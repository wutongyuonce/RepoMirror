# RepoMirror design

This report maps the current [interaction SPEC](interaction-spec.md) to modules. ADR-0004 through ADR-0006 explain the durable decisions.

## Runtime path

```text
GitHub URL or import JSON
  → React form / drop target
  → Tauri command
  → Rust configuration validation
  → atomic config replacement

Rename or drag existing item
  → React chooses the intended next config and folder moves
  → save_config_with_moves validates and preflights
  → local directory rename(s)
  → atomic config replacement or reverse-order rollback

Preview → Git temporary clone → destination comparison → displayed commit and changes
Confirm changed previews → new Git clone and destination comparison → equality check → local writes → status save
```

## Authority and interfaces

| Rule, state, or error | Authority | Interface and callers | Evidence |
| --- | --- | --- | --- |
| Configuration shape, path identity, references, Source URL consistency | `src-tauri/src/lib.rs::validate_config` | `load_config`, `import_config`, `save_config`, `save_config_with_moves` | Rust validator tests; JSON schema documents shape only. |
| Configuration file preservation and replacement | `read_config`, `write_config` | Startup, save, import confirmation | Unsupported-version retention and missing-root tests. |
| Folder move ownership, symlink preflight, order, rollback, and config save | `validate_managed_move_path`, `write_config_with_moves` | Rename and drag commands from `src/App.tsx` through `src/api.ts` | Move success, symlink, collision, and failed-save rollback tests. |
| Optional physical deletion | `delete_destinations` | Delete confirmation in `src/App.tsx` passes Root Directory and Sync Item data | Destination path resolution, preflight, and per-path failure reporting; config saves first. |
| Which item or link was dropped and where | `DropRow` and `dropLinks` in `src/App.tsx`; `src/source.ts` parses external links | Root/group tree and current content area | Custom internal drag type; external URI or plain-text links. |
| Add-link form state and navigation selection | `src/App.tsx` | Add form, first import, group navigation | UI state transitions. |
| Previewed commit and changes | `compare_trees`, `ensure_preview_matches` | `preview_sync`, `sync_item` | Stale-preview tests. |
| Which previews enter sync | `src/preview-batch.ts::changedPreviews` | Preview dialog and sync action in `src/App.tsx` | No-change, mixed, and missing-directory selection test. |
| Destination path safety | `destination_path`, `validate_destination_tree` | Preview and sync | Conflict and symlink tests. |

## Configuration and filesystem ordering

`save_config_with_moves` first compares the saved configuration with the caller's expected version, validates the complete next configuration, then checks all source and target paths. It moves existing folders in sequence and writes configuration through a unique temporary file with an atomic replacement. A failed move or config write triggers reverse-order rollback of completed moves. Rollback failure is explicit. No placeholder folder is created for a missing source.

Deletion uses the opposite order because deleted files cannot be rolled back: save the configuration first, then optionally remove managed Destination folders. A failed local deletion leaves configuration removed, and the UI tells the user that local files may remain. Root folders and files outside selected Destinations are outside deletion scope.

The React component derives proposed next configuration and user intent. The backend decides whether it is valid and whether filesystem changes are allowed. The frontend's path and duplicate checks are early feedback, not a second authority; a backend rejection leaves saved configuration unchanged.

## Sync and resource behavior

Each preview or sync call owns one temporary Git clone. The preview includes a commit ID and sorted file change list. Modified or deleted local files carry SHA-256 fingerprints, so editing the same path after preview invalidates confirmation. `sync_item` clones and compares again, then rejects a mismatch before applying changes. Source symlinks are reported as unsupported. Destination symlinks or file/directory conflicts are rejected during both comparison and application. The root path is resolved against existing ancestors, allowing an absent path while keeping effective Root Directories non-overlapping.

The app handles changed previews sequentially, recording each attempted item result in its final configuration save. Unchanged previews make no sync call and retain their saved status and time; when none have changes, the dialog closes without saving. Git is not cached between preview and execution. A Source can become unavailable between those calls, which fails only that item. Physical file copying is not transactional; the next preview is the recovery view after a partial copy.

## Accepted limits

- The URL add form accepts `tree/` or `blob/` links as directory candidates and interprets the next segment as the branch by default. Preview rejects paths that resolve to files. GitHub URLs with slash-named branches are ambiguous without repository lookup; the single-link form accepts an explicit full branch name.
- No cross-process lock covers two running app copies or external tools. The in-process mutex serializes config writes in one process.
- Each normal save compares its expected configuration with the current file and rejects a stale caller; an explicitly confirmed import can replace an unreadable file.
- `fs::rename` does not move folders across volumes. A cross-volume move fails without changing configuration.
- Move rollback can itself fail under external interference or permissions; that state is reported with paths.
- A Destination may change after the final comparison while files are being copied. The app does not claim an operating-system-level snapshot.

## Verification map

| SPEC obligation | Owner-level check |
| --- | --- |
| C1/C2/C3 | Rust config validation tests, read-version retention, and validation of real exported config. |
| M1 | Rust save-with-moves success/collision/rollback tests; frontend build for call-site typing. |
| D1 | Save-before-delete flow review and backend path preflight. |
| S1 | `ensure_preview_matches` tests for commit, change list, and same-path local content drift. |
| S2 | Rust non-mirror directory conflict and symlink tests. |
| S3 | `src/preview-batch.test.mjs` for no-change, mixed, and missing-directory selection; frontend build for dialog and action wiring. |
| Drag | `src/source.test.mjs` for external link parsing, UI handler audit, and frontend build; native drag behavior requires app interaction testing. |
| Add/import and relink | UI transition review plus frontend build; no local filesystem mutation during form filling. |
