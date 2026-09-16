import assert from "node:assert/strict";
import test from "node:test";
import { loadPatterns } from "../src/pattern-loader.js";

test("loadPatterns reads the default pattern file with the current categories", () => {
  const patterns = loadPatterns();
  const categories = patterns.map((pattern) => pattern.category);

  assert.deepEqual(categories, ["Application Crash", "Authentication Failure", "Rate Limiting", "Timeout"]);

  for (const pattern of patterns) {
    assert.ok(pattern.keywords.length > 0, `${pattern.id} should have at least one keyword`);
  }
});

test("loadPatterns can load a custom pattern file path", () => {
  const patterns = loadPatterns("patterns/default-patterns.json");
  assert.equal(patterns.length, 4);
});
