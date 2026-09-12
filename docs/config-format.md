# Configuration Format

[中文文档](config-format.zh-CN.md)

RepoMirror imports and exports JSON with `schemaVersion: 3`. Unknown fields are rejected. Version-2 files are discarded rather than migrated.

## Top-Level Fields

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | number | Must be `3`. |
| `rootDirectories` | array | Unique `id` values and unique canonical absolute paths. One root cannot contain another. |
| `theme` | `light`, `dark`, or omitted | Application appearance. |
| `folderGroups` | array | `{ rootId, path }`. `path` is a unique non-empty relative path per root. |
| `items` | array | Sync Items with unique `id` and unique destination paths. |

## Root Directory

| Field | Rule |
| --- | --- |
| `id` | Non-empty, unique string. |
| `path` | Absolute local folder that exists when the configuration is saved. |
| `name` | Optional display label. |

## Folder Group

`path` is relative to its Root Directory and may contain multiple segments, such as `tools/browser`. A Folder Group cannot occupy or sit inside a Sync Item Destination.

## Sync Item

`folderGroup` must be empty for the Root Directory or exactly match a Folder Group under the same root. `destinationName` is a single folder name, not a path.

| Field | Rule |
| --- | --- |
| `id` | Non-empty, unique string. |
| `sourceUrl` | A query-free `https://github.com/<owner>/<repo>` URL or a `tree/<branch>/<path>` URL. |
| `repoUrl` | Matching `https://github.com/<owner>/<repo>.git` URL. |
| `branch` and `sourcePath` | Both absent for a repository Source; both present and matching the `tree` URL for a directory Source. |
| `rootId` | Must match a Root Directory `id`. |
| `folderGroup` | Empty or an existing Folder Group path under `rootId`. |
| `destinationName` | Single folder name. |
| `mirror` | Boolean. |
| `lastStatus` | `not_synced`, `synced`, or `failed`. Stored in configuration; not shown as a list column. |
| `lastSyncedAt` | RFC 3339 timestamp or `null`. |
| `lastCommit`, `lastMessage` | String or `null`. |

Relative paths cannot be absolute and cannot contain `.` or `..` path segments.
