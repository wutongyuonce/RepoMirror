export type SyncStatus = "not_synced" | "up_to_date" | "updated" | "failed";

export interface SyncItem {
  id: string;
  sourceUrl: string;
  repoUrl: string;
  branch?: string;
  sourcePath?: string;
  folderGroup: string;
  destinationName: string;
  mirror: boolean;
  lastStatus: SyncStatus;
  lastSyncedAt?: string;
  lastCommit?: string;
  lastMessage?: string;
}

export interface AppConfig {
  schemaVersion: 1;
  rootDirectory?: string;
  theme?: "light" | "dark";
  folderGroups: string[];
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
