# 迁移与实现说明

这份文档解释「为什么这样搬」，而不是「代码长什么样」。代码本身带注释，这里只记录**决定**。

---

## 1. 目标与边界

要求是三件事：**保留核心功能**、**保留渲染引擎**、**技术栈迁到 React + Tauri**，并**完善 Agent 功能**。

SimpleChat 明确写着「不包含工具调用」，所以 Agent 不是移植对象，而是新增能力。其余部分按「行为等价」迁移：

| 能力 | 处理方式 |
|---|---|
| 消息树（版本/分支/分叉） | 逐函数移植，含单测 |
| 流式 Markdown 渲染 | 逐段移植，策略不变 |
| 上下文压缩 | 逐逻辑移植（增量滚动压缩） |
| token 估算 / 占用圆环 | 逐函数移植 |
| 参数条件化 | 逐规则移植 |
| 预设 / 思考档位 / 附件 | 保留，作用域略作简化 |
| 工具调用 | 新增 |

---

## 2. 分层映射

| SimpleChat (Kotlin) | 本项目 | 说明 |
|---|---|---|
| `db/Entities.kt` | `src-tauri/src/db.rs` | 同表同列，新增 `messages.steps`、`tool_audit` |
| `db/MessageTree.kt` | `src/core/messageTree.ts` | 纯函数，1:1 |
| `net/SseLineParser.kt` | `src/core/sseParser.ts` | 纯函数，1:1 + `tool_calls` 增量 |
| `net/SseClient.kt` | `src-tauri/src/net.rs` + `src/api/chat.ts` | 拆成「传输」与「协议」两半 |
| `net/ChatApi.kt` | `src/core/chatRequest.ts` | 参数条件化规则 1:1 |
| `net/Provider.kt` | `src/core/provider.ts` | 模型能力表照搬 |
| `data/TokenEstimate.kt` | `src/core/tokenEstimate.ts` | 1:1 |
| `ui/chat/RequestOrdering.kt` | `src/core/requestOrdering.ts` | 1:1 |
| `ui/chat/RequestContent.kt` | `chatRequest.ts` 的 `userContent` | 1:1 |
| `ui/markdown/*` | `src/core/markdown/*` + `src/components/markdown/*` | 五段链路全部保留 |
| `ui/chat/ChatViewModel.kt` | `src/state/chat.ts` | 流式调度 + 树操作 |
| `data/SettingsStore.kt` | `src/state/settings.ts` | 一个 JSON blob，400 ms 防抖 |
| `data/SecretBox.kt` | `src-tauri/src/secrets.rs` | Keystore → 系统凭据管理器 |
| `data/AttachmentImport.kt` / `docx` | `src-tauri/src/commands.rs` / `docx.rs` | 图片 base64、文本、docx |

---

## 3. 渲染引擎

### 3.1 五段链路（原样保留）

```
content
  ↓ normalizeHtml        HTML → Markdown 等价物、引用式链接内联、空行折叠
  ↓ normalizeSoftBreaks  裸换行补成段落边界（七类例外）
  ↓ splitMarkdownBlocks  按空行切块、围栏内不切、同族合并
  ↓ <MarkdownBlock>      每块一次解析，memo 于 text
  ↓ CodeBlock            增量高亮 + 折叠 + 行号 + 复制
```

顺序不能改：`normalizeHtml` 会把 `<br>` 变成硬换行标记（行尾两空格），后面那一步必须**在标记已经存在之后**才能正确判断「这一行是段内换行」。同理，切块规则与软换行规则必须对「围栏、表格、缩进续行」给出一致的答案，否则同一段内容会被撕成两种形状。

### 3.2 「逐块 memo」在 React 里怎么成立

这是整个迁移最关键的等价点。Compose 的 `key(block.key) { }` 换成 React 的 `memo` + 稳定 `key`：

- `MarkdownText` 用 `block.start`（在已 normalize 文本中的偏移）作为 `key`。流式追加时，前面各块的 `start` 不变 → key 不变 → 组件实例不重建。
- `MarkdownBlock` 是 `memo` 组件，props **只有 `text: string`**。颜色、字体、间距、插件全部来自 CSS 变量与模块级常量。

> 这一条是硬约束。样式一旦作为 props 传入，每次渲染都是新对象，`memo` 永远失效，于是每帧都重解析全部块 —— 分块渲染的所有收益归零。原实现里同样的坑写在 `MarkdownBlockView` 的注释里。

解析器换成了 remark/react-markdown（原为 `org.jetbrains:markdown` + mikepenz），但那只是**同一策略的另一种执行**，不是策略本身的改变。

### 3.3 频率控制

