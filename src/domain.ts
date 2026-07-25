export type SyncStatus = "not_synced" | "synced" | "failed";

export interface RootDirectory {
  id: string;
  path: string;
}

export interface FolderGroup {
  rootId: string;
  path: string;
}

export interface SyncItem {
  id: string;
  sourceUrl: string;
  repoUrl: string;
  branch?: string;
  sourcePath?: string;
  rootId: string;
  folderGroup: string;
  destinationName: string;
  mirror: boolean;
  lastStatus: SyncStatus;
  lastSyncedAt?: string;
  lastCommit?: string;
  lastMessage?: string;
}

export interface AppConfig {
  schemaVersion: 3;
  rootDirectories: RootDirectory[];
  theme?: "light" | "dark";
  folderGroups: FolderGroup[];
  items: SyncItem[];
}

export interface PreviewChange {
  kind: "add" | "modify" | "delete";
  path: string;
}

export interface SyncPreview {
  commit: string;
  changes: PreviewChange[];
}
