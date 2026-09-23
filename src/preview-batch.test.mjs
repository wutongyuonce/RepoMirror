import assert from "node:assert/strict";
import test from "node:test";
import { previewBatch } from "./preview-batch.ts";

test("one unavailable source does not hide the other batch previews", async () => {
  const visited = [];
  const result = await previewBatch(["first", "broken", "last"], async (item, index) => {
    visited.push([item, index]);
    if (item === "broken") throw new Error("source unavailable");
    return `${item}-preview`;
  });
  assert.deepEqual(visited, [["first", 0], ["broken", 1], ["last", 2]]);
  assert.deepEqual(result.successes, [
    { item: "first", preview: "first-preview" },
    { item: "last", preview: "last-preview" },
  ]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].item, "broken");
  assert.match(result.failures[0].cause.message, /source unavailable/);
});
