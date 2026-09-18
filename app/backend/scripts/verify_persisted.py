#!/usr/bin/env python3
"""核验浏览器 UI 回归产生的数据已真实落库(临时脚本,不入库)。

登录 browser-1789734428@atoms.test,查询最近对话/消息/项目,输出概要。
密钥来源:/workspace/app/frontend/.env.local
"""
import json
import urllib.request

ENV_PATH = "/workspace/app/frontend/.env.local"
EMAIL = "browser-1789734428@atoms.test"
PASSWORD = "AtomsDemo2026!"


def load_env(path: str) -> dict:
    env = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key] = value
    return env


def rest(method: str, path: str, token: str, anon: str, base: str) -> list | dict:
    req = urllib.request.Request(
        f"{base}{path}",
        headers={"apikey": anon, "Authorization": f"Bearer {token}"},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode())


def main() -> None:
    env = load_env(ENV_PATH)
    base = env["VITE_SUPABASE_URL"].rstrip("/")
    anon = env["VITE_SUPABASE_ANON_KEY"]

    body = json.dumps({"email": EMAIL, "password": PASSWORD}).encode()
    req = urllib.request.Request(
        f"{base}/auth/v1/token?grant_type=password",
        data=body,
        headers={"apikey": anon, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        session = json.loads(resp.read().decode())
    token = session["access_token"]
    uid = session["user"]["id"]
    print(f"登录成功 uid={uid}")

    convs = rest(
        "GET",
        f"/rest/v1/conversations?user_id=eq.{uid}&select=id,title,created_at&order=created_at.desc&limit=3",
        token, anon, base,
    )
    print(f"最近对话 {len(convs)} 条:")
    for c in convs:
        print(f"  - {c['id']} | {c['title']} | {c['created_at']}")

    if convs:
        cid = convs[0]["id"]
        msgs = rest(
            "GET",
            f"/rest/v1/messages?conversation_id=eq.{cid}&select=role,content,created_at&order=created_at.asc",
            token, anon, base,
        )
        print(f"最新对话 {cid} 消息 {len(msgs)} 条:")
        for m in msgs:
            print(f"  [{m['role']}] {m['content'][:60]!r}")

    projects = rest(
        "GET",
        f"/rest/v1/projects?user_id=eq.{uid}&select=id,name,source,created_at&order=created_at.desc&limit=3",
        token, anon, base,
    )
    print(f"最近项目 {len(projects)} 条:")
    for p in projects:
        print(f"  - {p['name']} | source={p['source']} | {p['created_at']}")


if __name__ == "__main__":
    main()
