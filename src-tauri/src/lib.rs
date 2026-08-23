use chrono::Utc;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    ffi::OsStr,
    fs,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Manager};
use tempfile::TempDir;
use url::Url;
use walkdir::WalkDir;

const CONFIG_SCHEMA_VERSION: u8 = 3;

fn default_schema_version() -> u8 {
    CONFIG_SCHEMA_VERSION
}

#[derive(Clone, Debug, Deserialize, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RootDirectory {
    id: String,
    path: String,
    name: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FolderGroup {
    root_id: String,
    path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Theme {
    Light,
    Dark,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SyncStatus {
    NotSynced,
    Synced,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewChange {
    kind: String,
    path: String,
}

#[derive(Serialize)]
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

#[tauri::command]
fn load_config(app: AppHandle) -> Result<AppConfig, String> {
    let path = config_path(&app)?;
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let file = fs::File::open(&path).map_err(|error| format!("无法读取配置：{error}"))?;
    let value: serde_json::Value =
        serde_json::from_reader(file).map_err(|error| format!("配置文件格式无效：{error}"))?;
    let schema_version = value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64);
    if schema_version == Some(2) {
        fs::remove_file(&path).map_err(|error| format!("无法清除旧版配置：{error}"))?;
        return Ok(AppConfig::default());
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
fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    validate_config(&config)?;
    let path = config_path(&app)?;
    write_config(&path, &config)
}

fn write_config(path: &Path, config: &AppConfig) -> Result<(), String> {
    let temporary = path.with_extension("json.tmp");
    let json =
        serde_json::to_vec_pretty(&config).map_err(|error| format!("无法序列化配置：{error}"))?;
    fs::write(&temporary, json).map_err(|error| format!("无法写入配置：{error}"))?;
    fs::rename(&temporary, &path).map_err(|error| format!("无法保存配置：{error}"))
}

#[tauri::command]
fn select_root() -> Option<String> {
    FileDialog::new()
        .set_title("选择 RepoMirror 根目录")
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
fn export_config(config: AppConfig) -> Result<bool, String> {
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
async fn preview_sync(item: SyncItem, root_directory: String) -> Result<SyncPreview, String> {
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
async fn sync_item(item: SyncItem, root_directory: String) -> Result<SyncItem, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let prepared = prepare_source(&item)?;
        let destination = destination_path(&root_directory, &item)?;
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
        let canonical = fs::canonicalize(&root.path)
            .map_err(|_| format!("根目录不存在或无法访问：{}", root.path))?;
        if !canonical.is_dir() || !root_paths.insert(canonical) {
            return Err("根目录重复或不是目录。".to_owned());
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

fn validate_source(item: &SyncItem) -> Result<(), String> {
    let source_url =
        Url::parse(&item.source_url).map_err(|_| "sourceUrl 必须是有效 URL。".to_owned())?;
    if source_url.scheme() != "https"
        || source_url.host_str() != Some("github.com")
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
    if repo_url.scheme() != "https" || repo_url.host_str() != Some("github.com") {
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
            if branch.trim().is_empty()
                || branch != source_parts[3]
                || path != &source_parts[4..].join("/")
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
    let root = PathBuf::from(root_directory);
    if !root.is_absolute() {
        return Err("根目录必须是绝对路径。".to_owned());
    }
    Ok(root.join(&item.folder_group).join(&item.destination_name))
}

#[tauri::command]
fn delete_directories(paths: Vec<String>) -> Result<(), String> {
    for path in paths {
        let directory = PathBuf::from(&path);
        if !directory.is_absolute() {
            return Err("只能删除绝对路径目录。".to_owned());
        }
        if directory.exists() {
            if !directory.is_dir() {
                return Err(format!("不是目录：{path}"));
            }
            fs::remove_dir_all(&directory)
                .map_err(|error| format!("无法删除目录 {path}：{error}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn move_directory(from: String, to: String) -> Result<(), String> {
    let source = PathBuf::from(&from);
    let destination = PathBuf::from(&to);
    if !source.is_absolute() || !destination.is_absolute() || !source.is_dir() {
        return Err("本地目标目录无效。".to_owned());
    }
    if destination.exists() {
        return Err("新位置已有同名本地文件夹，无法移动。".to_owned());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("无法创建新位置：{error}"))?;
    }
    fs::rename(&source, &destination).map_err(|error| format!("无法移动本地目标目录：{error}"))
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
    let source_files = collect_files(source)?;
    let destination_files = collect_files(destination)?;
    let mut changes = Vec::new();

    for (relative, source_file) in &source_files {
        let path = display_path(relative);
        match destination_files.get(relative) {
            None => changes.push(PreviewChange {
                kind: "add".to_owned(),
                path,
            }),
            Some(destination_file) if !files_equal(source_file, destination_file)? => {
                changes.push(PreviewChange {
                    kind: "modify".to_owned(),
                    path,
                })
            }
            _ => {}
        }
    }
    if mirror {
        for relative in destination_files
            .keys()
            .filter(|relative| !source_files.contains_key(*relative))
        {
            changes.push(PreviewChange {
                kind: "delete".to_owned(),
                path: display_path(relative),
            });
        }
    }
    changes.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(changes)
}

fn apply_sync(source: &Path, destination: &Path, mirror: bool) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| format!("无法创建目标目录：{error}"))?;
    let source_files = collect_files(source)?;
    let destination_files = collect_files(destination)?;

    for (relative, source_file) in &source_files {
        let target = destination.join(&relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| format!("无法创建目标父目录：{error}"))?;
        }
        let needs_copy = match destination_files.get(relative) {
            Some(existing) => !files_equal(&source_file, existing)?,
            None => true,
        };
        if needs_copy {
            if target.is_dir() {
                fs::remove_dir_all(&target)
                    .map_err(|error| format!("无法替换目标目录：{error}"))?;
            }
            fs::copy(source_file, &target).map_err(|error| format!("无法写入目标文件：{error}"))?;
        }
    }

    if mirror {
        for relative in destination_files
            .keys()
            .filter(|relative| !source_files.contains_key(*relative))
        {
            let target = destination.join(relative);
            if target.exists() {
                fs::remove_file(&target).map_err(|error| format!("无法移除过期文件：{error}"))?;
            }
        }
        remove_empty_directories(destination)?;
    }
    Ok(())
}

fn collect_files(root: &Path) -> Result<BTreeMap<PathBuf, PathBuf>, String> {
    let mut files = BTreeMap::new();
    if !root.exists() {
        return Ok(files);
    }
    for entry in WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| !should_ignore(entry.path(), root))
    {
        let entry = entry.map_err(|error| format!("无法读取目录：{error}"))?;
        if entry.file_type().is_file() {
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|error| format!("无法解析来源路径：{error}"))?
                .to_path_buf();
            files.insert(relative, entry.into_path());
        }
    }
    Ok(files)
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

fn remove_empty_directories(root: &Path) -> Result<(), String> {
    let mut directories: Vec<PathBuf> = WalkDir::new(root)
        .min_depth(1)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().is_dir() && !should_ignore(entry.path(), root))
        .map(|entry| entry.into_path())
        .collect();
    directories.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for directory in directories {
        match fs::remove_dir(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::DirectoryNotEmpty => {}
            Err(error) => return Err(format!("无法清理空目录：{error}")),
        }
    }
    Ok(())
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            select_root,
            import_config,
            export_config,
            preview_sync,
            sync_item,
            delete_directories,
            move_directory,
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
            }],
            theme: Some(Theme::Light),
            folder_groups: vec![],
            items: vec![repository_item()],
        };
        assert!(validate_config(&config).is_ok());
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
            }],
            theme: None,
            folder_groups: vec![],
            items: vec![item],
        };
        assert!(validate_config(&config).is_err());
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
    fn moves_a_destination_without_overwriting_an_existing_directory() {
        let temporary = tempfile::tempdir().unwrap();
        let source = temporary.path().join("source");
        let destination = temporary.path().join("nested/destination");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("item.txt"), "contents").unwrap();

        move_directory(
            source.to_string_lossy().into_owned(),
            destination.to_string_lossy().into_owned(),
        )
        .unwrap();

        assert!(!source.exists());
        assert_eq!(fs::read_to_string(destination.join("item.txt")).unwrap(), "contents");
        assert!(move_directory(
            destination.to_string_lossy().into_owned(),
            temporary.path().join("nested").to_string_lossy().into_owned(),
        )
        .is_err());
    }
}
