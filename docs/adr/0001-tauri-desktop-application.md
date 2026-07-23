# Use Tauri for the desktop application

RepoMirror will be a Tauri 2 desktop application with a TypeScript web interface and a small Rust backend. It needs local folder selection and Git-based synchronization more than deep Apple-specific UI integration, so this keeps the application small and straightforward to maintain while retaining a native macOS distribution path.

## Considered Options

- SwiftUI: strongest macOS integration, but a slower path for this form- and list-oriented tool.
- Local web application: easier to start, but less natural for filesystem access, command execution, and distribution.
