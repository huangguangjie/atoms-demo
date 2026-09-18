#!/usr/bin/env python3
"""端到端验证 app_atoms_agent_generate:注册真实用户拿 JWT,SSE 流式调用 AI 生成,断言事件契约与 HTML 产出。

用法:python3 test_agent_e2e.py
密钥来源:/workspace/app/frontend/.env.local(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)。
"""
import json
import time
import urllib.error
import urllib.request

ENV_PATH = "/workspace/app/frontend/.env.local"
PASSWORD = "AtomsDemo2026!"
PROMPT = "做一个极简待办清单:输入待办、回车添加、点击切换完成、带计数,中文界面。"


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


def main() -> None:
    env = load_env(ENV_PATH)
    base = env["VITE_SUPABASE_URL"].rstrip("/")
    anon = env["VITE_SUPABASE_ANON_KEY"]

    # 1) 注册(mailer_autoconfirm 开启,响应直接带会话)
    email = f"agent-{int(time.time())}@atoms.test"
    body = json.dumps({"email": email, "password": PASSWORD}).encode()
    req = urllib.request.Request(
        f"{base}/auth/v1/signup",
        data=body,
        headers={"apikey": anon, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        signup = json.loads(resp.read().decode())
    token = signup.get("access_token")
    if not token:
        raise SystemExit(f"signup 未返回会话: {str(signup)[:300]}")
    print(f"[1/2] 注册成功: {email}")

    # 2) 登录态 SSE 调用 AI 生成(与前端 runAgent 契约一致:prompt/theme/mode)
    url = f"{base}/functions/v1/app_atoms_agent_generate"
    body = json.dumps({"prompt": PROMPT, "theme": "默认", "mode": "goal"}).encode()
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "apikey": anon,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    counts: dict[str, int] = {}
    html_len = 0
    error_message = None
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=280) as resp:
            print(f"[2/2] Edge Function HTTP {resp.status},开始接收 SSE 流...")
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if not payload or payload == "[DONE]":
                    continue
                try:
                    event = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                etype = event.get("type")
                counts[etype] = counts.get(etype, 0) + 1
                if etype == "app":
                    files = (event.get("app") or {}).get("files") or [{}]
                    html_len = len(files[0].get("content", ""))
                if etype == "error":
                    error_message = event.get("message")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Edge Function HTTP {exc.code}: {exc.read().decode()[:300]}")

    elapsed = time.time() - start
    print(f"耗时 {elapsed:.1f}s,事件统计: {counts},HTML 长度: {html_len}")
    if error_message:
        raise SystemExit(f"流内返回错误事件: {error_message}")
    assert counts.get("message", 0) >= 1, "缺少 message 事件"
    assert counts.get("plan", 0) == 1, "缺少 plan 事件"
    assert counts.get("app", 0) == 1, "缺少 app 事件"
    assert html_len > 1000, f"应用 HTML 过短: {html_len}"
    print("E2E PASS: 登录态 AI 生成链路完整(message/plan/app 事件齐全,HTML 有效)")


if __name__ == "__main__":
    main()
