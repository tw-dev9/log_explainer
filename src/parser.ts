import type { DebugPacket, DebugPacketContext, EvidenceLine, ErrorPattern, PatternMatch, RawDumpMatch, RawDumpResult } from "./types.js";

const defaultMaxRawDumpMatches = 5;
const defaultMaxRawDumpLines = 20000;
const defaultMaxRawDumpEvidenceLines = 500;
const defaultContextWindow = 2;
const defaultMaxGuidedEvidenceLines = 200;

const relevantLineTerms = [
  "error",
  "warn",
  "exception",
  "timeout",
  "failed",
  "fatal",
  "denied",
  "unauthorized",
  "quota",
  "throttle",
  "401",
  "403",
  "429"
];

const correlationIdPattern = /correlationId=([^\s]+)/i;
const endpointPattern = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s(\/[^\s]*)/;
const statusPattern = /\bstatus=([^\s]+)/i;
const durationPattern = /\bdurationMs=([^\s]+)/i;

export interface EvidenceWindowOptions {
  contextWindow?: number;
  maxLines?: number;
}

function isRelevantLine(line: string): boolean {
  const lower = line.toLowerCase();
  return relevantLineTerms.some((term) => lower.includes(term));
}

function findMatchingIndices(lines: string[], predicate: (line: string) => boolean): number[] {
  const indices: number[] = [];
  lines.forEach((line, index) => {
    if (predicate(line)) indices.push(index);
  });
  return indices;
}

function buildEvidenceWindows(
  lines: string[],
  matchedIndices: number[],
  options: EvidenceWindowOptions = {}
): EvidenceLine[] {
  const contextWindow = options.contextWindow ?? defaultContextWindow;
  const matchedSet = new Set(matchedIndices);
  const included = new Set<number>();

  for (const index of matchedIndices) {
    const start = Math.max(0, index - contextWindow);
    const end = Math.min(lines.length - 1, index + contextWindow);
    for (let i = start; i <= end; i++) {
      included.add(i);
    }
  }

  const entries = Array.from(included)
    .sort((a, b) => a - b)
    .map(
      (index): EvidenceLine => ({
        line: index + 1,
        text: lines[index],
        isMatch: matchedSet.has(index)
      })
    );

  return options.maxLines !== undefined ? entries.slice(0, options.maxLines) : entries;
}

export function analyseLog(lines: string[], patterns: ErrorPattern[], options: EvidenceWindowOptions = {}): DebugPacket {
  const relevantLines = extractRelevantLines(lines, {
    contextWindow: options.contextWindow,
    maxLines: options.maxLines ?? defaultMaxGuidedEvidenceLines
  });
  const context = extractContext(lines);
  const bestPattern = selectStrongestPattern(lines, patterns);

  if (bestPattern === null) {
    return {
      summary: "The log contains errors, but no known pattern was confidently matched.",
      category: "Unknown",
      likelyCause: "No known pattern matched. Manual review is required.",
      relevantLines,
      nextChecks: [
        "Review ERROR and WARN lines.",
        "Look for correlation IDs.",
        "Check recent deployments.",
        "Compare with previous known incidents."
      ],
      confidence: "Low",
      context
    };
  }

  return {
    summary: bestPattern.summary,
    category: bestPattern.category,
    likelyCause: bestPattern.likelyCause,
    relevantLines,
    nextChecks: bestPattern.nextChecks,
    confidence: bestPattern.confidence,
    context
  };
}

export function analyseRawDump(
  lines: string[],
  patterns: ErrorPattern[],
  options: { maxMatches?: number; maxLines?: number; maxEvidenceLines?: number; contextWindow?: number } = {}
): RawDumpResult {
  const maxLines = options.maxLines ?? defaultMaxRawDumpLines;
  const maxEvidenceLines = options.maxEvidenceLines ?? defaultMaxRawDumpEvidenceLines;
  const maxMatches = options.maxMatches ?? defaultMaxRawDumpMatches;
  const contextWindow = options.contextWindow ?? defaultContextWindow;
  const analysedLines = lines.slice(0, maxLines);
  const allMatches = matchPatterns(analysedLines, patterns);
  const topMatches = allMatches.slice(0, maxMatches);
  const claimedLines = new Set(topMatches.flatMap((match) => match.matchedLines));
  const uncategorizedLineCount = extractRelevantLines(analysedLines)
    .filter((entry) => entry.isMatch && !claimedLines.has(entry.text)).length;

  return {
    matches: topMatches.map((match): RawDumpMatch => ({
      category: match.pattern.category,
      summary: match.pattern.summary,
      likelyCause: match.pattern.likelyCause,
      relevantLines: buildEvidenceWindows(analysedLines, match.matchedLineIndices, {
        contextWindow,
        maxLines: maxEvidenceLines
      }),
      nextChecks: match.pattern.nextChecks,
      confidence: match.pattern.confidence,
      score: match.score
    })),
    additionalMatchCount: Math.max(allMatches.length - topMatches.length, 0),
    context: extractContext(analysedLines),
    totalLines: lines.length,
    truncatedLineCount: Math.max(lines.length - analysedLines.length, 0),
    uncategorizedLineCount
  };
}

export function matchPatterns(
  lines: string[],
  patterns: ErrorPattern[],
  options: { minScore?: number } = {}
): PatternMatch[] {
  const minScore = options.minScore ?? 0;
  const matches: PatternMatch[] = [];

  for (const pattern of patterns) {
    const score = scoreKeywordMatches(lines, pattern.keywords);

    if (score > minScore) {
      const matchedLineIndices = matchedIndicesForKeywords(lines, pattern.keywords);
      matches.push({
        pattern,
        score,
        matchedLines: matchedLineIndices.map((i) => lines[i]),
        matchedLineIndices
      });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

function matchedIndicesForKeywords(lines: string[], keywords: string[]): number[] {
  return findMatchingIndices(lines, (line) => {
    const lower = line.toLowerCase();
    return keywords.some((keyword) => lower.includes(keyword.toLowerCase()));
  });
}

export function selectStrongestPattern(lines: string[], patterns: ErrorPattern[]): ErrorPattern | null {
  let bestPattern: ErrorPattern | null = null;
  let bestScore = 0;

  for (const pattern of patterns) {
    const score = scoreKeywordMatches(lines, pattern.keywords);

    if (score > bestScore) {
      bestScore = score;
      bestPattern = pattern;
    }
  }

  return bestPattern;
}

export function extractContext(lines: string[]): DebugPacketContext {
  const content = lines.join("\n");
  const endpointMatch = content.match(endpointPattern);

  return {
    correlationId: content.match(correlationIdPattern)?.[1] ?? null,
    endpoint: endpointMatch ? `${endpointMatch[1]} ${endpointMatch[2]}` : null,
    status: content.match(statusPattern)?.[1] ?? null,
    durationMs: content.match(durationPattern)?.[1] ?? null
  };
}

export function extractRelevantLines(lines: string[], options: EvidenceWindowOptions = {}): EvidenceLine[] {
  const matchedIndices = findMatchingIndices(lines, isRelevantLine);
  return buildEvidenceWindows(lines, matchedIndices, options);
}

function scoreKeywordMatches(lines: string[], keywords: string[]): number {
  let score = 0;

  for (const line of lines) {
    const lower = line.toLowerCase();

    for (const keyword of keywords) {
      if (lower.includes(keyword.toLowerCase())) {
        score++;
      }
    }
  }

  return score;
}
