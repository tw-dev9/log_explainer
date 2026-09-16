import assert from "node:assert/strict";
import test from "node:test";
import { analyseLog, analyseRawDump, extractContext, extractRelevantLines, matchPatterns, selectStrongestPattern } from "../src/parser.js";
import { loadPatterns } from "../src/pattern-loader.js";

const patterns = loadPatterns();

test("analyseLog detects timeout failures using the default pattern file", () => {
  const packet = analyseLog(
    [
      "INFO Request started",
      "ERROR TimeoutException: The operation timed out after 30 seconds",
      "WARN Retrying request"
    ],
    patterns
  );

  assert.equal(packet.category, "Timeout");
  assert.equal(packet.confidence, "Medium");
  assert.deepEqual(packet.relevantLines, [
    { line: 1, text: "INFO Request started", isMatch: false },
    { line: 2, text: "ERROR TimeoutException: The operation timed out after 30 seconds", isMatch: true },
    { line: 3, text: "WARN Retrying request", isMatch: true }
  ]);
});

test("analyseLog detects application crashes using the default pattern file", () => {
  const packet = analyseLog(
    [
      "INFO Request started",
      "ERROR Unhandled exception: NullReferenceException: Object reference not set to an instance of an object",
      "ERROR   at ReportService.BuildSummary(ReportRequest request)"
    ],
    patterns
  );

  assert.equal(packet.category, "Application Crash");
  assert.equal(packet.confidence, "Medium");
});

test("analyseLog detects authentication failures using the default pattern file", () => {
  const packet = analyseLog(
    ["INFO Request started", "ERROR Authentication failed: invalid token", "WARN Unauthorized access attempt status=401"],
    patterns
  );

  assert.equal(packet.category, "Authentication Failure");
  assert.equal(packet.confidence, "Medium");
});

test("analyseLog detects rate limiting using the default pattern file", () => {
  const packet = analyseLog(
    [
      "INFO Request started",
      "WARN Rate limit exceeded for client",
      "ERROR Too many requests: quota exceeded (120/100 per minute)"
    ],
    patterns
  );

  assert.equal(packet.category, "Rate Limiting");
  assert.equal(packet.confidence, "Medium");
});

test("analyseLog falls back to unknown when no pattern matches", () => {
  const packet = analyseLog(["INFO Request started", "ERROR Something broke"], patterns);

  assert.equal(packet.category, "Unknown");
  assert.equal(packet.confidence, "Low");
});

test("analyseLog falls back to unknown when given no patterns at all", () => {
  const packet = analyseLog(["ERROR TimeoutException: The operation timed out"], []);

  assert.equal(packet.category, "Unknown");
});

test("selectStrongestPattern picks the pattern with the most keyword hits", () => {
  const best = selectStrongestPattern(
    [
      "ERROR Too many requests: quota exceeded",
      "ERROR status=429",
      "WARN Rate limit exceeded",
      "ERROR Authentication failed: invalid token"
    ],
    patterns
  );

  assert.equal(best?.category, "Rate Limiting");
});

test("selectStrongestPattern returns null when nothing matches", () => {
  const best = selectStrongestPattern(["INFO all good"], patterns);

  assert.equal(best, null);
});

test("extractRelevantLines flags error-like lines and includes surrounding context", () => {
  const entries = extractRelevantLines(
    ["INFO all good", "ERROR failure", "WARN slow request", "Exception thrown", "operation timeout", "Retry failed"],
    { contextWindow: 1 }
  );

  assert.deepEqual(
    entries.filter((entry) => entry.isMatch).map((entry) => entry.text),
    ["ERROR failure", "WARN slow request", "Exception thrown", "operation timeout", "Retry failed"]
  );
  assert.deepEqual(entries[0], { line: 1, text: "INFO all good", isMatch: false });
});

test("extractRelevantLines inserts a gap between distant matches and caps the total", () => {
  const lines = Array.from({ length: 20 }, (_, index) => `INFO line ${index + 1}`);
  lines[2] = "ERROR first";
  lines[15] = "ERROR second";

  const entries = extractRelevantLines(lines, { contextWindow: 1 });
  assert.deepEqual(
    entries.map((entry) => entry.line),
    [2, 3, 4, 15, 16, 17]
  );

  const capped = extractRelevantLines(lines, { contextWindow: 1, maxLines: 2 });
  assert.equal(capped.length, 2);
});

test("extractContext finds all fields when present", () => {
  assert.deepEqual(
    extractContext([
      "INFO Request started GET /api/orders/active correlationId=req_7f92",
      "ERROR Retry failed correlationId=req_7f92 durationMs=61012",
      "INFO Request completed GET /api/orders/active status=500 durationMs=61012"
    ]),
    {
      correlationId: "req_7f92",
      endpoint: "GET /api/orders/active",
      status: "500",
      durationMs: "61012"
    }
  );
});

test("extractContext returns null for missing fields", () => {
  assert.deepEqual(extractContext(["ERROR Retry failed correlationId=req_7f92"]), {
    correlationId: "req_7f92",
    endpoint: null,
    status: null,
    durationMs: null
  });
});

