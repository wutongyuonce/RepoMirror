# RepoMirror interaction SPEC

This document is the current user-visible contract for the macOS application. `schemaVersion: 3` remains the import and export format. [The design report](design.md) assigns each rule to code.

## Purpose and boundary

RepoMirror stores instructions for copying a GitHub repository or one of its directories into local Destinations. Configuration is durable user data; a local folder may be missing, moved outside the app, or temporarily unavailable. A manual synchronization is the only action that obtains GitHub content and writes it into a Destination.

## Grilling decisions adopted

The user elected the recommended answer for every design branch. Dependent decisions are listed under their prerequisite:

1. **What is authoritative?** The saved configuration describes the intended location. A missing Root Directory does not erase it.
   - **Missing folder:** show the saved location, allow import/load, and create folders on confirmed sync only.
   - **Externally moved folder:** offer “重新关联现有文件夹” to select the moved Root Directory without moving files again.
   - **Unsupported or invalid saved file:** preserve the file and show a persistent error; never turn a read error into a writable empty configuration.
2. **What does a drag mean?** The data source determines the operation.
   - **Existing Sync Item:** dropping on a Root Directory or Folder Group moves its configuration and any existing local Destination. Multiple selected items move together.
   - **GitHub URL from another app:** dropping on a tree node or the current content area opens the add-source form with the URLs and target filled in. It adds nothing until confirmed and does not synchronize.
   - **Unrecognized data:** report an error, with no configuration or filesystem change.
3. **What does a name or location change mean?** Root, group, and Destination renames update the saved path and move an existing local folder. If the folder is absent, only the path changes. An occupied target blocks the change. The old configuration remains on failed preflight or failed move; failed config save triggers a best-effort rollback and reports any rollback failure.
4. **What does deletion mean?** Configuration deletion is the primary operation. Local Destination deletion is optional and explicitly checked. Configuration saves first; if local deletion then fails, the app reports that configuration was removed and files may remain. Root Directories and unrelated local files are never deleted by this action.
5. **What does sync confirmation authorize?** Exactly the displayed Source commit and file changes, including the contents of local files marked for modification or deletion. If either changes before execution, that Sync Item is rejected and needs a new preview. File/directory conflicts or symlinks within a Destination block preview and synchronization rather than deleting or following them.

## Main scenarios

### Add and import

- Selecting an existing local folder adds a Root Directory. Roots have unique IDs and non-overlapping effective paths.
- Adding or dragging one or more HTTPS GitHub repository or `tree/<branch>/<path>` links creates Sync Items after the add form is confirmed. A Source is never cloned merely by being added. The form treats one path segment after `tree/` as the branch by default; for a single link with a slash-named branch, the user supplies the full branch name so the remaining segments are the Source path.
- Folder Group paths are relative to one Root Directory. Missing ancestors are added as Folder Groups. A Folder Group cannot occupy or sit inside a Destination.
- Import validates the complete JSON before offering to replace an existing configuration. Missing Root Directories are valid when their existing ancestors are accessible directories. A failed or cancelled import leaves the current configuration untouched. A successful first import selects its first Root Directory.
- A read error preserves the saved file and disables normal writes and export. An explicitly confirmed valid import can replace an unreadable file.

### Rename, drag, move, relink

- Root rename changes its final path component and display name. Group rename changes that group path and all descendant group and item paths. Destination rename changes its final path component.
- For an existing local folder, the folder and configuration move together. For an absent folder, configuration changes without creating a placeholder. A file, folder, or symlink at the new local path is a collision, even when the old folder is absent.
- Dragging selected Sync Items to a tree node moves only those not already at that location. The old Folder Group remains, even when empty. The current view stays in place.
- “移动至” chooses a parent for the Root Directory, preserving its final folder name. It follows the same folder-move rule. It cannot move into itself or overlap another Root Directory.
- “重新关联现有文件夹” is for a Root Directory that has already disappeared from its saved path. It changes the saved root path to a user-selected existing folder without moving either folder.
- If a batch move fails before saving, completed moves are rolled back in reverse order. If rollback itself fails, the error names the remaining locations; the app does not claim the disk is unchanged.

