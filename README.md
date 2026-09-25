# RepoMirror

[中文文档](README.zh-CN.md)

RepoMirror is a focused macOS desktop app for mirroring a GitHub repository, or one directory inside it, into a local folder tree. It is built with Tauri 2, React, TypeScript, and a small Rust backend.

It is especially useful for people building a local library of AI agent skills, prompts, extensions, and open-source tools: keep the folders you actually use on disk, group them however you like, and stop manually checking dozens of GitHub projects for updates.

![image-20260726022555468](img/image-20260726022555468.png)

![image-20260726022606544](img/image-20260726022606544.png)

## Features

- Multiple user-selected root directories, displayed as one folder tree. A folder inside an existing root cannot be added as another root, and a new root cannot contain an existing one.
- Expandable path-based folder groups such as `tools/browser` beneath each root directory.
- GitHub repository and `tree/<branch>/<path>` or `blob/<branch>/<path>` directory links. A path to a file is rejected during preview.
- Batch source addition and optional custom destination names.
- Per-item mirror mode, with a file-by-file preview before every write.
- Manual single-item synchronization and scope-aware batch synchronization.
- Drag one or multiple Sync Items to another root directory or folder group; existing local destinations move with them. Drag a GitHub link onto a tree node or the current content area to prefill the add form.
- Move a first-level root directory from its context menu by choosing a destination parent. Existing local folders move with the configuration; a missing root can be relinked to an existing folder.
- Command-click (or Control-click) to select multiple items, and Shift-click to select a range.
- Rename root directories, folder groups, and Sync Item destinations. Existing local folders follow the new name; absent folders change only in configuration. An occupied target blocks the rename.
- Config import/export, persistent light/dark appearance, and no account or token storage.

RepoMirror uses the Mac's existing `git` executable and credentials. Private repositories work when Git can already authenticate on the machine.

## How to use

1. Click **+** beside “文件夹组” in the sidebar and select a local folder as a Root Directory. This is the local storage location, not the GitHub source. One configuration can contain multiple non-overlapping roots.
2. Select a root or Folder Group, click “添加来源”, and paste a GitHub repository URL such as `https://github.com/owner/repo` or a directory URL such as `https://github.com/owner/repo/tree/main/packages/tool`. Enter one URL per line; a single URL may use a custom final folder name. You can also drag a GitHub URL from a browser onto a sidebar location or the current content area. **Confirming the add form saves the Sync Item; it does not download files.**
3. Use “预览并同步” for one item or “同步当前文件夹” for the selected location. Batch scope can include only that location or its descendants (the default). Review the listed additions, modifications, deletions, and missing-directory creation. A failed item preview is shown separately. Confirmation syncs only successfully previewed items with changes; if none need syncing, close the preview.
4. Mirror mode is enabled for new items. After confirmation it removes ordinary destination files and symbolic links absent from the Source. Turn off “镜像同步” in item details to retain extra local entries. Both modes preserve unlisted empty directories and reject file/directory conflicts.

Each item writes to `<Root Directory>/<Folder Group>/<Destination Name>`. For example, `/Users/me/Library`, `tools/browser`, and `plugin` produce `/Users/me/Library/tools/browser/plugin`. The same GitHub Source may be added at different destinations, but two items cannot occupy one destination. Synchronization is manual; there is no scheduler or background sync.

To add a Folder Group, select its Root Directory, click “文件夹组” in the toolbar, and enter a path **relative to that root**, such as `tools/browser`. Missing ancestor groups are added to configuration. If a GitHub directory link uses a branch containing `/`, add that link alone and enter its full name, such as `feature/new-ui`, in “完整分支名” so RepoMirror can distinguish the branch from the repository directory.

### Organize local folders

- **Move Sync Items:** Drag one or more selected items to a root or Folder Group in the sidebar. Command-click (or Control-click) selects multiple items; Shift-click selects a range. Existing local Destinations move with their configuration. An item that has not created its folder yet only changes its saved location. An occupied target blocks the move.
- **Rename:** Double-click a root or Folder Group name, use its context menu, or edit a Sync Item's Destination Name in its details. An existing local folder follows the new name. Renaming a Folder Group also updates descendant groups and items; absent folders are not created during rename.
- **Move a whole Root Directory:** Right-click the root and choose “移动至”, then select its new **parent**. Moving `/A/Library` to parent `/B` produces `/B/Library`. The local root moves if it exists; otherwise only the saved path changes.
- **Relink an existing folder:** If you already moved `/A/Library` to `/B/Library` in Finder, right-click the root after the old path is gone, choose “重新关联现有文件夹”, and select `/B/Library`. This changes the saved root path without moving or synchronizing files. Choose the folder you intend these items to manage; RepoMirror cannot verify it is the same folder previously stored at the old path.
- **Delete:** Removing an item, Folder Group, or Root Directory removes configuration by default and leaves local files. The optional local-deletion checkbox removes only the affected managed Destinations after the configuration saves; it never removes the Root Directory itself or unrelated files.

