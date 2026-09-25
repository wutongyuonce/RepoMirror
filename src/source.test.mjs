import assert from "node:assert/strict";
import test from "node:test";
import { externalLinks, parseSource } from "./source.ts";

test("a dropped GitHub link becomes a source only after the target is chosen", () => {
  const links = externalLinks({ getData: (kind) => kind === "text/uri-list" ? "# browser title\nhttps://github.com/example/plugin\n" : "" });
  assert.deepEqual(links, ["https://github.com/example/plugin"]);
  const item = parseSource(links[0], "root", "tools");
  assert.equal(item.rootId, "root");
  assert.equal(item.folderGroup, "tools");
  assert.equal(item.destinationName, "plugin");
  assert.equal(item.lastStatus, "not_synced");
});

test("a slash-named branch requires the explicit branch field", () => {
  for (const marker of ["tree", "blob"]) {
    const url = `https://github.com/example/plugin/${marker}/feature/new-ui/packages/tool`;
    const item = parseSource(url, "root", "", undefined, "feature/new-ui");
    assert.equal(item.sourceUrl, url);
    assert.equal(item.branch, "feature/new-ui");
    assert.equal(item.sourcePath, "packages/tool");
    assert.throws(() => parseSource(url, "root", "", undefined, "missing/branch"));
  }
});

test("a GitHub blob URL can be saved as a directory candidate", () => {
  const url = "https://github.com/example/plugin/blob/main/.agents/skills/tool/";
  const item = parseSource(url, "root", "");
  assert.equal(item.sourceUrl, url.slice(0, -1));
  assert.equal(item.branch, "main");
  assert.equal(item.sourcePath, ".agents/skills/tool");
  assert.equal(item.destinationName, "tool");
  assert.throws(() => parseSource("https://github.com/example/plugin/blob/main", "root", ""));
});

test("dragged non-GitHub and credentialed links are rejected", () => {
  assert.throws(() => parseSource("file:///tmp/plugin", "root", ""));
  assert.throws(() => parseSource("http://github.com/example/plugin", "root", ""));
  assert.throws(() => parseSource("https://user:secret@github.com/example/plugin", "root", ""));
  assert.throws(() => parseSource("https://github.com/example/plugin?tab=readme", "root", ""));
});

test("a Git clone URL is saved as a canonical repository Source", () => {
  const item = parseSource("https://github.com/example/plugin.git", "root", "");
  assert.equal(item.sourceUrl, "https://github.com/example/plugin");
  assert.equal(item.repoUrl, "https://github.com/example/plugin.git");
  assert.equal(item.destinationName, "plugin");
});
