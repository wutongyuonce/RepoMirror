# Move existing folders with configuration

Renaming or moving a Root Directory, Folder Group, or Sync Item also moves its existing local folder; absent folders change only in configuration. An occupied target blocks the operation. RepoMirror saves the folder move and configuration through one backend operation that preflights all paths and attempts to roll back moves if saving fails. This avoids the previous default of leaving old folders behind after a configuration-only rename, while keeping externally moved Root Directories as a separate relink action.
