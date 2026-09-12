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

For a repository Source, use a two-segment GitHub URL and set both `branch` and `sourcePath` to `null`. For a directory Source, use `https://github.com/<owner>/<repo>/tree/<branch>/<path>` and copy `<branch>` and `<path>` exactly. `repoUrl` always uses the matching `.git` URL.

A nested folder group path must also list its ancestors. A Folder Group cannot occupy or sit inside a Sync Item destination. One Root Directory cannot contain another.

Reject absolute group paths, path segments `.` or `..`, empty destination names, query strings, URL fragments, duplicate IDs, duplicate `<rootId>/<folderGroup>/<destinationName>` paths, missing `rootId` references, and unknown fields.