数据层 50 ms 合并一次增量，渲染层**按同一节奏采样**（`useSampledWhile`）。这里必须用「常驻定时器 + 读最新值」，不能写成 `useEffect(..., [value])` 起 `setTimeout` —— 那是 debounce，流式期间计时器不断被重置，界面会一直不动直到流结束，比不节流更糟。

### 3.4 增量语法高亮

`IncrementalHighlighter` 持有上一份结果：若新代码是旧代码的**纯追加**，则保留「上一版最后一行之前」的全部高亮，只对该行之后重新分词。

- 最后一行可能被追加内容延长，必须重算；
- 代码以换行结尾时最后一行是空的，等价于「整段稳定」，而这恰好是流式里最常见的时刻；
- 不是纯追加（换版本 / 换语言 / 编辑）→ 整段重算。

highlight.js 输出的是 HTML 字符串，这里把它还原成**带偏移的 span**（`spansFromHtml`），而不是塞 `dangerouslySetInnerHTML`：偏移是增量复用与「折叠时只渲染前 60 行」都需要的东西，而且没有注入面。

### 3.5 折叠与布局稳定

- 超过 20 行的代码块默认收起：**高度裁到 300 px，同时只排版前 60 行**。原实现的经验是：`heightIn(max=…)` 只裁不省，几千行代码为显示十几行仍然要全篇排版，这是代码块最大的一笔开销。
- 流式尾块套 `RetainHeight`：半截语法（`**bold` 补全成 `**bold**`）会导致重排收缩，用「历史最大高度」做 `min-height` 兜住，避免内容抖动。

---

## 4. 消息树

`messages` 仍是树：身份是 `parentId`，兄弟是版本（`variantIndex` + `active`），当前对话 = 从根沿 `active` 走到叶子。

- **重新生成**：在同一个 `parentId` 下追加新助手消息；旧兄弟及其子树保留，只是不再是 `active`。
- **编辑并重发**：追加一个新的**用户消息版本**，再在其下追加助手消息。旧分支整段保留 —— 这正是位置模型做不到的事。
- **删除**：删整棵子树。被删节点若原本是 `active`，把 `active` 交还给 `variantIndex` 最大的剩余兄弟，否则路径会提前断掉。
- **分叉**：把活跃路径到目标消息为止的一段复制进新会话，`parentId` 重挂、`variantIndex` 归零。

实现位置：SQLite 侧只做「读全量 / 增删改 / 切 active」，**路径推导与兄弟计数在 TS 里以纯函数完成**，与原实现一致 —— 这类逻辑一旦错就是「顺序全乱」，必须能单测。

### 新增：`messages.steps`

Agent 一轮回复可能包含多个模型回合。若每个回合都做成树上的节点，版本切换、压缩、导出的语义都会立刻变复杂（工具消息算不算消息？能不能被删？）。

所以：**一个可见的助手节点 = 一次完整回复**，它内部的所有回合存在 `steps` JSON 列里：

```jsonc
[{
  "index": 0,
  "content": "我先找一下相关代码。",
  "reasoning": "…",
  "toolCalls": [{
    "id": "call_1", "name": "grep", "args": "{\"pattern\":\"…\"}",
    "status": "done",
    "result": { "content": "src/a.ts:12: …", "isError": false, "durationMs": 8 }
  }]
}]
```

发请求时把 `steps` **展开**成合法的消息序列（`assistant(tool_calls)` + 每个结果一条 `tool`），这样历史被完整重放，模型不会看到「没有对应调用的工具结果」。见 `messageToOut`。

---

## 5. 流式与取消

WebView 里直接 `fetch` 会因为端点不返回 CORS 头而被拦，收紧 CSP 也不是出路。所以 **HTTP 全在 Rust**：

```
TS: buildChatRequest(...)  →  invoke('chat_stream', {streamId, url, headers, body})
Rust: reqwest POST → 按字节流读取 → 以 '\n' 切分 → 逐行 emit('chat://stream', {kind:'line', line})
TS: parseSseLine(line) → StreamEvent
```

三个决定：

1. **在 Rust 侧按行切，而不是按块转发。** 传输层可能把一个多字节 UTF-8 字符切成两半；行边界一定是字符边界，所以在 Rust 里切行、`from_utf8_lossy` 解码是安全的，协议解析（`data:` 前缀、`[DONE]`、JSON、错误对象）则留在 TS 里，保持纯函数、可单测。
2. **取消是协作式的。** 注册表里存的是 `oneshot::Sender`；取消时发送信号，任务在 `select!` 里立刻中断并 drop 响应，socket 随之关闭。等价于原实现里 `call.cancel()` 的效果 ——「点停止立刻停」。
3. **不设总超时。** 模型思考时可能几十秒不吐一个字节，设了会被误判为断线；只保留连接超时。

数据库落盘同样是**节流**的：流中约每 2 秒 checkpoint 一次，结束时终写一次。每个 token 都回写等于一次回复几千次事务。

