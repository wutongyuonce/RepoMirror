import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  Download,
  Folder,
  FolderPlus,
  Github,
  LoaderCircle,
  MoreHorizontal,
  Moon,
  Plus,
  RefreshCw,
  Settings2,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { AppConfig, SyncItem, SyncPreview } from "./domain";

const EMPTY_CONFIG: AppConfig = { schemaVersion: 1, folderGroups: [], items: [] };
const NOTIFICATION_TIMEOUT_MS = 5_000;

function newId() {
  return crypto.randomUUID();
}

function normalizeGroup(value: string) {
  const clean = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (clean.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("文件夹路径只能包含普通的相对路径段。");
  }
  return clean;
}

function parseSource(url: string, folderGroup: string, destinationName?: string): SyncItem {
  const parsed = new URL(url.trim());
  if (parsed.hostname !== "github.com") throw new Error("仅支持 github.com 链接。");

  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parts.length < 2) throw new Error("GitHub 链接缺少仓库名称。");

  const [owner, repo, marker, branch, ...pathParts] = parts;
  const isFolderLink = marker === "tree";
  if (marker && !isFolderLink) throw new Error("请使用仓库链接或 GitHub 的 tree 目录链接。");
  if (isFolderLink && (!branch || pathParts.length === 0)) {
    throw new Error("目录链接必须包含分支与目录。");
  }

  const sourcePath = isFolderLink ? pathParts.join("/") : undefined;
  const defaultName = sourcePath?.split("/").at(-1) ?? repo;
  return {
    id: newId(),
    sourceUrl: url.trim(),
    repoUrl: `https://github.com/${owner}/${repo}.git`,
    branch: isFolderLink ? branch : undefined,
    sourcePath,
    folderGroup,
    destinationName: destinationName?.trim() || defaultName,
    mirror: true,
    lastStatus: "not_synced",
  };
}

function destination(item: SyncItem) {
  return [item.folderGroup, item.destinationName].filter(Boolean).join("/");
}

function statusLabel(status: SyncItem["lastStatus"]) {
  return {
    not_synced: "未同步",
    up_to_date: "已是最新",
    updated: "已更新",
    failed: "失败",
  }[status];
}

function Status({ item }: { item: SyncItem }) {
  const Icon = item.lastStatus === "failed" ? CircleAlert : item.lastStatus === "not_synced" ? Clock3 : CircleCheck;
  return <span className={`status status-${item.lastStatus}`}><Icon size={14} />{statusLabel(item.lastStatus)}</span>;
}

type Dialog = "group" | "sources" | "preview" | "settings" | "delete-group" | "confirm-import" | null;
type SyncOperation = { kind: "preview" | "sync"; current: number; total: number; itemName?: string };

type FolderNode = { path: string; label: string; children: FolderNode[] };

