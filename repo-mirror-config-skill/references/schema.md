# RepoMirror JSON Schema 2

```json
{
  "schemaVersion": 2,
  "rootDirectory": "/absolute/path/optional",
  "theme": "light",
  "folderGroups": ["tools/browser"],
  "items": [
    {
      "id": "unique-string",
      "sourceUrl": "https://github.com/owner/repo/tree/main/path/to/folder",
      "repoUrl": "https://github.com/owner/repo.git",
      "branch": "main",
      "sourcePath": "path/to/folder",
      "folderGroup": "tools/browser",
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

Top-level fields: `schemaVersion` must be `2`; `rootDirectory` and `theme` are optional. `theme` is `light` or `dark`. `folderGroups` contains unique non-empty relative paths.

Every Sync Item contains all displayed fields. `lastStatus` is `not_synced`, `synced`, or `failed`. The three `last*` fields may be `null`; `lastSyncedAt` otherwise uses RFC 3339.

For a repository Source, use a two-segment GitHub URL and set both `branch` and `sourcePath` to `null`. For a directory Source, use `https://github.com/<owner>/<repo>/tree/<branch>/<path>` and copy `<branch>` and `<path>` exactly. `repoUrl` always uses the matching `.git` URL.

Reject absolute group paths, path segments `.` or `..`, empty destination names, query strings, URL fragments, duplicate IDs, duplicate `<folderGroup>/<destinationName>` paths, and unknown fields.
