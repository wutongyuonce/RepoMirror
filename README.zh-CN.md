# RepoMirror

[English](README.md)

RepoMirror 是一款专注于将 GitHub 仓库或其中指定目录镜像同步至本地文件夹树的 macOS 桌面应用。它基于 Tauri 2、React、TypeScript 与精简的 Rust 后端构建。

它特别适合正在本地积累 AI Agent Skills、提示词、扩展与开源工具的人：把真正会使用的项目保留在磁盘上，按自己的方式归组，不必再手动逐个检查几十个 GitHub 项目有没有更新。

![image-20260726022555468](img/image-20260726022555468.png)

![image-20260726022606544](img/image-20260726022606544.png)

## 功能

- 可选择多个根目录，并在同一棵文件夹树中展示。不能把已有根目录里的文件夹再加成根目录，也不能添加会包住已有根目录的文件夹。
- 每个根目录下都支持可展开的路径型文件夹组，例如 `tools/browser`。
- 支持 GitHub 仓库链接与 `tree/<branch>/<path>` 目录链接。
- 批量添加来源，并可自定义目标文件夹名称。
- 每个条目独立设置镜像模式；每次写入前提供逐文件预览。
- 手动同步单个条目，或按范围批量同步当前文件夹。
- 可将一个或多个同步项拖至另一根目录或文件夹组；已有的本地目标文件夹会一同移动。也可把 GitHub 链接拖到文件夹树或当前内容区域，预填添加表单。
- 第一层根目录支持右键“移动至”；已有本地文件夹与配置一起移动。若文件夹已在应用外移动，可使用“重新关联现有文件夹”。
- 按住 Command（或 Control）点击可多选，按住 Shift 点击可选择两个条目之间的全部内容。
- 根目录、文件夹组和同步项的最终文件夹名称都可重命名。已有本地文件夹跟随新名字；不存在时只改配置。目标位置被占用则拒绝。
- 配置导入与导出、持久化浅色/深色外观；不存储账号或令牌。

RepoMirror 使用 Mac 上已有的 `git` 可执行文件与凭据。只要 Git 已能在此机器上认证，私有仓库也可正常使用。

## 使用方法

1. 点击左侧“文件夹组”旁的 **+**，选择一个本地文件夹作为根目录。根目录是保存位置，不是 GitHub 来源；同一份配置可以包含多个互不重叠的根目录。
2. 选中根目录或文件夹组，点击“添加来源”，粘贴 GitHub 仓库链接（如 `https://github.com/owner/repo`）或目录链接（如 `https://github.com/owner/repo/tree/main/packages/tool`）。可每行填一条；单条链接可指定最终文件夹名称。也可将浏览器里的 GitHub 链接拖到左侧目标位置或当前内容区，表单会预填链接和目标。**确认添加只保存同步项，不会下载文件。**
3. 点击同步项的“预览并同步”，或点击顶部“同步当前文件夹”。批量同步可选择仅当前节点，或递归包含子文件夹组（默认）。预览列出新增、修改、删除和缺失目标目录的创建；某条预览失败会单独显示。确认后只同步预览成功且有变更的项目；若都无需同步，关闭预览即可。
4. 每条同步项默认开启镜像模式：确认同步后，目标目录里来源没有的普通文件和符号链接会被删除。若要保留这些本地额外内容，在同步项详情中关闭“镜像同步”。两种模式都不会删除未列出的空目录；遇到文件与目录冲突会报错。

每条同步项的目标位置为 `<根目录>/<文件夹组>/<最终文件夹名称>`。例如根目录是 `/Users/me/Library`、文件夹组是 `tools/browser`、最终名称是 `plugin`，则文件写入 `/Users/me/Library/tools/browser/plugin`。同一个 GitHub 来源可以添加到不同目标位置；同一根目录下的两个同步项不能占用同一个目标路径。RepoMirror 不会定时或后台同步。

要新建文件夹组，先选中所属根目录，再点顶部“文件夹组”，输入**相对根目录**的路径，例如 `tools/browser`；缺少的上级组会一并加入配置。若 GitHub 目录链接中的分支名含 `/`，添加单条链接时在“完整分支名”填写完整名称，例如 `feature/new-ui`，以便正确区分分支和仓库内目录。

### 整理本地文件夹

