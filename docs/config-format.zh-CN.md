# 配置格式

[English](config-format.md)

RepoMirror 导入和导出使用 `schemaVersion: 3` 的 JSON。未知字段会被拒绝。旧版 v2 文件会被丢弃，不会迁移。

## 顶层字段

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `schemaVersion` | number | 必须为 `3`。 |
| `rootDirectories` | array | `id` 唯一，路径为唯一的规范绝对路径。根目录不能彼此嵌套。 |
| `theme` | `light`、`dark` 或省略 | 应用外观。 |
| `folderGroups` | array | `{ rootId, path }`。同一根目录下 `path` 唯一且非空。 |
| `items` | array | 同步条目；`id` 与目标路径均须唯一。 |

## 根目录

| 字段 | 规则 |
| --- | --- |
| `id` | 非空且唯一的字符串。 |
| `path` | 保存配置时必须存在的绝对本地文件夹。 |
| `name` | 可选显示名称。 |

## 文件夹组

`path` 相对其根目录，可包含多段，例如 `tools/browser`。文件夹组不能占用或位于同步项目标目录内。

## 同步条目

位于根目录中的条目，`folderGroup` 必须为空字符串；位于文件夹组中的条目，`folderGroup` 必须与同一根目录下某文件夹组完全一致。`destinationName` 只能是单个文件夹名称，不能是路径。

| 字段 | 规则 |
| --- | --- |
| `id` | 非空且唯一的字符串。 |
| `sourceUrl` | 不带查询参数的 `https://github.com/<owner>/<repo>` URL，或 `tree/<branch>/<path>` URL。 |
| `repoUrl` | 与来源匹配的 `https://github.com/<owner>/<repo>.git` URL。 |
| `branch` 与 `sourcePath` | 仓库来源时均省略；目录来源时均须存在，并与 `tree` URL 一致。 |
| `rootId` | 必须对应某个根目录 `id`。 |
| `folderGroup` | 空字符串，或同一根目录下已有文件夹组路径。 |
| `destinationName` | 单个文件夹名称。 |
| `mirror` | 布尔值。 |
| `lastStatus` | `not_synced`、`synced` 或 `failed`。保存在配置中，不作为列表列展示。 |
| `lastSyncedAt` | RFC 3339 时间戳或 `null`。 |
| `lastCommit`、`lastMessage` | 字符串或 `null`。 |

相对路径不能是绝对路径，也不能包含 `.` 或 `..` 路径段。
