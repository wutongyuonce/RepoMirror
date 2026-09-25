# Interaction audit

Scope: configuration load/import/export, GitHub URL entry and drag, Root Directory and Folder Group navigation, rename/move/delete, preview, and synchronization. This is a review of those paths, not a claim that every possible filesystem race is eliminated. The current contract is [interaction-spec.md](interaction-spec.md).

## Issues found and addressed

| Observed problem | Change and evidence |
| --- | --- |
| Moving a Root Directory made import and startup fail; the UI displayed an empty configuration. | Missing roots are accepted, the saved file is retained, and load failure becomes a persistent read-only error. The folder is created only on confirmed sync. |
| Loading a saved v2 file deleted it. | Unsupported saved versions now return an error without removing the file. |
| A GitHub link dragged onto the tree highlighted a target but did nothing. | Internal Sync Item drags use a private type; external URI or plain-text links fill the add form for the drop target. The current content area also accepts links. |
| Rename and drag defaulted to configuration-only changes, leaving old local folders behind. | Existing folders move with their saved paths; missing folders only change in configuration. Reassociation of an externally moved Root Directory has a separate action. |
| Multi-item moves or a failed config save could leave filesystem and config disagreeing while the UI claimed the old state. | The backend preflights move targets, performs the moves with one config write, and attempts reverse-order rollback. A rollback failure is named explicitly. |
| Optional deletion removed files before saving configuration. | Config saves first; local cleanup follows and reports partial failure. The backend resolves selected Destinations within their Roots and rejects symlink paths. |
| The preview and confirmed sync could use different GitHub commits or local differences. | Sync rechecks the Source commit and sorted change list and rejects an expired preview before writing. |
| Editing a local file after preview could leave the same “modify this path” entry, so the earlier check still allowed overwriting the new edit. | Modified and deleted local files now have SHA-256 fingerprints in the preview comparison; a same-path content change expires the preview. |
| A Folder Group changed to a symlink outside the root could redirect a Sync Item move. | The move transaction now verifies that each source and target belongs to a configured root, group, or item and rejects symlink components. |
| One unavailable Source aborted the whole batch preview and hid other items' results; local conflicts were incorrectly described as invalid GitHub links. | Batch preview now collects each outcome, shows the actual error, and allows confirmation of successfully previewed items. |
| `mirror: false` could still delete a local directory when a Source file used its name. | File/directory conflicts are rejected at preview and before writes in both mirror modes. |
| An empty Source produced no file changes, so sync never created a missing Destination. | Preview now lists the Destination creation, and confirmation creates the missing directory tree. |
| An empty selected scope did nothing when preview was requested. | An empty scope reports that it contains no items. No-change previews now close without another sync or status update, per the current interaction SPEC. |
| After a batch failure, the list could still show an old successful time without any lasting failure indication. | The item records its failure message and displays failure in the list and details until a successful retry. |
| A broken configuration symlink looked like a missing file and could load an empty configuration. | Startup distinguishes an absent file from an unreadable path and reports an error for the latter. |
| Destination symlinks could redirect writes outside the intended folder. | Symlinks in or beneath the selected Root path are rejected; Source symlinks are reported as unsupported instead of silently omitted. |
| Equivalent relative paths such as `a//b` and `a/b/` could bypass duplicate checks. | Runtime validation requires normalized group paths. |
| First import left no Root Directory selected; deleting a group jumped to the first Root; moving an absent root created an empty folder. | First import selects its first Root, group deletion selects its parent, and absent-root move changes only the saved path. |
| Concurrent stale UI saves and export could use an out-of-date configuration snapshot. | Normal saves compare their expected config with the current file; export reads the current saved file. |
| URL entry deferred some invalid links to the save step and could not identify slash-named branches. | Form validation now checks HTTPS GitHub URL restrictions, normalizes clone URLs, and lets a single tree link provide its full branch name. |

## Accepted limits and follow-up checks

- File copying during sync is not transactional. An I/O error can leave a partial Destination; a new preview is the recovery view.
- Filesystem changes by another program between the final check and write can still race. A failed folder-move rollback is reported with paths. Cross-volume folder moves fail without copying.
- Two app processes do not share an operating-system lock. Stale-save comparison catches many conflicts but cannot prevent an older running version from writing later.
- GitHub `tree` URLs with slash-named branches are ambiguous. The single-link form requires the user to supply the full branch name.
- Native macOS drag-and-drop and modal interactions still need hands-on verification in the rebuilt app. Source parsing, backend rules, Rust tests, and production builds have automated checks.
