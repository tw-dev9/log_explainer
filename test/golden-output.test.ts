import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { explainRawLog } from "../src/explain.js";
import { toMarkdown } from "../src/output.js";
import { loadPatterns } from "../src/pattern-loader.js";

const fixturesDir = join("test", "fixtures");
const patterns = loadPatterns();

function readTextFile(path: string): string {
  return readFileSync(path, "utf8").replace(/\r\n/g, "\n");
}

test("CLI Markdown output for the synthetic timeout log matches the golden file", () => {
  const rawContent = readTextFile(join(fixturesDir, "synthetic-timeout-log.txt"));
  const expected = readTextFile(join(fixturesDir, "timeout-debug-packet.md"));

  const { packet, warnings } = explainRawLog(rawContent, patterns);
  const actual = toMarkdown(packet, warnings);

  assert.equal(actual, expected);
});