test("matchPatterns returns every pattern that matched, ranked by score, with per-pattern matched lines", () => {
  const matches = matchPatterns(
    [
      "INFO Request started",
      "ERROR TimeoutException: The operation timed out",
      "WARN Retrying request",
      "ERROR Authentication failed: invalid token",
      "WARN Unauthorized access attempt status=401"
    ],
    patterns
  );

  const categories = matches.map((match) => match.pattern.category);
  assert.deepEqual(categories, ["Authentication Failure", "Timeout"]);

  const authMatch = matches.find((match) => match.pattern.category === "Authentication Failure");
  assert.deepEqual(authMatch?.matchedLines, [
    "ERROR Authentication failed: invalid token",
    "WARN Unauthorized access attempt status=401"
  ]);

  const timeoutMatch = matches.find((match) => match.pattern.category === "Timeout");
  assert.deepEqual(timeoutMatch?.matchedLines, ["ERROR TimeoutException: The operation timed out"]);
});

test("matchPatterns returns an empty array when nothing matches", () => {
  assert.deepEqual(matchPatterns(["INFO all good"], patterns), []);
});

test("matchPatterns includes a line in every pattern it matches", () => {
  const matches = matchPatterns(["ERROR Too many requests: quota exceeded, status=401 unauthorized"], patterns);

  const rateLimit = matches.find((match) => match.pattern.category === "Rate Limiting");
  const auth = matches.find((match) => match.pattern.category === "Authentication Failure");

  assert.ok(rateLimit?.matchedLines.includes("ERROR Too many requests: quota exceeded, status=401 unauthorized"));
  assert.ok(auth?.matchedLines.includes("ERROR Too many requests: quota exceeded, status=401 unauthorized"));
});

test("analyseRawDump ranks and caps matches, reporting the overflow count", () => {
  const result = analyseRawDump(
    [
      "ERROR TimeoutException: The operation timed out",
      "ERROR Authentication failed: invalid token",
      "WARN Unauthorized access attempt status=401",
      "WARN Rate limit exceeded for client"
    ],
    patterns,
    { maxMatches: 1 }
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].category, "Authentication Failure");
  assert.equal(result.additionalMatchCount, 2);
  assert.equal(result.totalLines, 4);
});

test("analyseRawDump reports uncategorized relevant lines not claimed by any top match", () => {
  const result = analyseRawDump(
    ["ERROR TimeoutException: The operation timed out", "ERROR Something else broke unexpectedly"],
    patterns
  );

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].category, "Timeout");
  assert.equal(result.uncategorizedLineCount, 1);
});

test("analyseRawDump returns an empty match list without throwing when nothing matches", () => {
  const result = analyseRawDump(["INFO all good"], patterns);

  assert.deepEqual(result.matches, []);
  assert.equal(result.additionalMatchCount, 0);
  assert.equal(result.uncategorizedLineCount, 0);
});

test("analyseRawDump truncates input beyond the configurable line cap and reports the count", () => {
  const lines = Array.from({ length: 30 }, (_, index) => `INFO noise line ${index}`);
  lines[5] = "ERROR TimeoutException: The operation timed out";
  lines[25] = "ERROR Authentication failed: invalid token";

  const result = analyseRawDump(lines, patterns, { maxLines: 10 });

  assert.equal(result.totalLines, 30);
  assert.equal(result.truncatedLineCount, 20);
  assert.deepEqual(
    result.matches.map((match) => match.category),
    ["Timeout"]
  );
});

test("analyseRawDump caps per-match evidence lines without losing the true score", () => {
  const lines = Array.from({ length: 50 }, (_, index) => `ERROR TimeoutException: The operation timed out (${index})`);

  const result = analyseRawDump(lines, patterns, { maxEvidenceLines: 5 });

  assert.equal(result.matches[0].relevantLines.length, 5);
  assert.equal(result.matches[0].score, 150);
});

test("analyseRawDump stays bounded and accurate for a large generated input", () => {
  const lines = Array.from({ length: 50000 }, (_, index) =>
    index % 1000 === 0 ? "ERROR TimeoutException: The operation timed out" : "INFO steady state, all systems nominal"
  );

  const result = analyseRawDump(lines, patterns);

  assert.equal(result.totalLines, 50000);
  assert.equal(result.truncatedLineCount, 30000);
  assert.equal(result.matches[0].category, "Timeout");
  assert.ok(result.matches[0].relevantLines.length <= 500);
});

test("analyseRawDump populates a shared context from the whole input", () => {
  const result = analyseRawDump(
    [
      "INFO Request started GET /api/orders/active correlationId=req_7f92",
      "ERROR TimeoutException: The operation timed out",
      "INFO Request completed GET /api/orders/active status=500 durationMs=61012"
    ],
    patterns
  );

  assert.deepEqual(result.context, {
    correlationId: "req_7f92",
    endpoint: "GET /api/orders/active",
    status: "500",
    durationMs: "61012"
  });
});

test("extractContext returns all nulls when nothing matches", () => {
  assert.deepEqual(extractContext(["INFO Request started", "ERROR Something broke"]), {
    correlationId: null,
    endpoint: null,
    status: null,
    durationMs: null
  });
});
