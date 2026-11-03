"""Remove the render-test conversation created by seed_render_test.py."""

import json
import os
import sqlite3

DB = os.path.join(os.environ["APPDATA"], "com.simpleagent.desktop", "simple-agent.db")
conn = sqlite3.connect(DB)

deleted = conn.execute(
    "DELETE FROM conversations WHERE title = ?", ("渲染测试",)
).rowcount

row = conn.execute("SELECT value FROM settings WHERE key = 'app'").fetchone()
if row:
    data = json.loads(row[0])
    data.setdefault("ui", {})["lastConversationId"] = None
    conn.execute(
        "UPDATE settings SET value = ? WHERE key = 'app'",
        (json.dumps(data, ensure_ascii=False),),
    )

conn.commit()
print(f"deleted {deleted} conversation(s)")
