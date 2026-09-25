use chrono::Utc;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(unix)]
use std::os::unix::ffi::OsStrExt;
use std::{
    collections::{BTreeMap, HashSet},
    ffi::OsStr,
    fs,
    io::{self, Read, Write},
    path::{Component, Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use tempfile::TempDir;
use url::Url;
use walkdir::WalkDir;

const CONFIG_SCHEMA_VERSION: u8 = 3;
static CONFIG_WRITE_LOCK: Mutex<()> = Mutex::new(());

fn default_schema_version() -> u8 {
    CONFIG_SCHEMA_VERSION
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AppConfig {
    #[serde(default = "default_schema_version")]
    schema_version: u8,
    root_directories: Vec<RootDirectory>,
    theme: Option<Theme>,
    folder_groups: Vec<FolderGroup>,
    items: Vec<SyncItem>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            schema_version: CONFIG_SCHEMA_VERSION,
            root_directories: vec![],
            theme: None,
            folder_groups: vec![],
            items: vec![],
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RootDirectory {
    id: String,
    path: String,
    name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FolderGroup {
    root_id: String,
    path: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DirectoryMove {
    from: String,
    to: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeleteTarget {
    root_directory: String,
    item: SyncItem,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SyncItem {
    id: String,
    source_url: String,
    repo_url: String,
    branch: Option<String>,
    source_path: Option<String>,
    root_id: String,
    folder_group: String,
    destination_name: String,
    mirror: bool,
    last_status: SyncStatus,
    last_synced_at: Option<String>,
    last_commit: Option<String>,
    last_message: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Theme {
    Light,
    Dark,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum SyncStatus {
    NotSynced,
    Synced,
    Failed,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewChange {
    kind: String,
    path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    local_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    link_target: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncPreview {
    commit: String,
    changes: Vec<PreviewChange>,
}

struct PreparedSource {
    _temporary_directory: TempDir,
    source: PathBuf,
    commit: String,
}

enum TreeEntry {
    File,
    Symlink(PathBuf),
}

#[tauri::command]
fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    read_config(&path)
}

fn read_config(path: &Path) -> Result<AppConfig, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(AppConfig::default()),
        Err(error) => return Err(format!("无法检查配置文件：{error}")),
    }
    let file = fs::File::open(path).map_err(|error| format!("无法读取配置：{error}"))?;
    let value: serde_json::Value =
        serde_json::from_reader(file).map_err(|error| format!("配置文件格式无效：{error}"))?;
    let schema_version = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64);
    if schema_version == Some(2) {
        return Err("检测到旧版 schemaVersion: 2 配置；原文件已保留，请导入新版配置。".to_owned());
    }
    if schema_version != Some(CONFIG_SCHEMA_VERSION.into()) {
        return Err("配置版本不受支持。".to_owned());
    }
    let config: AppConfig =
        serde_json::from_value(value).map_err(|error| format!("配置文件格式无效：{error}"))?;
    validate_config(&config)?;
    Ok(config)
}

#[tauri::command]
fn save_config(
    app: AppHandle,
    config: AppConfig,
    expected_config: Option<AppConfig>,
) -> Result<(), String> {
    let _guard = CONFIG_WRITE_LOCK.lock().map_err(|_| "配置写入锁不可用。")?;
    validate_config(&config)?;
    let path = config_path(&app)?;
    ensure_current_config(&path, expected_config.as_ref())?;
    write_config(&path, &config)
}

#[tauri::command]
fn save_config_with_moves(
    app: AppHandle,
    config: AppConfig,
    moves: Vec<DirectoryMove>,
    expected_config: AppConfig,
) -> Result<(), String> {
    let _guard = CONFIG_WRITE_LOCK.lock().map_err(|_| "配置写入锁不可用。")?;
    let path = config_path(&app)?;
    ensure_current_config(&path, Some(&expected_config))?;
    for movement in &moves {
        validate_managed_move_path(&expected_config, Path::new(&movement.from))?;
        validate_managed_move_path(&config, Path::new(&movement.to))?;
    }
    write_config_with_moves(&path, &config, &moves)
}

fn validate_managed_move_path(config: &AppConfig, path: &Path) -> Result<(), String> {
    for root in &config.root_directories {
        let root_path = Path::new(&root.path);
        let Ok(relative) = path.strip_prefix(root_path) else {
            continue;
        };
        if relative.as_os_str().is_empty() {
            return Ok(());
        }
        let managed_group = config
            .folder_groups
            .iter()
            .any(|group| group.root_id == root.id && root_path.join(&group.path) == path);
        let managed_item = config.items.iter().any(|item| {
            item.root_id == root.id
                && root_path
                    .join(&item.folder_group)
                    .join(&item.destination_name)
                    == path
        });
        if !managed_group && !managed_item {
            continue;
        }
        let mut current = root_path.to_path_buf();
        for component in relative.components() {
            current.push(component);
            match fs::symlink_metadata(&current) {
                Ok(metadata) if metadata.file_type().is_symlink() => {
                    return Err(format!("移动路径包含符号链接：{}", current.display()));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => {
                    return Err(format!("无法检查移动路径 {}：{error}", current.display()))
                }
                _ => {}
            }
        }
        return Ok(());
    }
    Err(format!("移动路径不属于受管理的文件夹：{}", path.display()))
}

fn ensure_current_config(path: &Path, expected: Option<&AppConfig>) -> Result<(), String> {
    if let Some(expected) = expected {
        let current = read_config(path)?;
        if &current != expected {
            return Err("配置已被其他操作修改；请重新打开应用后重试。".to_owned());
        }
    }
    Ok(())
}

fn write_config_with_moves(
    path: &Path,
    config: &AppConfig,
    moves: &[DirectoryMove],
) -> Result<(), String> {
    validate_config(config)?;
    let mut sources = HashSet::new();
    let mut targets = HashSet::new();
    for movement in moves {
        let from = Path::new(&movement.from);
        let to = Path::new(&movement.to);
        if !from.is_absolute() || !to.is_absolute() || from == to || to.starts_with(from) {
            return Err("本地文件夹移动路径无效。".to_owned());
        }
        if !sources.insert(from) || !targets.insert(to) {
            return Err("本地文件夹移动路径重复。".to_owned());
        }
        match fs::symlink_metadata(from) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(format!("原位置不是普通目录：{}", from.display()));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查原位置 {}：{error}", from.display())),
            _ => {}
        }
        match fs::symlink_metadata(to) {
            Ok(_) => return Err(format!("新位置已被占用：{}", to.display())),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查新位置 {}：{error}", to.display())),
        }
    }

    let mut completed: Vec<&DirectoryMove> = Vec::new();
    for movement in moves {
        let from = Path::new(&movement.from);
        if !from.exists() {
            continue;
        }
        let result = if let Some(parent) = Path::new(&movement.to).parent() {
            fs::create_dir_all(parent).and_then(|_| fs::rename(from, &movement.to))
        } else {
            fs::rename(from, &movement.to)
        };
        if let Err(error) = result {
            return Err(rollback_moves(
                &completed,
                format!("无法移动本地文件夹 {}：{error}", movement.from),
            ));
        }
        completed.push(movement);
    }
    if let Err(error) = write_config(path, config) {
        return Err(rollback_moves(&completed, error));
    }
    Ok(())
}

fn rollback_moves(completed: &[&DirectoryMove], error: String) -> String {
    let failures: Vec<_> = completed
        .iter()
        .rev()
        .filter_map(|movement| {
            fs::rename(&movement.to, &movement.from)
                .err()
                .map(|cause| format!("{} → {}：{cause}", movement.to, movement.from))
        })
        .collect();
    if failures.is_empty() {
        format!("{error}。配置未更新，已还原本地文件夹。")
    } else {
        format!(
            "{error}。配置未更新，但以下文件夹还原失败，请手动检查：{}",
            failures.join("；")
        )
    }
}

fn write_config(path: &Path, config: &AppConfig) -> Result<(), String> {
    let json =
        serde_json::to_vec_pretty(&config).map_err(|error| format!("无法序列化配置：{error}"))?;
    let parent = path.parent().ok_or("配置路径无效。")?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| format!("无法创建临时配置：{error}"))?;
    temporary
        .write_all(&json)
        .map_err(|error| format!("无法写入配置：{error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| format!("无法保存配置：{error}"))?;
    temporary
        .persist(path)
        .map_err(|error| format!("无法替换配置：{}", error.error))?;
    Ok(())
}

#[tauri::command]
fn select_root() -> Option<String> {
    select_directory("选择 RepoMirror 根目录".to_owned(), None)
}

#[tauri::command]
fn select_directory(title: String, directory: Option<String>) -> Option<String> {
    let mut dialog = FileDialog::new().set_title(&title);
    if let Some(path) = directory {
        dialog = dialog.set_directory(path);
    }
    dialog
        .pick_folder()
        .and_then(|path| fs::canonicalize(path).ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
fn open_directory(path: String) -> Result<(), String> {
    if !Path::new(&path).is_dir() {
        return Err("文件夹不存在。".to_owned());
    }
    std::process::Command::new("open")
        .arg(&path)
        .status()
        .map_err(|error| format!("无法打开文件夹：{error}"))?
        .success()
        .then_some(())
        .ok_or_else(|| "无法打开文件夹。".to_owned())
}

#[tauri::command]
fn import_config() -> Result<Option<AppConfig>, String> {
    let Some(path) = FileDialog::new()
        .set_title("导入 RepoMirror 配置")
        .add_filter("JSON", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    let file = fs::File::open(&path).map_err(|error| format!("无法读取导入文件：{error}"))?;
    let value: serde_json::Value =
        serde_json::from_reader(file).map_err(|error| format!("导入文件不是有效 JSON：{error}"))?;
    if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(CONFIG_SCHEMA_VERSION.into())
    {
        return Err("导入文件必须包含 schemaVersion: 3。旧版配置不再支持。".to_owned());
    }
    let config: AppConfig = serde_json::from_value(value)
        .map_err(|error| format!("导入文件不符合 RepoMirror 配置格式：{error}"))?;
    validate_config(&config)?;
    Ok(Some(config))
}

#[tauri::command]
fn export_config(app: AppHandle) -> Result<bool, String> {
    let config = read_config(&config_path(&app)?)?;
    let Some(path) = FileDialog::new()
        .set_title("导出 RepoMirror 配置")
        .set_file_name("repo-mirror-config.json")
        .add_filter("JSON", &["json"])
        .save_file()
    else {
        return Ok(false);
    };
    let json =
        serde_json::to_vec_pretty(&config).map_err(|error| format!("无法序列化配置：{error}"))?;
    fs::write(path, json).map_err(|error| format!("无法导出配置：{error}"))?;
    Ok(true)
}

#[tauri::command]
async fn preview_sync(
    app: AppHandle,
    item: SyncItem,
    root_directory: String,
) -> Result<SyncPreview, String> {
    ensure_saved_item(&app, &item, &root_directory)?;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare_source(&item)?;
        let destination = destination_path(&root_directory, &item)?;
        Ok(SyncPreview {
            commit: prepared.commit,
            changes: compare_trees(&prepared.source, &destination, item.mirror)?,
        })
    })
    .await
    .map_err(|error| format!("同步预览任务意外中断：{error}"))?
}

#[tauri::command]
async fn sync_item(
    app: AppHandle,
    item: SyncItem,
    root_directory: String,
    expected_preview: SyncPreview,
) -> Result<SyncItem, String> {
    ensure_saved_item(&app, &item, &root_directory)?;
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare_source(&item)?;
        let destination = destination_path(&root_directory, &item)?;
        let actual_preview = SyncPreview {
            commit: prepared.commit.clone(),
            changes: compare_trees(&prepared.source, &destination, item.mirror)?,
        };
        ensure_preview_matches(&expected_preview, &actual_preview)?;
        let mut updated = item;
        apply_sync(&prepared.source, &destination, updated.mirror)?;
        updated.last_status = SyncStatus::Synced;
        updated.last_synced_at = Some(Utc::now().to_rfc3339());
        updated.last_commit = Some(prepared.commit);
        updated.last_message = None;
        Ok(updated)
    })
    .await
    .map_err(|error| format!("同步任务意外中断：{error}"))?
}

fn ensure_saved_item(app: &AppHandle, item: &SyncItem, root_directory: &str) -> Result<(), String> {
    let config = read_config(&config_path(app)?)?;
    let saved = config
        .items
        .iter()
        .find(|candidate| candidate.id == item.id);
    let root = config
        .root_directories
        .iter()
        .find(|candidate| candidate.id == item.root_id);
    if saved != Some(item) || root.map(|directory| directory.path.as_str()) != Some(root_directory)
    {
        return Err("同步项配置已变化；请重新打开或重新预览后再试。".to_owned());
    }
    Ok(())
}

fn ensure_preview_matches(expected: &SyncPreview, actual: &SyncPreview) -> Result<(), String> {
    if expected != actual {
        return Err("来源或本地文件已变化，预览已过期；请重新预览后再同步。".to_owned());
    }
    Ok(())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("无法定位应用配置目录：{error}"))?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建应用配置目录：{error}"))?;
    Ok(directory.join("config.json"))
}

fn validate_relative_path(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    let path = Path::new(value);
    if path.is_absolute()
        || value.contains('\\')
        || value.contains('\0')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || path.components().any(|component| {
            matches!(
                component,
                Component::CurDir
                    | Component::ParentDir
                    | Component::RootDir
                    | Component::Prefix(_)
            )
        })
    {
        return Err("文件夹路径必须是普通相对路径。".to_owned());
    }
    Ok(())
}

fn validate_config(config: &AppConfig) -> Result<(), String> {
    if config.schema_version != CONFIG_SCHEMA_VERSION {
        return Err(format!("仅支持 schemaVersion: {CONFIG_SCHEMA_VERSION}。"));
    }
    let mut roots: HashSet<String> = HashSet::new();
    let mut root_paths: HashSet<PathBuf> = HashSet::new();
    for root in &config.root_directories {
        if root.id.trim().is_empty() || !roots.insert(root.id.clone()) {
            return Err("每个根目录必须有唯一且非空的 id。".to_owned());
        }
        let canonical = canonical_root_path(&root.path)?;
        if !root_paths.insert(canonical.clone()) {
            return Err("根目录重复或不是目录。".to_owned());
        }
        if root_paths.iter().any(|existing| {
            existing != &canonical
                && (existing.starts_with(&canonical) || canonical.starts_with(existing))
        }) {
            return Err("根目录不能位于另一个根目录之内。".to_owned());
        }
    }

    let mut groups: HashSet<(String, String)> = HashSet::new();
    for group in &config.folder_groups {
        if group.path.is_empty() {
            return Err("文件夹组不能是根目录。".to_owned());
        }
        if !roots.contains(&group.root_id) {
            return Err("文件夹组引用了不存在的根目录。".to_owned());
        }
        validate_relative_path(&group.path)?;
        if !groups.insert((group.root_id.clone(), group.path.clone())) {
            return Err(format!("文件夹组重复：{}", group.path));
        }
    }

    let mut identifiers: HashSet<String> = HashSet::new();
    let mut destinations: HashSet<String> = HashSet::new();
    for item in &config.items {
        if item.id.trim().is_empty() || !identifiers.insert(item.id.clone()) {
            return Err("每个同步项必须有唯一且非空的 id。".to_owned());
        }
        if !roots.contains(&item.root_id) {
            return Err("同步项引用了不存在的根目录。".to_owned());
        }
        validate_relative_path(&item.folder_group)?;
        if !item.folder_group.is_empty()
            && !groups.contains(&(item.root_id.clone(), item.folder_group.clone()))
        {
            return Err(format!(
                "同步项引用了不存在的文件夹组：{}",
                item.folder_group
            ));
        }
        validate_name(&item.destination_name)?;
        validate_source(item)?;
        if let Some(timestamp) = &item.last_synced_at {
            chrono::DateTime::parse_from_rfc3339(timestamp)
                .map_err(|_| format!("同步时间不是 RFC 3339 格式：{timestamp}"))?;
        }
        let destination = format!(
            "{}/{}/{}",
            item.root_id, item.folder_group, item.destination_name
        );
        if !destinations.insert(destination) {
            return Err("同步项目标路径不能重复。".to_owned());
        }
    }

    for group in &config.folder_groups {
        for item in &config.items {
            if group.root_id != item.root_id {
                continue;
            }
            let destination = if item.folder_group.is_empty() {
                item.destination_name.clone()
            } else {
                format!("{}/{}", item.folder_group, item.destination_name)
            };
            if group.path == destination || group.path.starts_with(&format!("{destination}/")) {
                return Err("文件夹组不能位于同步项目标目录内。".to_owned());
            }
        }
    }
    Ok(())
}

fn canonical_root_path(value: &str) -> Result<PathBuf, String> {
    let path = Path::new(value);
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(format!("根目录必须是规范的绝对路径：{value}"));
    }

    let mut existing = path;
    let mut missing = Vec::new();
    loop {
        match fs::canonicalize(existing) {
            Ok(mut canonical) => {
                if !canonical.is_dir() {
                    return Err(format!("根目录或其上级路径不是目录：{value}"));
                }
                for component in missing.iter().rev() {
                    canonical.push(component);
                }
                return Ok(canonical);
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                if fs::symlink_metadata(existing).is_ok() {
                    return Err(format!("根目录路径包含失效的符号链接：{value}"));
                }
                let name = existing
                    .file_name()
                    .ok_or_else(|| format!("无法访问根目录路径：{value}"))?;
                missing.push(name.to_os_string());
                existing = existing
                    .parent()
                    .ok_or_else(|| format!("无法访问根目录路径：{value}"))?;
            }
            Err(error) => return Err(format!("无法访问根目录路径 {value}：{error}")),
        }
    }
}

fn validate_source(item: &SyncItem) -> Result<(), String> {
    let source_url =
        Url::parse(&item.source_url).map_err(|_| "sourceUrl 必须是有效 URL。".to_owned())?;
    if source_url.scheme() != "https"
        || source_url.host_str() != Some("github.com")
        || !source_url.username().is_empty()
        || source_url.password().is_some()
        || source_url.port().is_some()
        || source_url.query().is_some()
        || source_url.fragment().is_some()
    {
        return Err("sourceUrl 必须是无查询参数的 https://github.com 链接。".to_owned());
    }
    let source_parts: Vec<_> = source_url
        .path_segments()
        .map(|parts| parts.filter(|part| !part.is_empty()).collect())
        .unwrap_or_default();
    let source_is_repo = source_parts.len() == 2;
    let source_is_folder = source_parts.len() >= 5 && source_parts[2] == "tree";
    if !source_is_repo && !source_is_folder {
        return Err("sourceUrl 必须是仓库链接或 tree/<branch>/<path> 目录链接。".to_owned());
    }

    let repo_url = Url::parse(&item.repo_url).map_err(|_| "repoUrl 必须是有效 URL。".to_owned())?;
    if repo_url.scheme() != "https"
        || repo_url.host_str() != Some("github.com")
        || !repo_url.username().is_empty()
        || repo_url.password().is_some()
        || repo_url.port().is_some()
        || repo_url.query().is_some()
        || repo_url.fragment().is_some()
    {
        return Err("repoUrl 必须是 https://github.com 地址。".to_owned());
    }
    let repo_parts: Vec<_> = repo_url
        .path_segments()
        .map(|parts| parts.filter(|part| !part.is_empty()).collect())
        .unwrap_or_default();
    if repo_parts.len() != 2
        || !repo_parts[1].ends_with(".git")
        || source_parts[0] != repo_parts[0]
        || source_parts[1] != repo_parts[1].trim_end_matches(".git")
    {
        return Err("repoUrl 必须与 sourceUrl 指向同一个 GitHub 仓库。".to_owned());
    }

    match (&item.branch, &item.source_path) {
        (None, None) if source_is_repo => Ok(()),
        (Some(branch), Some(path)) if source_is_folder => {
            let branch_parts: Vec<_> = branch.split('/').collect();
            if branch_parts
                .iter()
                .any(|part| part.is_empty() || *part == "." || *part == "..")
                || source_parts[3..].len() <= branch_parts.len()
                || source_parts[3..3 + branch_parts.len()] != branch_parts
                || path != &source_parts[3 + branch_parts.len()..].join("/")
            {
                return Err("branch 和 sourcePath 必须与 sourceUrl 的目录链接一致。".to_owned());
            }
            validate_relative_path(path)
        }
        _ => Err("仓库链接不能包含 branch/sourcePath；目录链接必须同时包含二者。".to_owned()),
    }
}

fn validate_name(value: &str) -> Result<(), String> {
    if value.trim().is_empty()
        || value.contains('/')
        || value.contains('\\')
        || value == "."
        || value == ".."
    {
        return Err("最终文件夹名称无效。".to_owned());
    }
    Ok(())
}

fn destination_path(root_directory: &str, item: &SyncItem) -> Result<PathBuf, String> {
    validate_relative_path(&item.folder_group)?;
    validate_name(&item.destination_name)?;
    let root = canonical_root_path(root_directory)?;
    let destination = root.join(&item.folder_group).join(&item.destination_name);
    let mut segment_path = root.clone();
    for segment in Path::new(&item.folder_group)
        .join(&item.destination_name)
        .components()
    {
        segment_path.push(segment);
        match fs::symlink_metadata(&segment_path) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(format!("目标路径包含符号链接：{}", segment_path.display()));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查目标路径：{error}")),
            _ => {}
        }
    }
    let resolved = canonical_root_path(&destination.to_string_lossy())?;
    if !resolved.starts_with(&root) {
        return Err("目标路径通过符号链接离开了根目录。".to_owned());
    }
    Ok(destination)
}

#[tauri::command]
fn delete_destinations(targets: Vec<DeleteTarget>) -> Result<(), String> {
    let mut directories = Vec::new();
    for target in targets {
        let directory = destination_path(&target.root_directory, &target.item)?;
        match fs::symlink_metadata(&directory) {
            Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                return Err(format!("不是普通目录：{}", directory.display()));
            }
            Ok(_) => directories.push(directory),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查目录 {}：{error}", directory.display())),
        }
    }
    let failures: Vec<_> = directories
        .into_iter()
        .filter_map(|directory| {
            fs::remove_dir_all(&directory)
                .err()
                .map(|error| format!("{}：{error}", directory.display()))
        })
        .collect();
    if failures.is_empty() {
        Ok(())
    } else {
        Err(format!("以下本地目录未能删除：{}", failures.join("；")))
    }
}

#[tauri::command]
fn directory_exists(path: String) -> bool {
    Path::new(&path).is_dir()
}

fn prepare_source(item: &SyncItem) -> Result<PreparedSource, String> {
    let temporary_directory =
        tempfile::tempdir().map_err(|error| format!("无法创建临时目录：{error}"))?;
    let clone_directory = temporary_directory.path().join("source");
    let mut clone = Command::new("git");
    clone
        .arg("clone")
        .arg("--depth")
        .arg("1")
        .arg("--filter=blob:none");
    if item.source_path.is_some() {
        clone.arg("--sparse");
    }
    if let Some(branch) = &item.branch {
        clone.arg("--branch").arg(branch);
    }
    clone
        .arg(&item.repo_url)
        .arg(&clone_directory)
        .env("GIT_TERMINAL_PROMPT", "0");
    run_git(clone, "无法获取 GitHub 来源")?;

    let source = if let Some(source_path) = &item.source_path {
        validate_relative_path(source_path)?;
        let mut sparse = Command::new("git");
        sparse
            .arg("-C")
            .arg(&clone_directory)
            .arg("sparse-checkout")
            .arg("set")
            .arg("--no-cone")
            .arg(source_path);
        run_git(sparse, "无法读取仓库子目录")?;
        clone_directory.join(source_path)
    } else {
        clone_directory.clone()
    };
    if !source.is_dir() {
        return Err("来源目录不存在；请检查 GitHub 链接、分支和路径。".to_owned());
    }
    if let Some(source_path) = &item.source_path {
        let mut current = clone_directory.clone();
        for component in Path::new(source_path).components() {
            current.push(component);
            let metadata = fs::symlink_metadata(&current)
                .map_err(|error| format!("无法检查来源目录：{error}"))?;
            if metadata.file_type().is_symlink() {
                return Err(format!("来源目录路径包含符号链接：{}", current.display()));
            }
        }
    }
    let source = source
        .canonicalize()
        .map_err(|error| format!("无法解析来源目录：{error}"))?;
    let clone_root = clone_directory
        .canonicalize()
        .map_err(|error| format!("无法解析克隆目录：{error}"))?;
    if !source.starts_with(&clone_root) {
        return Err("来源目录通过符号链接离开了克隆目录。".to_owned());
    }

    let mut revision = Command::new("git");
    revision
        .arg("-C")
        .arg(&clone_directory)
        .arg("rev-parse")
        .arg("HEAD");
    let commit = String::from_utf8(run_git(revision, "无法读取来源版本")?)
        .map_err(|_| "Git 返回了无效版本号。".to_owned())?
        .trim()
        .to_owned();

    Ok(PreparedSource {
        _temporary_directory: temporary_directory,
        source,
        commit,
    })
}

fn run_git(mut command: Command, context: &str) -> Result<Vec<u8>, String> {
    let output = command
        .output()
        .map_err(|error| format!("{context}：{error}"))?;
    if output.status.success() {
        return Ok(output.stdout);
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(format!(
        "{context}：{}",
        if message.is_empty() {
            "Git 命令失败。"
        } else {
            &message
        }
    ))
}

fn compare_trees(
    source: &Path,
    destination: &Path,
    mirror: bool,
) -> Result<Vec<PreviewChange>, String> {
    let source_entries = collect_entries(source)?;
    validate_destination_tree(destination, &source_entries)?;
    let destination_entries = collect_entries(destination)?;
    let mut changes = Vec::new();

    for (relative, source_entry) in &source_entries {
        let path = display_path(relative);
        let kind = if matches!(source_entry, TreeEntry::Symlink(_)) {
            "add_symlink"
        } else {
            "add"
        };
        let link_target = match source_entry {
            TreeEntry::Symlink(target) => Some(target.to_string_lossy().into_owned()),
            TreeEntry::File => None,
        };
        match destination_entries.get(relative) {
            None => changes.push(PreviewChange {
                kind: kind.to_owned(),
                path,
                local_fingerprint: None,
                link_target,
            }),
            Some(destination_entry)
                if !entries_equal(
                    source_entry,
                    destination_entry,
                    &source.join(relative),
                    &destination.join(relative),
                )? =>
            {
                changes.push(PreviewChange {
                    kind: if matches!(source_entry, TreeEntry::Symlink(_)) {
                        "modify_symlink"
                    } else {
                        "modify"
                    }
                    .to_owned(),
                    path,
                    local_fingerprint: Some(entry_fingerprint(
                        destination_entry,
                        &destination.join(relative),
                    )?),
                    link_target,
                })
            }
            _ => {}
        }
    }
    if mirror {
        for (relative, destination_entry) in destination_entries
            .iter()
            .filter(|(relative, _)| !source_entries.contains_key(*relative))
        {
            changes.push(PreviewChange {
                kind: if matches!(destination_entry, TreeEntry::Symlink(_)) {
                    "delete_symlink"
                } else {
                    "delete"
                }
                .to_owned(),
                path: display_path(relative),
                local_fingerprint: Some(entry_fingerprint(
                    destination_entry,
                    &destination.join(relative),
                )?),
                link_target: match destination_entry {
                    TreeEntry::Symlink(target) => Some(target.to_string_lossy().into_owned()),
                    TreeEntry::File => None,
                },
            });
        }
    }
    if changes.is_empty() && !destination.exists() {
        changes.push(PreviewChange {
            kind: "create_directory".to_owned(),
            path: ".".to_owned(),
            local_fingerprint: None,
            link_target: None,
        });
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

fn apply_sync(source: &Path, destination: &Path, mirror: bool) -> Result<(), String> {
    let source_entries = collect_entries(source)?;
    validate_destination_tree(destination, &source_entries)?;
    fs::create_dir_all(destination).map_err(|error| format!("无法创建目标目录：{error}"))?;
    let destination_entries = collect_entries(destination)?;

    for (relative, source_entry) in &source_entries {
        let target = destination.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建目标父目录：{error}"))?;
        }
        let needs_copy = match destination_entries.get(relative) {
            Some(existing) => {
                !entries_equal(source_entry, existing, &source.join(relative), &target)?
            }
            None => true,
        };
        if needs_copy {
            let replace_existing = destination_entries.get(relative).is_some_and(|existing| {
                matches!(source_entry, TreeEntry::Symlink(_))
                    || matches!(existing, TreeEntry::Symlink(_))
            });
            if replace_existing {
                fs::remove_file(&target).map_err(|error| format!("无法替换目标文件：{error}"))?;
            }
            match source_entry {
                TreeEntry::File => {
                    fs::copy(source.join(relative), &target)
                        .map_err(|error| format!("无法写入目标文件：{error}"))?;
                }
                TreeEntry::Symlink(link_target) => create_symlink(link_target, &target)?,
            }
        }
    }

    if mirror {
        for relative in destination_entries
            .keys()
            .filter(|relative| !source_entries.contains_key(*relative))
        {
            let target = destination.join(relative);
            if let Err(error) = fs::remove_file(&target) {
                if error.kind() != io::ErrorKind::NotFound {
                    return Err(format!("无法移除过期文件：{error}"));
                }
            }
        }
    }
    Ok(())
}

fn validate_destination_tree(
    source_root: &Path,
    source_entries: &BTreeMap<PathBuf, TreeEntry>,
) -> Result<(), String> {
    match fs::symlink_metadata(source_root) {
        Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
            return Err(format!("目标不是普通目录：{}", source_root.display()));
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("无法检查目标目录：{error}")),
        _ => {}
    }
    for relative in source_entries.keys() {
        let target = source_root.join(relative);
        match fs::symlink_metadata(&target) {
            Ok(metadata) if metadata.is_dir() => {
                return Err(format!("来源文件与本地目录冲突：{}", target.display()));
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("无法检查目标路径：{error}")),
            _ => {}
        }
        let mut parent = source_root.to_path_buf();
        for component in relative.parent().into_iter().flat_map(Path::components) {
            parent.push(component);
            match fs::symlink_metadata(&parent) {
                Ok(metadata) if !metadata.is_dir() || metadata.file_type().is_symlink() => {
                    return Err(format!("来源目录与本地文件冲突：{}", parent.display()));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("无法检查目标路径：{error}")),
                _ => {}
            }
        }
    }
    Ok(())
}

fn collect_entries(root: &Path) -> Result<BTreeMap<PathBuf, TreeEntry>, String> {
    let mut entries = BTreeMap::new();
    if !root.exists() {
        return Ok(entries);
    }
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !should_ignore(entry.path(), root))
    {
        let entry = entry.map_err(|error| format!("无法读取目录：{error}"))?;
        if entry.file_type().is_file() || entry.file_type().is_symlink() {
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|error| format!("无法解析来源路径：{error}"))?
                .to_path_buf();
            let value = if entry.file_type().is_symlink() {
                TreeEntry::Symlink(fs::read_link(entry.path()).map_err(|error| {
                    format!("无法读取符号链接 {}：{error}", entry.path().display())
                })?)
            } else {
                TreeEntry::File
            };
            entries.insert(relative, value);
        } else if !entry.file_type().is_dir() {
            return Err(format!(
                "目录包含不支持的文件类型：{}",
                entry.path().display()
            ));
        }
    }
    Ok(entries)
}

fn entries_equal(
    source: &TreeEntry,
    destination: &TreeEntry,
    source_path: &Path,
    destination_path: &Path,
) -> Result<bool, String> {
    match (source, destination) {
        (TreeEntry::File, TreeEntry::File) => files_equal(source_path, destination_path),
        (TreeEntry::Symlink(left), TreeEntry::Symlink(right)) => Ok(left == right),
        _ => Ok(false),
    }
}

fn entry_fingerprint(entry: &TreeEntry, path: &Path) -> Result<String, String> {
    match entry {
        TreeEntry::File => file_fingerprint(path),
        TreeEntry::Symlink(target) => {
            let mut hash = Sha256::new();
            hash.update(b"symlink\0");
            hash.update(target.as_os_str().as_bytes());
            Ok(format!("{:x}", hash.finalize()))
        }
    }
}

#[cfg(unix)]
fn create_symlink(link_target: &Path, destination: &Path) -> Result<(), String> {
    std::os::unix::fs::symlink(link_target, destination)
        .map_err(|error| format!("无法创建目标符号链接：{error}"))
}

fn should_ignore(path: &Path, root: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };
    relative.components().any(|component| match component {
        Component::Normal(name) => {
            name == OsStr::new(".git")
                || name == OsStr::new("node_modules")
                || name == OsStr::new(".DS_Store")
        }
        _ => false,
    })
}

fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    let left_metadata = fs::metadata(left).map_err(|error| format!("无法读取来源文件：{error}"))?;
    let right_metadata =
        fs::metadata(right).map_err(|error| format!("无法读取目标文件：{error}"))?;
    if left_metadata.len() != right_metadata.len() {
        return Ok(false);
    }
    let mut left_file =
        fs::File::open(left).map_err(|error| format!("无法打开来源文件：{error}"))?;
    let mut right_file =
        fs::File::open(right).map_err(|error| format!("无法打开目标文件：{error}"))?;
    let mut left_buffer = [0; 8192];
    let mut right_buffer = [0; 8192];
    loop {
        let left_read = left_file
            .read(&mut left_buffer)
            .map_err(|error| format!("无法读取来源文件：{error}"))?;
        let right_read = right_file
            .read(&mut right_buffer)
            .map_err(|error| format!("无法读取目标文件：{error}"))?;
        if left_read != right_read || left_buffer[..left_read] != right_buffer[..right_read] {
            return Ok(false);
        }
        if left_read == 0 {
            return Ok(true);
        }
    }
}

fn file_fingerprint(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| format!("无法读取本地文件：{error}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 8192];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("无法计算本地文件指纹：{error}"))?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            save_config_with_moves,
            select_root,
            select_directory,
            import_config,
            export_config,
            preview_sync,
            sync_item,
            delete_destinations,
            directory_exists,
            open_directory
        ])
        .run(tauri::generate_context!())
        .expect("error while running RepoMirror");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repository_item() -> SyncItem {
        SyncItem {
            id: "root-item".to_owned(),
            source_url: "https://github.com/example/plugin".to_owned(),
            repo_url: "https://github.com/example/plugin.git".to_owned(),
            branch: None,
            source_path: None,
            root_id: "root".to_owned(),
            folder_group: "".to_owned(),
            destination_name: "plugin".to_owned(),
            mirror: true,
            last_status: SyncStatus::NotSynced,
            last_synced_at: None,
            last_commit: None,
            last_message: None,
        }
    }

    #[test]
    fn accepts_a_valid_repository_configuration() {
        let config = AppConfig {
            schema_version: CONFIG_SCHEMA_VERSION,
            root_directories: vec![RootDirectory {
                id: "root".to_owned(),
                path: "/tmp".to_owned(),
                name: None,
            }],
            theme: Some(Theme::Light),
            folder_groups: vec![],
            items: vec![repository_item()],
        };
        assert!(validate_config(&config).is_ok());
    }

    #[test]
    fn accepts_a_missing_root_and_sync_creates_it() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("moved-root");
        let config = AppConfig {
            schema_version: CONFIG_SCHEMA_VERSION,
            root_directories: vec![RootDirectory {
                id: "root".to_owned(),
                path: root.to_string_lossy().into_owned(),
                name: None,
            }],
            theme: None,
            folder_groups: vec![],
            items: vec![repository_item()],
        };

        assert!(!root.exists());
        validate_config(&config).unwrap();
        assert!(
            !root.exists(),
            "loading configuration must not create folders"
        );

        let source = temporary.path().join("source");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("item.txt"), "contents").unwrap();
        let destination =
            destination_path(&config.root_directories[0].path, &config.items[0]).unwrap();
        assert_eq!(compare_trees(&source, &destination, true).unwrap().len(), 1);
        assert!(!root.exists(), "preview must not create folders");
        apply_sync(&source, &destination, true).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("item.txt")).unwrap(),
            "contents"
        );
    }

    #[test]
    fn empty_source_still_previews_and_creates_a_missing_destination() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("root/group/item");
        fs::create_dir(&source).unwrap();
        let changes = compare_trees(&source, &destination, true).unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, "create_directory");
        apply_sync(&source, &destination, true).unwrap();
        assert!(destination.is_dir());
        assert!(compare_trees(&source, &destination, true)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn rejects_a_root_nested_inside_another_root() {
        let temporary = tempfile::tempdir().unwrap();
        let child = temporary.path().join("nested");
        fs::create_dir(&child).unwrap();
        let config = AppConfig {
            schema_version: CONFIG_SCHEMA_VERSION,
            root_directories: vec![
                RootDirectory {
                    id: "outer".to_owned(),
                    path: temporary.path().to_string_lossy().into_owned(),
                    name: None,
                },
                RootDirectory {
                    id: "inner".to_owned(),
                    path: child.to_string_lossy().into_owned(),
                    name: None,
                },
            ],
            theme: None,
            folder_groups: vec![],
            items: vec![],
        };
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn rejects_a_missing_root_nested_inside_another_root() {
        let temporary = tempfile::tempdir().unwrap();
        let config = AppConfig {
            schema_version: CONFIG_SCHEMA_VERSION,
            root_directories: vec![
                RootDirectory {
                    id: "outer".to_owned(),
                    path: temporary.path().to_string_lossy().into_owned(),
                    name: None,
                },
                RootDirectory {
                    id: "inner".to_owned(),
                    path: temporary
                        .path()
                        .join("future/nested")
                        .to_string_lossy()
                        .into_owned(),
                    name: None,
                },
            ],
            theme: None,
            folder_groups: vec![],
            items: vec![],
        };
        assert!(validate_config(&config).is_err());
        assert!(!temporary.path().join("future").exists());
    }

    #[test]
    fn rejects_a_missing_root_below_a_file() {
        let temporary = tempfile::tempdir().unwrap();
        let file = temporary.path().join("file");
        fs::write(&file, "contents").unwrap();
        assert!(canonical_root_path(&file.join("child").to_string_lossy()).is_err());
    }

    #[test]
    fn rejects_a_source_that_does_not_match_its_repository() {
        let mut item = repository_item();
        item.repo_url = "https://github.com/example/other.git".to_owned();
        let config = AppConfig {
            schema_version: CONFIG_SCHEMA_VERSION,
            root_directories: vec![RootDirectory {
                id: "root".to_owned(),
                path: "/tmp".to_owned(),
                name: None,
            }],
            theme: None,
            folder_groups: vec![],
            items: vec![item],
        };
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn rejects_repository_urls_with_credentials_or_query_parameters() {
        let mut item = repository_item();
        item.repo_url = "https://user:secret@github.com/example/plugin.git".to_owned();
        assert!(validate_source(&item).is_err());
        item.repo_url = "https://github.com/example/plugin.git?other=true".to_owned();
        assert!(validate_source(&item).is_err());
    }

    #[test]
    fn accepts_an_explicit_slash_named_branch() {
        let mut item = repository_item();
        item.source_url =
            "https://github.com/example/plugin/tree/feature/new-ui/packages/tool".to_owned();
        item.branch = Some("feature/new-ui".to_owned());
        item.source_path = Some("packages/tool".to_owned());
        assert!(validate_source(&item).is_ok());
        item.branch = Some("feature".to_owned());
        assert!(validate_source(&item).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn deletion_rejects_a_symlink_before_removing_any_directory() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("root");
        let ordinary = root.join("ordinary");
        let linked = root.join("linked");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&ordinary).unwrap();
        symlink(&ordinary, &linked).unwrap();
        let mut ordinary_item = repository_item();
        ordinary_item.destination_name = "ordinary".to_owned();
        let mut linked_item = repository_item();
        linked_item.destination_name = "linked".to_owned();
        assert!(delete_destinations(vec![
            DeleteTarget {
                root_directory: root.to_string_lossy().into_owned(),
                item: ordinary_item
            },
            DeleteTarget {
                root_directory: root.to_string_lossy().into_owned(),
                item: linked_item
            },
        ])
        .is_err());
        assert!(ordinary.is_dir());
    }

    #[test]
    fn rejects_unknown_configuration_fields() {
        let json = r#"{"schemaVersion":3,"rootDirectories":[],"folderGroups":[],"items":[],"unexpected":true}"#;
        assert!(serde_json::from_str::<AppConfig>(json).is_err());
    }

    #[test]
    fn accepts_only_current_sync_statuses() {
        assert!(serde_json::from_str::<SyncStatus>(r#""synced""#).is_ok());
        assert!(serde_json::from_str::<SyncStatus>(r#""updated""#).is_err());
        assert!(serde_json::from_str::<SyncStatus>(r#""up_to_date""#).is_err());
    }

    #[test]
    fn preserves_unsupported_saved_configuration() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("config.json");
        let original = br#"{"schemaVersion":2,"items":[{"id":"saved"}]}"#;
        fs::write(&path, original).unwrap();
        assert!(read_config(&path).is_err());
        assert_eq!(fs::read(&path).unwrap(), original);
    }

    #[cfg(unix)]
    #[test]
    fn broken_config_symlink_is_an_error_instead_of_an_empty_configuration() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("config.json");
        symlink(temporary.path().join("missing.json"), &path).unwrap();
        assert!(read_config(&path).is_err());
        assert!(fs::symlink_metadata(&path)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn rejects_equivalent_non_normalized_group_paths() {
        for path in ["a//b", "a/b/", "a/./b", "a/../b", "a\\b"] {
            assert!(validate_relative_path(path).is_err(), "{path}");
        }
    }

    #[test]
    fn rejects_stale_source_or_local_preview() {
        let expected = SyncPreview {
            commit: "first".to_owned(),
            changes: vec![PreviewChange {
                kind: "add".to_owned(),
                path: "a".to_owned(),
                local_fingerprint: None,
                link_target: None,
            }],
        };
        let mut actual = expected.clone();
        assert!(ensure_preview_matches(&expected, &actual).is_ok());
        actual.commit = "second".to_owned();
        assert!(ensure_preview_matches(&expected, &actual).is_err());
        actual.commit = expected.commit.clone();
        actual.changes.clear();
        assert!(ensure_preview_matches(&expected, &actual).is_err());
    }

    #[test]
    fn changing_an_already_modified_local_file_expires_its_preview() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(source.join("item.txt"), "remote").unwrap();
        fs::write(destination.join("item.txt"), "local-one").unwrap();
        let expected = SyncPreview {
            commit: "same-commit".to_owned(),
            changes: compare_trees(&source, &destination, true).unwrap(),
        };
        fs::write(destination.join("item.txt"), "local-two").unwrap();
        let actual = SyncPreview {
            commit: "same-commit".to_owned(),
            changes: compare_trees(&source, &destination, true).unwrap(),
        };
        assert_eq!(expected.changes[0].kind, actual.changes[0].kind);
        assert_eq!(expected.changes[0].path, actual.changes[0].path);
        assert!(ensure_preview_matches(&expected, &actual).is_err());
    }

    #[test]
    fn non_mirror_sync_does_not_remove_a_conflicting_local_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir_all(destination.join("entry")).unwrap();
        fs::write(source.join("entry"), "remote").unwrap();
        fs::write(destination.join("entry/local.txt"), "local").unwrap();
        assert!(compare_trees(&source, &destination, false).is_err());
        assert!(apply_sync(&source, &destination, false).is_err());
        assert_eq!(
            fs::read_to_string(destination.join("entry/local.txt")).unwrap(),
            "local"
        );
    }

    #[test]
    fn mirror_sync_keeps_unpreviewed_empty_directories() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir_all(destination.join("empty-local")).unwrap();
        fs::write(source.join("new.txt"), "remote").unwrap();
        assert_eq!(compare_trees(&source, &destination, true).unwrap().len(), 1);
        apply_sync(&source, &destination, true).unwrap();
        assert!(destination.join("empty-local").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn replaces_destination_symlink_without_writing_outside_it() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        let outside = temporary.path().join("outside.txt");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(source.join("entry"), "remote").unwrap();
        fs::write(&outside, "local").unwrap();
        symlink(&outside, destination.join("entry")).unwrap();
        let changes = compare_trees(&source, &destination, true).unwrap();
        assert_eq!(changes[0].kind, "modify");
        apply_sync(&source, &destination, true).unwrap();
        assert_eq!(
            fs::read_to_string(destination.join("entry")).unwrap(),
            "remote"
        );
        assert_eq!(fs::read_to_string(outside).unwrap(), "local");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_destination_symlink_used_as_a_parent() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        let outside = temporary.path().join("outside");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(source.join("nested/entry"), "remote").unwrap();
        symlink(&outside, destination.join("nested")).unwrap();
        assert!(compare_trees(&source, &destination, true).is_err());
        assert!(apply_sync(&source, &destination, true).is_err());
        assert!(!outside.join("entry").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_a_symlinked_folder_group_outside_the_root() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("root");
        let outside = temporary.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        symlink(&outside, root.join("group")).unwrap();
        let mut item = repository_item();
        item.folder_group = "group".to_owned();
        assert!(destination_path(&root.to_string_lossy(), &item).is_err());
        assert!(!outside.join("plugin").exists());
    }

    #[cfg(unix)]
    #[test]
    fn move_rejects_a_symlinked_group_before_touching_its_destination() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("root");
        let outside = temporary.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::create_dir(outside.join("plugin")).unwrap();
        symlink(&outside, root.join("group")).unwrap();
        let mut item = repository_item();
        item.folder_group = "group".to_owned();
        let config = AppConfig {
            root_directories: vec![RootDirectory {
                id: "root".to_owned(),
                path: root.to_string_lossy().into_owned(),
                name: None,
            }],
            folder_groups: vec![FolderGroup {
                root_id: "root".to_owned(),
                path: "group".to_owned(),
            }],
            items: vec![item],
            ..AppConfig::default()
        };
        assert!(validate_managed_move_path(&config, &root.join("group/plugin")).is_err());
        assert!(outside.join("plugin").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn copies_source_symlink_itself_without_following_its_target() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir(source.join("demos")).unwrap();
        fs::create_dir(source.join("workbench")).unwrap();
        fs::write(source.join("demos/example.txt"), "inside").unwrap();
        symlink("../demos", source.join("workbench/demosrc")).unwrap();
        let changes = compare_trees(&source, &destination, true).unwrap();
        assert!(changes.iter().any(|change| change.kind == "add_symlink"
            && change.path == "workbench/demosrc"
            && change.link_target.as_deref() == Some("../demos")));
        apply_sync(&source, &destination, true).unwrap();
        assert_eq!(
            fs::read_link(destination.join("workbench/demosrc")).unwrap(),
            Path::new("../demos")
        );
        assert!(compare_trees(&source, &destination, true)
            .unwrap()
            .is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn external_and_dangling_symlinks_are_copied_without_traversal() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        let outside = temporary.path().join("outside");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("secret.txt"), "outside").unwrap();
        symlink(&outside, source.join("external")).unwrap();
        symlink("missing", source.join("dangling")).unwrap();
        apply_sync(&source, &destination, false).unwrap();
        assert_eq!(
            fs::read_link(destination.join("external")).unwrap(),
            outside
        );
        assert_eq!(
            fs::read_link(destination.join("dangling")).unwrap(),
            Path::new("missing")
        );
        assert_eq!(collect_entries(&destination).unwrap().len(), 2);
        assert!(compare_trees(&source, &destination, false)
            .unwrap()
            .is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn updates_link_target_without_removing_extra_link_in_non_mirror_mode() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        symlink("new-target", source.join("link")).unwrap();
        symlink("old-target", destination.join("link")).unwrap();
        symlink("extra-target", destination.join("extra")).unwrap();
        let changes = compare_trees(&source, &destination, false).unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].kind, "modify_symlink");
        assert_eq!(changes[0].link_target.as_deref(), Some("new-target"));
        apply_sync(&source, &destination, false).unwrap();
        assert_eq!(
            fs::read_link(destination.join("link")).unwrap(),
            Path::new("new-target")
        );
        assert_eq!(
            fs::read_link(destination.join("extra")).unwrap(),
            Path::new("extra-target")
        );
    }

    #[cfg(unix)]
    #[test]
    fn changed_local_symlink_expires_preview_and_mirror_deletes_link_only() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("destination");
        let outside = temporary.path().join("outside.txt");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&destination).unwrap();
        fs::write(&outside, "outside").unwrap();
        symlink("old", destination.join("link")).unwrap();
        let expected = SyncPreview {
            commit: "same".to_owned(),
            changes: compare_trees(&source, &destination, true).unwrap(),
        };
        fs::remove_file(destination.join("link")).unwrap();
        symlink(&outside, destination.join("link")).unwrap();
        let actual = SyncPreview {
            commit: "same".to_owned(),
            changes: compare_trees(&source, &destination, true).unwrap(),
        };
        assert!(ensure_preview_matches(&expected, &actual).is_err());
        apply_sync(&source, &destination, true).unwrap();
        assert!(!destination.join("link").exists());
        assert!(fs::symlink_metadata(destination.join("link")).is_err());
        assert_eq!(fs::read_to_string(outside).unwrap(), "outside");
    }

    #[test]
    fn restores_a_moved_folder_when_config_write_fails() {
        let temporary = tempfile::tempdir().unwrap();
        let from = temporary.path().join("from");
        let to = temporary.path().join("to");
        fs::create_dir(&from).unwrap();
        fs::write(from.join("item.txt"), "local").unwrap();
        let config = AppConfig::default();
        let path = temporary.path().join("missing-parent/config.json");
        let result = write_config_with_moves(
            &path,
            &config,
            &[DirectoryMove {
                from: from.to_string_lossy().into_owned(),
                to: to.to_string_lossy().into_owned(),
            }],
        );
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(from.join("item.txt")).unwrap(), "local");
        assert!(!to.exists());
    }

    #[test]
    fn moves_a_folder_and_config_together_without_overwriting_a_target() {
        let temporary = tempfile::tempdir().unwrap();
        let from = temporary.path().join("source");
        let to = temporary.path().join("nested/destination");
        let path = temporary.path().join("config.json");
        fs::create_dir(&from).unwrap();
        fs::write(from.join("item.txt"), "contents").unwrap();
        let config = AppConfig::default();
        write_config_with_moves(
            &path,
            &config,
            &[DirectoryMove {
                from: from.to_string_lossy().into_owned(),
                to: to.to_string_lossy().into_owned(),
            }],
        )
        .unwrap();
        assert!(!from.exists());
        assert_eq!(fs::read_to_string(to.join("item.txt")).unwrap(), "contents");
        assert!(read_config(&path).is_ok());
        fs::create_dir(&from).unwrap();
        assert!(write_config_with_moves(
            &path,
            &config,
            &[DirectoryMove {
                from: from.to_string_lossy().into_owned(),
                to: to.to_string_lossy().into_owned()
            }]
        )
        .is_err());
        assert!(from.exists());
    }

    #[test]
    fn rejects_a_stale_configuration_before_writing() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("config.json");
        let original = AppConfig::default();
        write_config(&path, &original).unwrap();
        let mut changed = original.clone();
        changed.theme = Some(Theme::Dark);
        write_config(&path, &changed).unwrap();
        assert!(ensure_current_config(&path, Some(&original)).is_err());
        assert!(ensure_current_config(&path, Some(&changed)).is_ok());
    }
}
