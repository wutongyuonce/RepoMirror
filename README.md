# RepoMirror

[中文文档](README.zh-CN.md)

RepoMirror is a focused macOS desktop app for mirroring a GitHub repository, or one directory inside it, into a local folder tree. It is built with Tauri 2, React, TypeScript, and a small Rust backend.

## Features

- One user-selected default root directory.
- Expandable path-based folder groups such as `tools/browser`.
- GitHub repository and `tree/<branch>/<path>` directory links.
- Batch source addition and optional custom destination names.
- Per-item mirror mode, with a file-by-file preview before every write.
- Manual single-item and sequential all-item synchronization.
- Config import/export, persistent light/dark appearance, and no account or token storage.

RepoMirror uses the Mac's existing `git` executable and credentials. Private repositories work when Git can already authenticate on the machine.

## Safety

Synchronizing never starts without a preview and confirmation. Mirror mode may remove files from a destination when they do not exist in the source; disabling mirror mode preserves local extra files.

`.git`, `.DS_Store`, and `node_modules` are never changed by synchronization. Deleting a folder group removes its sync configuration and child sync configurations only; it never deletes local destination files.

### How synchronization works

RepoMirror retrieves the newest commit from each configured GitHub source, then compares the source directory with that item's final destination directory. It writes only files that are new or different and leaves identical files untouched. A new GitHub commit therefore does not necessarily change local files: a commit outside the configured repository directory has no effect on that item.

`Sync all` runs every configured item, including items nested in folder groups. It does not treat the default root directory as one large destination, so unrelated files and folders at the root are preserved. Each item is handled independently at `<rootDirectory>/<folderGroup>/<destinationName>`.

With `mirror: true`, source files replace same-named local files and local files absent from the source are removed, but only inside that item's final destination directory. With `mirror: false`, files absent from the source are retained; changed source files are still updated.

## Configuration

RepoMirror stores its working configuration in the macOS application-support directory. Exported files use a stable JSON contract with `schemaVersion: 1`.

```json
{
  "schemaVersion": 1,
  "rootDirectory": "/Users/you/RepoMirror Library",
  "theme": "dark",
  "folderGroups": ["tools/browser"],
  "items": [
    {
      "id": "5ac18832-4c2f-4a61-a8ca-cf7b5f9c4a44",
      "sourceUrl": "https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-btw",
      "repoUrl": "https://github.com/narumiruna/pi-extensions.git",
      "branch": "main",
      "sourcePath": "extensions/pi-btw",
      "folderGroup": "tools/browser",
      "destinationName": "pi-btw",
      "mirror": true,
      "lastStatus": "not_synced",
      "lastSyncedAt": null,
      "lastCommit": null,
      "lastMessage": null
    }
  ]
}
```

Imports reject malformed JSON, unsupported schema versions, unknown fields, invalid paths, invalid enum values, duplicate IDs or destinations, and GitHub fields that do not agree with each other. A failed import does not alter the current configuration. When configuration already exists, RepoMirror requires an explicit overwrite confirmation before replacing it. See [docs/config-format.md](docs/config-format.md) and [docs/config-schema.json](docs/config-schema.json) for the full contract.

## Development

Requirements: macOS 12+, Git, Node.js 20+, Rust, and Xcode Command Line Tools.

```bash
pnpm install
pnpm tauri dev
```

Validate the frontend and Rust backend separately:

```bash
pnpm build
cd src-tauri && cargo check
```

Create a macOS bundle with:

```bash
pnpm tauri build
```

The command first runs the production frontend build and then produces a release macOS application bundle and disk image. The usual output locations are:

```text
src-tauri/target/release/bundle/macos/RepoMirror.app
src-tauri/target/release/bundle/dmg/RepoMirror_0.1.0_<architecture>.dmg
```

On an Apple Silicon Mac, `<architecture>` is `aarch64`; on an Intel Mac, it is `x64`. The `.app` bundle can run directly, while the `.dmg` is the convenient distribution installer: open it and drag `RepoMirror.app` into Applications. Builds are not code-signed or notarized by this repository, so macOS may require an explicit first-run approval when distributing the app outside the development machine.

## Project Layout

```text
src/          React interface and Tauri command client
src-tauri/    Rust configuration, Git, preview, and sync implementation
docs/         Architecture decisions and configuration contract
```

## License

RepoMirror is released under the [MIT License](LICENSE).
