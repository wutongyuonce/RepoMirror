# RepoMirror

[English](README.md)

RepoMirror 是一款专注于将 GitHub 仓库或其中指定目录镜像同步至本地文件夹树的 macOS 桌面应用。它基于 Tauri 2、React、TypeScript 与精简的 Rust 后端构建。

它特别适合正在本地积累 AI Agent Skills、提示词、扩展与开源工具的人：把真正会使用的项目保留在磁盘上，按自己的方式归组，不必再手动逐个检查几十个 GitHub 项目有没有更新。

![image-20260726022555468](img/image-20260726022555468.png)

![image-20260726022606544](img/image-20260726022606544.png)

## 功能

- 可选择多个根目录，并在同一棵文件夹树中展示。
- 每个根目录下都支持可展开的路径型文件夹组，例如 `tools/browser`。
- 支持 GitHub 仓库链接与 `tree/<branch>/<path>` 目录链接。
- 批量添加来源，并可自定义目标文件夹名称。
- 每个条目独立设置镜像模式；每次写入前提供逐文件预览。
- 手动同步单个条目，或按范围批量同步当前文件夹。
- 可将一个或多个同步项拖至另一根目录或文件夹组，并选择是否一起移动它们受管理的本地目标文件夹；拖动完成后保持当前页面不跳转。
- 按住 Command（或 Control）点击可多选，按住 Shift 点击可选择两个条目之间的全部内容。
- 根目录和文件夹组支持双击重命名，也可右键选择“编辑名字”或在 Finder 中打开所在位置。
- 配置导入与导出、持久化浅色/深色外观；不存储账号或令牌。

RepoMirror 使用 Mac 上已有的 `git` 可执行文件与凭据。只要 Git 已能在此机器上认证，私有仓库也可正常使用。

## 安全性

同步始终会先展示预览，且需确认后才会开始。镜像模式可能删除目标目录中来源不存在的文件；关闭镜像模式则会保留本地额外文件。

同步永远不会修改 `.git`、`.DS_Store` 与 `node_modules`。删除根目录或文件夹组会递归移除相关配置；用户可另行选择删除受影响的受管理目标文件夹。RepoMirror 绝不会删除根目录本身或其中未受管理的文件。

### 同步逻辑

RepoMirror 会获取每个已配置 GitHub 来源的最新提交，然后比较来源目录与该条目的最终目标目录。它只会写入新增或内容不同的文件，完全相同的文件不会被改动。因此，GitHub 有新提交并不一定会改变本地文件：若提交未影响已配置的仓库目录，该条目不会发生实际文件变更。

列表仅记录三种结果：“未同步”、“已同步”和“失败”。“已同步”表示该条目最近一次同步已成功完成，不是后台实时检查 GitHub 的状态。运行预览会重新获取来源，并判断当前的文件级差异。预览为空表示无需同步，此时 RepoMirror 不会提供确认同步操作。

“同步当前文件夹”会先打开范围选择：可选择仅同步当前节点，或同步当前节点及所有子文件夹组，默认选择递归范围。根目录只会同步其自身范围内的同步项。每个条目都独立处理，最终路径为 `<rootDirectory>/<folderGroup>/<destinationName>`，因此无关的本地文件会被保留。

当 `mirror: true` 时，来源文件会覆盖同名本地文件，来源中不存在的本地文件会被移除，但影响范围仅限该条目的最终目标目录。当 `mirror: false` 时，来源中不存在的本地文件会保留；来源中有变更的文件仍会更新。

## 配置

RepoMirror 将工作配置保存在 macOS 的应用支持目录中。导出的文件使用 `schemaVersion: 3`。旧版 v2 配置会被直接丢弃，不会迁移或导入。

```json
{
  "schemaVersion": 3,
  "rootDirectories": [
    { "id": "library", "path": "/Users/you/RepoMirror Library", "name": "我的资料库" }
  ],
  "theme": "dark",
  "folderGroups": [
    { "rootId": "library", "path": "tools/browser" }
  ],
  "items": [
    {
      "id": "5ac18832-4c2f-4a61-a8ca-cf7b5f9c4a44",
      "sourceUrl": "https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-btw",
      "repoUrl": "https://github.com/narumiruna/pi-extensions.git",
      "branch": "main",
      "sourcePath": "extensions/pi-btw",
      "rootId": "library",
      "folderGroup": "tools/browser",
      "destinationName": "pi-btw",
      "mirror": true,
      "lastStatus": "not_synced",
      "lastSyncedAt": null,
      "lastCommit": null,
      "lastMessage": null
    }
  ]
}
```

导入会拒绝格式错误的 JSON、不支持的 schema 版本、未知字段、无效路径、无效枚举值、重复的 ID 或目标路径，以及彼此不一致的 GitHub 字段。导入失败不会更改当前配置。已有配置时，RepoMirror 会要求明确确认覆盖后才会替换。

### Codex 配置辅助 Skill

本仓库包含 [`repo-mirror-config-skill/`](repo-mirror-config-skill)，这是一个用于创建、解释、审阅和修复 RepoMirror 导入 JSON 的 Codex Skill。它会将 GitHub 仓库或目录链接转换为合法的同步条目，只询问缺失的必要信息，并在返回结果前检查 JSON 规范。

将它安装到本机 Codex skills 目录后，新建一个 Codex task：

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/repo-mirror-config"
cp -R repo-mirror-config-skill/. "${CODEX_HOME:-$HOME/.codex}/skills/repo-mirror-config/"
```

之后可以这样向 Codex 提需求：

> 使用 `repo-mirror-config` 生成一份可导入的 RepoMirror JSON。我的根目录是 `/Users/me/Extensions`；请把这些链接放到 `community/tools` 下：`https://github.com/owner/repo` 和 `https://github.com/owner/repo/tree/main/packages/plugin`。

该 Skill 也可用于验证已有导出文件，或修复被 RepoMirror 拒绝导入的 JSON。`mirror: true` 仍需审慎选择：确认预览后，它可能删除目标目录中来源不存在的文件。

## 开发

环境要求：macOS 12+、Git、Node.js 20+、Rust 与 Xcode Command Line Tools。

```bash
pnpm install
pnpm tauri dev
```

分别验证前端与 Rust 后端：

```bash
pnpm build
cd src-tauri && cargo check
```

创建 macOS 应用包：

```bash
pnpm tauri build
```

该命令会先执行前端生产构建，再生成 release 版 macOS 应用包与磁盘映像。通常输出在以下位置：

```text
src-tauri/target/release/bundle/macos/RepoMirror.app
src-tauri/target/release/bundle/dmg/RepoMirror_0.2.0_<architecture>.dmg
```

在 Apple Silicon Mac 上，`<architecture>` 为 `aarch64`；在 Intel Mac 上则为 `x64`。`.app` 可以直接运行；`.dmg` 则适合分发，打开后将 `RepoMirror.app` 拖入“应用程序”即可。本仓库的构建未进行代码签名或公证，因此在开发机以外分发时，macOS 首次运行可能要求用户明确允许打开。

## 项目结构

```text
src/          React 界面与 Tauri 命令客户端
src-tauri/    Rust 配置、Git、预览与同步实现
docs/         架构决策与配置合约
```

## 许可证

RepoMirror 基于 [MIT License](LICENSE) 发布。
