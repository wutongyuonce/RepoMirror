---
name: repo-mirror-config
description: Create, explain, review, or repair RepoMirror configuration JSON. Use when a user wants to prepare a RepoMirror import file, convert GitHub repository or directory links into sync items, validate a configuration, or understand the schemaVersion 2 format.
---

# RepoMirror Configuration

Create only `schemaVersion: 2` JSON. Read [references/schema.md](references/schema.md) before generating, modifying, or reviewing a configuration.

## Workflow

1. Ask only for unknown essentials: default root directory, folder group paths, GitHub links, optional destination names, and mirror preference.
2. Convert each GitHub URL into exactly one Sync Item. A repository URL has `branch` and `sourcePath` set to `null`; a `tree/<branch>/<path>` URL copies its branch and directory path into both fields.
3. Add every non-root `folderGroup` to `folderGroups`. Use the empty string only for a root-level Sync Item.
4. Generate stable unique IDs. Set initial status fields to `not_synced`, `null`, `null`, and `null` unless the user provides real synchronization state.
5. Validate the finished JSON against the checklist below. Return JSON in a fenced `json` block, followed by only necessary notes.

## Final Checklist

- Use the exact top-level fields from the reference; do not add comments or unknown fields.
- Set `schemaVersion` to `2`.
- Keep `rootDirectory` absolute when present.
- Keep folder groups unique, non-empty, relative, and free of `.` or `..` path segments.
- Keep every `id` and final destination path unique.
- Require `repoUrl` to match its `sourceUrl` repository.
- Use `https://github.com` URLs without fragments or query strings.
- For a directory link, require `branch` and `sourcePath` to exactly match the URL.
- Do not claim a configuration is importable when any check is uncertain; explain the failing field and request the smallest missing detail.

## Safety

Warn that `mirror: true` permits RepoMirror to delete destination files absent from the Source after preview confirmation. Configuration import changes only application configuration; it does not itself synchronize or delete local files.
