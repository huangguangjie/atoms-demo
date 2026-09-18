#!/usr/bin/env python3
"""atoms-demo 端到端验证脚本:登录、资料/空间、克隆/模板落库、收藏切换、RLS 隔离。

用法:python3 e2e_verify.py <测试邮箱>
密钥来源:/workspace/app/frontend/.env.local(VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)。
"""
import json
import sys
import time
import urllib.error
import urllib.request

ENV_PATH = "/workspace/app/frontend/.env.local"
PASSWORD = "AtomsDemo2026!"
APP_HTML = "<!doctype html><html><body><h1>Simple Calculator</h1><p>cloned app</p></body></html>"

env = {}
with open(ENV_PATH, encoding="utf-8") as f:
    for line in f:
        if "=" in line:
            k, v = line.strip().split("=", 1)
            env[k] = v

BASE = env["VITE_SUPABASE_URL"].rstrip("/")
ANON = env["VITE_SUPABASE_ANON_KEY"]


def req(method: str, path: str, token: str | None = None, body: dict | None = None,
        prefer_repr: bool = False, timeout: int = 30):
    headers = {"apikey": ANON, "Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if prefer_repr:
        headers["Prefer"] = "return=representation"
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode()[:300]
        print(f"   [HTTP {exc.code}] {method} {path.split('?')[0]} -> {detail}")
        return None


def login(email: str, password: str) -> dict:
    return req("POST", "/auth/v1/token?grant_type=password", body={"email": email, "password": password})


def main() -> None:
    email_a = sys.argv[1]
    # 1) 用户 A 登录
    login_a = login(email_a, PASSWORD)
    token_a = login_a["access_token"]
    uid_a = login_a["user"]["id"]
    print(f"1) 用户 A 登录成功: {email_a} uid={uid_a}")

    # 2) 资料(已存在则跳过)+ 默认空间(无则创建)
    profile = req("GET", f"/rest/v1/profiles?id=eq.{uid_a}&select=id", token_a)
    if not profile:
        req("POST", "/rest/v1/profiles", token_a,
            {"id": uid_a, "display_name": email_a.split("@")[0], "email": email_a,
             "avatar_color": "bg-violet-500"}, prefer_repr=True)
        print("2) 资料:已创建")
    else:
        print("2) 资料:已存在,跳过")
    spaces = req("GET", f"/rest/v1/spaces?owner_id=eq.{uid_a}&select=id,name,is_default", token_a)
    if not spaces:
        spaces = req("POST", "/rest/v1/spaces", token_a,
                     {"owner_id": uid_a, "name": f"{email_a.split('@')[0]} 的 Atoms", "is_default": True},
                     prefer_repr=True)
        print(f"   默认空间:已创建 {[(s['name'], s['is_default']) for s in (spaces or [])]}")
    else:
        print(f"   默认空间:已存在 {[(s['name'], s['is_default']) for s in spaces]}")

    # 3) 克隆社区应用 -> source=cloned,含 app_html
    cloned = req("POST", "/rest/v1/projects", token_a, {
        "user_id": uid_a, "space_id": None, "name": "Simple Calculator 克隆",
        "description": "从社区克隆的应用(原作者:Leo)", "source": "cloned", "favorite": False,
        "cover_gradient": "from-slate-600 to-slate-400", "cover_emoji": "🧮", "views": 0,
        "app_html": APP_HTML}, prefer_repr=True)
    pid = cloned[0]["id"] if cloned else ""
    print(f"3) 克隆项目落库: id={pid} source={cloned[0]['source']} app_html 长度={len(cloned[0].get('app_html') or '')}")

    # 4) 使用模板 -> source=template
    tpl = req("POST", "/rest/v1/projects", token_a, {
        "user_id": uid_a, "space_id": None, "name": "Landing Page Kit 实例",
        "description": "基于模板 Landing Page Kit 创建", "source": "template", "favorite": False,
        "cover_gradient": "from-blue-500 to-cyan-400", "cover_emoji": "🚀", "views": 0},
        prefer_repr=True)
    print(f"4) 模板项目落库: {[(p['name'], p['source']) for p in (tpl or [])]}")

    # 5) 收藏切换
    fav = req("PATCH", f"/rest/v1/projects?id=eq.{pid}", token_a, {"favorite": True}, prefer_repr=True)
    print(f"5) 收藏切换: {[(p['name'], p['favorite']) for p in (fav or [])]}")

    # 6) 项目列表
    rows = req("GET", "/rest/v1/projects?select=id,name,source,favorite&order=updated_at.desc", token_a)
    print(f"6) 用户 A 项目列表: {[(r['name'], r['source'], r['favorite']) for r in rows]}")

    # 7) RLS 隔离:用户 B 注册后读取项目应为空
    email_b = f"e2eb{int(time.time())}@atoms.test"
    signup_b = req("POST", "/auth/v1/signup", body={"email": email_b, "password": PASSWORD})
    token_b = signup_b["access_token"]
    rows_b = req("GET", "/rest/v1/projects?select=id,name", token_b)
    print(f"7) 用户 B({email_b}) 读项目: {rows_b} {'OK RLS 隔离生效' if rows_b == [] else '异常'}")

    # 8) 用户 B 试图修改用户 A 的项目,RLS 下应返回空数组
    patch_b = req("PATCH", f"/rest/v1/projects?id=eq.{pid}", token_b, {"favorite": True}, prefer_repr=True)
    print(f"8) 用户 B 越权修改结果: {patch_b} {'OK 已被 RLS 拦截' if patch_b == [] else '异常'}")


if __name__ == "__main__":
    main()