### Import, export, and missing folders

Use “本地配置” in the lower-left corner to import or export JSON. The whole import is validated before replacement; an existing configuration requires explicit confirmation. A cancelled or failed import leaves it unchanged. Roots in imported configuration may be missing. Preview does not create folders; confirmed sync creates the missing root, group, and Destination directories. If the old folder was actually moved elsewhere, relink it first so the next sync does not recreate the old path.

An invalid or unsupported saved configuration is preserved on disk, shown as an error, and blocks ordinary writes. You can explicitly import a valid backup to replace it. Export a backup before major changes or moving to another computer.

## Safety

Synchronizing never starts without a preview and confirmation. Confirmation rechecks the previewed commit and file or symbolic-link changes. Links are copied as links without following their targets; mirror deletion removes only the link itself. A copied link can point outside the destination when another program opens it. A symbolic link used as a destination parent path or a file/directory conflict blocks synchronization.

`.git`, `.DS_Store`, and `node_modules` are never changed by synchronization. Deleting a root directory or Folder Group recursively removes its configuration. You may separately opt in to delete the affected managed Destinations; RepoMirror never deletes the root directory itself or files outside the selected managed Destinations.

### How synchronization works

RepoMirror retrieves the newest commit from each configured GitHub source, then compares the source directory with that item's final destination directory. It writes only files that are new or different and leaves identical files untouched. A new GitHub commit therefore does not necessarily change local files: a commit outside the configured repository directory has no effect on that item.

Each Sync Item records its most recent synchronization time in configuration. Run a preview to fetch the Source again and determine the current file-level differences. Items with no changes are skipped, leaving their recorded sync time unchanged. A missing Destination appears as a directory-creation change even when the Source has no ordinary files.

`Sync current folder` always starts with a scope dialog. Choose either the current location only or the current location and all descendant Folder Groups; recursive scope is selected by default. A root directory scopes only the Sync Items beneath that root. Each item is handled independently at `<rootDirectory>/<folderGroup>/<destinationName>`, so unrelated local files are preserved.

With `mirror: true`, source files replace same-named local files and local files absent from the source are removed, but only inside that item's final destination directory. With `mirror: false`, files absent from the source are retained; changed source files are still updated.

## Configuration

RepoMirror stores its working configuration in the macOS application-support directory. Exported files use `schemaVersion: 3`. Version-2 configuration files are not imported or migrated; a saved version-2 file is retained and reported as unsupported.

```json
{
  "schemaVersion": 3,
  "rootDirectories": [
    { "id": "library", "path": "/Users/you/RepoMirror Library", "name": "My Library" }
  ],
  "theme": "dark",
  "folderGroups": [
    { "rootId": "library", "path": "tools/browser" }
  ],
  "items": [
    {
      "id": "5ac18832-4c2f-4a61-a8ca-cf7b5f9c4a44",
      "sourceUrl": "https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-btw",
      "repoUrl": "https://github.com/narumiruna/pi-extensions.git",
      "branch": "main",
      "sourcePath": "extensions/pi-btw",
      "rootId": "library",
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

Imports reject malformed JSON, unsupported schema versions, unknown fields, invalid paths, invalid enum values, duplicate IDs or destinations, and GitHub fields that do not agree with each other. A missing Root Directory does not block import or loading; synchronization creates it after preview and confirmation. The full interaction contract is in [interaction SPEC](docs/interaction-spec.md). A failed import does not alter the current configuration. When configuration already exists, RepoMirror requires an explicit overwrite confirmation before replacing it.

### Configuration Skill for Codex

This repository includes [`repo-mirror-config-skill/`](repo-mirror-config-skill), a Codex skill for creating, explaining, reviewing, and repairing RepoMirror import JSON. It converts GitHub repository or directory links into valid `schemaVersion: 3` Sync Items, asks only for missing essentials, and checks the schema before returning a result.

Install it into your local Codex skills directory, then start a new Codex task:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/repo-mirror-config"
cp -R repo-mirror-config-skill/. "${CODEX_HOME:-$HOME/.codex}/skills/repo-mirror-config/"
```

Then ask Codex something like:

> Use `repo-mirror-config` to create an importable RepoMirror JSON. My root directory is `/Users/me/Extensions`; put these links under `community/tools`: `https://github.com/owner/repo` and `https://github.com/owner/repo/tree/main/packages/plugin`.

The skill also works for validating an existing export or repairing a JSON file rejected by RepoMirror. `mirror: true` remains a deliberate choice: after preview confirmation, it may remove destination files that are absent from the source.

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
src-tauri/target/release/bundle/dmg/RepoMirror_0.3.3_<architecture>.dmg
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
