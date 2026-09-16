#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { explainRawDump, explainRawLog } from "./explain.js";
import { toJson, toJsonRawDump, toMarkdown, toMarkdownRawDump } from "./output.js";
import { loadPatterns, loadRedactionRules, readPackageVersion } from "./pattern-loader.js";

const usage = `Usage: safe-log-explainer [options] [file]

Reads an application log from <file> (or stdin when <file> is "-" or omitted)
and prints a redacted debug packet you can hand to an AI assistant.

Options:
  -j, --json                   Output JSON instead of Markdown
  -r, --raw-dump               Treat the input as a large multi-incident dump and
                               report up to --max-matches ranked matches
      --no-redact              Leave sensitive values in place (local use only)
  -p, --patterns <file>        Error-pattern JSON to use instead of the bundled set
      --redaction-rules <file> Extra redaction rules JSON, appended to the built-ins
  -c, --context <n>            Context lines shown around each matched line (default 2)
  -m, --max-matches <n>        Raw dump only: matches to report (default 5)
  -h, --help                   Show this help
  -v, --version                Show the version
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => Promise<string>;
  stdinIsTty: boolean;
}

const defaultIo: CliIo = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  readStdin: async () => {
    let content = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
      content += chunk;
    }
    return content;
  },
  stdinIsTty: process.stdin.isTTY === true
};

function parseCount(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

const cliOptions = {
  json: { type: "boolean", short: "j", default: false },
  "raw-dump": { type: "boolean", short: "r", default: false },
  "no-redact": { type: "boolean", default: false },
  patterns: { type: "string", short: "p" },
  "redaction-rules": { type: "string" },
  context: { type: "string", short: "c" },
  "max-matches": { type: "string", short: "m" },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false }
} as const;

function parseCliArgs(args: string[]) {
  return parseArgs({ args, options: cliOptions, allowPositionals: true });
}

export async function run(args: string[], io: CliIo = defaultIo): Promise<number> {
  let parsed: ReturnType<typeof parseCliArgs>;

  try {
    parsed = parseCliArgs(args);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}

${usage}`);
    return 1;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    io.stdout(usage);
    return 0;
  }

  if (values.version) {
    io.stdout(`${readPackageVersion()}\n`);
    return 0;
  }

  if (positionals.length > 1) {
    io.stderr(`Expected at most one file argument, got ${positionals.length}.\n\n${usage}`);
    return 1;
  }

  const filePath = positionals[0];
  const readFromStdin = filePath === undefined || filePath === "-";

  if (readFromStdin && io.stdinIsTty) {
    io.stderr(usage);
    return 1;
  }

  try {
    const rawContent = readFromStdin ? await io.readStdin() : readFileSync(filePath, "utf8");
    const patterns = loadPatterns(values.patterns);
    const redactionRules = values["redaction-rules"] === undefined ? undefined : loadRedactionRules(values["redaction-rules"]);
    const redact = !values["no-redact"];
    const contextWindow = parseCount(values.context, "--context");

    if (values["raw-dump"]) {
      const maxMatches = parseCount(values["max-matches"], "--max-matches");
      const { result, warnings } = explainRawDump(rawContent, patterns, { redact, contextWindow, maxMatches, redactionRules });
      io.stdout(values.json ? `${toJsonRawDump(result, warnings)}\n` : toMarkdownRawDump(result, warnings));
    } else {
      const { packet, warnings } = explainRawLog(rawContent, patterns, { redact, contextWindow, redactionRules });
      io.stdout(values.json ? `${toJson(packet, warnings)}\n` : toMarkdown(packet, warnings));
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`safe-log-explainer: ${message}\n`);
    return 1;
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  run(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