function buildFolderTree(paths: string[]) {
  const roots: FolderNode[] = [];
  const nodes = new Map<string, FolderNode>();
  for (const path of [...new Set(paths.filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"))) {
    const parts = path.split("/");
    let parent = roots;
    for (let index = 0; index < parts.length; index += 1) {
      const currentPath = parts.slice(0, index + 1).join("/");
      let node = nodes.get(currentPath);
      if (!node) {
        node = { path: currentPath, label: parts[index], children: [] };
        nodes.set(currentPath, node);
        parent.push(node);
      }
      parent = node.children;
    }
  }
  return roots;
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [activeGroup, setActiveGroup] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [operation, setOperation] = useState<SyncOperation>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [previews, setPreviews] = useState<Array<{ item: SyncItem; preview: SyncPreview }>>([]);
  const [groupPath, setGroupPath] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [customName, setCustomName] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupDeleteConfirmed, setGroupDeleteConfirmed] = useState(false);
  const [pendingImport, setPendingImport] = useState<AppConfig>();
  const [importOverwriteConfirmed, setImportOverwriteConfirmed] = useState(false);

  useEffect(() => {
    api.loadConfig().then(setConfig).catch(() => setConfig(EMPTY_CONFIG)).finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(() => setError(undefined), NOTIFICATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [error]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(undefined), NOTIFICATION_TIMEOUT_MS);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const persist = async (next: AppConfig) => {
    setConfig(next);
    try {
      await api.saveConfig(next);
    } catch {
      setError("配置无法保存。请检查应用数据目录是否可写。");
    }
  };

  const groupPaths = useMemo(() => [...new Set([...config.folderGroups, ...config.items.map((item) => item.folderGroup)].filter(Boolean))], [config.folderGroups, config.items]);
  const folderTree = useMemo(() => buildFolderTree(groupPaths), [groupPaths]);
  const groups = useMemo(() => ["", ...groupPaths.sort((left, right) => left.localeCompare(right, "zh-Hans-CN"))], [groupPaths]);
  const theme = config.theme ?? "light";
  const selectedItem = config.items.find((item) => item.id === selectedId);
  const previewChangeCount = previews.reduce((total, { preview }) => total + preview.changes.length, 0);
  const previewItemCount = previews.filter(({ preview }) => preview.changes.length > 0).length;
  const groupedItems = activeGroup ? config.items.filter((item) => item.folderGroup === activeGroup || item.folderGroup.startsWith(`${activeGroup}/`)) : config.items.filter((item) => item.folderGroup === "");
  const affectedGroupItems = activeGroup ? config.items.filter((item) => item.folderGroup === activeGroup || item.folderGroup.startsWith(`${activeGroup}/`)) : [];

  useEffect(() => {
    const pathsToExpand = groupPaths.flatMap((group) => {
      const parts = group.split("/");
      return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
    });
    setExpandedGroups((current) => new Set([...current, ...pathsToExpand]));
  }, [groupPaths]);

  const chooseRoot = async () => {
    const root = await api.selectRoot().catch(() => null);
    if (root) await persist({ ...config, rootDirectory: root });
  };

  const toggleTheme = () => persist({ ...config, theme: theme === "light" ? "dark" : "light" });

  const importConfig = async () => {
    try {
      const imported = await api.importConfig();
      if (imported) {
        const hasCurrentConfiguration = Boolean(config.rootDirectory) || config.folderGroups.length > 0 || config.items.length > 0;
        if (hasCurrentConfiguration) {
          setPendingImport(imported);
          setImportOverwriteConfirmed(false);
          setDialog("confirm-import");
        } else {
          await applyImportedConfig(imported);
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法导入配置。");
    }
  };

  const applyImportedConfig = async (imported: AppConfig) => {
    await persist(imported);
    setActiveGroup("");
    setSelectedId(undefined);
    setPendingImport(undefined);
    setDialog(null);
  };

  const exportConfig = async () => {
    try {
      await api.exportConfig(config);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法导出配置。");
    }
  };

  const addGroup = async () => {
    try {
      const path = normalizeGroup(groupPath);
      if (config.folderGroups.includes(path)) throw new Error("这个文件夹组已经存在。");
      await persist({ ...config, folderGroups: [...config.folderGroups, path] });
      setActiveGroup(path);
      setGroupPath("");
      setDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法创建文件夹组。");
    }
  };

  const addSources = async () => {
    try {
      const links = sourceUrls.split("\n").map((line) => line.trim()).filter(Boolean);
      if (!links.length) throw new Error("请至少粘贴一个 GitHub 链接。");
      if (customName.trim() && links.length !== 1) throw new Error("批量添加时请保留自动名称。");
      const items = links.map((url) => parseSource(url, activeGroup, customName));
      const paths = new Set(config.items.map(destination));
      for (const item of items) {
        if (paths.has(destination(item))) throw new Error(`目标路径已存在：${destination(item)}`);
        paths.add(destination(item));
      }
      const folderGroups = activeGroup && !config.folderGroups.includes(activeGroup)
        ? [...config.folderGroups, activeGroup]
        : config.folderGroups;
      await persist({ ...config, folderGroups, items: [...config.items, ...items] });
      setSelectedId(items[0].id);
      setSourceUrls("");
      setCustomName("");
      setDialog(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "链接无法解析。");
    }
  };

  const removeItem = async (id: string) => {
    await persist({ ...config, items: config.items.filter((item) => item.id !== id) });
    if (selectedId === id) setSelectedId(undefined);
  };

  const deleteFolderGroup = async () => {
    if (!activeGroup) return;
    const contains = (path: string) => path === activeGroup || path.startsWith(`${activeGroup}/`);
    await persist({
      ...config,
      folderGroups: config.folderGroups.filter((group) => !contains(group)),
      items: config.items.filter((item) => !contains(item.folderGroup)),
    });
    setActiveGroup("");
    setSelectedId(undefined);
    setGroupDeleteConfirmed(false);
    setDialog(null);
  };

  const toggleGroup = (path: string) => setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });

  const previewItems = async (items: SyncItem[]) => {
    if (!config.rootDirectory) return setError("请先选择默认根目录。");
    setOperation({ kind: "preview", current: 0, total: items.length });
    try {
      const results: Array<{ item: SyncItem; preview: SyncPreview }> = [];
      for (const [index, item] of items.entries()) {
        setOperation({ kind: "preview", current: index + 1, total: items.length, itemName: item.destinationName });
        results.push({ item, preview: await api.preview(item, config.rootDirectory) });
      }
      setPreviews(results);
      setDialog("preview");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "无法生成预览。");
    } finally {
      setOperation(undefined);
    }
  };

  const confirmSync = async () => {
    if (!config.rootDirectory) return;
    const changedPreviews = previews.filter(({ preview }) => preview.changes.length > 0);
    if (!changedPreviews.length) {
      setDialog(null);
      setPreviews([]);
      return;
    }
    setOperation({ kind: "sync", current: 0, total: changedPreviews.length });
    try {
      let next = config;
      const failures: string[] = [];
      for (const [index, { item }] of changedPreviews.entries()) {
        setOperation({ kind: "sync", current: index + 1, total: changedPreviews.length, itemName: item.destinationName });
        try {
          const updated = await api.sync(item, config.rootDirectory);
          next = { ...next, items: next.items.map((current) => current.id === updated.id ? updated : current) };
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : "同步失败。";
          failures.push(`${item.destinationName}：${message}`);
          next = {
            ...next,
            items: next.items.map((current) => current.id === item.id ? { ...current, lastStatus: "failed", lastMessage: message } : current),
          };
        }
        setConfig(next);
      }
      await api.saveConfig(next);
      setDialog(null);
      setPreviews([]);
      if (failures.length) setError(failures.join("\n"));
      else setNotice(`已完成 ${changedPreviews.length} 项同步。`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "同步失败。");
    } finally {
      setOperation(undefined);
    }
  };

  const editSelected = async (patch: Partial<SyncItem>) => {
    if (!selectedItem) return;
    await persist({ ...config, items: config.items.map((item) => item.id === selectedItem.id ? { ...item, ...patch } : item) });
  };

  return (
    <main className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand-row"><div className="brand"><span className="brand-mark"><RefreshCw size={15} /></span><span>RepoMirror</span></div><button className="icon-button theme-button" onClick={toggleTheme} title={theme === "light" ? "切换夜间模式" : "切换日间模式"}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button></div>
        <button className="root-card" onClick={chooseRoot} title="选择默认根目录">
          <Folder size={17} />
          <span><small>默认根目录</small><strong>{config.rootDirectory?.split("/").at(-1) ?? "尚未选择"}</strong></span>
          <MoreHorizontal size={16} />
        </button>
        <div className="sidebar-heading"><span>文件夹组</span><button className="icon-button" onClick={() => setDialog("group")} title="添加文件夹组"><FolderPlus size={16} /></button></div>
        <nav className="group-nav">
          <button className={activeGroup === "" ? "active" : ""} onClick={() => setActiveGroup("")}><Folder size={15} /><span>根目录</span><em>{config.items.filter((item) => item.folderGroup === "").length}</em></button>
          <FolderTree nodes={folderTree} activeGroup={activeGroup} expandedGroups={expandedGroups} onSelect={setActiveGroup} onToggle={toggleGroup} items={config.items} />
        </nav>
        <button className="sidebar-footer" onClick={() => setDialog("settings")}><Settings2 size={15} /><span>本地配置</span></button>
      </aside>

      <section className="content">
        <header className="topbar">
          <div className="heading-copy"><h1>{activeGroup || "根目录"}</h1><p>{activeGroup ? `相对路径 /${activeGroup}` : "同步项直接放入默认根目录"}</p></div>
          <div className="toolbar">
            {activeGroup ? <button className="icon-button danger" onClick={() => { setGroupDeleteConfirmed(false); setDialog("delete-group"); }} title="删除此文件夹组及其同步项"><Trash2 size={16} /></button> : null}
            <button className="button secondary" onClick={() => setDialog("group")}><FolderPlus size={16} />文件夹组</button>
            <button className="button secondary" onClick={() => setDialog("sources")}><Plus size={16} />添加来源</button>
            <button className="button primary" disabled={!config.items.length || !!operation} onClick={() => previewItems(config.items)}>{operation?.kind === "preview" ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}同步全部</button>
          </div>
        </header>

        <div className="list-head"><span>来源与目标</span><span>上次同步结果</span><span>最近同步</span><span /></div>
        <div className="item-list">
          {!loaded ? <div className="empty-state"><LoaderCircle className="spin" size={20} />正在载入配置</div> : null}
          {loaded && groupedItems.length === 0 ? <div className="empty-state"><Folder size={24} /><strong>这里还没有同步项</strong><span>添加 GitHub 仓库或项目内目录，它会同步到这个位置。</span><button className="button secondary" onClick={() => setDialog("sources")}><Plus size={16} />添加来源</button></div> : null}
          {groupedItems.map((item) => <button className={`item-row ${selectedId === item.id ? "selected" : ""}`} key={item.id} onClick={() => setSelectedId(item.id)}>
            <span className="item-title"><Github size={17} /><span><strong>{item.destinationName}</strong><small>{item.sourcePath ? `${item.repoUrl.replace("https://github.com/", "").replace(".git", "")} / ${item.sourcePath}` : item.repoUrl.replace("https://github.com/", "").replace(".git", "")}</small></span></span>
            <Status item={item} />
            <span className="date">{item.lastSyncedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastSyncedAt)) : "从未"}</span>
            <ChevronRight size={17} />
          </button>)}
        </div>
      </section>

      {selectedItem ? <aside className="details">
        <div className="detail-top"><div><small>同步项</small><h2>{selectedItem.destinationName}</h2></div><button className="icon-button" onClick={() => setSelectedId(undefined)} title="关闭详情"><X size={17} /></button></div>
        <div className="detail-path"><Folder size={16} /><span>{config.rootDirectory ? `${config.rootDirectory}/${destination(selectedItem)}` : destination(selectedItem)}</span></div>
        <label>GitHub 来源<span className="readonly-input">{selectedItem.sourceUrl}</span></label>
        <label>最终文件夹名称<input value={selectedItem.destinationName} onChange={(event) => editSelected({ destinationName: event.target.value.trim() })} /></label>
        <label className="switch-row"><span><strong>镜像同步</strong><small>删除来源中不存在的目标文件</small></span><input type="checkbox" checked={selectedItem.mirror} onChange={(event) => editSelected({ mirror: event.target.checked })} /></label>
        <div className="detail-actions"><button className="button primary" disabled={!!operation} onClick={() => previewItems([selectedItem])}>{operation?.kind === "preview" ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}预览并同步</button><button className="icon-button danger" onClick={() => removeItem(selectedItem.id)} title="移除同步项"><Trash2 size={16} /></button></div>
      </aside> : null}

      {dialog === "group" ? <Modal title="添加文件夹组" close={() => setDialog(null)}>
        <p>使用相对路径；例如 <code>tools/browser</code> 会在默认根目录中递归创建目录。</p>
        <label>相对父路径<input autoFocus placeholder="例如 tools/browser" value={groupPath} onChange={(event) => setGroupPath(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addGroup()} /></label>
        <ModalActions close={() => setDialog(null)} submit={addGroup} label="创建文件夹组" />
      </Modal> : null}

      {dialog === "sources" ? <Modal title="添加 GitHub 来源" close={() => setDialog(null)}>
        <label>放入文件夹组<select value={activeGroup} onChange={(event) => setActiveGroup(event.target.value)}>{groups.map((group) => <option key={group || "root"} value={group}>{group || "根目录"}</option>)}</select></label>
        <label>GitHub 链接<textarea autoFocus rows={5} placeholder={"每行一个链接\nhttps://github.com/owner/repo\nhttps://github.com/owner/repo/tree/main/packages/example"} value={sourceUrls} onChange={(event) => setSourceUrls(event.target.value)} /></label>
        <label>自定义最终名称 <small>仅单条链接</small><input placeholder="留空以自动命名" value={customName} onChange={(event) => setCustomName(event.target.value)} /></label>
        <ModalActions close={() => setDialog(null)} submit={addSources} label="添加同步项" />
      </Modal> : null}

      {dialog === "settings" ? <Modal title="本地配置" close={() => setDialog(null)}>
        <p>同步项与默认根目录保存在这台 Mac 的应用支持目录中。已有配置导入时会要求确认替换。</p>
        <div className="config-actions">
          <button className="button secondary" onClick={exportConfig}><Download size={16} />导出 JSON</button>
          <button className="button secondary" onClick={importConfig}><Upload size={16} />导入 JSON</button>
        </div>
      </Modal> : null}

      {dialog === "confirm-import" && pendingImport ? <Modal title="替换当前配置" close={() => { setPendingImport(undefined); setDialog(null); }}>
        <p>导入文件包含 {pendingImport.folderGroups.length} 个文件夹组和 {pendingImport.items.length} 条同步项，将替换当前的 {config.folderGroups.length} 个文件夹组和 {config.items.length} 条同步项。</p>
        <p>不会同步、删除或修改任何本地目标文件。</p>
        <label className="confirm-row"><input type="checkbox" checked={importOverwriteConfirmed} onChange={(event) => setImportOverwriteConfirmed(event.target.checked)} /><span>我知道当前 RepoMirror 配置会被替换。</span></label>
        <ModalActions close={() => { setPendingImport(undefined); setDialog(null); }} submit={() => applyImportedConfig(pendingImport)} label="替换当前配置" disabled={!importOverwriteConfirmed} destructive />
      </Modal> : null}

      {dialog === "delete-group" ? <Modal title="删除文件夹组" close={() => setDialog(null)}>
        <p>这会从 RepoMirror 配置中删除 <code>{activeGroup}</code> 及其子组，并移除其中的 {affectedGroupItems.length} 条同步项。目标目录中的本地文件不会被删除。</p>
        <label className="confirm-row"><input type="checkbox" checked={groupDeleteConfirmed} onChange={(event) => setGroupDeleteConfirmed(event.target.checked)} /><span>我知道这会移除这些同步项的同步配置。</span></label>
        <ModalActions close={() => setDialog(null)} submit={deleteFolderGroup} label="删除文件夹组" disabled={!groupDeleteConfirmed} destructive />
      </Modal> : null}

      {dialog === "preview" ? <Modal title="同步预览" close={() => setDialog(null)} wide>
        <p>{previewChangeCount ? `发现 ${previewChangeCount} 个文件变更，涉及 ${previewItemCount} / ${previews.length} 个同步项。确认后只会同步有变更的项目。` : `已检查 ${previews.length} 个同步项，来源与本地目标目录完全一致。`}</p>
        {previewChangeCount ? <div className="preview-list">{previews.flatMap(({ item, preview }) => preview.changes.map((change) => <div key={`${item.id}-${change.kind}-${change.path}`}><span className={`change change-${change.kind}`}>{change.kind === "add" ? "新增" : change.kind === "modify" ? "修改" : "删除"}</span><code>{destination(item)}/{change.path}</code></div>))}</div> : <div className="preview-empty"><CircleCheck size={18} /><span>无需同步</span></div>}
        <div className="preview-commits">{previews.map(({ item, preview }) => <span key={item.id}>{item.destinationName} · {preview.commit.slice(0, 8)}</span>)}</div>
        {previewChangeCount ? <ModalActions close={() => setDialog(null)} submit={confirmSync} label={operation?.kind === "sync" ? "正在同步" : `确认同步 ${previewItemCount} 项`} disabled={operation?.kind === "sync"} loading={operation?.kind === "sync"} /> : <div className="modal-actions"><button className="button secondary" onClick={() => setDialog(null)}><Check size={16} />关闭</button></div>}
      </Modal> : null}

      {error ? <div className="toast"><CircleAlert size={17} /><span>{error}</span><button className="icon-button" onClick={() => setError(undefined)} title="关闭提示"><X size={15} /></button></div> : null}
      {notice ? <div className="toast success"><CircleCheck size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice(undefined)} title="关闭提示"><X size={15} /></button></div> : null}
      {operation ? <ProgressDialog operation={operation} /> : null}
    </main>
  );
}

