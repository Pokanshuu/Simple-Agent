"""Seed one conversation that exercises the Markdown renderer end to end.

Used to verify the code-fence/gutter/table/alert/todo/tool-card paths visually.
Intentionally inserted straight into SQLite so the app's own parsing of
`attachments`/`steps` JSON is exercised too.
"""

import json
import os
import sqlite3
import time
import uuid

DB = os.path.join(
    os.environ["APPDATA"], "com.simpleagent.desktop", "simple-agent.db"
)

SYSTEM_PROMPT = """\
You are Simple Agent, a careful coding agent running as a desktop app on Windows.

# Environment
- Workspace root: D:\\Codes\\Simple-Agent
- Today: 2026-11-03
- All file paths are resolved **inside the workspace root**. Paths that escape it are rejected.

# How to work
1. **Investigate before acting.** Use `glob` and `grep` to locate code, then `read_file` to confirm the exact bytes. Never rewrite a file you have not read.
2. **Prefer `edit_file`** with a minimal, unique `old_string` over `write_file` for existing files. Overwriting is a last resort.
3. **Verify.** When a cheap check exists (a build, a test, a linter), run it with `run_shell` and report the result honestly.
4. **Plan long jobs.** For anything needing more than two or three tool calls, call `todo_write` first and keep exactly one item `in_progress`.
5. **Stay inside the request.** Do not refactor unrelated code, do not add features nobody asked for, do not delete files unless told to.
6. **Report concisely.** Lead with what you changed and why. Reference files as `path:line`. Do not paste whole files back.

# Available tools
- read_file
- write_file
- edit_file
- list_dir
- glob
- grep
- run_shell
- fetch_url
- todo_write
"""

CONTENT = f"""以下是我收到的系统提示词（原文）：

```text
{SYSTEM_PROMPT}```

## 一个表格

| 工具 | 需要审批 | 说明 |
|---|---|---|
| `read_file` | 否 | 行号输出，分页读取 |
| `write_file` | **是** | 覆盖写，会创建父目录 |
| `run_shell` | **是** | Windows 走 `cmd /D /S /C`，超时即杀 |

### 任务清单

- [x] 移植渲染引擎（HTML 折算 → 软换行 → 切块 → 增量高亮）
- [ ] 移植附件（图片 / 文本 / docx）
- [ ] 补文档

> [!NOTE]
> 这是一条提示块，应该有左侧强调条与标签，且不应被拆成多段。

> [!WARNING]
> 第二条提示块，颜色不同。

行内代码 `normalizeSoftBreaks`，链接 [架构说明](https://example.com)。

这是一行
这是下一行（应该被合并成同一段，因为上一行没有句末标点）
但是这一行，结尾是逗号，
所以它是同一段的续行。

---

最后一段：`code`、**粗体**、*斜体*、~~删除线~~ 混排。
"""


def main() -> None:
    conn = sqlite3.connect(DB)
    now = int(time.time() * 1000)

    # Keep the database tidy: this is a throwaway conversation.
    existing = conn.execute(
        "SELECT id FROM conversations WHERE title = ?", ("渲染测试",)
    ).fetchone()
    if existing:
        conn.execute("DELETE FROM conversations WHERE id = ?", (existing[0],))

    cid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO conversations (id, title, mode, provider, model, system_prompt,"
        " workspace, created_at, updated_at, pinned, pinned_at)"
        " VALUES (?,?,?,?,?,?,?,?,?,0,NULL)",
        (cid, "渲染测试", "AGENT", "DEEPSEEK", "deepseek-flash", None, None, now, now),
    )

    uid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO messages (id, conversation_id, parent_id, variant_index, active, role,"
        " content, attachments, reasoning, steps, status, error_message, model, created_at)"
        " VALUES (?,?,?,0,1,'user',?,NULL,NULL,NULL,'DONE',NULL,NULL,?)",
        (uid, cid, "", "把系统提示词原文发我，并演示一下渲染", now),
    )

    steps = [
        {
            "index": 0,
            "content": "先读一下配置文件确认版本。",
            "reasoning": "用户要的是原文展示，但这正好可以演示工具卡片：读一个文件、再改一个文件。",
            "toolCalls": [
                {
                    "id": "call_1",
                    "name": "read_file",
                    "args": json.dumps({"path": "package.json"}, ensure_ascii=False),
                    "status": "done",
                    "result": {
                        "content": '     1| {\n     2|   "name": "simple-agent"\n     3|   "version": "0.1.0"\n     4| }',
                        "isError": False,
                        "durationMs": 4,
                    },
                },
                {
                    "id": "call_2",
                    "name": "grep",
                    "args": json.dumps({"pattern": "white-space", "include": "*.css"}, ensure_ascii=False),
                    "status": "done",
                    "result": {
                        "content": "src/styles/markdown.css:120:   white-space: pre;",
                        "isError": False,
                        "durationMs": 12,
                    },
                },
            ],
        }
    ]

    aid = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO messages (id, conversation_id, parent_id, variant_index, active, role,"
        " content, attachments, reasoning, steps, status, error_message, model, thinking_ms,"
        " ttft_ms, tps, tokens_in, tokens_out, created_at)"
        " VALUES (?,?,?,0,1,'assistant',?,NULL,?,?,'DONE',NULL,'deepseek-flash',3200,900,21.5,120,340,?)",
        (
            aid,
            cid,
            uid,
            CONTENT,
            "先把结构讲清楚：代码块、表格、清单、提示块各自要能独立渲染。",
            json.dumps(steps, ensure_ascii=False),
            now + 1000,
        ),
    )

    conn.commit()
    print("seeded conversation", cid)


if __name__ == "__main__":
    main()
