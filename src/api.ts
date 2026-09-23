import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, SyncItem, SyncPreview } from "./domain";

export type DirectoryMove = { from: string; to: string };

export const api = {
  loadConfig: () => invoke<AppConfig>("load_config"),
  saveConfig: (config: AppConfig, expectedConfig: AppConfig | null) => invoke<void>("save_config", { config, expectedConfig }),
  saveConfigWithMoves: (config: AppConfig, moves: DirectoryMove[], expectedConfig: AppConfig) =>
    invoke<void>("save_config_with_moves", { config, moves, expectedConfig }),
  selectRoot: () => invoke<string | null>("select_root"),
  selectDirectory: (title: string, directory?: string) =>
    invoke<string | null>("select_directory", { title, directory: directory ?? null }),
  importConfig: () => invoke<AppConfig | null>("import_config"),
  exportConfig: () => invoke<boolean>("export_config"),
  preview: (item: SyncItem, rootDirectory: string) =>
    invoke<SyncPreview>("preview_sync", { item, rootDirectory }),
  sync: (item: SyncItem, rootDirectory: string, expectedPreview: SyncPreview) =>
    invoke<SyncItem>("sync_item", { item, rootDirectory, expectedPreview }),
  deleteDestinations: (targets: Array<{ rootDirectory: string; item: SyncItem }>) =>
    invoke<void>("delete_destinations", { targets }),
  directoryExists: (path: string) => invoke<boolean>("directory_exists", { path }),
  openDirectory: (path: string) => invoke<void>("open_directory", { path }),
};
