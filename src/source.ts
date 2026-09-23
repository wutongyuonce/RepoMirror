import type { SyncItem } from "./domain";

export function parseSource(url: string, rootId: string, folderGroup: string, destinationName?: string, branchOverride?: string): SyncItem {
  const parsed = new URL(url.trim());
  const parts = parsed.pathname.split("/").filter(Boolean);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash || parts.length < 2) throw new Error("请使用无附加参数的 HTTPS GitHub 仓库或目录链接。");
  const [owner, repo, marker] = parts;
  const repository = repo.endsWith(".git") ? repo.slice(0, -4) : repo;
  if (!repository) throw new Error("仓库名称无效。");
  if (marker && marker !== "tree") throw new Error("请使用仓库链接或 GitHub 的 tree 目录链接。");
  if (branchOverride && marker !== "tree") throw new Error("仓库链接不需要填写分支。");
  const branch = marker === "tree" ? branchOverride?.trim() || parts[3] : undefined;
  const branchParts = branch?.split("/") ?? [];
  if (marker === "tree" && (!branch || branchParts.some((part) => !part || part === "." || part === "..") || parts.slice(3, 3 + branchParts.length).join("/") !== branch || parts.length <= 3 + branchParts.length)) throw new Error("目录链接的分支或路径无效；含 / 的分支请填写完整分支名。");
  const sourcePath = marker === "tree" ? parts.slice(3 + branchParts.length).join("/") : undefined;
  const sourceUrl = `https://github.com/${owner}/${repository}${marker === "tree" ? `/tree/${parts.slice(3).join("/")}` : ""}`;
  return { id: crypto.randomUUID(), sourceUrl, repoUrl: `https://github.com/${owner}/${repository}.git`, branch, sourcePath, rootId, folderGroup, destinationName: destinationName?.trim() || sourcePath?.split("/").at(-1) || repository, mirror: true, lastStatus: "not_synced" };
}

export function externalLinks(data: Pick<DataTransfer, "getData">): string[] {
  const value = data.getData("text/uri-list") || data.getData("text/plain");
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}