### Preview and synchronize

- A single item or the chosen current-folder scope is previewed before writing. The batch scope can be direct items only or recursive, with recursive as the default. An empty chosen scope reports that it has no Sync Items. Preview failure is reported per item; other items are still previewed, and the user may confirm only those with successful previews.
- Preview reads a GitHub commit and compares ordinary files; it does not create local folders. Source symlinks outside ignored paths are unsupported and produce an error rather than being silently omitted. Confirmation checks the commit, file changes, and content fingerprints of local files that would be replaced or deleted. An expired preview fails that item and does not write it.
- `mirror: true` removes ordinary extra files within that Destination, except ignored paths. `mirror: false` preserves extra files. Both modes preserve unlisted empty local directories and reject file/directory conflicts; neither silently removes a local directory to make room for a Source file.
- A missing Destination is a previewed creation even when its Source has no ordinary files. Confirmed sync creates its Root Directory, Folder Group, and Destination folders. It records success or failure per item, then saves statuses. An item can have partial filesystem changes if a write fails midway; a new preview shows the remaining difference.
- When all files already match, the user can still confirm the preview. RepoMirror rechecks the Source and Destination and records the item as synchronized without copying files.
- A failed item retains its last successful sync time but displays a failure indicator and its latest error in details. A later success clears that error.

## Invariants and failure semantics

| ID | Rule | Failure response |
| --- | --- | --- |
| C1 | Reads and imports do not delete saved configuration or create user folders. | Preserve bytes, explain the error. |
| C2 | Root paths are absolute, unique after resolving existing ancestors, and non-overlapping. Group and Destination paths are normalized relative paths. | Reject before saving. |
| C3 | One Root Directory owns each Folder Group and Sync Item; Destination paths are unique and do not overlap Folder Groups. | Reject before saving or moving files. |
| M1 | Existing local folders follow rename and move; targets must be vacant. | Retain config, roll back completed moves when possible, report exceptions. |
| D1 | Explicit optional local deletion never deletes the Root Directory itself. | Keep saved deletion; report local cleanup failure. |
| S1 | Confirmed sync uses the previewed commit and file change list. | Reject stale preview, request a new one. |
| S2 | Preview and sync reject Destination symlinks and file/directory conflicts. | Explain the conflicting path; leave it untouched. |

## Concurrency, limits, and trade-offs

- Configuration writes and rename/move transactions are serialized within one app process. Each normal save rejects a stale configuration snapshot. The app does not lock another running RepoMirror process or external filesystem tools.
- Batch preview and sync process items sequentially. Git is invoked for each preview and again for confirmed sync; the temporary clone is released after each item.
- Move rollback is best effort for unexpected filesystem failures. Cross-volume rename is not emulated with copy-and-delete. Filesystem sync itself is not transactional; failures may leave a partially updated Destination.
- Rechecking the preview just before writes narrows, but cannot eliminate, races with other programs editing the Destination during the write.
- Local deletion is irreversible. The optional deletion checkbox is off by default.

## Acceptance checks

| Obligation | Evidence |
| --- | --- |
| C1/C2 | Missing-root load/import; unsupported saved file retained; malformed relative paths rejected. |
| M1 | Existing folder follows config; occupied target rejected; failed config write restores moved folder. |
| D1 | Optional deletion executes after config save and reports partial cleanup. |
| S1 | Mismatched commit or change list is rejected before applying. |
| S2 | Non-mirror file/directory conflict and symlink escape leave local files untouched. |
| Drag | External GitHub link fills the add form; existing item drag moves selected items. |
| Add/import | First import selects a Root Directory; explicit slash-named branch leaves the correct Source path. |
| Relink | Missing Root Directory can point at an existing folder without moving it or changing its Sync Items. |
