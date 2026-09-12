---
name: repo-mirror-config
description: Create, explain, review, or repair RepoMirror configuration JSON. Use when a user wants to prepare a RepoMirror import file, convert GitHub repository or directory links into sync items, validate a configuration, or understand the schemaVersion 3 format.
---

# RepoMirror Configuration

Create only `schemaVersion: 3` JSON. Read [references/schema.md](references/schema.md) before generating, modifying, or reviewing a configuration. RepoMirror rejects version-2 files.

## Workflow

1. Ask only for unknown essentials: one or more root directories, folder group paths, GitHub links, optional destination names, and mirror preference.
2. Give every Root Directory a unique `id` and an absolute `path`. Optional `name` is a display label only.
3. Convert each GitHub URL into exactly one Sync Item with that item's `rootId`. A repository URL omits `branch` and `sourcePath` (use `null`); a `tree/<branch>/<path>` URL copies its branch and directory path into both fields.
4. Represent folder groups as `{ rootId, path }` objects. Include every ancestor of a nested path (`community/tools` also needs `community`). Use `folderGroup: ""` only for a root-level Sync Item.
5. Generate stable unique IDs. Set `lastStatus` to `not_synced` and the three `last*` fields to `null` unless the user provides real synchronization state.
6. Validate the finished JSON against the checklist below. Return JSON in a fenced `json` block, followed by only necessary notes.

## Final Checklist

- Use the exact top-level fields from the reference; do not add comments or unknown fields.
- Set `schemaVersion` to `3`.
- Keep every root `path` absolute. One root must not be inside another.
- Keep folder group paths unique per root, non-empty, relative, and free of `.` or `..` path segments.
- Keep every `id` and final `<folderGroup>/<destinationName>` path unique within a root.
- Require each item `rootId` to match a Root Directory, and each non-empty `folderGroup` to match a Folder Group under that root.
- Require `repoUrl` to match its `sourceUrl` repository.
- Use `https://github.com` URLs without fragments or query strings.
- For a directory link, require `branch` and `sourcePath` to exactly match the URL.
- Do not claim a configuration is importable when any check is uncertain; explain the failing field and request the smallest missing detail.

## Safety

Warn that `mirror: true` permits RepoMirror to delete destination files absent from the Source after preview confirmation. Configuration import changes only application configuration; it does not itself synchronize or delete local files.
