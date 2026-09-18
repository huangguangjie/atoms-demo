#!/usr/bin/env python3
"""通过 Supabase Management API 把 AI 网关密钥写入 Edge Function Secrets。

密钥来源:环境变量 APP_AI_KEY / APP_AI_BASE_URL(平台注入);
Supabase 凭据:/tmp/supabase_env(SUPABASE_URL / SUPABASE_ACCESS_TOKEN)。
"""
import json
import os
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
    env = load_env()
    ref = env["SUPABASE_URL"].replace("https://", "").split(".")[0]
    token = env["SUPABASE_ACCESS_TOKEN"]

    secrets = [
        {"name": "APP_AI_KEY", "value": os.environ["APP_AI_KEY"]},
        {"name": "APP_AI_BASE_URL", "value": os.environ["APP_AI_BASE_URL"]},
    ]
    api_url = f"https://api.supabase.com/v1/projects/{ref}/secrets"
    req = urllib.request.Request(
        api_url,
        data=json.dumps(secrets).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"HTTP {resp.status}: secrets 已写入 {ref}")
    except urllib.error.HTTPError as exc:
        print(f"HTTP {exc.code}")
        print(exc.read().decode()[:2000])
        sys.exit(1)


if __name__ == "__main__":
    main()
