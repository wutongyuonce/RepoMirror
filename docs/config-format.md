# Configuration Format

RepoMirror imports and exports JSON with `schemaVersion: 1`. All top-level fields are required except `rootDirectory` and `theme`; all Sync Item fields are required and nullable status fields must be present as `null` when unknown.

## Top-Level Fields

| Field | Type | Rule |
| --- | --- | --- |
| `schemaVersion` | number | Must be `1`. |
| `rootDirectory` | string or omitted | Absolute local path. |
| `theme` | `light` or `dark` or omitted | Application appearance. |
| `folderGroups` | string array | Unique non-empty relative paths. |
| `items` | array | Sync Items with unique `id` and unique destination paths. |

## Sync Item

`folderGroup` must be empty for the root directory or exactly match an entry in `folderGroups`. `destinationName` is a single folder name, not a path.

| Field | Rule |
| --- | --- |
| `id` | Non-empty, unique string. |
| `sourceUrl` | A query-free `https://github.com/<owner>/<repo>` URL or a `tree/<branch>/<path>` URL. |
| `repoUrl` | Matching `https://github.com/<owner>/<repo>.git` URL. |
| `branch` and `sourcePath` | Both absent for a repository Source; both present and matching the `tree` URL for a directory Source. |
| `mirror` | Boolean. |
| `lastStatus` | `not_synced`, `up_to_date`, `updated`, or `failed`. |
| `lastSyncedAt` | RFC 3339 timestamp or `null`. |
| `lastCommit`, `lastMessage` | String or `null`. |

Relative paths cannot be absolute and cannot contain `.` or `..` path segments. Unknown fields are rejected so that configuration mistakes are visible instead of silently ignored.
