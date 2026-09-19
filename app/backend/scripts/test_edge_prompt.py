#!/usr/bin/env python3
"""直接调用 AI Edge Function(浏览器回归同款提示词与请求头),定位浏览器侧 500(临时,不入库)。

浏览器 agent.ts 仅带 Authorization(不带 apikey);脚本先完全复刻浏览器请求,
若被网关拒绝再补 apikey 对比,输出两种结果。
"""
import json
import time
import urllib.error
import urllib.request

ENV_PATH = "/workspace/app/frontend/.env.local"
EMAIL = f"edge-probe-{int(time.time())}@atoms.test"
PASSWORD = "AtomsDemo2026!"
PROMPT = "做一个极简白噪音混音器,雨声/海浪/风声三轨切换,浅色主题,中文界面"


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


def stream_call(url: str, body: bytes, headers: dict) -> tuple[int, dict, int, str | None]:
    counts: dict[str, int] = {}
    html_len = 0
    error_message = None
    start = time.time()
    try:
        req = urllib.request.Request(url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(req, timeout=280) as resp:
            status = resp.status
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
        return exc.code, {}, 0, f"HTTP {exc.code}: {exc.read().decode()[:400]}"
    return status, counts, html_len, error_message


def main() -> None:
    env = load_env(ENV_PATH)
    base = env["VITE_SUPABASE_URL"].rstrip("/")
    anon = env["VITE_SUPABASE_ANON_KEY"]

    # 新邮箱需先注册再登录(mailer_autoconfirm 开启,注册即激活)
    signup_body = json.dumps({"email": EMAIL, "password": PASSWORD}).encode()
    signup_req = urllib.request.Request(
        f"{base}/auth/v1/signup",
        data=signup_body,
        headers={"apikey": anon, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(signup_req, timeout=20) as resp:
            print(f"注册 HTTP {resp.status}")
    except urllib.error.HTTPError as exc:
        print(f"注册 HTTP {exc.code}(可能已存在,继续登录)")

    body = json.dumps({"email": EMAIL, "password": PASSWORD}).encode()
    req = urllib.request.Request(
        f"{base}/auth/v1/token?grant_type=password",
        data=body,
        headers={"apikey": anon, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        token = json.loads(resp.read().decode())["access_token"]
    print("登录成功,开始调用 Edge Function(复刻浏览器请求头:仅 Authorization)...")

    url = f"{base}/functions/v1/app_atoms_agent_generate"
    payload = json.dumps({"prompt": PROMPT, "theme": "默认", "mode": "goal"}).encode()

    headers_no_apikey = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    status, counts, html_len, err = stream_call(url, payload, headers_no_apikey)
    print(f"[无 apikey] HTTP {status},事件: {counts},HTML: {html_len},错误: {err}")

    if status != 200:
        print("补 apikey 复测(对照 test_agent_e2e.py 的请求头)...")
        headers_with_apikey = {"apikey": anon, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        status2, counts2, html_len2, err2 = stream_call(url, payload, headers_with_apikey)
        print(f"[带 apikey] HTTP {status2},事件: {counts2},HTML: {html_len2},错误: {err2}")


if __name__ == "__main__":
    main()
