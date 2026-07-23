# 配置格式

[English](config-format.md)

RepoMirror 导入和导出使用 `schemaVersion: 2` 的 JSON。除 `rootDirectory` 和 `theme` 外，所有顶层字段都是必填项；所有同步条目字段也都是必填项。未知的状态字段必须以 `null` 明确写出。

## 顶层字段

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `schemaVersion` | number | 必须为 `2`。 |
| `rootDirectory` | string 或省略 | 绝对本地路径。 |
| `theme` | `light`、`dark` 或省略 | 应用外观。 |
| `folderGroups` | string array | 唯一、非空的相对路径。 |
| `items` | array | 同步条目；`id` 与目标路径均须唯一。 |

## 同步条目

根目录中的条目，`folderGroup` 必须为空字符串；位于文件夹组中的条目，`folderGroup` 必须与 `folderGroups` 中某项完全一致。`destinationName` 只能是单个文件夹名称，不能是路径。

| 字段 | 规则 |
| --- | --- |
| `id` | 非空且唯一的字符串。 |
| `sourceUrl` | 不带查询参数的 `https://github.com/<owner>/<repo>` URL，或 `tree/<branch>/<path>` URL。 |
| `repoUrl` | 与来源匹配的 `https://github.com/<owner>/<repo>.git` URL。 |
| `branch` 与 `sourcePath` | 仓库来源时均为 `null`；目录来源时均须存在，并与 `tree` URL 一致。 |
| `mirror` | 布尔值。 |
| `lastStatus` | `not_synced`、`synced` 或 `failed`。 |
| `lastSyncedAt` | RFC 3339 时间戳或 `null`。 |
| `lastCommit`、`lastMessage` | 字符串或 `null`。 |

相对路径不能是绝对路径，也不能包含 `.` 或 `..` 路径段。系统会拒绝未知字段，以便配置错误能够被明确发现，而不是被静默忽略。