function Modal({ title, children, close, wide = false }: { title: string; children: React.ReactNode; close: () => void; wide?: boolean }) {
  return <div className="modal-backdrop"><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true"><header><h2>{title}</h2><button className="icon-button" onClick={close} title="关闭"><X size={17} /></button></header>{children}</section></div>;
}

function FolderTree({ nodes, activeGroup, expandedGroups, onSelect, onToggle, items, depth = 0 }: { nodes: FolderNode[]; activeGroup: string; expandedGroups: Set<string>; onSelect: (path: string) => void; onToggle: (path: string) => void; items: SyncItem[]; depth?: number }) {
  return <>{nodes.map((node) => {
    const hasChildren = node.children.length > 0;
    const expanded = expandedGroups.has(node.path);
    const count = items.filter((item) => item.folderGroup === node.path).length;
    return <div className="tree-node" key={node.path}>
      <div className={`tree-row ${activeGroup === node.path ? "active" : ""}`} style={{ paddingLeft: 7 + depth * 15 }}>
        {hasChildren ? <button className="tree-toggle" onClick={() => onToggle(node.path)} title={expanded ? "折叠文件夹组" : "展开文件夹组"}>{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="tree-spacer" />}
        <button className="tree-select" onClick={() => onSelect(node.path)}><Folder size={15} /><span>{node.label}</span><em>{count}</em></button>
      </div>
      {hasChildren && expanded ? <FolderTree nodes={node.children} activeGroup={activeGroup} expandedGroups={expandedGroups} onSelect={onSelect} onToggle={onToggle} items={items} depth={depth + 1} /> : null}
    </div>;
  })}</>;
}

function ModalActions({ close, submit, label, disabled = false, destructive = false, loading = false }: { close: () => void; submit: () => void; label: string; disabled?: boolean; destructive?: boolean; loading?: boolean }) {
  return <div className="modal-actions"><button className="button ghost" onClick={close}>取消</button><button className={`button ${destructive ? "destructive" : "primary"}`} disabled={disabled} onClick={submit}>{loading ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}{label}</button></div>;
}

function ProgressDialog({ operation }: { operation: SyncOperation }) {
  const isPreview = operation.kind === "preview";
  const detail = operation.current
    ? `${isPreview ? "正在检查" : "正在同步"} ${operation.current} / ${operation.total} 个同步项`
    : `正在准备 ${operation.total} 个同步项`;
  return <div className="modal-backdrop progress-backdrop" role="alertdialog" aria-modal="true" aria-label={isPreview ? "正在生成同步预览" : "正在同步文件"}>
    <section className="progress-dialog">
      <LoaderCircle size={24} className="spin" />
      <div><strong>{isPreview ? "正在生成同步预览" : "正在同步文件"}</strong><span>{detail}</span>{operation.itemName ? <small>{operation.itemName}</small> : null}</div>
    </section>
  </div>;
}
