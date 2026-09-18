#!/usr/bin/env python3
"""通过 Supabase Management API 执行 SQL 脚本(建表/RLS/种子数据)。

用法:python3 run_sql.py <sql 文件路径>
密钥来源:/tmp/supabase_env(平台注入的用户提供的 SUPABASE_URL / SUPABASE_ACCESS_TOKEN)
"""
import json
import sys
import urllib.error
import urllib.request

ENV_FILE = "/tmp/supabase_env"


def load_env() -> dict:
    env = {}
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line:
                key, value = line.split("=", 1)
                env[key] = value
    return env


def main() -> None:
    sql_path = sys.argv[1]
    env = load_env()
    url = env["SUPABASE_URL"].rstrip("/")
    ref = url.replace("https://", "").split(".")[0]
    token = env["SUPABASE_ACCESS_TOKEN"]

    with open(sql_path, "r", encoding="utf-8") as f:
        sql = f.read()

    api_url = f"https://api.supabase.com/v1/projects/{ref}/database/query"
    payload = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        api_url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            print(f"HTTP {resp.status}")
            print(body[:2000] if body else "(empty result)")
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code}")
        print(exc.read().decode("utf-8")[:4000])
        sys.exit(1)


if __name__ == "__main__":
    main()
