import assert from "node:assert/strict";
import test from "node:test";
import { explainRawDump, explainRawLog } from "../src/explain.js";
import { loadPatterns } from "../src/pattern-loader.js";
import { defaultRedactionRules } from "../src/sanitiser.js";

const patterns = loadPatterns();

const rawSample = [
  "INFO Request started",
  "ERROR TimeoutException: The operation timed out for userId=demo-123",
  "WARN Retrying request from 192.168.0.1",
  ""
].join("\n");

const rawSampleWithContext = [
  "INFO Request started GET /api/orders/active correlationId=req_7f92",
  "INFO User context loaded userId=demo-123",
  "ERROR TimeoutException: The operation timed out",
  "INFO Request completed GET /api/orders/active status=500 durationMs=61012",
  ""
].join("\n");

test("explainRawLog analyses raw content and redacts sensitive data from relevantLines", () => {
  const result = explainRawLog(rawSample, patterns);

  assert.equal(result.packet.category, "Timeout");
  assert.equal(result.packet.confidence, "Medium");
  assert.deepEqual(result.packet.relevantLines, [
    { line: 1, text: "INFO Request started", isMatch: false },
    { line: 2, text: "ERROR TimeoutException: The operation timed out for userId=[REDACTED:userId]", isMatch: true },
    { line: 3, text: "WARN Retrying request from [REDACTED:ip]", isMatch: true }
  ]);
  assert.deepEqual(result.warnings, [
    { type: "Possible IP address", value: "[REDACTED:ip]", count: 1 },
    { type: "Possible user identifier", value: "userId=[REDACTED:userId]", count: 1 }
  ]);
});

test("explainRawLog keeps relevantLines and warnings unredacted when redact is disabled", () => {
  const result = explainRawLog(rawSample, patterns, { redact: false });

  assert.deepEqual(
    result.packet.relevantLines.map((entry) => entry.text),
    ["INFO Request started", "ERROR TimeoutException: The operation timed out for userId=demo-123", "WARN Retrying request from 192.168.0.1"]
  );
  assert.deepEqual(result.warnings, [
    { type: "Possible IP address", value: "192.168.0.1", count: 1 },
    { type: "Possible user identifier", value: "userId=demo-123", count: 1 }
  ]);
});

test("explainRawLog populates packet.context from correlation ID, endpoint, status, and duration", () => {
  const result = explainRawLog(rawSampleWithContext, patterns);

  assert.deepEqual(result.packet.context, {
    correlationId: "req_7f92",
    endpoint: "GET /api/orders/active",
    status: "500",
    durationMs: "61012"
  });
});

test("explainRawLog redacts sensitive context values (correlationId, endpoint) the same as relevantLines", () => {
  const rawWithSensitiveCorrelationId = [
    "INFO Request started GET /api/orders/active correlationId=192.168.0.5",
    "ERROR TimeoutException: The operation timed out"
  ].join("\n");

  const redacted = explainRawLog(rawWithSensitiveCorrelationId, patterns);
  assert.equal(redacted.packet.context.correlationId, "[REDACTED:ip]");

  const unredacted = explainRawLog(rawWithSensitiveCorrelationId, patterns, { redact: false });
  assert.equal(unredacted.packet.context.correlationId, "192.168.0.5");
});

test("explainRawLog aggregates repeated warnings into one entry with a count", () => {
  const raw = ["ERROR timeout from 10.0.0.1", "ERROR timeout from 10.0.0.2", "ERROR timeout from 10.0.0.1"].join("\n");

  const redacted = explainRawLog(raw, patterns);
  assert.deepEqual(redacted.warnings, [{ type: "Possible IP address", value: "[REDACTED:ip]", count: 3 }]);

  const unredacted = explainRawLog(raw, patterns, { redact: false });
  assert.deepEqual(unredacted.warnings, [
    { type: "Possible IP address", value: "10.0.0.1", count: 2 },
    { type: "Possible IP address", value: "10.0.0.2", count: 1 }
  ]);
});

test("explainRawLog applies user-supplied redaction rules alongside the defaults", () => {
  const raw = "ERROR timeout on host db-primary.corp.example from 192.168.0.1";
  const rules = [
    ...defaultRedactionRules,
    { type: "hostname", label: "Internal hostname", pattern: /[a-z0-9-]+\.corp\.example/g, replacement: "[REDACTED:hostname]" }
  ];

  const result = explainRawLog(raw, patterns, { redactionRules: rules });
  assert.equal(result.packet.relevantLines[0]?.text, "ERROR timeout on host [REDACTED:hostname] from [REDACTED:ip]");
  assert.ok(result.warnings.some((warning) => warning.type === "Internal hostname"));
});

test("explainRawLog sets missing context fields to null", () => {
  const result = explainRawLog(rawSample, patterns);

  assert.deepEqual(result.packet.context, {
    correlationId: null,
    endpoint: null,
    status: null,
    durationMs: null
  });
});

const rawDumpSample = [
  "INFO Request started",
  "ERROR TimeoutException: The operation timed out for userId=demo-123",
  "WARN Retrying request from 192.168.0.1",
  "ERROR Authentication failed: invalid token for userId=demo-456",
  "WARN Unauthorized access attempt status=401",
  ""
].join("\n");

test("explainRawDump returns ranked matches and redacts sensitive data from each match's relevantLines", () => {
  const { result, warnings } = explainRawDump(rawDumpSample, patterns);

  assert.deepEqual(
    result.matches.map((match) => match.category),
    ["Authentication Failure", "Timeout"]
  );
  assert.deepEqual(
    result.matches[0].relevantLines.filter((entry) => entry.isMatch),
    [
      { line: 4, text: "ERROR Authentication failed: invalid token for userId=[REDACTED:userId]", isMatch: true },
      { line: 5, text: "WARN Unauthorized access attempt status=401", isMatch: true }
    ]
  );
  assert.deepEqual(
    result.matches[1].relevantLines.filter((entry) => entry.isMatch),
    [{ line: 2, text: "ERROR TimeoutException: The operation timed out for userId=[REDACTED:userId]", isMatch: true }]
  );
  assert.ok(result.matches[0].relevantLines.every((entry) => !entry.text.includes("192.168.0.1")));
  assert.equal(result.additionalMatchCount, 0);
  assert.equal(result.totalLines, 5);
  assert.ok(warnings.some((warning) => warning.type === "Possible IP address" && warning.value === "[REDACTED:ip]"));
});

test("explainRawDump keeps relevantLines and warnings unredacted when redact is disabled", () => {
  const { result, warnings } = explainRawDump(rawDumpSample, patterns, { redact: false });

  const timeoutMatch = result.matches.find((match) => match.category === "Timeout");
  assert.deepEqual(
    timeoutMatch?.relevantLines.filter((entry) => entry.isMatch),
    [{ line: 2, text: "ERROR TimeoutException: The operation timed out for userId=demo-123", isMatch: true }]
  );
  assert.ok(warnings.some((warning) => warning.type === "Possible IP address" && warning.value === "192.168.0.1"));
});

test("explainRawDump caps matches via maxMatches and reports the overflow count", () => {
  const { result } = explainRawDump(rawDumpSample, patterns, { maxMatches: 1 });

  assert.equal(result.matches.length, 1);
  assert.equal(result.additionalMatchCount, 1);
});

test("explainRawDump returns an empty match list without throwing for input with no known pattern", () => {
  const { result, warnings } = explainRawDump("INFO all good\n", patterns);

  assert.deepEqual(result.matches, []);
  assert.deepEqual(warnings, []);
});
