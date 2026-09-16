import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRedactionRules, type RedactionRule } from "./sanitiser.js";
import type { ErrorPattern } from "./types.js";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultPatternsPath = resolve(packageRoot, "patterns", "default-patterns.json");

export function loadPatterns(path: string = defaultPatternsPath): ErrorPattern[] {
  const raw = readFileSync(path, "utf8");
  const patterns = JSON.parse(raw) as ErrorPattern[];

  if (!Array.isArray(patterns)) {
    throw new Error(`Pattern file ${path} must contain a JSON array`);
  }

  for (const pattern of patterns) {
    if (typeof pattern.id !== "string" || typeof pattern.category !== "string" || !Array.isArray(pattern.keywords)) {
      throw new Error(`Pattern file ${path}: every entry needs "id", "category" and "keywords"`);
    }
  }

  return patterns;
}

// JSON shape for a user-supplied redaction rule. `pattern` is a regex source
// string; `flags` defaults to "g" and always has "g" added if missing.
export interface RedactionRuleDefinition {
  type: string;
  label?: string;
  pattern: string;
  flags?: string;
  replacement?: string;
}

export function parseRedactionRules(definitions: RedactionRuleDefinition[], source = "redaction rules"): RedactionRule[] {
  if (!Array.isArray(definitions)) {
    throw new Error(`${source} must be a JSON array`);
  }

  return definitions.map((definition, index) => {
    if (typeof definition.type !== "string" || typeof definition.pattern !== "string") {
      throw new Error(`${source}: entry ${index} needs "type" and "pattern"`);
    }

    const flags = definition.flags ?? "g";
    return {
      type: definition.type,
      label: definition.label ?? `Possible ${definition.type}`,
      pattern: new RegExp(definition.pattern, flags.includes("g") ? flags : `${flags}g`),
      replacement: definition.replacement ?? `[REDACTED:${definition.type}]`
    };
  });
}

// Loads extra rules from a JSON file and appends them to the built-in set.
export function loadRedactionRules(path: string): RedactionRule[] {
  const raw = readFileSync(path, "utf8");
  return [...defaultRedactionRules, ...parseRedactionRules(JSON.parse(raw) as RedactionRuleDefinition[], path)];
}

export function readPackageVersion(): string {
  const raw = readFileSync(resolve(packageRoot, "package.json"), "utf8");
  return (JSON.parse(raw) as { version: string }).version;
}
