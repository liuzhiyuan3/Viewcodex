# Viewcodex

Viewcodex 是一个面向 Codex CLI 的本地可视化工作台。

它不是 IDE，也不是网页聊天工具。它的目标很直接：把你平时使用 Codex CLI 时常做的事情整理到一个清晰的界面里，例如选择项目、读取项目规范、选择模型和 skill、启动 Codex、查看终端输出、管理 Team 角色会话。

## 主要功能

- 选择并管理本地项目目录
- 为每个项目配置启动文档，例如 `AGENTS.md`、`README.md`、项目规范或需求文档
- 启动 Codex 前提供项目必读/选读文档路径，要求 Codex 自行阅读 Markdown
- 选择模型、思考强度、上下文长度和任务模式
- 自动发现用户本机已有的 Codex skills
- 保存常用 Prompt，启动任务时快速插入
- 在界面内运行 Codex CLI 终端
- 查看每个 Codex 会话的上下文使用进度
- Team 模式支持 Planner、Executor、Reviewer 角色切换
- 支持项目级 Git 配置，包括仓库目录、Origin URL 和任务分支策略
- 上一次 Codex 会话结束后生成临时交接记录，下次启动时提供路径并删除原文件

## 技术栈

- Electron
- React
- TypeScript
- Vite
- xterm.js
- node-pty
- lucide-react
- 本地 JSON 配置

## 使用前准备

使用 Viewcodex 前，请先确认本机已经安装：

- Node.js
- npm
- Git
- Codex CLI

你还需要先完成 Codex CLI 的登录或配置，确保在终端里可以正常运行：

```bash
codex --version
```

如果你有自己的 skills，Viewcodex 会从下面的位置自动读取：

```text
CODEX_HOME/skills
~/.codex/skills
```

## 安装

从 GitHub 克隆项目：

```bash
git clone https://github.com/liuzhiyuan3/Viewcodex.git
cd Viewcodex
```

安装依赖：

```bash
npm install
```

启动应用：

```bash
npm run dev
```

## 基本使用

1. 打开 Viewcodex。
2. 点击左侧的“选择项目”，选择一个本地代码项目。
3. 在“文档”页面添加启动文档。
4. 在“配置”页面选择模型、上下文长度、Git 策略等配置。
5. 在 CLI 页面输入需求。
6. 点击“启动”，Viewcodex 会把项目文档路径和你的需求一起交给 Codex CLI。

## 启动文档

启动文档是 Codex 每次开始处理项目任务前需要阅读的项目 Markdown。

常见启动文档包括：

- `AGENTS.md`
- `README.md`
- 项目规范文档
- 接口说明
- 业务规则
- 当前需求文档

启动文档分为：

- 必读：每次都会优先加入上下文
- 可选：标准/深度任务会一起列入阅读路径

Viewcodex 不会把启动文档正文塞进 prompt。它只会把文档路径列出来，并要求 Codex 在项目内自行阅读，这样可以减少 prompt 体积，避免长文档挤占上下文。

## Prompt 记忆

你可以在配置中保存常用 Prompt。

例如：

- 代码审查 Prompt
- 修复构建 Prompt
- UI 优化 Prompt
- 提交说明 Prompt

之后在 CLI 页面可以直接插入，不需要每次重新输入。

## Skills

Viewcodex 不会内置固定 skill 列表。

它会实时扫描你本机的 Codex skills：

```text
CODEX_HOME/skills
~/.codex/skills
```

如果你后续新增、删除或修改了 skill，可以回到应用点击 Skill 旁边的刷新按钮，或者重新聚焦窗口，列表会重新读取。

## Git 配置

Viewcodex 不会猜测你的 GitHub 仓库地址。

它只会从本地 Git 配置读取：

```bash
git remote get-url origin
```

如果你还没有创建远程仓库，Origin URL 会保持为空。你可以之后手动填写，或者先在项目里配置 remote。

Git 配置支持：

- 自动检测仓库目录
- 显示 Origin URL
- 沿用当前分支
- 启动前创建任务分支
- 任务完成后自动提交 Git

## Team 模式

Team 模式提供三个角色：

- Planner：负责拆解任务和输出执行方案
- Executor：负责按方案实现和验证
- Reviewer：负责检查问题、风险和遗漏

点击左侧角色即可切换到对应的 Codex 终端。

## 会话交接

当一个 Codex 会话结束时，Viewcodex 会在项目内生成临时交接记录。

这份记录不是项目规范，只用于下一次快速恢复上下文。下一次启动 Codex 时，Viewcodex 会把交接文档路径提供给 Codex，并在启动时删除原文件。

## 本地打包

项目使用 `electron-builder` 打包。

先安装依赖并确认构建通过：

```bash
npm install
npm run build
```

生成当前平台安装包：

```bash
npm run dist
```

只生成未压缩的应用目录，适合本地快速检查：

```bash
npm run dist:dir
```

macOS 打包：

```bash
npm run dist:mac
```

打包产物会输出到 `release/`，该目录不会提交到 Git。

注意：Viewcodex 依赖本机 Codex CLI。打包后的 App 如果检测不到 `codex`，请在配置页填写 Codex CLI 的完整路径，例如 `/opt/homebrew/bin/codex`。

## 常用命令

开发启动：

```bash
npm run dev
```

类型检查：

```bash
npm run typecheck
```

运行测试：

```bash
npm test
```

构建检查：

```bash
npm run build
```

## 许可证

MIT