- **移动同步项：** 将列表中的同步项拖到左侧根目录或文件夹组。按住 Command（或 Control）点击可多选，Shift 点击可选连续范围。已有目标文件夹会随配置一起移动；若尚未同步、文件夹不存在，则只修改保存位置。目标位置已有文件或文件夹时会拒绝移动。
- **重命名：** 双击左侧根目录或文件夹组名称，或在右键菜单中选择“重命名文件夹”；同步项的最终名称在右侧详情中修改。已有本地文件夹跟随改名；不存在的文件夹不会提前创建。重命名文件夹组也会更新其中子组和同步项的位置。
- **移动整个根目录：** 在根目录右键菜单选“移动至”，选择新的**父文件夹**。例如当前根目录是 `/A/Library`，选 `/B` 后目标为 `/B/Library`。若原文件夹仍在，RepoMirror 会搬动它；若已不存在，只更新配置路径。
- **重新关联现有文件夹：** 如果你已经在 Finder 里把 `/A/Library` 搬到了 `/B/Library`，旧路径不存在时，在根目录右键菜单选此项，再选择 `/B/Library`。这只更新根目录路径，保留原有文件夹组和同步项，不再次移动或同步文件。请选择确实要交给这些同步项管理的文件夹；应用不会核验它与旧目录的内容是否相同。
- **删除：** 默认只删除选定同步项或范围内的配置，保留本地文件。只有勾选删除本地文件，才会在保存配置后删除相关同步项的目标文件夹；根目录本身及其中无关文件不会因此删除。

### 导入、导出与缺失目录

在左下角“本地配置”中导入或导出 JSON。导入前会校验整份文件；已有配置时须确认替换，取消或失败不会覆盖它。导入配置中的根目录即使已被移动或暂时不存在，也允许导入；预览不会创建目录，确认同步时会创建缺失的根目录、文件夹组和目标目录。若原文件夹其实已被手动搬走，先用“重新关联现有文件夹”，以免下次同步在旧路径重新创建一份。

如果已保存的配置文件损坏或版本不受支持，应用会保留原文件、显示错误并阻止普通写入；可以在“本地配置”中明确导入有效备份来替换。建议在大范围改动或更换电脑前先导出备份。

## 安全性

同步始终会先展示预览，确认时会重新检查来源提交、普通文件和符号链接的差异。符号链接按链接本身复制，不读取其指向的内容；镜像模式删除多余链接时也只删除链接。其他程序打开复制后的链接时，仍可能访问目标目录外的路径。目标父路径中的符号链接或文件与目录冲突会阻止同步。

同步永远不会修改 `.git`、`.DS_Store` 与 `node_modules`。删除根目录或文件夹组会递归移除相关配置；用户可另行选择删除受影响的受管理目标文件夹。RepoMirror 绝不会删除根目录本身或所选受管理目标文件夹之外的文件。

### 同步逻辑

RepoMirror 会获取每个已配置 GitHub 来源的最新提交，然后比较来源目录与该条目的最终目标目录。它只会写入新增或内容不同的文件，完全相同的文件不会被改动。因此，GitHub 有新提交并不一定会改变本地文件：若提交未影响已配置的仓库目录，该条目不会发生实际文件变更。

同步项会在配置中记录最近一次同步时间。运行预览会重新获取来源，并判断当前的文件级差异。没有变更的项目会跳过，最近同步时间不变。若目标目录不存在，即使来源没有普通文件，预览也会列出创建目录。

“同步当前文件夹”会先打开范围选择：可选择仅同步当前节点，或同步当前节点及所有子文件夹组，默认选择递归范围。根目录只会同步其自身范围内的同步项。每个条目都独立处理，最终路径为 `<rootDirectory>/<folderGroup>/<destinationName>`，因此无关的本地文件会被保留。

当 `mirror: true` 时，来源文件会覆盖同名本地文件，来源中不存在的本地文件会被移除，但影响范围仅限该条目的最终目标目录。当 `mirror: false` 时，来源中不存在的本地文件会保留；来源中有变更的文件仍会更新。

## 配置

RepoMirror 将工作配置保存在 macOS 的应用支持目录中。导出的文件使用 `schemaVersion: 3`。旧版 v2 配置不会迁移或导入；已保存的 v2 文件会保留，并显示不支持的原因。

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

导入会拒绝格式错误的 JSON、不支持的 schema 版本、未知字段、无效路径、无效枚举值、重复的 ID 或目标路径，以及彼此不一致的 GitHub 字段。根目录暂时不存在时仍可导入或读取配置；预览并确认同步后会自动创建。完整交互规则见 [交互 SPEC](docs/interaction-spec.md)。导入失败不会更改当前配置。已有配置时，RepoMirror 会要求明确确认覆盖后才会替换。

### Codex 配置辅助 Skill

本仓库包含 [`repo-mirror-config-skill/`](repo-mirror-config-skill)，这是一个用于创建、解释、审阅和修复 RepoMirror 导入 JSON 的 Codex Skill。它会将 GitHub 仓库或目录链接转换为合法的 `schemaVersion: 3` 同步条目，只询问缺失的必要信息，并在返回结果前检查 JSON 规范。

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
src-tauri/target/release/bundle/dmg/RepoMirror_0.3.2_<architecture>.dmg
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
