import assert from "node:assert/strict";
import test from "node:test";
import { toJson, toJsonRawDump, toMarkdown, toMarkdownRawDump } from "../src/output.js";
import type { DebugPacket, RawDumpResult, Warning } from "../src/types.js";

const packet: DebugPacket = {
  summary: "The log shows a request failure caused by repeated timeout errors.",
  category: "Timeout",
  likelyCause: "A long-running operation or unavailable downstream dependency.",
  relevantLines: [{ line: 5, text: "ERROR TimeoutException: The operation timed out", isMatch: true }],
  nextChecks: ["Check the downstream dependency."],
  confidence: "Medium",
  context: {
    correlationId: "req_7f92",
    endpoint: "GET /api/orders/active",
    status: "500",
    durationMs: "61012"
  }
};

const warnings: Warning[] = [
  { type: "Possible IP address", value: "192.168.0.1", count: 1 },
  { type: "Possible email address", value: "[REDACTED:email]", count: 3 }
];

test("toMarkdown renders a Context section with correlation ID, endpoint, status, and duration", () => {
  const markdown = toMarkdown(packet, warnings);

  assert.match(markdown, /## Context\n\n- Correlation ID: req_7f92\n- Endpoint: GET \/api\/orders\/active\n- Status: 500\n- Duration: 61012ms/);
});

test("toMarkdown renders 'Not found' for missing context fields", () => {
  const markdown = toMarkdown({ ...packet, context: { correlationId: null, endpoint: null, status: null, durationMs: null } }, warnings);

  assert.match(markdown, /## Context\n\n- Correlation ID: Not found\n- Endpoint: Not found\n- Status: Not found\n- Duration: Not found/);
});

test("toMarkdown renders warnings with a count when they occurred more than once", () => {
  const markdown = toMarkdown(packet, warnings);

  assert.match(markdown, /- Possible IP address: `192\.168\.0\.1`\n- Possible email address: `\[REDACTED:email\]` \(×3\)/);
});

test("toJson serialises the packet and warnings", () => {
  const json = toJson(packet, warnings);
  const parsed = JSON.parse(json);

  assert.deepEqual(parsed.packet, packet);
  assert.deepEqual(parsed.warnings, warnings);
});

const rawDumpResult: RawDumpResult = {
  matches: [
    {
      category: "Timeout",
      summary: "The log shows a request failure caused by repeated timeout errors.",
      likelyCause: "A long-running operation or unavailable downstream dependency.",
      relevantLines: [{ line: 5, text: "ERROR TimeoutException: The operation timed out", isMatch: true }],
      nextChecks: ["Check the downstream dependency."],
      confidence: "Medium",
      score: 3
    },
    {
      category: "Authentication Failure",
      summary: "The log shows repeated authentication or authorization failures.",
      likelyCause: "Expired or invalid credentials/tokens.",
      relevantLines: [{ line: 12, text: "ERROR Authentication failed: invalid token", isMatch: true }],
      nextChecks: ["Verify the token or credential."],
      confidence: "Medium",
      score: 2
    }
  ],
  additionalMatchCount: 1,
  context: {
    correlationId: "req_7f92",
    endpoint: "GET /api/orders/active",
    status: "500",
    durationMs: "61012"
  },
  totalLines: 120,
  truncatedLineCount: 20,
  uncategorizedLineCount: 4
};

test("toMarkdownRawDump renders an overview, one section per match, and the additional-matches note", () => {
  const markdown = toMarkdownRawDump(rawDumpResult, warnings);

  assert.match(markdown, /- Lines analysed: 100 of 120/);
  assert.match(markdown, /- Truncated lines: 20 \(excluded from analysis\)/);
  assert.match(markdown, /- Matches found: 2/);
  assert.match(markdown, /## Match 1: Timeout/);
  assert.match(markdown, /## Match 2: Authentication Failure/);
  assert.match(markdown, /_1 additional lower-confidence match not shown\._/);
  assert.match(markdown, /## Context\n\n- Correlation ID: req_7f92/);
});

test("toMarkdownRawDump renders a no-match state when there are no matches", () => {
  const markdown = toMarkdownRawDump({ ...rawDumpResult, matches: [], additionalMatchCount: 0 }, warnings);

  assert.match(markdown, /No known pattern was confidently matched anywhere in this dump\./);
});

test("toJsonRawDump serialises the result and warnings", () => {
  const json = toJsonRawDump(rawDumpResult, warnings);
  const parsed = JSON.parse(json);

  assert.deepEqual(parsed.result, rawDumpResult);
  assert.deepEqual(parsed.warnings, warnings);
});