---

## 6. Agent

### 6.1 循环

```
for step in 1..maxSteps:
    body = build(history + 已有工具结果, tools)
    流式 → 累积 content / reasoning / tool_calls
    没有 tool_calls → 这一轮的正文就是答案，结束
    有 tool_calls → 逐个 审批 → 执行 → append tool 消息 → 下一轮
```

控制流与副作用分离：`runAgentLoop` 的 `stream` / `approve` / `execute` 都是注入的，所以「停止条件、取消、assistant↔tool 配对」这些真正容易错的部分可以在没有网络、没有窗口、没有文件系统的情况下测。

### 6.2 工具契约

| 工具 | 需要审批 | 备注 |
|---|---|---|
| `read_file` | 否 | 行号输出，分页 |
| `write_file` | **是** | 覆盖写 |
| `edit_file` | **是** | 精确串替换，多处匹配需 `replace_all` |
| `list_dir` | 否 | 深度受限 |
| `glob` | 否 | `**` 跨目录 |
| `grep` | 否 | Rust regex，`path:line: text` |
| `run_shell` | **是** | `cmd /D /S /C` / `sh -lc`，超时即杀 |
| `fetch_url` | **是** | HTML 去标签 |
| `todo_write` | 否 | 只更新 UI 的任务清单 |

所有工具输出都有上限（读 4 MB 截断、输出 30 000 字符截断、walk 40 000 项、grep 400 条）。一个 `cat` 40 MB 日志的模型不该能把上下文窗口和 IPC 负载一起打爆。

### 6.3 沙箱

`resolve_existing` / `resolve_new`：先 lexical 归一化 `.`/`..`，再 `canonicalize`（解开符号链接），最后要求结果以工作区根为前缀。写文件时先建父目录再 canonicalize 父目录 —— 否则 `a/../..` 这类路径会在建目录之后逃逸。

这是**边界检查**，不是权限系统：Agent 仍然以你的用户身份运行。真正的隔离要虚拟机或容器，超出桌面应用的范围。

### 6.4 审批

- `ask`（默认）：写入/命令逐次弹窗，展示**原始参数**；可「本会话总是允许」，按工具名记忆，**不持久化**。
- `auto`：全部放行。
- `never`：写入与命令直接拒绝（模型会收到「用户拒绝了」并改走别的路）。

审批等待是一个 Promise，其 resolver 存在 store 里；`stop()` 会把所有等待中的审批一并置为拒绝，否则循环会卡在一个永远不 resolve 的 Promise 上。

### 6.5 提示词

Agent 的系统提示词用英文：工具调用准确率与指令遵循在英文下更稳；**人设**提示词（创作/扮演）跟随界面语言，因为那是用户读到的语气。

提示词里明确写了环境（工作区根、平台、日期）、工作方法（先查后改、优先 `edit_file`、多步任务用 `todo_write`）与输出风格（先给结论、路径写成 `path:line`）。

---

## 7. 数据

`schema` 与原 Room 库同构（v1，`PRAGMA user_version=1`），新增：

- `messages.steps`：上面说的回合 JSON。
- `messages.attachments`：仍为 JSON 文本。
- `tool_audit`：工具调用流水（工具名、参数、是否成功、耗时），用于事后审计，不参与渲染。
- `settings`：键值表，实际只用一个 `app` 键存设置 JSON。

显式迁移、不用 `fallbackToDestructiveMigration` 的立场照旧：库坏了就先修库，不能悄悄清空用户的会话。

---

## 8. 刻意不做 / 简化

| 项 | 原因 |
|---|---|
| PDF 抽正文 | 需要额外 crate，收益低于 docx；选中 PDF 会得到明确的错误提示 |
| 预设按会话挂载 | 改为全局启用 + 会话级补充提示词，操作更少；数据模型保留了 `conversation_presets` 表 |
| 数学公式 | 与原项目一致，按纯文本显示 |
| 会话级「后台并行生成」 | Android 的 TODO 项；桌面端单窗口，价值不明显 |
| 路由 / 代码分割 | 桌面应用一次加载，200 kB gzip 的 Markdown 链路不值得拆 |
| Electron 式多进程隔离 | Tauri 本身就是「Rust 后端 + 系统 WebView」，能力收敛在命令面 |

---

## 9. 后续可以做的

1. **工具集扩展**：`apply_patch`（结构化 diff）、`web_search`、MCP 客户端。
2. **审批细化到参数**：现在按工具名记忆「总是允许」；更稳的做法是按「工具 + 路径前缀」。
3. **会话级并行**：Rust 侧已经支持多路 stream（注册表按 id 隔离），前端只需要改成按会话持有。
4. **打包体积**：`remark` 换 `markdown-it` 可省一半，但会失去 React 元素级的组件接管，需要重新实现代码块/表格。
