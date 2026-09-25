# RepoMirror JSON Schema 3

```json
{
  "schemaVersion": 3,
  "rootDirectories": [
    { "id": "library", "path": "/absolute/path", "name": "My Library" }
  ],
  "theme": "light",
  "folderGroups": [
    { "rootId": "library", "path": "community" },
    { "rootId": "library", "path": "community/tools" }
  ],
  "items": [
    {
      "id": "unique-string",
      "sourceUrl": "https://github.com/owner/repo/tree/main/path/to/folder",
      "repoUrl": "https://github.com/owner/repo.git",
      "branch": "main",
      "sourcePath": "path/to/folder",
      "rootId": "library",
      "folderGroup": "community/tools",
      "destinationName": "folder",
      "mirror": true,
      "lastStatus": "not_synced",
      "lastSyncedAt": null,
      "lastCommit": null,
      "lastMessage": null
    }
  ]
}
```

Top-level fields: `schemaVersion` must be `3`; `theme` is optional (`light` or `dark`). `rootDirectories` is required. `folderGroups` contains `{ rootId, path }` objects, not bare strings.

Every Sync Item includes `rootId`. `lastStatus` is `not_synced`, `synced`, or `failed`. The three `last*` fields may be `null`; `lastSyncedAt` otherwise uses RFC 3339.

For a repository Source, use a two-segment GitHub URL and set both `branch` and `sourcePath` to `null`. For a directory Source, use `https://github.com/<owner>/<repo>/tree/<branch>/<path>` or `https://github.com/<owner>/<repo>/blob/<branch>/<path>` and copy `<branch>` and `<path>` exactly. If the branch name contains `/`, include all of its segments in `branch`; the remaining URL segments form `sourcePath`. `repoUrl` always uses the matching `.git` URL. Preview rejects paths that resolve to files.

A nested folder group path should also list its ancestors so the UI can display the full tree. A Folder Group cannot occupy or sit inside a Sync Item destination. One Root Directory cannot contain another. Root paths may be absent; validate overlap using existing canonical ancestors, and do not create directories while preparing JSON.

Reject absolute group paths, empty or `.` or `..` segments, repeated or trailing slashes, backslashes, empty destination names, GitHub URL credentials or ports, query strings, URL fragments, duplicate IDs, duplicate `<rootId>/<folderGroup>/<destinationName>` paths, missing `rootId` references, and unknown fields. If a directory URL's branch contains `/`, the user must provide the full branch name so the remaining URL segments form `sourcePath`.
