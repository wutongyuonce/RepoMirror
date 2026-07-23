# RepoMirror

[English](README.md)

RepoMirror 是一款专注于将 GitHub 仓库或其中指定目录镜像同步至本地文件夹树的 macOS 桌面应用。它基于 Tauri 2、React、TypeScript 与精简的 Rust 后端构建。

## 功能

- 选择一个默认根目录。
- 可展开的路径型文件夹组，例如 `tools/browser`。
- 支持 GitHub 仓库链接与 `tree/<branch>/<path>` 目录链接。
- 批量添加来源，并可自定义目标文件夹名称。
- 每个条目独立设置镜像模式；每次写入前提供逐文件预览。
- 手动同步单个条目，或按顺序同步全部条目。
- 配置导入与导出、持久化浅色/深色外观；不存储账号或令牌。

RepoMirror 使用 Mac 上已有的 `git` 可执行文件与凭据。只要 Git 已能在此机器上认证，私有仓库也可正常使用。

## 安全性

同步始终会先展示预览，且需确认后才会开始。镜像模式可能删除目标目录中来源不存在的文件；关闭镜像模式则会保留本地额外文件。

同步永远不会修改 `.git`、`.DS_Store` 与 `node_modules`。删除文件夹组只会移除其同步配置及子级同步配置，绝不会删除本地目标文件。

### 同步逻辑

RepoMirror 会获取每个已配置 GitHub 来源的最新提交，然后比较来源目录与该条目的最终目标目录。它只会写入新增或内容不同的文件，完全相同的文件不会被改动。因此，GitHub 有新提交并不一定会改变本地文件：若提交未影响已配置的仓库目录，该条目不会发生实际文件变更。

`Sync all` 会执行所有已配置条目，包括文件夹组内的条目。它不会把默认根目录当成一个整体目标目录同步，因此根目录中无关的文件和文件夹会被保留。每个条目都独立处理，最终路径为 `<rootDirectory>/<folderGroup>/<destinationName>`。

当 `mirror: true` 时，来源文件会覆盖同名本地文件，来源中不存在的本地文件会被移除，但影响范围仅限该条目的最终目标目录。当 `mirror: false` 时，来源中不存在的本地文件会保留；来源中有变更的文件仍会更新。

## 配置

RepoMirror 将工作配置保存在 macOS 的应用支持目录中。导出的文件使用稳定的 JSON 合约，`schemaVersion` 为 `1`。

```json
{
  "schemaVersion": 1,
  "rootDirectory": "/Users/you/RepoMirror Library",
  "theme": "dark",
  "folderGroups": ["tools/browser"],
  "items": [
    {
      "id": "5ac18832-4c2f-4a61-a8ca-cf7b5f9c4a44",
      "sourceUrl": "https://github.com/narumiruna/pi-extensions/tree/main/extensions/pi-btw",
      "repoUrl": "https://github.com/narumiruna/pi-extensions.git",
      "branch": "main",
      "sourcePath": "extensions/pi-btw",
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

导入会拒绝格式错误的 JSON、不支持的 schema 版本、未知字段、无效路径、无效枚举值、重复的 ID 或目标路径，以及彼此不一致的 GitHub 字段。导入失败不会更改当前配置。已有配置时，RepoMirror 会要求明确确认覆盖后才会替换。完整合约请参阅 [docs/config-format.zh-CN.md](docs/config-format.zh-CN.md) 与 [docs/config-schema.json](docs/config-schema.json)。

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
src-tauri/target/release/bundle/dmg/RepoMirror_0.1.0_<architecture>.dmg
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
