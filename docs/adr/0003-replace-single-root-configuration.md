# Replace the single-root configuration

Status: superseded by ADR-0004 for the handling of saved version-2 files.

RepoMirror will replace the version-2 single-root configuration with a multi-root configuration and will not migrate or import version-2 JSON. This intentionally resets saved Sync Item configuration while preserving all local Destination files, avoiding a long-lived compatibility layer for a pre-release data format.
