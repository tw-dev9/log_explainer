import { analyseLog, analyseRawDump } from "./parser.js";
import { aggregateWarnings, defaultRedactionRules, detectSensitiveData, redactSensitiveData, type RedactionRule } from "./sanitiser.js";
import type { DebugPacket, DebugPacketContext, EvidenceLine, ErrorPattern, RawDumpResult, Warning } from "./types.js";

export interface ExplanationResult {
  packet: DebugPacket;
  warnings: Warning[];
}

export interface ExplainOptions {
  redact?: boolean;
  contextWindow?: number;
  redactionRules?: RedactionRule[];
}

export interface RawDumpExplanationResult {
  result: RawDumpResult;
  warnings: Warning[];
}

export interface ExplainRawDumpOptions {
  redact?: boolean;
  maxMatches?: number;
  contextWindow?: number;
  redactionRules?: RedactionRule[];
}

export function explainRawLog(
  rawContent: string,
  patterns: ErrorPattern[],
  options: ExplainOptions = {}
): ExplanationResult {
  const redactor = makeRedactor(options);
  const lines = splitLines(rawContent);
  const packet = analyseLog(lines, patterns, { contextWindow: options.contextWindow });

  return {
    packet: {
      ...packet,
      relevantLines: redactEvidenceLines(packet.relevantLines, redactor),
      context: redactContext(packet.context, redactor)
    },
    warnings: collectWarnings(rawContent, redactor)
  };
}

export function explainRawDump(
  rawContent: string,
  patterns: ErrorPattern[],
  options: ExplainRawDumpOptions = {}
): RawDumpExplanationResult {
  const redactor = makeRedactor(options);
  const lines = splitLines(rawContent);
  const result = analyseRawDump(lines, patterns, { maxMatches: options.maxMatches, contextWindow: options.contextWindow });

  return {
    result: {
      ...result,
      matches: result.matches.map((match) => ({
        ...match,
        relevantLines: redactEvidenceLines(match.relevantLines, redactor)
      })),
      context: redactContext(result.context, redactor)
    },
    warnings: collectWarnings(rawContent, redactor)
  };
}

function splitLines(rawContent: string): string[] {
  const lines = rawContent.split(/\r?\n/);

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines;
}

interface Redactor {
  enabled: boolean;
  rules: RedactionRule[];
  apply: (text: string) => string;
}

function makeRedactor(options: { redact?: boolean; redactionRules?: RedactionRule[] }): Redactor {
  const enabled = options.redact ?? true;
  const rules = options.redactionRules ?? defaultRedactionRules;
  return {
    enabled,
    rules,
    apply: (text) => (enabled ? redactSensitiveData(text, rules) : text)
  };
}

function redactEvidenceLines(entries: EvidenceLine[], redactor: Redactor): EvidenceLine[] {
  return redactor.enabled ? entries.map((entry) => ({ ...entry, text: redactor.apply(entry.text) })) : entries;
}

function redactContext(context: DebugPacketContext, redactor: Redactor): DebugPacketContext {
  return {
    ...context,
    correlationId: context.correlationId !== null ? redactor.apply(context.correlationId) : null,
    endpoint: context.endpoint !== null ? redactor.apply(context.endpoint) : null
  };
}

function collectWarnings(rawContent: string, redactor: Redactor): Warning[] {
  const warnings = detectSensitiveData(rawContent, redactor.rules).map((warning) => ({
    ...warning,
    value: redactor.apply(warning.value)
  }));

  return aggregateWarnings(warnings);
}
