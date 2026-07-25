import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, SyncItem, SyncPreview } from "./domain";

export const api = {
  loadConfig: () => invoke<AppConfig>("load_config"),
  saveConfig: (config: AppConfig) => invoke<void>("save_config", { config }),
  selectRoot: () => invoke<string | null>("select_root"),
  importConfig: () => invoke<AppConfig | null>("import_config"),
  exportConfig: (config: AppConfig) => invoke<boolean>("export_config", { config }),
  preview: (item: SyncItem, rootDirectory: string) =>
    invoke<SyncPreview>("preview_sync", { item, rootDirectory }),
  sync: (item: SyncItem, rootDirectory: string) =>
    invoke<SyncItem>("sync_item", { item, rootDirectory }),
  deleteDirectories: (paths: string[]) => invoke<void>("delete_directories", { paths }),
  moveDirectory: (from: string, to: string) => invoke<void>("move_directory", { from, to }),
  directoryExists: (path: string) => invoke<boolean>("directory_exists", { path }),
};
