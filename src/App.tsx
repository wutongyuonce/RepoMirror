import { Check, ChevronDown, ChevronRight, CircleAlert, CircleCheck, Download, Folder, FolderPlus, Github, LoaderCircle, Moon, Plus, RefreshCw, Settings2, Sun, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { api } from "./api";
import type { DirectoryMove } from "./api";
import { externalLinks, parseSource } from "./source";
import { changedPreviews, previewBatch } from "./preview-batch";
import type { AppConfig, RootDirectory, SyncItem, SyncPreview } from "./domain";

const EMPTY_CONFIG: AppConfig = { schemaVersion: 3, rootDirectories: [], folderGroups: [], items: [] };
const NOTIFICATION_TIMEOUT_MS = 5_000;
type Dialog = "group" | "sources" | "settings" | "sync-scope" | "preview" | "delete" | "delete-item" | "move" | "move-root" | "rename" | "import" | null;
type Operation = { kind: "preview" | "sync"; current: number; total: number; itemName?: string };
type ContextTarget = { rootId: string; group: string; name: string; path: string };
type PendingRename = { kind: "root"; rootId: string; name: string; from: string; to: string } | { kind: "group"; rootId: string; from: string; to: string } | { kind: "item"; itemId: string; name: string; from: string; to: string };
type PendingRootMove = { rootId: string; from: string; to: string };
type Node = { path: string; label: string; children: Node[] };
const id = () => crypto.randomUUID();
const errorMessage = (cause: unknown, fallback: string) => {
  if (cause instanceof Error && cause.message) return cause.message;
  if (typeof cause === "string" && cause) return cause;
  if (cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string") return cause.message;
  return fallback;
};
const normalize = (value: string) => { const path = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, ""); if (!path || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("请输入普通的、相对当前根目录的文件夹路径。"); return path; };
const itemPath = (item: SyncItem) => [item.folderGroup, item.destinationName].filter(Boolean).join("/");
const localPath = (root: RootDirectory | undefined, item: SyncItem) => root ? `${root.path}/${itemPath(item)}` : itemPath(item);
const contains = (base: string, value: string) => !base || value === base || value.startsWith(`${base}/`);
const leafName = (path: string) => path.replace(/\/+$/g, "").split("/").filter(Boolean).at(-1) ?? "";
const joinDir = (base: string, name: string) => base.replace(/\/+$/g, "") === "" || base === "/" ? `/${name}` : `${base.replace(/\/+$/g, "")}/${name}`;
const parentDir = (path: string) => { const parts = path.replace(/\/+$/g, "").split("/").filter(Boolean); return parts.length <= 1 ? "/" : `/${parts.slice(0, -1).join("/")}`; };
const folderNameOk = (name: string) => !!name && !name.includes("/") && !name.includes("\\") && name !== "." && name !== "..";
function tree(paths: string[]) { const roots: Node[] = []; const map = new Map<string, Node>(); for (const path of [...new Set(paths)].filter(Boolean).sort()) { let parent = roots; for (const [index, label] of path.split("/").entries()) { const current = path.split("/").slice(0, index + 1).join("/"); let node = map.get(current); if (!node) { node = { path: current, label, children: [] }; map.set(current, node); parent.push(node); } parent = node.children; } } return roots; }
export default function App() {
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG); const [loaded, setLoaded] = useState(false); const [loadError, setLoadError] = useState<string>(); const [rootId, setRootId] = useState<string>(); const [group, setGroup] = useState(""); const [dialog, setDialog] = useState<Dialog>(null); const [selectedId, setSelectedId] = useState<string>(); const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); const [editingGroup, setEditingGroup] = useState<string>(); const [editingRootId, setEditingRootId] = useState<string>(); const [editingName, setEditingName] = useState(""); const [contextMenu, setContextMenu] = useState<{ target: ContextTarget; x: number; y: number }>(); const [operation, setOperation] = useState<Operation>(); const [previews, setPreviews] = useState<Array<{ item: SyncItem; preview: SyncPreview }>>([]); const [previewFailures, setPreviewFailures] = useState<Array<{ item: SyncItem; message: string }>>([]); const [error, setError] = useState<string>(); const [notice, setNotice] = useState<string>(); const [groupPath, setGroupPath] = useState(""); const [urls, setUrls] = useState(""); const [customName, setCustomName] = useState(""); const [branchDraft, setBranchDraft] = useState(""); const [recursive, setRecursive] = useState(true); const [deleteFiles, setDeleteFiles] = useState(false); const [expanded, setExpanded] = useState<Set<string>>(new Set()); const [dropTarget, setDropTarget] = useState<string>(); const draggedIds = useRef<string[]>([]); const selectionAnchor = useRef<string>(); const sidebarRef = useRef<HTMLElement>(null); const actionLock = useRef(false); const [nameDraft, setNameDraft] = useState<string>(); const [pendingMove, setPendingMove] = useState<{ items: SyncItem[]; rootId: string; group: string }>(); const [pendingRootMove, setPendingRootMove] = useState<PendingRootMove>(); const [pendingRename, setPendingRename] = useState<PendingRename>(); const [editingGroupRootId, setEditingGroupRootId] = useState<string>(); const [pendingImport, setPendingImport] = useState<AppConfig>(); const [pendingDelete, setPendingDelete] = useState<SyncItem>();
  useEffect(() => { api.loadConfig().then((next) => { setConfig(next); setRootId(next.rootDirectories[0]?.id); }).catch((cause) => setLoadError(errorMessage(cause, "无法读取已保存配置。"))).finally(() => setLoaded(true)); }, []);
  useEffect(() => { if (!error) return; const timeout = window.setTimeout(() => setError(undefined), NOTIFICATION_TIMEOUT_MS); return () => window.clearTimeout(timeout); }, [error]);
  useEffect(() => { if (!notice) return; const timeout = window.setTimeout(() => setNotice(undefined), NOTIFICATION_TIMEOUT_MS); return () => window.clearTimeout(timeout); }, [notice]);
  useEffect(() => { setNameDraft(undefined); }, [selectedId]);
  const persist = async (next: AppConfig, replaceUnreadable = false, moves: DirectoryMove[] = []) => {
    try {
      if (!loaded || (loadError && !replaceUnreadable)) throw new Error("无法读取已保存配置，请先导入备份，避免覆盖原配置。");
      if (moves.length) await api.saveConfigWithMoves(next, moves, config);
      else await api.saveConfig(next, replaceUnreadable ? null : config);
      setConfig(next);
      setLoadError(undefined);
    } catch (cause) {
      setError(errorMessage(cause, "配置无法保存。"));
      throw cause instanceof Error ? cause : new Error(errorMessage(cause, "配置无法保存。"));
    }
  };
  const withFolderGroups = (current: AppConfig, targetRootId: string, path: string) => {
    if (!path) return current.folderGroups;
    const needed = path.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"));
    const have = new Set(current.folderGroups.filter((candidate) => candidate.rootId === targetRootId).map((candidate) => candidate.path));
    return [...current.folderGroups, ...needed.filter((candidate) => !have.has(candidate)).map((candidate) => ({ rootId: targetRootId, path: candidate }))];
  };
  const root = config.rootDirectories.find((candidate) => candidate.id === rootId); const currentGroups = config.folderGroups.filter((candidate) => candidate.rootId === rootId); const directItems = config.items.filter((item) => item.rootId === rootId && item.folderGroup === group); const selected = config.items.find((item) => item.id === selectedId); const theme = config.theme ?? "light";
  const setLocation = (nextRootId: string, nextGroup = "") => { setRootId(nextRootId); setGroup(nextGroup); setSelectedId(undefined); setSelectedIds(new Set()); selectionAnchor.current = undefined; };
  const applyGroupRename = async (targetRootId: string, from: string, to: string) => {
    const directory = config.rootDirectories.find((candidate) => candidate.id === targetRootId);
    if (!directory) throw new Error("根目录不存在。");
    const replace = (path: string) => path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
    const folderGroups = config.folderGroups.map((candidate) => candidate.rootId === targetRootId ? { ...candidate, path: replace(candidate.path) } : candidate);
    if (new Set(folderGroups.map((candidate) => `${candidate.rootId}:${candidate.path}`)).size !== folderGroups.length) throw new Error("该文件夹名称已存在。");
    const items = config.items.map((item) => item.rootId === targetRootId ? { ...item, folderGroup: replace(item.folderGroup) } : item);
    if (new Set(items.map((item) => `${item.rootId}:${itemPath(item)}`)).size !== items.length) throw new Error("重命名后会产生重复的同步目标。");
    for (const candidate of folderGroups) {
      if (candidate.rootId !== targetRootId) continue;
      for (const item of items) {
        if (item.rootId !== targetRootId) continue;
        const destination = itemPath(item);
        if (candidate.path === destination || candidate.path.startsWith(`${destination}/`)) throw new Error("文件夹组不能位于同步项目标目录内。");
      }
    }
    await persist({ ...config, folderGroups, items }, false, [{ from: `${directory.path}/${from}`, to: `${directory.path}/${to}` }]);
    if (rootId === targetRootId) setGroup((current) => replace(current));
    const prefix = `${targetRootId}:${from}`;
    setExpanded((current) => new Set([...current].map((key) => key === prefix || key.startsWith(`${prefix}/`) ? `${targetRootId}:${replace(key.slice(targetRootId.length + 1))}` : key)));
  };
  const finishRootRename = async () => {
    if (!editingRootId || actionLock.current) return;
    const targetId = editingRootId;
    const name = editingName.trim();
    const directory = config.rootDirectories.find((candidate) => candidate.id === targetId);
    if (!directory) return setEditingRootId(undefined);
    const from = directory.path;
    if (!folderNameOk(name)) return setError("请输入不含路径符号的文件夹名称。");
    if (name === (directory.name ?? leafName(from))) return setEditingRootId(undefined);
    const to = joinDir(parentDir(from), name);
    actionLock.current = true;
    try {
      if (to === from) {
        setEditingRootId(undefined);
        await persist({ ...config, rootDirectories: config.rootDirectories.map((candidate) => candidate.id === targetId ? { ...candidate, name } : candidate) });
        return;
      }
      if (!await api.directoryExists(from)) {
        setEditingRootId(undefined);
        await persist({ ...config, rootDirectories: config.rootDirectories.map((candidate) => candidate.id === targetId ? { ...candidate, name, path: to } : candidate) }, false, [{ from, to }]);
        return;
      }
      setEditingRootId(undefined);
      setPendingRename({ kind: "root", rootId: targetId, name, from, to });
      setDialog("rename");
    } catch (cause) { setError(errorMessage(cause, "无法重命名根目录。")); }
    finally { actionLock.current = false; }
  };
  const openDirectory = async () => { if (!contextMenu) return; try { await api.openDirectory(contextMenu.target.path); } catch (cause) { setError(errorMessage(cause, "无法打开文件夹。")); } setContextMenu(undefined); };
  const editContextTarget = () => {
    if (!contextMenu) return;
    if (contextMenu.target.group) {
      setEditingGroupRootId(contextMenu.target.rootId);
      setEditingGroup(contextMenu.target.group);
      setEditingName(contextMenu.target.name);
    } else {
      setEditingRootId(contextMenu.target.rootId);
      setEditingName(contextMenu.target.name);
    }
    setContextMenu(undefined);
  };
  const finishRename = async () => {
    if (!editingGroup || actionLock.current) return;
    const from = editingGroup;
    const targetRootId = editingGroupRootId ?? rootId;
    const name = editingName.trim();
    if (!targetRootId) return setEditingGroup(undefined);
    try {
      if (!folderNameOk(name)) throw new Error("请输入不含路径符号的文件夹名称。");
      const parent = from.includes("/") ? from.slice(0, from.lastIndexOf("/")) : "";
      const to = [parent, name].filter(Boolean).join("/");
      if (to === from) {
        setEditingGroup(undefined);
        setEditingGroupRootId(undefined);
        return;
      }
      const replace = (path: string) => path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path;
      if (new Set(config.folderGroups.map((candidate) => `${candidate.rootId}:${candidate.rootId === targetRootId ? replace(candidate.path) : candidate.path}`)).size !== config.folderGroups.length) throw new Error("该文件夹名称已存在。");
      if (new Set(config.items.map((item) => `${item.rootId}:${itemPath(item.rootId === targetRootId ? { ...item, folderGroup: replace(item.folderGroup) } : item)}`)).size !== config.items.length) throw new Error("重命名后会产生重复的同步目标。");
      const directory = config.rootDirectories.find((candidate) => candidate.id === targetRootId);
      const local = directory ? `${directory.path}/${from}` : from;
      actionLock.current = true;
      if (!await api.directoryExists(local)) {
        setEditingGroup(undefined);
        setEditingGroupRootId(undefined);
        await applyGroupRename(targetRootId, from, to);
        return;
      }
      setEditingGroup(undefined);
      setEditingGroupRootId(undefined);
      setPendingRename({ kind: "group", rootId: targetRootId, from, to });
      setDialog("rename");
    } catch (cause) { setError(errorMessage(cause, "无法重命名文件夹。")); }
    finally { actionLock.current = false; }
  };
  const overlappingRoot = (path: string, exceptId?: string) => config.rootDirectories.find((candidate) => candidate.id !== exceptId && (contains(candidate.path, path) || contains(path, candidate.path)));
  const addRoot = async () => {
    const path = await api.selectRoot().catch(() => null);
    if (!path) return;
    const nested = overlappingRoot(path);
    if (nested) {
      if (nested.path === path) return setError("该根目录已存在。");
      if (contains(nested.path, path)) return setError("不能添加已有根目录下的文件夹。");
      return setError("不能添加包含已有根目录的文件夹。");
    }
    const next = { ...config, rootDirectories: [...config.rootDirectories, { id: id(), path }] };
    try {
      await persist(next);
      setLocation(next.rootDirectories.at(-1)!.id);
    } catch { /* persist already reported */ }
  };
  const addGroup = async () => { try { if (!rootId) throw new Error("请先添加并选择一个根目录。"); const path = normalize(groupPath); if (currentGroups.some((candidate) => candidate.path === path)) throw new Error("该文件夹组已存在。"); const segments = path.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/")); if (config.items.some((item) => item.rootId === rootId && segments.some((segment) => segment === itemPath(item) || segment.startsWith(`${itemPath(item)}/`)))) throw new Error("文件夹组不能位于同步项目标目录内。"); await persist({ ...config, folderGroups: withFolderGroups(config, rootId, path) }); setGroup(path); setGroupPath(""); setDialog(null); } catch (cause) { setError(errorMessage(cause, "无法创建文件夹组。")); } };
  const addSources = async () => { try { if (!rootId) throw new Error("请先选择根目录。"); const links = urls.split("\n").map((line) => line.trim()).filter(Boolean); if (!links.length) throw new Error("请至少粘贴一个 GitHub 链接。"); if ((customName.trim() || branchDraft.trim()) && links.length !== 1) throw new Error("批量添加时请保留自动名称和分支。"); const additions = links.map((url) => parseSource(url, rootId, group, customName, branchDraft)); const paths = new Set(config.items.filter((item) => item.rootId === rootId).map(itemPath)); for (const item of additions) { if (paths.has(itemPath(item))) throw new Error(`目标路径已存在：${itemPath(item)}`); paths.add(itemPath(item)); } await persist({ ...config, folderGroups: withFolderGroups(config, rootId, group), items: [...config.items, ...additions] }); setSelectedId(additions[0].id); setUrls(""); setCustomName(""); setBranchDraft(""); setDialog(null); } catch (cause) { setError(errorMessage(cause, "链接无法解析。")); } };
  const preview = async (items: SyncItem[]) => {
    if (!root) return;
    if (!items.length) return setError("当前范围没有同步项。");
    flushSync(() => setOperation({ kind: "preview", current: 0, total: items.length }));
    try {
      const { successes, failures } = await previewBatch(items, async (item, index) => {
        const itemRoot = config.rootDirectories.find((candidate) => candidate.id === item.rootId);
        if (!itemRoot) throw new Error("同步项的根目录不存在。");
        flushSync(() => setOperation({ kind: "preview", current: index + 1, total: items.length, itemName: item.destinationName }));
        return api.preview(item, itemRoot.path);
      });
      setPreviews(successes);
      setPreviewFailures(failures.map(({ item, cause }) => ({ item, message: errorMessage(cause, "无法生成预览。") })));
      setDialog("preview");
    } catch (cause) { setError(errorMessage(cause, "无法生成同步预览。")); }
    finally { setOperation(undefined); }
  };
  const pendingSyncs = changedPreviews(previews);
  const sync = async () => {
    if (!pendingSyncs.length) return setDialog(null);
    flushSync(() => setOperation({ kind: "sync", current: 0, total: pendingSyncs.length }));
    let next = config;
    const failures: string[] = [];
    for (const [index, { item, preview }] of pendingSyncs.entries()) {
      try {
        const itemRoot = next.rootDirectories.find((candidate) => candidate.id === item.rootId)!;
        flushSync(() => setOperation({ kind: "sync", current: index + 1, total: pendingSyncs.length, itemName: item.destinationName }));
        const updated = await api.sync(item, itemRoot.path, preview);
        next = { ...next, items: next.items.map((candidate) => candidate.id === updated.id ? updated : candidate) };
      } catch (cause) {
        const message = errorMessage(cause, "同步失败。");
        failures.push(`${item.destinationName}：${message}`);
        next = { ...next, items: next.items.map((candidate) => candidate.id === item.id ? { ...candidate, lastStatus: "failed", lastMessage: message } : candidate) };
      }
    }
    try {
      await persist(next);
      setDialog(null);
      setPreviews([]);
      failures.length ? setError(failures.join("\n")) : setNotice(`已完成 ${pendingSyncs.length} 项同步。`);
    } catch { /* persist already reported */ }
    setOperation(undefined);
  };
  const deleteLocation = async () => {
    if (!rootId) return;
    const affected = config.items.filter((item) => item.rootId === rootId && contains(group, item.folderGroup));
    const next = group ? { ...config, folderGroups: config.folderGroups.filter((candidate) => candidate.rootId !== rootId || !contains(group, candidate.path)), items: config.items.filter((item) => item.rootId !== rootId || !contains(group, item.folderGroup)) } : { ...config, rootDirectories: config.rootDirectories.filter((candidate) => candidate.id !== rootId), folderGroups: config.folderGroups.filter((candidate) => candidate.rootId !== rootId), items: config.items.filter((item) => item.rootId !== rootId) };
    try { await persist(next); } catch { return; }
    const oldRoot = rootId;
    const parent = group.includes("/") ? group.slice(0, group.lastIndexOf("/")) : "";
    setLocation(group ? oldRoot : next.rootDirectories[0]?.id ?? "", parent);
    setDialog(null);
    if (deleteFiles) {
      try { await api.deleteDestinations(affected.map((item) => ({ rootDirectory: root!.path, item }))); }
      catch (cause) { setError(`配置已删除，但部分本地文件夹未能删除：${errorMessage(cause, "请手动检查。")}`); }
    }
    setDeleteFiles(false);
  };
  const beginMove = async (items: SyncItem[], targetRootId: string, targetGroup: string) => {
    try {
      items = items.filter((item) => item.rootId !== targetRootId || item.folderGroup !== targetGroup);
      if (!items.length) return;
      const moved = items.map((item) => ({ ...item, rootId: targetRootId, folderGroup: targetGroup }));
      const moves = items.map((item, index) => ({
        from: localPath(config.rootDirectories.find((candidate) => candidate.id === item.rootId), item),
        to: localPath(config.rootDirectories.find((candidate) => candidate.id === targetRootId), moved[index]),
      }));
      const next = { ...config, folderGroups: withFolderGroups(config, targetRootId, targetGroup), items: config.items.map((item) => moved.find((candidate) => candidate.id === item.id) ?? item) };
      const existing = await Promise.all(moves.map((move) => api.directoryExists(move.from)));
      if (!existing.some(Boolean)) {
        try { await persist(next, false, moves); setSelectedIds(new Set(items.map((item) => item.id))); }
        catch { /* persist already reported */ }
        return;
      }
      setPendingMove({ items, rootId: targetRootId, group: targetGroup });
      setDialog("move");
    } catch (cause) { setError(errorMessage(cause, "无法检查同步项位置。")); }
  };
  const finishMove = async () => {
    if (!pendingMove || actionLock.current) return;
    const moved = pendingMove.items.map((item) => ({ ...item, rootId: pendingMove.rootId, folderGroup: pendingMove.group }));
    actionLock.current = true;
    try {
      const moves = pendingMove.items.map((item, index) => ({ from: localPath(config.rootDirectories.find((candidate) => candidate.id === item.rootId), item), to: localPath(config.rootDirectories.find((candidate) => candidate.id === pendingMove.rootId), moved[index]) }));
      await persist({ ...config, folderGroups: withFolderGroups(config, pendingMove.rootId, pendingMove.group), items: config.items.map((item) => moved.find((candidate) => candidate.id === item.id) ?? item) }, false, moves);
      setSelectedIds(new Set(moved.map((item) => item.id)));
      setSelectedId(moved[0].id);
      setDialog(null);
    } catch (cause) { setError(errorMessage(cause, "无法移动同步项。")); }
    finally { actionLock.current = false; }
  };
  const applyRootPath = async (targetId: string, from: string, to: string) => {
    const nested = overlappingRoot(to, targetId);
    if (nested) {
      if (nested.path === to) throw new Error("目标位置已有另一个根目录。");
      if (contains(nested.path, to)) throw new Error("不能把根目录移动到另一个根目录内部。");
      throw new Error("不能把根目录移动到包含另一个根目录的位置。");
    }
    await persist({ ...config, rootDirectories: config.rootDirectories.map((candidate) => candidate.id === targetId ? { ...candidate, path: to, name: leafName(to) } : candidate) }, false, [{ from, to }]);
  };
  const beginMoveRoot = async () => {
    if (!contextMenu || contextMenu.target.group) return;
    const target = contextMenu.target;
    setContextMenu(undefined);
    const parent = await api.selectDirectory("选择移动目标", parentDir(target.path)).catch(() => null);
    if (!parent) return;
    const to = joinDir(parent, leafName(target.path));
    if (to === target.path) return;
    if (contains(target.path, to)) return setError("不能把根目录移动到自身内部。");
    const nested = overlappingRoot(to, target.rootId);
    if (nested) {
      if (nested.path === to) return setError("目标位置已有另一个根目录。");
      if (contains(nested.path, to)) return setError("不能把根目录移动到另一个根目录内部。");
      return setError("不能把根目录移动到包含另一个根目录的位置。");
    }
    try {
      if (!await api.directoryExists(target.path)) {
        await applyRootPath(target.rootId, target.path, to);
        return;
      }
      setPendingRootMove({ rootId: target.rootId, from: target.path, to });
      setDialog("move-root");
    } catch (cause) { setError(`${errorMessage(cause, "无法移动根目录。")} 已保留原位置配置。`); }
  };
  const relinkRoot = async () => {
    if (!contextMenu || contextMenu.target.group) return;
    const target = contextMenu.target;
    setContextMenu(undefined);
    try {
      if (await api.directoryExists(target.path)) return setError("原根目录仍存在；请使用“移动至”调整位置。");
      const path = await api.selectRoot();
      if (!path) return;
      if (overlappingRoot(path, target.rootId)) return setError("所选文件夹与另一个根目录重叠。");
      await persist({ ...config, rootDirectories: config.rootDirectories.map((directory) => directory.id === target.rootId ? { ...directory, path, name: leafName(path) } : directory) });
      setLocation(target.rootId);
    } catch (cause) { setError(errorMessage(cause, "无法重新关联根目录。")); }
  };
  const finishMoveRoot = async () => {
    if (!pendingRootMove || actionLock.current) return;
    actionLock.current = true;
    try {
      await applyRootPath(pendingRootMove.rootId, pendingRootMove.from, pendingRootMove.to);
      setPendingRootMove(undefined);
      setDialog(null);
    } catch (cause) { setError(errorMessage(cause, "无法移动根目录。")); }
    finally { actionLock.current = false; }
  };
  const finishRenameConfirm = async () => {
    if (!pendingRename || actionLock.current) return;
    actionLock.current = true;
    try {
      if (pendingRename.kind === "root") {
        const nested = overlappingRoot(pendingRename.to, pendingRename.rootId);
        if (nested) throw new Error(nested.path === pendingRename.to ? "目标位置已有另一个根目录。" : "不能把根目录重命名到另一个根目录的位置。");
        await persist({ ...config, rootDirectories: config.rootDirectories.map((candidate) => candidate.id === pendingRename.rootId ? { ...candidate, name: pendingRename.name, path: pendingRename.to } : candidate) }, false, [{ from: pendingRename.from, to: pendingRename.to }]);
      } else if (pendingRename.kind === "group") {
        await applyGroupRename(pendingRename.rootId, pendingRename.from, pendingRename.to);
      } else {
        await persist({ ...config, items: config.items.map((item) => item.id === pendingRename.itemId ? { ...item, destinationName: pendingRename.name } : item) }, false, [{ from: pendingRename.from, to: pendingRename.to }]);
      }
      setPendingRename(undefined);
      setDialog(null);
    } catch (cause) { setError(errorMessage(cause, "无法重命名文件夹。")); }
    finally { actionLock.current = false; }
  };
  const commitDestinationName = async () => {
    if (!selected || actionLock.current) return;
    const name = (nameDraft ?? selected.destinationName).trim();
    if (nameDraft === undefined) return;
    if (!folderNameOk(name)) {
      setNameDraft(undefined);
      return setError("请输入不含路径符号的文件夹名称。");
    }
    if (name === selected.destinationName) return setNameDraft(undefined);
    const nextItem = { ...selected, destinationName: name };
    const nextPath = itemPath(nextItem);
    if (config.items.some((item) => item.id !== selected.id && item.rootId === selected.rootId && itemPath(item) === nextPath)) {
      setNameDraft(undefined);
      return setError("目标路径已存在。");
    }
    if (config.folderGroups.some((candidate) => candidate.rootId === selected.rootId && (candidate.path === nextPath || candidate.path.startsWith(`${nextPath}/`)))) {
      setNameDraft(undefined);
      return setError("最终文件夹不能与文件夹组重叠。");
    }
    const itemRoot = config.rootDirectories.find((candidate) => candidate.id === selected.rootId);
    const from = localPath(itemRoot, selected);
    const to = localPath(itemRoot, nextItem);
    actionLock.current = true;
    try {
      if (!await api.directoryExists(from)) {
        setNameDraft(undefined);
        await persist({ ...config, items: config.items.map((item) => item.id === selected.id ? nextItem : item) }, false, [{ from, to }]);
        return;
      }
      setNameDraft(undefined);
      setPendingRename({ kind: "item", itemId: selected.id, name, from, to });
      setDialog("rename");
    } catch (cause) { setError(errorMessage(cause, "无法重命名同步项。")); }
    finally { actionLock.current = false; }
  };
  const removeItem = async (item: SyncItem) => {
    try { await persist({ ...config, items: config.items.filter((candidate) => candidate.id !== item.id) }); }
    catch { return; }
    setSelectedId(undefined); setPendingDelete(undefined); setDialog(null);
    if (deleteFiles) {
      try { await api.deleteDestinations([{ rootDirectory: config.rootDirectories.find((candidate) => candidate.id === item.rootId)!.path, item }]); }
      catch (cause) { setError(`配置已删除，但本地文件夹未能删除：${errorMessage(cause, "请手动检查。")}`); }
    }
    setDeleteFiles(false);
  };
  const importConfig = async () => { try { const imported = await api.importConfig(); if (!imported) return; if (loadError || config.rootDirectories.length || config.folderGroups.length || config.items.length) { setPendingImport(imported); setDialog("import"); } else { await persist(imported); setLocation(imported.rootDirectories[0]?.id ?? ""); setDialog(null); } } catch (cause) { setError(errorMessage(cause, "无法导入配置。")); } };
  const dropLinks = (links: string[], targetRootId: string, targetGroup: string) => {
    try {
      if (!links.length) throw new Error("未找到 GitHub 链接。");
      links.forEach((url) => parseSource(url, targetRootId, targetGroup));
      setLocation(targetRootId, targetGroup);
      setUrls(links.join("\n"));
      setCustomName("");
      setBranchDraft("");
      setDialog("sources");
    } catch (cause) { setError(errorMessage(cause, "无法识别拖入的链接。")); }
  };
  const autoScroll = (event: React.DragEvent) => { if (!draggedIds.current.length) return; const sidebar = sidebarRef.current; const inSidebar = !!sidebar && event.clientX < sidebar.getBoundingClientRect().right; const bounds = inSidebar ? sidebar!.getBoundingClientRect() : { top: 0, height: window.innerHeight }; const y = event.clientY - bounds.top; const amount = y < 64 ? -18 : y > bounds.height - 64 ? 18 : 0; if (amount) (inSidebar ? sidebar! : window).scrollBy({ top: amount }); };
  return <main className="app-shell" data-theme={theme} onClick={() => contextMenu && setContextMenu(undefined)} onDragOverCapture={autoScroll}>
    <aside className="sidebar" ref={sidebarRef}><div className="brand-row"><div className="brand"><span className="brand-mark"><RefreshCw size={15} /></span><span>RepoMirror</span></div><button className="icon-button theme-button" disabled={!loaded || !!loadError} onClick={() => { void persist({ ...config, theme: theme === "light" ? "dark" : "light" }).catch(() => {}); }}>{theme === "light" ? <Moon size={16} /> : <Sun size={16} />}</button></div><div className="sidebar-heading"><span>文件夹组</span><button className="icon-button" disabled={!loaded || !!loadError} onClick={addRoot} title="添加根目录"><FolderPlus size={16} /></button></div><nav className="group-nav">{config.rootDirectories.map((directory) => <RootTree key={directory.id} root={directory} nodes={tree(config.folderGroups.filter((candidate) => candidate.rootId === directory.id).map((candidate) => candidate.path))} activeRootId={rootId} activeGroup={group} items={config.items} draggedIds={draggedIds} dropTarget={dropTarget} setDropTarget={setDropTarget} expanded={expanded} onToggle={(key) => setExpanded((set) => { const next = new Set(set); next.has(key) ? next.delete(key) : next.add(key); return next; })} onSelect={setLocation} onDrop={beginMove} onExternalDrop={dropLinks} editingGroup={editingGroup} editingRootId={editingRootId} editingName={editingName} editingGroupRootId={editingGroupRootId} onStartRename={(path, name) => { setEditingRootId(undefined); setEditingGroupRootId(directory.id); setEditingGroup(path); setEditingName(name); }} onStartRootRename={(id, name) => { setEditingGroup(undefined); setEditingGroupRootId(undefined); setEditingRootId(id); setEditingName(name); }} onContextMenu={(target, event) => { event.preventDefault(); setContextMenu({ target, x: event.clientX, y: event.clientY }); }} onChangeRename={setEditingName} onFinishRename={finishRename} onFinishRootRename={finishRootRename} onCancelRename={() => { setEditingGroup(undefined); setEditingGroupRootId(undefined); setEditingRootId(undefined); }} />)}</nav><button className="sidebar-footer" disabled={!loaded} onClick={() => setDialog("settings")}><Settings2 size={15} /><span>本地配置</span></button></aside>
    <section className="content" onDragOver={(event) => { if (root && !Array.from(event.dataTransfer.types).includes(INTERNAL_DRAG_TYPE)) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }} onDrop={(event) => { if (root && !Array.from(event.dataTransfer.types).includes(INTERNAL_DRAG_TYPE)) { event.preventDefault(); dropLinks(externalLinks(event.dataTransfer), root.id, group); } }}><header className="topbar"><div className="heading-copy"><Folder size={20} /><div><h1>{root ? (group ? group.split("/").at(-1) : (root.name ?? leafName(root.path))) : "选择根目录"}</h1><p>{root ? (group ? `相对路径 /${group}` : root.path) : "从左侧 + 添加一个本地根目录"}</p></div></div><div className="toolbar">{root && <><button className="icon-button danger" onClick={() => { setDeleteFiles(false); setDialog("delete"); }} title="删除当前范围"><Trash2 size={16} /></button><button className="button secondary" onClick={() => setDialog("group")}><FolderPlus size={16} />文件夹组</button><button className="button secondary" onClick={() => setDialog("sources")}><Plus size={16} />添加来源</button><button className="button primary" disabled={!config.items.some((item) => item.rootId === rootId && contains(group, item.folderGroup)) || !!operation} onClick={() => { setRecursive(true); setDialog("sync-scope"); }}><RefreshCw size={16} />同步当前文件夹</button></>}</div></header><div className="list-head"><span>来源与目标</span><span>最近同步</span><span /></div><div className="item-list">{!loaded && <div className="empty-state"><LoaderCircle className="spin" size={20} />正在载入配置</div>}{loaded && loadError && <div className="empty-state" role="alert"><CircleAlert size={24} /><strong>无法读取已保存配置</strong><span>{loadError}</span><span>配置文件仍保留在磁盘上。请修复错误后重启，或从“本地配置”导入备份。</span></div>}{loaded && root && !directItems.length && <div className="empty-state"><Folder size={24} /><strong>这里还没有同步项</strong><span>添加 GitHub 仓库或项目内目录，它会同步到这个位置。</span></div>}{directItems.map((item, index) => <button draggable className={`item-row ${selectedIds.has(item.id) ? "selected" : ""}`} key={item.id} onDragStart={(event) => { const ids = selectedIds.has(item.id) ? [...selectedIds] : [item.id]; draggedIds.current = ids; setSelectedIds(new Set(ids)); setSelectedId(item.id); selectionAnchor.current = item.id; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(INTERNAL_DRAG_TYPE, JSON.stringify(ids)); event.dataTransfer.setData("text/plain", JSON.stringify(ids)); }} onDragEnd={() => { draggedIds.current = []; setDropTarget(undefined); }} onClick={(event) => { const anchorIndex = directItems.findIndex((candidate) => candidate.id === selectionAnchor.current); const next = event.shiftKey && anchorIndex >= 0 ? directItems.slice(Math.min(anchorIndex, index), Math.max(anchorIndex, index) + 1).map((candidate) => candidate.id) : event.metaKey || event.ctrlKey ? [...selectedIds].filter((id) => id !== item.id).concat(selectedIds.has(item.id) ? [] : item.id) : [item.id]; setSelectedIds(new Set(next)); setSelectedId(item.id); selectionAnchor.current = item.id; }}><span className="item-title"><Github size={17} /><span><strong>{item.destinationName}</strong><small>{item.sourcePath ? `${item.repoUrl.replace("https://github.com/", "").replace(".git", "")} / ${item.sourcePath}` : item.repoUrl.replace("https://github.com/", "").replace(".git", "")}</small></span></span><span className="date">{item.lastStatus === "failed" ? "上次失败" : item.lastSyncedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.lastSyncedAt)) : "从未"}</span><ChevronRight size={17} /></button>)}</div></section>
    {selected && <aside className="details"><div className="detail-top"><div><small>同步项</small><h2>{selected.destinationName}</h2></div><button className="icon-button" onClick={() => setSelectedId(undefined)}><X size={17} /></button></div><div className="detail-path"><Folder size={16} /><span>{localPath(config.rootDirectories.find((candidate) => candidate.id === selected.rootId), selected)}</span></div><label>GitHub 来源<span className="readonly-input">{selected.sourceUrl}</span></label>{selected.lastStatus === "failed" && <p role="alert">上次同步失败：{selected.lastMessage ?? "请重新预览后重试。"}</p>}<label>最终文件夹名称<input value={nameDraft ?? selected.destinationName} onChange={(event) => setNameDraft(event.target.value)} onBlur={() => { void commitDestinationName(); }} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label><label className="switch-row"><span><strong>镜像同步</strong><small>删除来源中不存在的目标文件</small></span><input type="checkbox" checked={selected.mirror} onChange={(event) => { void persist({ ...config, items: config.items.map((item) => item.id === selected.id ? { ...item, mirror: event.target.checked } : item) }).catch(() => {}); }} /></label><div className="detail-actions"><button className="button primary" disabled={!!operation} onClick={() => preview([selected])}><RefreshCw size={16} />预览并同步</button><button className="icon-button danger" onClick={() => { setPendingDelete(selected); setDeleteFiles(false); setDialog("delete-item"); }}><Trash2 size={16} /></button></div></aside>}
    {dialog === "group" && <Modal title="添加文件夹组" close={() => setDialog(null)}><p>路径始终相对当前根目录；例如 <code>a/b/c/d</code>。</p><label>相对根目录的路径<input autoFocus value={groupPath} onChange={(event) => setGroupPath(event.target.value)} onKeyDown={(event) => event.key === "Enter" && addGroup()} /></label><Actions close={() => setDialog(null)} submit={addGroup} label="创建文件夹组" /></Modal>}
    {dialog === "sources" && <Modal title="添加 GitHub 来源" close={() => setDialog(null)}><p>将添加到当前选中的位置：<code>{group || root?.path}</code></p><label>GitHub 链接<textarea autoFocus rows={5} value={urls} onChange={(event) => setUrls(event.target.value)} placeholder={"每行一个链接\nhttps://github.com/owner/repo"} /></label><label>自定义最终名称 <small>仅单条链接</small><input value={customName} onChange={(event) => setCustomName(event.target.value)} /></label><label>完整分支名 <small>仅单条目录链接；分支名含 / 时填写</small><input value={branchDraft} onChange={(event) => setBranchDraft(event.target.value)} /></label><Actions close={() => setDialog(null)} submit={addSources} label="添加同步项" /></Modal>}
    {dialog === "sync-scope" && <Modal title="同步当前文件夹" close={() => setDialog(null)}><p>选择本次同步范围。</p><label className="confirm-row"><input type="radio" checked={!recursive} onChange={() => setRecursive(false)} /><span>仅当前文件夹（{config.items.filter((item) => item.rootId === rootId && item.folderGroup === group).length} 项）</span></label><label className="confirm-row"><input type="radio" checked={recursive} onChange={() => setRecursive(true)} /><span>递归当前文件夹及子文件夹（{config.items.filter((item) => item.rootId === rootId && contains(group, item.folderGroup)).length} 项）</span></label><Actions close={() => setDialog(null)} submit={() => preview(config.items.filter((item) => item.rootId === rootId && (recursive ? contains(group, item.folderGroup) : item.folderGroup === group)))} label="生成同步预览" /></Modal>}
    {dialog === "preview" && <Modal title="同步预览" close={() => setDialog(null)} wide>
      <p>{previews.length} 项预览成功（{pendingSyncs.length} 项有变更，{previews.length - pendingSyncs.length} 项已是最新）{previewFailures.length ? `，${previewFailures.length} 项失败` : ""}。{pendingSyncs.length ? "确认后只同步有变更的项目。" : previewFailures.length ? "没有可确认同步的项目。" : "无需同步。"}</p>
      {!pendingSyncs.length && previews.length > 0 && <div className="preview-empty"><CircleCheck size={16} />成功预览的项目已是最新</div>}
      {(pendingSyncs.length > 0 || previewFailures.length > 0) && <div className="preview-list">
        {previews.flatMap(({ item, preview }) => preview.changes.map((change) => <div key={`${item.id}-${change.path}`}><span className={`change change-${change.kind.split("_")[0]}`}>{change.kind === "add" ? "新增" : change.kind === "modify" ? change.linkTarget ? "替换链接" : "修改" : change.kind === "create_directory" ? "创建目录" : change.kind === "add_symlink" ? "新增链接" : change.kind === "modify_symlink" ? "修改链接" : change.kind === "delete_symlink" ? "删除链接" : "删除"}</span><code>{itemPath(item)}{change.path === "." ? "" : `/${change.path}`}{change.linkTarget ? change.kind === "modify" ? `（原链接指向 ${change.linkTarget}）` : ` → ${change.linkTarget}` : ""}</code></div>))}
        {previewFailures.map(({ item, message }) => <div key={`failed-${item.id}`} role="alert"><span className="change change-delete">失败</span><code>{itemPath(item)}：{message}</code></div>)}
      </div>}
      {pendingSyncs.length ? <Actions close={() => setDialog(null)} submit={sync} label="确认同步有变更项" /> : <div className="modal-actions"><button className="button primary" onClick={() => setDialog(null)}>关闭</button></div>}
    </Modal>}
    {dialog === "delete" && <Modal title={group ? "删除文件夹组" : "删除根目录"} close={() => setDialog(null)}><p>将递归删除当前范围的文件夹组和同步项配置。本地文件默认保留。</p><label className="confirm-row"><input type="checkbox" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} /><span>同时删除其中同步项管理的本地目标文件夹（不会删除根目录或目标文件夹之外的文件）</span></label><Actions close={() => setDialog(null)} submit={deleteLocation} label={group ? "删除文件夹组" : "删除根目录"} destructive /></Modal>}
    {dialog === "delete-item" && pendingDelete && <Modal title="删除同步项" close={() => setDialog(null)}><p>将删除这条同步链接配置。本地文件夹默认保留。</p><label className="confirm-row"><input type="checkbox" checked={deleteFiles} onChange={(event) => setDeleteFiles(event.target.checked)} /><span>同时删除本地目标文件夹（{localPath(config.rootDirectories.find((candidate) => candidate.id === pendingDelete.rootId), pendingDelete)}）</span></label><Actions close={() => setDialog(null)} submit={() => removeItem(pendingDelete)} label="删除同步项" destructive /></Modal>}
    {dialog === "move" && pendingMove && <Modal title="移动同步项" close={() => setDialog(null)}><p>将移动 {pendingMove.items.length} 个同步项及现有本地目标文件夹。目标已被占用时不会移动。</p><Actions close={() => setDialog(null)} submit={finishMove} label="确认迁移" /></Modal>}
    {dialog === "move-root" && pendingRootMove && <Modal title="移动根目录" close={() => setDialog(null)}><p>将根目录及现有本地文件夹移至 <code>{pendingRootMove.to}</code>。旧目录不存在时只更新配置，等待同步时创建。</p><Actions close={() => setDialog(null)} submit={finishMoveRoot} label="确认迁移" /></Modal>}
    {dialog === "rename" && pendingRename && <Modal title={pendingRename.kind === "root" ? "重命名根目录" : pendingRename.kind === "group" ? "重命名文件夹组" : "重命名同步项"} close={() => setDialog(null)}><p>将名称更新为 <code>{pendingRename.kind === "group" ? leafName(pendingRename.to) : pendingRename.name}</code>，并移动现有本地文件夹。目标已被占用时不会重命名。</p><Actions close={() => setDialog(null)} submit={finishRenameConfirm} label="确认重命名" /></Modal>}
    {dialog === "settings" && <Modal title="本地配置" close={() => setDialog(null)}><p>根目录与同步项保存在这台 Mac。仅支持新版 JSON 配置。</p><div className="config-actions"><button className="button secondary" disabled={!loaded || !!loadError} onClick={() => { void api.exportConfig().catch((cause) => setError(errorMessage(cause, "无法导出配置。"))); }}><Download size={16} />导出 JSON</button><button className="button secondary" onClick={importConfig}><Upload size={16} />导入 JSON</button></div></Modal>}
    {dialog === "import" && pendingImport && <Modal title="替换当前配置" close={() => setDialog(null)}><p>导入会替换当前同步配置，但不会修改任何本地文件。</p><Actions close={() => setDialog(null)} submit={() => { void persist(pendingImport, !!loadError).then(() => { setRootId(pendingImport.rootDirectories[0]?.id); setDialog(null); }).catch(() => {}); }} label="替换当前配置" destructive /></Modal>}
    {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onMouseDown={(event) => event.stopPropagation()}><button onClick={editContextTarget}>重命名文件夹</button>{!contextMenu.target.group && <><button onClick={beginMoveRoot}>移动至</button><button onClick={relinkRoot}>重新关联现有文件夹</button></>}<button onClick={openDirectory}>打开所在文件夹位置</button></div>}{error && <div className="toast"><CircleAlert size={17} /><span>{error}</span><button className="icon-button" onClick={() => setError(undefined)}><X size={15} /></button></div>}{notice && <div className="toast success"><CircleCheck size={17} /><span>{notice}</span><button className="icon-button" onClick={() => setNotice(undefined)}><X size={15} /></button></div>}{operation && <Progress operation={operation} />}
  </main>;
}
type DropProps = { items: SyncItem[]; draggedIds: React.MutableRefObject<string[]>; dropTarget?: string; setDropTarget: (target?: string) => void; onDrop: (items: SyncItem[], rootId: string, group: string) => void; onExternalDrop: (links: string[], rootId: string, group: string) => void };
type RenameProps = { editingGroup?: string; editingGroupRootId?: string; editingRootId?: string; editingName: string; onStartRename: (path: string, name: string) => void; onStartRootRename: (id: string, name: string) => void; onChangeRename: (name: string) => void; onFinishRename: () => void; onFinishRootRename: () => void; onCancelRename: () => void };
type ContextProps = { onContextMenu: (target: ContextTarget, event: React.MouseEvent) => void };
const INTERNAL_DRAG_TYPE = "application/x-repomirror-items";
function DropRow({ target, children, onDrop, onLinks, onDoubleClick, className = "", style, ...props }: DropProps & { target: string; children: React.ReactNode; onDrop: (items: SyncItem[]) => void; onLinks: (links: string[]) => void; onDoubleClick?: () => void; className?: string; style?: React.CSSProperties }) {
  const finish = (event: React.DragEvent) => {
    if (Array.from(event.dataTransfer.types).includes(INTERNAL_DRAG_TYPE)) {
      let ids: string[] = props.draggedIds.current;
      if (!ids.length) {
        try { ids = JSON.parse(event.dataTransfer.getData(INTERNAL_DRAG_TYPE)); }
        catch { ids = []; }
      }
      const items = props.items.filter((item) => ids.includes(item.id));
      if (items.length) onDrop(items);
    } else onLinks(externalLinks(event.dataTransfer));
    props.setDropTarget(undefined);
  };
  return <div className={`tree-row ${className} ${props.dropTarget === target ? "drop-target" : ""}`} style={style} onDoubleClick={onDoubleClick} onDragOverCapture={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = Array.from(event.dataTransfer.types).includes(INTERNAL_DRAG_TYPE) ? "move" : "copy"; props.setDropTarget(target); }} onDragLeaveCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) props.setDropTarget(undefined); }} onDropCapture={(event) => { event.preventDefault(); event.stopPropagation(); finish(event); }}>{children}</div>;
}
function RootTree({ root, nodes, activeRootId, activeGroup, expanded, onToggle, onSelect, ...props }: { root: RootDirectory; nodes: Node[]; activeRootId?: string; activeGroup: string; expanded: Set<string>; onToggle: (key: string) => void; onSelect: (rootId: string, group?: string) => void } & DropProps & RenameProps & ContextProps) { const target = `${root.id}:`; const editing = props.editingRootId === root.id; return <><DropRow {...props} target={target} className={activeRootId === root.id && !activeGroup ? "active" : ""} onDrop={(item) => props.onDrop(item, root.id, "")} onLinks={(links) => props.onExternalDrop(links, root.id, "")} onDoubleClick={() => props.onStartRootRename(root.id, root.name ?? root.path.split("/").at(-1) ?? "")}><span className="tree-spacer" /><div className="tree-select" role="button" tabIndex={0} onContextMenu={(event) => props.onContextMenu({ rootId: root.id, group: "", name: root.name ?? root.path.split("/").at(-1) ?? "", path: root.path }, event)} onClick={() => onSelect(root.id)} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && onSelect(root.id)}><Folder size={15} />{editing ? <input autoFocus value={props.editingName} onChange={(event) => props.onChangeRename(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Enter") props.onFinishRootRename(); if (event.key === "Escape") props.onCancelRename(); }} onBlur={props.onFinishRootRename} /> : <span>{root.name ?? root.path.split("/").at(-1)}</span>}<em>{props.items.filter((item) => item.rootId === root.id && !item.folderGroup).length}</em></div></DropRow><Tree nodes={nodes} rootId={root.id} rootPath={root.path} active={activeRootId === root.id ? activeGroup : ""} expanded={expanded} onToggle={onToggle} onSelect={onSelect} {...props} /></>; }
function Tree({ nodes, rootId, rootPath, active, expanded, onToggle, onSelect, depth = 1, ...props }: { nodes: Node[]; rootId: string; rootPath: string; active: string; expanded: Set<string>; onToggle: (key: string) => void; onSelect: (rootId: string, group?: string) => void; depth?: number } & DropProps & RenameProps & ContextProps) { return <>{nodes.map((node) => { const key = `${rootId}:${node.path}`; const open = expanded.has(key); const select = () => onSelect(rootId, node.path); const editing = props.editingGroup === node.path && (!props.editingGroupRootId || props.editingGroupRootId === rootId); return <div className="tree-node" key={key}><DropRow {...props} target={key} className={active === node.path ? "active" : ""} style={{ paddingLeft: 7 + depth * 15 }} onDrop={(item) => props.onDrop(item, rootId, node.path)} onLinks={(links) => props.onExternalDrop(links, rootId, node.path)} onDoubleClick={() => props.onStartRename(node.path, node.label)}><>{node.children.length ? <button className="tree-toggle" onClick={() => onToggle(key)}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button> : <span className="tree-spacer" />}<div className="tree-select" role="button" tabIndex={0} onContextMenu={(event) => props.onContextMenu({ rootId, group: node.path, name: node.label, path: `${rootPath}/${node.path}` }, event)} onClick={select} onKeyDown={(event) => (event.key === "Enter" || event.key === " ") && select()}><Folder size={15} />{editing ? <input autoFocus value={props.editingName} onChange={(event) => props.onChangeRename(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Enter") props.onFinishRename(); if (event.key === "Escape") props.onCancelRename(); }} onBlur={props.onFinishRename} /> : <span>{node.label}</span>}<em>{props.items.filter((item) => item.rootId === rootId && item.folderGroup === node.path).length}</em></div></></DropRow>{open && <Tree nodes={node.children} rootId={rootId} rootPath={rootPath} active={active} expanded={expanded} onToggle={onToggle} onSelect={onSelect} depth={depth + 1} {...props} />}</div>; })}</>; }
function Modal({ title, children, close, wide = false }: { title: string; children: React.ReactNode; close: () => void; wide?: boolean }) { return <div className="modal-backdrop"><section className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true"><header><h2>{title}</h2><button className="icon-button" onClick={close}><X size={17} /></button></header>{children}</section></div>; }
function Actions({ close, submit, label, destructive = false }: { close: () => void; submit: () => void; label: string; destructive?: boolean }) { return <div className="modal-actions"><button className="button ghost" onClick={close}>取消</button><button className={`button ${destructive ? "destructive" : "primary"}`} onClick={submit}><Check size={16} />{label}</button></div>; }
function Progress({ operation }: { operation: Operation }) { return <div className="modal-backdrop progress-backdrop"><section className="progress-dialog"><LoaderCircle size={24} className="spin" /><div><strong>{operation.kind === "preview" ? "正在生成同步预览" : "正在同步文件"}</strong><span>{operation.current} / {operation.total}</span><small>{operation.itemName}</small></div></section></div>; }
