# 实现说明

## 分层

| Simple Chat (Kotlin) | 本项目 |
|---|---|
| `db/Entities.kt` | `src-tauri/src/db.rs`（同表同列，新增 `steps`） |
| `db/MessageTree.kt` | `src/core/messageTree.ts` |
| `net/SseLineParser.kt` | `src/core/sseParser.ts` |
| `net/SseClient.kt` | `src-tauri/src/net.rs`（传输）+ `src/api/chat.ts`（装配） |
| `net/ChatApi.kt` | `src/core/chatRequest.ts` |
| `net/Provider.kt` | `src/core/provider.ts` |
| `data/TokenEstimate.kt` | `src/core/tokenEstimate.ts` |
| `ui/markdown/*` | `src/core/markdown/*` + `src/components/markdown/*` |
| `ui/chat/ChatViewModel.kt` | `src/state/chat.ts` |
| `data/SecretBox.kt` | `src-tauri/src/secrets.rs` |

## 渲染管线

```
content
  ↓ normalizeHtml        HTML → Markdown、引用式链接内联、空行折叠
  ↓ normalizeSoftBreaks  裸换行补成段落边界（围栏/表格/续行等七类例外）
  ↓ splitMarkdownBlocks  按空行切块，围栏内不切，同族合并
  ↓ MarkdownBlock        每块一次解析，memo 于 text
  ↓ CodeBlock            增量高亮 + 折叠 + 行号
```

- 顺序不可换：`<br>` 变成的行尾硬换行标记，必须在软换行判断之前存在。
- `MarkdownBlock` 的 props 只有 `text`。样式一旦作为 props 进入，每帧都是新对象，`memo` 失效，分块就没有意义。
- 代码高亮：新代码是旧代码的纯追加时，保留「上一版最后一行之前」的结果，只重算该行之后。

## 出字节奏

数据层按 33ms 合并增量；渲染层另有 `useSmoothReveal`：把可见文本当作缓冲，每 32ms 推进一帧，推进量 = 积压 × 45%，流结束立刻补齐。新字按块做 `blur(6px)` 入场（`rehypeStreamChars` 只作用于尾块，上限 900 字）。

## 消息树

路径 = 从根沿 `active` 走到叶子。重新生成在同一 `parentId` 下追加兄弟；编辑重发追加一个用户消息版本；删除删整棵子树并把 `active` 交还最大 `variantIndex` 的兄弟；分叉把路径前缀复制进新会话。

一个可见的助手节点 = 一次完整回复，内部多轮模型回合存在 `steps` JSON 里；发请求时展开成 `assistant(tool_calls)` + 若干 `tool` 消息。

## 流式与取消

HTTP 全在 Rust：`reqwest` 按行切分后逐行 `emit`，TS 侧只做协议解析（纯函数）。取消用 `oneshot` 协作式中断，drop 响应即断 socket。不设总超时（思考时可能长时间无输出）。

## Agent

```
build(history + 已有工具结果) → 流式 → 有 tool_calls？
     ├─ 否：本轮正文即答案
     └─ 是：逐个 审批 → 执行 → 追加 tool 消息 → 下一轮
```

- 工具全部在 `src-tauri/src/tools.rs`；路径先 lexical 归一化再 `canonicalize`，必须落在工作区内。
- 审批等待是一个 Promise，`stop()` 会把挂起的审批一并置为拒绝，否则循环卡死。
- Agent 会话的模式与工作区在第一条消息后锁定；转录只追加。

## 与上游的差异

预设改为全局启用；未做 PDF 抽文本；数学公式按纯文本；侧栏默认宽度从 140px 放宽到 232px（会话标题需要），可拖 180–340px。
