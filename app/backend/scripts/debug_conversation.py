#!/usr/bin/env python3
"""复现「创建对话失败」:登录态/匿名态/越权插入 conversations 与 messages 的真实报错。

用法:python3 debug_conversation.py
密钥来源:/workspace/app/frontend/.env.local(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)。
"""
import json
import time
import urllib.error
import urllib.request

ENV_PATH = "/workspace/app/frontend/.env.local"
PASSWORD = "AtomsDemo2026!"

env = {}
with open(ENV_PATH, encoding="utf-8") as f:
    for line in f:
        if "=" in line:
            k, v = line.strip().split("=", 1)
            env[k] = v

BASE = env["VITE_SUPABASE_URL"].rstrip("/")
ANON = env["VITE_SUPABASE_ANON_KEY"]


def req(method, path, token=None, body=None, prefer_repr=False):
    headers = {"apikey": ANON, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer_repr:
        headers["Prefer"] = "return=representation"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:400]


def main() -> None:
    email = f"dbg{int(time.time())}@atoms.test"

    # 1) 注册(autoconfirm 时直接返回会话)
    status, signup = req("POST", "/auth/v1/signup", body={"email": email, "password": PASSWORD})
    is_dict = isinstance(signup, dict)
    token = signup.get("access_token") if is_dict else None
    uid = (signup.get("user") or {}).get("id") if is_dict else None
    print(f"1) signup HTTP {status}: uid={uid} 有会话={bool(token)}")
    if not token:
        print(f"   signup 响应体: {str(signup)[:500]}")

    # 2) 登录态插入 conversations(模拟前端 .select().single() 的 return=representation)
    status, row = req("POST", "/rest/v1/conversations", token,
                      {"user_id": uid, "space_id": None, "title": "调试对话"}, prefer_repr=True)
    print(f"2) 登录态插入 conversations HTTP {status}: {str(row)[:200]}")
    conv_id = row[0]["id"] if isinstance(row, list) and row else None

    # 3) 登录态插入 messages(验证触发器联动 bump_conversation_updated)
    if conv_id:
        status, mrow = req("POST", "/rest/v1/messages", token,
                           {"conversation_id": conv_id, "role": "user", "content": "你好"},
                           prefer_repr=True)
        print(f"3) 登录态插入 messages HTTP {status}: {str(mrow)[:200]}")

    # 4) 匿名插入(未登录前端行为:user_id='demo-user',UUID 解析必然失败)
    status, err = req("POST", "/rest/v1/conversations", None,
                      {"user_id": "demo-user", "space_id": None, "title": "匿名"})
    print(f"4) 匿名插入(user_id='demo-user')HTTP {status}: {err}")

    # 5) 登录态读取自己的对话(RLS 过滤)
    if token:
        status, rows = req("GET", f"/rest/v1/conversations?user_id=eq.{uid}&select=id,title", token)
        print(f"5) 登录态读 conversations HTTP {status}: {str(rows)[:200]}")


if __name__ == "__main__":
    main()
