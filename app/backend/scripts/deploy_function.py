#!/usr/bin/env python3
"""通过 Supabase Management API 部署 Edge Function(创建或更新代码)。

用法:python3 deploy_function.py <slug> <代码文件路径>
密钥来源:/tmp/supabase_env(SUPABASE_URL / SUPABASE_ACCESS_TOKEN)。
"""
import json
import sys
import urllib.error
import urllib.request

ENV_FILE = "/tmp/supabase_env"
VERIFY_JWT = False  # 前端自行校验会话;函数内部用 service role 验证 JWT


def load_env() -> dict:
    env = {}
    with open(ENV_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if "=" in line:
                key, value = line.split("=", 1)
                env[key] = value
    return env


def api(ref: str, token: str, method: str, path: str, body: dict | None = None) -> tuple[int, str]:
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{ref}{path}",
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode()[:2000]


def main() -> None:
    slug, code_path = sys.argv[1], sys.argv[2]
    env = load_env()
    ref = env["SUPABASE_URL"].replace("https://", "").split(".")[0]
    token = env["SUPABASE_ACCESS_TOKEN"]
    with open(code_path, "r", encoding="utf-8") as f:
        code = f.read()

    status, body = api(ref, token, "GET", "/functions")
    if status != 200:
        print(f"列出函数失败 HTTP {status}: {body}")
        sys.exit(1)
    existing = {item.get("slug") for item in json.loads(body)}
    print(f"现有函数: {sorted(existing)}")

    payload = {
        "slug": slug,
        "name": slug,
        "body": code,
        "verify_jwt": VERIFY_JWT,
    }
    if slug in existing:
        # 该 API 版本不支持 PUT 更新,先删除再重建
        status, body = api(ref, token, "DELETE", f"/functions/{slug}")
        print(f"删除旧函数 {slug}: HTTP {status}")
        if status >= 300:
            print(body)
            sys.exit(1)
        action = "重建"
    else:
        action = "创建"
    status, body = api(ref, token, "POST", "/functions", payload)
    print(f"{action}函数 {slug}: HTTP {status}")
    if status >= 300:
        print(body)
        sys.exit(1)
    print(f"函数地址: https://{ref}.supabase.co/functions/v1/{slug}")


if __name__ == "__main__":
    main()
