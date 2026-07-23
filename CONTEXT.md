# RepoMirror

RepoMirror is a local macOS application for keeping folders in sync with GitHub repositories or repository subdirectories.

## Language

**Sync Item**:
One saved instruction describing a GitHub source and the local folder that should receive its contents.
_Avoid_: Plugin, task, job

**Source**:
A GitHub repository or a specific directory inside one, identified by its URL.
_Avoid_: Link, remote, package

**Destination**:
The folder on the local machine whose contents are managed by a Sync Item.
_Avoid_: Output, install path, target directory

**Default Root Directory**:
The one user-selected local base folder from which every Sync Item's Destination is resolved.
_Avoid_: Workspace, library, repository

**Mirror Sync**:
A synchronization mode that makes a Destination contain the same files as its Source, including removing files absent from the Source.
_Avoid_: Update, refresh

**Private Source**:
A Source that Git can access only through credentials already configured on the local machine. RepoMirror neither signs users in nor stores credentials.

**Tracked Branch**:
The branch whose newest commit supplies a Sync Item's Source. A repository URL uses the repository's default branch; a GitHub directory URL supplies its own branch.

**Folder Group**:
A path-based container for Sync Items beneath the Default Root Directory. Its relative path may contain multiple segments and is rendered as a folder tree.
_Avoid_: Import group, category

**Delete Folder Group**:
Removal of a Folder Group, all of its descendant Folder Groups, and their Sync Item configurations. It never deletes the corresponding local Destination files.

**Destination Name**:
The final folder name of a Sync Item beneath its Folder Group. It defaults to the Source's repository or directory name and may be customized.

**Sync Status**:
The most recent result recorded for a Sync Item: not synced, up to date, updated, or failed.

**Configuration Export**:
A JSON representation of the Default Root Directory and all saved Sync Items, used for backup and transfer between machines.

**System Git**:
The `git` executable installed on the user's Mac and used by RepoMirror to retrieve Sources. RepoMirror does not bundle or configure it.

**Sync Preview**:
An itemized, read-only comparison of a Source and its Destination shown before a Mirror Sync is confirmed. It does not change local files.

**Manual Sync**:
A Sync Item runs only when the user explicitly starts a single-item or all-item synchronization. RepoMirror does not schedule or run synchronizations in the background.
