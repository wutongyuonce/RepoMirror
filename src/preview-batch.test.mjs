import assert from "node:assert/strict";
import test from "node:test";
import { changedPreviews, previewBatch } from "./preview-batch.ts";

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

test("only previews with file or directory changes are eligible for sync", () => {
  const unchanged = { item: "current", preview: { changes: [] } };
  const added = { item: "new", preview: { changes: [{ kind: "add" }] } };
  const modified = { item: "modified", preview: { changes: [{ kind: "modify" }] } };
  const deleted = { item: "removed", preview: { changes: [{ kind: "delete" }] } };
  const missingDirectory = { item: "missing", preview: { changes: [{ kind: "create_directory" }] } };

  assert.deepEqual(changedPreviews([unchanged]), []);
  assert.deepEqual(changedPreviews([unchanged, added, modified, deleted, missingDirectory]), [added, modified, deleted, missingDirectory]);
  assert.deepEqual(changedPreviews([]), []);
});
