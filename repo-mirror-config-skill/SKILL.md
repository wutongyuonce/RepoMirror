---
name: repo-mirror-config
description: Create, explain, review, or repair RepoMirror schemaVersion 3 import JSON. Use when a user supplies GitHub repository or directory links, wants to restore or move a configuration after local folders changed, asks why an import failed, or needs an importable configuration checked against current path and source rules.
---

# RepoMirror Configuration

Create only `schemaVersion: 3` JSON. Read [references/schema.md](references/schema.md) before generating, modifying, or reviewing a configuration. RepoMirror rejects version-2 files.

## Workflow

1. Ask only for unknown essentials: one or more root directory paths, folder group paths, GitHub links, optional destination names, and mirror preference. For an ambiguous `tree` URL whose branch may contain `/`, ask for the full branch name instead of guessing.
2. Give every Root Directory a unique `id` and an absolute `path`. A moved or missing local root is valid when its existing ancestors are accessible directories. When repairing an existing configuration, preserve its saved path unless the user provides a new location; do not guess where a folder moved. Optional `name` is a display label.
3. Convert each GitHub URL into exactly one Sync Item with that item's `rootId`. Accept only HTTPS `github.com` repository or `tree/<branch>/<path>` URLs without credentials, ports, query strings, or fragments. Normalize a repository clone URL ending in `.git` to a plain repository `sourceUrl`. A repository URL uses `null` for `branch` and `sourcePath`; a directory URL sets both fields to the exact branch and remaining directory path.
4. Represent folder groups as `{ rootId, path }` objects. Include every ancestor of a nested path (`community/tools` also needs `community`). Use `folderGroup: ""` only for a root-level Sync Item.
5. Generate unique IDs for new roots and items. Preserve valid existing IDs and synchronization history when repairing a configuration. For new items, set `lastStatus` to `not_synced` and the three `last*` fields to `null` unless the user provides real synchronization state.
6. Validate the finished JSON against the checklist below. Return JSON in a fenced `json` block, followed by only necessary notes.

## Final Checklist

- Use the exact top-level fields from the reference; do not add comments or unknown fields.
- Set `schemaVersion` to `3`.
- Keep every root `path` absolute. One root must not be inside another, including after resolving any existing path ancestors. A missing root alone is not an import error.
- Keep folder group paths unique per root, non-empty, relative, and normalized: no leading/trailing slash, repeated slash, backslash, `.` or `..` segment.
- Keep every `id` unique across the entire configuration and every final `<folderGroup>/<destinationName>` path unique within its root.
- Require each item `rootId` to match a Root Directory, and each non-empty `folderGroup` to match a Folder Group under that root.
- Require `repoUrl` to match its `sourceUrl` repository.
- Use HTTPS `github.com` URLs without credentials, custom ports, fragments, or query strings.
- For a directory link, require `branch` and `sourcePath` to exactly match the URL.
- Do not claim a configuration is importable when any check is uncertain; explain the failing field and request the smallest missing detail.

## Safety

Explain that importing or adding a link changes only application configuration; it does not fetch the Source, create a missing local folder, or synchronize files. Confirmed sync creates missing folders. If a Root Directory was already moved in Finder and its old path is missing, direct the user to “重新关联现有文件夹” before syncing so RepoMirror does not recreate the old path. Warn that `mirror: true` permits RepoMirror to delete ordinary destination files absent from the Source after preview confirmation.
