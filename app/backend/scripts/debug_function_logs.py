#!/usr/bin/env python3
"""查询 edge_logs 最近日志,定位「生成中断」的真实原因。

用法:python3 debug_function_logs.py [minutes]
密钥来源:/tmp/supabase_env(SUPABASE_URL / SUPABASE_ACCESS_TOKEN)。
"""
import json
import sys
import time
import urllib.parse
import urllib.request

ENV_FILE = "/tmp/supabase_env"


def load_env() -> dict:
    env = {}
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line:
                key, value = line.split("=", 1)
                env[key] = value
    return env


def main() -> None:
    minutes = int(sys.argv[1]) if len(sys.argv) > 1 else 60
    env = load_env()
    ref = env["SUPABASE_URL"].replace("https://", "").split(".")[0]
    token = env["SUPABASE_ACCESS_TOKEN"]
    # 不按 host 过滤(Log Explorer 字段名可能不同),拉全量后本地过滤 agent_generate
    sql = (
        "select timestamp, event_message from edge_logs "
        "where timestamp > now() - interval '%d minutes' "
        "order by timestamp desc limit 300" % minutes
    )
    url = "https://api.supabase.com/v1/projects/%s/analytics/endpoints/logs.all?sql=%s" % (
        ref,
        urllib.parse.quote(sql),
    )
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read().decode())
    rows = data.get("result", [])
    print(f"共 {len(rows)} 条日志")
    hit = 0
    for row in rows:
        msg = row["event_message"]
        if "app_atoms_agent_generate" in msg or "agent_generate" in msg:
            hit += 1
            ts = time.strftime("%H:%M:%S", time.gmtime(row["timestamp"] / 1_000_000))
            print(f"[{ts}] {msg[:500]}")
            print("-" * 60)
    if hit == 0:
        # 退而打印全部前 40 条,便于诊断字段结构
        for row in rows[:40]:
            ts = time.strftime("%H:%M:%S", time.gmtime(row["timestamp"] / 1_000_000))
            print(f"[{ts}] {row['event_message'][:300]}")


if __name__ == "__main__":
    main()
