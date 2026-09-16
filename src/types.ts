export interface EvidenceLine {
  line: number;
  text: string;
  isMatch: boolean;
}

export interface DebugPacketContext {
  correlationId: string | null;
  endpoint: string | null;
  status: string | null;
  durationMs: string | null;
}

export interface DebugPacket {
  summary: string;
  category: string;
  likelyCause: string;
  relevantLines: EvidenceLine[];
  nextChecks: string[];
  confidence: string;
  context: DebugPacketContext;
}

export interface Warning {
  type: string;
  value: string;
  count: number;
}

export interface ErrorPattern {
  id: string;
  category: string;
  keywords: string[];
  summary: string;
  likelyCause: string;
  nextChecks: string[];
  confidence: string;
}

export interface PatternMatch {
  pattern: ErrorPattern;
  score: number;
  matchedLines: string[];
  matchedLineIndices: number[];
}

export interface RawDumpMatch {
  category: string;
  summary: string;
  likelyCause: string;
  relevantLines: EvidenceLine[];
  nextChecks: string[];
  confidence: string;
  score: number;
}

export interface RawDumpResult {
  matches: RawDumpMatch[];
  additionalMatchCount: number;
  context: DebugPacketContext;
  totalLines: number;
  truncatedLineCount: number;
  uncategorizedLineCount: number;
}
