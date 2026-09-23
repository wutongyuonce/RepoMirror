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

**Root Directory**:
A saved absolute location for Folder Groups and Destinations. It can be temporarily absent on disk; each Sync Item belongs to exactly one Root Directory, and Root Directories cannot overlap.
_Avoid_: Default root directory, workspace, library, repository

**Relink Root Directory**:
Point an existing Root Directory configuration at a folder that was moved outside RepoMirror, retaining its Folder Groups and Sync Items.

**Mirror Sync**:
A synchronization mode that makes a Destination contain the same files as its Source, including removing files absent from the Source.
_Avoid_: Update, refresh

**Private Source**:
A Source that Git can access only through credentials already configured on the local machine. RepoMirror neither signs users in nor stores credentials.

**Tracked Branch**:
The branch whose newest commit supplies a Sync Item's Source. A repository URL uses the repository's default branch; a GitHub directory URL supplies its own branch.

**Folder Group**:
A path-based container for Sync Items beneath one Root Directory. Its relative path may contain multiple segments and is rendered as a folder tree; every new path is entered relative to its Root Directory, regardless of which Folder Group is currently selected. Creating or moving into a nested path also creates any missing ancestor Folder Groups. A Folder Group cannot be inside or occupy a Sync Item Destination.
_Avoid_: Import group, category

**Delete Folder Group**:
Removal of a Folder Group, all of its descendant Folder Groups, and their Sync Item configurations. Its delete action is sufficient to remove configuration; the user may separately confirm deletion of the affected managed Destinations.

**Delete Root Directory**:
Removal of a Root Directory, its descendant Folder Groups, and their Sync Item configurations. Its delete action is sufficient to remove configuration; the user may separately confirm deletion of the affected managed Destinations, but it never deletes the Root Directory itself or unrelated local files within it.

**Destination Name**:
The final folder name of a Sync Item beneath its Folder Group. It defaults to the Source's repository or directory name and may be changed; an existing local Destination follows the new name.

**Move Sync Item**:
Reassignment of a Sync Item to another Root Directory or Folder Group. Its existing Destination moves with it; an absent Destination remains a saved location for a future sync.

**Move Root Directory**:
Relocation of a Root Directory to a new parent, preserving its folder name. Its local folder moves if present; if absent, the saved location changes without creating a folder.

**Rename Local Folder**:
Renaming a Root Directory, Folder Group, or Destination changes the saved name and moves the corresponding local folder if present. A name already occupied on disk is a conflict.

**Sync Status**:
The most recent result recorded for a Sync Item: not synced, synced, or failed. A failure is marked in the list and its reason is shown in item details; successful syncs show their time.

**Configuration Export**:
A JSON representation of Root Directories and all saved Sync Items, used for backup and transfer between machines.

**System Git**:
The `git` executable installed on the user's Mac and used by RepoMirror to retrieve Sources. RepoMirror does not bundle or configure it.

**Sync Preview**:
An itemized, read-only comparison of a Source commit and its Destination, shown before synchronization is confirmed. Confirmation applies only while the source commit and listed file changes still match.

**Sync Scope**:
The set of Sync Items chosen from the currently viewed Root Directory or Folder Group: either that location alone or that location together with all descendant Folder Groups. The user chooses the scope for each batch synchronization; recursive scope is the default.
_Avoid_: Sync all

**Manual Sync**:
A Sync Item runs only when the user explicitly starts a single-item or all-item synchronization. RepoMirror does not schedule or run synchronizations in the background.
