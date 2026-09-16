import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const cliPath = join("dist", "src", "cli.js");
const fixturePath = join("test", "fixtures", "synthetic-timeout-log.txt");
const goldenPath = join("test", "fixtures", "timeout-debug-packet.md");

function runCli(args: string[], input?: string) {
  const result = spawnSync(process.execPath, [cliPath, ...args], { input, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("cli renders the golden Markdown packet for a file argument", () => {
  const { code, stdout, stderr } = runCli([fixturePath]);

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(stdout.replace(/\r\n/g, "\n"), readFileSync(goldenPath, "utf8").replace(/\r\n/g, "\n"));
});

test("cli reads from stdin when no file is given", () => {
  const { code, stdout } = runCli([], readFileSync(fixturePath, "utf8"));

  assert.equal(code, 0);
  assert.match(stdout, /## Error category\n\nTimeout/);
});

test("cli --json emits a parseable packet with instructions and aggregated warnings", () => {
  const { code, stdout } = runCli(["--json", fixturePath]);
  const parsed = JSON.parse(stdout);

  assert.equal(code, 0);
  assert.equal(typeof parsed.instructions, "string");
  assert.equal(parsed.packet.category, "Timeout");
  assert.ok(parsed.warnings.every((warning: { count: number }) => Number.isInteger(warning.count)));
});

test("cli --no-redact leaves sensitive values in place", () => {
  const redacted = runCli([fixturePath]).stdout;
  const unredacted = runCli(["--no-redact", fixturePath]).stdout;

  const warningsSection = (markdown: string) => markdown.slice(markdown.indexOf("## Sensitive-data warnings"));

  assert.match(warningsSection(redacted), /\[REDACTED:email\]/);
  assert.doesNotMatch(warningsSection(unredacted), /\[REDACTED:/);
  assert.match(warningsSection(unredacted), /jane\.doe@example\.com/);
});

test("cli --raw-dump renders ranked matches and honours --max-matches", () => {
  const dump = [
    "ERROR TimeoutException: The operation timed out",
    "ERROR Authentication failed: invalid token",
    "WARN Unauthorized access attempt status=401",
    "WARN Rate limit exceeded for client"
  ].join("\n");

  const { code, stdout } = runCli(["--raw-dump", "--max-matches", "1"], dump);

  assert.equal(code, 0);
  assert.match(stdout, /# Debug Packet: Raw Dump/);
  assert.match(stdout, /## Match 1: Authentication Failure/);
  assert.match(stdout, /_2 additional lower-confidence matches not shown\._/);
});

test("cli --redaction-rules appends user rules to the built-ins", () => {
  const input = "ERROR timeout on db-primary.corp.example accountId=acc-42 from 192.168.0.1\n";
  const { code, stdout } = runCli(["--redaction-rules", join("patterns", "example-redaction-rules.json")], input);

  assert.equal(code, 0);
  assert.match(stdout, /\[REDACTED:hostname\] accountId=\[REDACTED:accountId\] from \[REDACTED:ip\]/);
});

test("cli --patterns loads an alternative error-pattern file", () => {
  const { code, stdout } = runCli(["--patterns", join("patterns", "default-patterns.json"), fixturePath]);

  assert.equal(code, 0);
  assert.match(stdout, /Timeout/);
});

test("cli --context widens the evidence window", () => {
  const narrow = JSON.parse(runCli(["--json", "--context", "0", fixturePath]).stdout);
  const wide = JSON.parse(runCli(["--json", "--context", "4", fixturePath]).stdout);

  assert.ok(narrow.packet.relevantLines.every((entry: { isMatch: boolean }) => entry.isMatch));
  assert.ok(wide.packet.relevantLines.length > narrow.packet.relevantLines.length);
});

test("cli --help and --version exit 0 and write to stdout", () => {
  const help = runCli(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /^Usage: safe-log-explainer/);

  const version = runCli(["-v"]);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
});

test("cli reports missing files and bad options on stderr with exit code 1", () => {
  const missing = runCli(["does-not-exist.log"]);
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, "");
  assert.match(missing.stderr, /safe-log-explainer: ENOENT/);

  const badOption = runCli(["--bogus", fixturePath]);
  assert.equal(badOption.code, 1);
  assert.match(badOption.stderr, /Usage: safe-log-explainer/);

  const badCount = runCli(["--context", "two", fixturePath]);
  assert.equal(badCount.code, 1);
  assert.match(badCount.stderr, /--context must be a non-negative integer/);
});
