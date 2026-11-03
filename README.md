# Simple Agent

> 把 [Simple Chat](https://github.com/Pokanshuu/Simple-Chat) 从 Android / Jetpack Compose 迁移到 **React + Tauri 2** 的桌面重写版：保留消息树、流式 Markdown 渲染引擎与上下文管理，并在此基础上补齐**真正的 Agent 能力**（工具调用、工作区沙箱、审批、任务清单）。

[![CI](https://github.com/Pokanshuu/Simple-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokanshuu/Simple-Agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)](https://tauri.app)

**中文** | [架构说明](docs/ARCHITECTURE.md)

## 它是什么

一个本地优先的桌面 AI 客户端，接入任意 OpenAI 兼容端点。两种用法：

- **对话**：创作 / 扮演模式，长文本续写、多分支改动、上下文压缩。
- **Agent**：给模型一个工作区目录，它可以读代码、改文件、跑命令，每次落笔都走审批。

数据全在本机：SQLite 存会话与消息树，API Key 进系统凭据管理器（Windows Credential Manager），没有任何账号体系与云同步。

## 特性

### 从 SimpleChat 保留的核心

- **消息树**：以 `parentId` 组织。重新生成 = 挂一个新兄弟，切换版本时下游整段跟随，**旧分支连同子树原样保留**。
  「编辑并重发」同样只新增一个用户消息版本，不删任何历史。
- **流式 Markdown 渲染引擎**（移植，见下文）：`HTML→Markdown 折算` → `软换行补段` → `按块切分` → `逐块解析 + memo` → `增量语法高亮`。
- **思考区**：`reasoning_content` 折叠展示，只计真实思考时长；正文开始即收起（可关）。
- **上下文管理**：CJK 加权 token 估算、输入栏占用圆环、**增量滚动压缩**（保留最近 N 条完整消息，只改变发给 API 的内容，绝不删本地消息）。
- **多服务端**：DeepSeek / OpenCode Go / 自定义，含模型能力表（上下文窗口、识图、思考）。
- **参数条件化**：思考开启时不发 `temperature`、非思考时不发 `top_p`、模型不支持思考则完全不带 `thinking`。
- **附件**：图片（base64 data URL）、纯文本、`.docx`（OOXML 抽正文）。
- **全文搜索**：标题与正文，SQLite 侧匹配 + 命中片段高亮。
- **备份**：JSON 导出/导入（同 id 跳过，重复导入不产生副本）、Chatbox 备份导入。
- **多语言**：中英双语，排版按语种分档（中文两端对齐、西文左对齐）。
- **外观**：深/浅色/跟随系统、字号倍率、密度、快捷键可配。
- **粘贴图片**：输入框里直接 Ctrl+V 截图，自动变成附件（12 MB 上限）。

### 设计语言

界面按「寂静工作台」规范实现：只用暖灰白，颜色只属于内容；控件零描边（输入只留一条底线）；圆角只有 4 / 6 / 8 三档；内容面零阴影，浮层只有一档阴影；标题用衬线，正文 15px；非必要说明一律不写。详细规则见 [设计说明](#设计说明) 与 `src/styles/base.css` 里的注释。

侧栏默认 232px（规范给的 140px 是创作类导航的尺度，会话标题放不下），右边缘 6px 可拖 180–340px，双击复位。

### 新增的 Agent 能力

- **工具集**（9 个，全部执行在 Rust 侧）：`read_file` `write_file` `edit_file` `list_dir` `glob` `grep` `run_shell` `fetch_url` `todo_write`。
- **工作区沙箱**：所有路径经 canonicalize 后必须落在工作区根目录内，`..` / 符号链接逃逸一律拒绝。
- **审批**：写入与命令默认逐次询问，可选「本会话总是允许」/「自动执行」/「只读（全拒绝）」。
- **多步循环**：步数上限可配；每步的正文、思考、工具调用与结果都留在消息里，可回看、可审计（`tool_audit` 表）。
- **不可重放**：Agent 回合可能已经改过文件或执行过命令，所以**不提供重新生成**（UI 里隐藏，store 里也拦）。种子化内容见下。
- **工具卡片**：参数与返回原样展示 —— 出错时你看到的是模型真正提交的东西。
- **任务清单**：模型通过 `todo_write` 维护计划，界面实时显示进度。
- **可中断**：停止按钮立刻断开 socket（Rust 侧协作式取消），不留悬挂流。

## 快速开始

环境要求：Node 20+、pnpm、Rust 1.82+（MSVC 工具链）、Windows 10/11 或 macOS。Windows 需要 WebView2（Win11 自带）。

```bash
pnpm install
pnpm app:dev          # 开发模式（Vite + Tauri 窗口）
pnpm build            # 只构建前端
pnpm test             # 单元测试（vitest）
pnpm app:build        # 打包安装程序（NSIS / MSI）
```

首次使用：

1. 打开「设置 → API」，选服务商、填 Base URL 与模型、粘贴 API Key，点「测试连接」。
2. 要玩 Agent：切到「Agent」模式，在输入栏选一个工作区目录。
3. 发一句话。第一次回复结束后，会话会自动命名。

## 技术选型

| 层 | 选择 | 为什么 |
|---|---|---|
| UI | React 19 + TypeScript 5.9 | 迁移目标栈 |
| 构建 | Vite 7 | 快，且 dev 端口固定（Tauri 需要） |
| 状态 | Zustand 5 | 无 Provider 嵌套，选择器粒度够细 |
| Markdown | react-markdown 10 + remark-gfm | 输出 React 元素而非 HTML 字符串，才能逐块 memo、接管代码块 |
| 高亮 | highlight.js 11（按需注册 23 种语言） | 同步 API，可做增量前缀复用 |
| 图标 | lucide-react | 单一来源，`strokeWidth={2}`，16px |
| 桌面壳 | Tauri 2 + Rust | 需要 HTTP 流、文件系统、进程、SQLite、系统凭据 |
| 存储 | rusqlite（bundled SQLite） | 直接照搬 Room 的表结构，迁移无损耗 |
| 网络 | reqwest（rustls） | 绕过 CORS、可即时取消、SSE 在 Rust 侧按行分发 |
| 密钥 | keyring 4 | 对应 Android Keystore 的桌面等价物 |

## 目录

```text
src/
├─ core/                 # 纯逻辑，无 React
│  ├─ markdown/          # 渲染引擎：htmlNormalize / softBreaks / blockSplitter / highlight
│  ├─ agent/             # tools 定义、系统提示词、循环
│  ├─ chatRequest.ts     # 请求装配与参数条件化
│  ├─ sseParser.ts       # SSE 行解析（纯函数）
│  ├─ messageTree.ts     # 消息树纯函数
│  ├─ requestOrdering.ts # 压缩 + 路径 → 实际发送的消息
│  ├─ tokenEstimate.ts   # CJK 加权估算
│  └─ provider.ts        # 服务商与模型能力表
├─ api/                  # Tauri 命令桥 + 流式传输
├─ state/                # settings / chat 两个 store
├─ components/
│  ├─ markdown/          # MarkdownText / MarkdownBlock / CodeBlock
│  ├─ chat/              # 会话、消息、输入栏、设置、审批
│  └─ ui/                # 图标与基础控件
├─ i18n/                 # 中英词条
├─ core/meta.ts          # 关于页：仓库地址与全部开源许可
└─ styles/               # 设计 token 与 Markdown 版式
src-tauri/src/
├─ db.rs                 # 表结构、迁移、全部 SQL
├─ net.rs                # SSE 代理与取消
├─ tools.rs              # 9 个工具的实现与沙箱
├─ secrets.rs            # 系统凭据管理器
├─ docx.rs               # OOXML 抽正文
├─ commands.rs           # 命令面
└─ models.rs             # 与前端共享的序列化类型
```

## 数据在哪

- 数据库：`%APPDATA%\com.simpleagent.desktop\simple-agent.db`（WAL 模式）。设置页「数据」里能直接看到完整路径并复制。
- API Key：Windows Credential Manager，服务名 `com.simpleagent.desktop`，不落库、不进备份。
- 没有遥测、没有中转：请求从本机直连你配置的端点。
- **提示词里只有文件夹名**：Agent 的工作区路径只在本机用于解析，发给模型的是「Workspace: 测试」这种形式；工具报错信息也不再回显绝对路径。

## 与 SimpleChat 的差异

| 项 | SimpleChat | 本项目 |
|---|---|---|
| 平台 | Android / Compose | 桌面 / React + Tauri |
| 存储 | Room | SQLite（同表结构，`steps` 列为新增） |
| 密钥 | Android Keystore | Windows Credential Manager |
| Markdown 解析 | org.jetbrains:markdown + mikepenz | remark + react-markdown（分块与增量策略一致） |
| 高亮 | snipme（自建增量层） | highlight.js（同样的「最后一行之前全部复用」策略） |
| 工具调用 | 明确不做 | **核心能力** |
| 预设 | 挂在会话上 | 全局启用（简化） |

迁移细节与逐条取舍见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 设计说明

规范来自 OC Studio 的界面设计文档，这里只取能落到这个应用上的部分：

| 项 | 规则 |
|---|---|
| 色彩 | 暖灰三级（paper / paper-alt / paper-card）+ ink 三级 + 三枚状态色；界面不做主题色装饰 |
| 圆角 | 只有 `4 / 6 / 8`（item / control / panel）+ `full`；圆形语义才用 full |
| 描边 | 控件零描边，输入只有一条底线；线只出现在区块之间、表格行、浮层边界 |
| 阴影 | 内容面零阴影；浮层只有一档 `float-shadow` |
| 字体 | 正文 15px / 1.6 / 400；衬线只给页面标题（18px）与区块标题（15px）；其余 13 / 12 / 11 |
| 选中 | 只有两种：页签的 2px 墨色下划线，其余是浅底块 |
| 按钮 | 主按钮浅底实心；次按钮纯文字；危险按钮只给不可逆确认 |
| 文案 | 不写副标题、设置项说明；只有「破坏性后果 / 数据口径 / 隐私 / 未开放」四类允许一句话 |
| 图标 | lucide-react，`strokeWidth={2}`，桌面 16px |

`src/styles/base.css` 顶部是令牌，组件样式全部引用令牌，不写十六进制。

## 已知取舍

- **打包体积**：Markdown 链路（remark + highlight.js）约 200 kB gzip，没有做路由级拆分 —— 桌面端一次加载，不值得拆。
- **PDF 附件**：未做。`.docx` 已支持（zip + `word/document.xml`），PDF 需要额外 crate，收益不高。
- **预设作用域**：全局启用，而 SimpleChat 是每会话挂载。
- **数学公式**：与 SimpleChat 一致，`$$…$$` 按纯文本显示。
- **CSP**：当前为 `null`，因为模型输出只经 react-markdown（默认转义 HTML，`skipHtml`）渲染，没有 `dangerouslySetInnerHTML`。若以后引入 raw HTML，需要同时收紧 CSP。

## 关于页与仓库地址

「设置 → 关于」列出本项目、上游项目与全部随包分发的开源组件及其许可证。仓库地址集中在
`src/core/meta.ts` 的 `REPO_URL` —— 发布前把它改成真实地址即可，其余地方不需要动。

本项目以 MIT 发布（见 [LICENSE](LICENSE)），基于同样以 MIT 发布的
[Simple Chat](https://github.com/Pokanshuu/Simple-Chat)；消息树模型、上下文压缩策略与
Markdown 渲染链路都移植自它。

## 贡献

欢迎 Issue 与 PR，改动请保持聚焦。提交前跑一遍：

```bash
pnpm exec tsc --noEmit && pnpm test
cargo test --lib --manifest-path src-tauri/Cargo.toml
```

CI 还会额外跑 `cargo fmt --check` 与 `cargo clippy`，本地可以先 `cargo fmt` 一遍。

## 致谢

- [Simple Chat](https://github.com/Pokanshuu/Simple-Chat)：消息树、上下文压缩与 Markdown 渲染链路的原型
- 全部第三方组件及其许可证见「设置 → 关于」，条目集中在 `src/core/meta.ts`

## 许可证

MIT。
