# Simple Agent

[Simple Chat](https://github.com/Pokanshuu/Simple-Chat) 的桌面重写。React 19 + Tauri 2，数据全部在本机。

[![CI](https://github.com/Pokanshuu/Simple-Agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokanshuu/Simple-Agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## 功能

**对话**

- 消息树：重新生成、编辑重发只新增兄弟版本，旧分支连同子树保留
- 流式 Markdown：代码高亮、表格、任务清单、提示块
- 思考区：`reasoning_content` 折叠展示，正文开始即收起
- 上下文压缩：只改发给 API 的内容，本地消息一条不删
- 附件：图片、文本、docx；输入框可直接粘图

**Agent**

- 工具：`read_file` `write_file` `edit_file` `list_dir` `glob` `grep` `run_shell` `fetch_url` `todo_write`
- 工作区沙箱：路径越界一律拒绝
- 审批：逐次询问 / 本会话允许 / 只读
- 转录只追加，不提供重生成、编辑重发、删除

**其他**

- 服务商：DeepSeek / OpenCode Go / 任意 OpenAI 兼容端点
- 中英双语、深浅色、字号倍率、密度、发送快捷键
- JSON 备份导出导入、Chatbox 备份导入、标题与正文搜索

## 运行

要求 Node 20+、pnpm、Rust 1.82+（MSVC 工具链）、Windows 需 WebView2。

```bash
pnpm install
pnpm app:dev      # 开发
pnpm app:build    # 打包 NSIS / MSI
```

测试：

```bash
pnpm test
cargo test --lib --manifest-path src-tauri/Cargo.toml
```

## 使用

1. 设置 → API：选服务商，填 Base URL、模型、API Key，点「测试连接」
2. 用 Agent：切到 Agent 模式，选工作区目录

## 结构

```text
src/core/       纯逻辑：markdown 管线、消息树、SSE 解析、token 估算、Agent 循环
src/components/ markdown 渲染、对话、设置
src/state/      settings / chat 两个 store
src-tauri/src/  db、SSE 代理、工具执行、密钥
```

## 数据

- 数据库：`%APPDATA%\com.simpleagent.desktop\simple-agent.db`
- API Key：系统凭据管理器，不落库、不进备份
- 提示词里只有工作区文件夹名，绝对路径不出本机
- 请求从本机直连所配置端点，无中转

## 开发

实现说明见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

渲染引擎的手工验收素材：`scripts/seed_render_test.py` 塞入一个覆盖代码块 / 表格 / 任务清单 / 提示块的会话，`scripts/clean_render_test.py` 删掉它。

## 许可

MIT。基于同样以 MIT 发布的 [Simple Chat](https://github.com/Pokanshuu/Simple-Chat)。

第三方组件与许可证见「设置 → 关于」，条目在 `src/core/meta.ts`。
