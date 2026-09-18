#!/usr/bin/env python3
"""T9 生成质量验证:多类型提示词实测 Edge Function 提示词管线,保存产物并做质量门槛检查。

用法:python3 test_t9_baseline.py [提示词序号 1-5]
提示词库:1=贪吃蛇游戏 2=习惯打卡清单 3=记账仪表盘 4=番茄工作法介绍站 5=三分区贪吃蛇(介绍+游戏+玩法文档)
质量门槛:纯 HTML 文档(无围栏/前后杂文)、Flex/Grid 布局、@media 响应式、plan 含布局与视觉规范、SSE 事件完整。
输出:/workspace/app/backend/scripts/.t9_out/baseline_N.html、baseline_N_plan.json 与事件统计。
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ENV_PATH = "/workspace/app/frontend/.env.local"
PASSWORD = "AtomsDemo2026!"
OUT_DIR = Path("/workspace/app/backend/scripts/.t9_out")

PROMPTS = {
    1: "做一个贪吃蛇游戏,键盘方向键控制,有得分和最高分,游戏结束可重来。",
    2: "做一个习惯打卡清单,可以添加/勾选/删除习惯,显示连续打卡天数。",
    3: "做一个个人记账仪表盘,录入收支后能看到余额、分类占比和最近记录列表。",
    4: "做一个番茄工作法介绍网站,包含方法原理、使用步骤和常见问题。",
    5: "做一个贪吃蛇游戏应用,页面左边要有应用介绍文案,中间是游戏本体,右边放玩法说明文档(用列表逐条写清楚),键盘方向键控制,有得分统计。",
}


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
    idx = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    prompt = PROMPTS[idx]
    env = load_env(ENV_PATH)
    base = env["VITE_SUPABASE_URL"].rstrip("/")
    anon = env["VITE_SUPABASE_ANON_KEY"]

    # 登录(复用既有测试账号;不存在则注册)
    email = "t9-baseline@atoms.test"
    body = json.dumps({"email": email, "password": PASSWORD}).encode()
    req = urllib.request.Request(
        f"{base}/auth/v1/token?grant_type=password",
        data=body,
        headers={"apikey": anon, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            token = json.loads(resp.read().decode())["access_token"]
    except urllib.error.HTTPError:
        body = json.dumps({"email": email, "password": PASSWORD}).encode()
        req = urllib.request.Request(
            f"{base}/auth/v1/signup",
            data=body,
            headers={"apikey": anon, "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            token = json.loads(resp.read().decode())["access_token"]
    print(f"登录成功: {email}")

    url = f"{base}/functions/v1/app_atoms_agent_generate"
    payload = json.dumps({"prompt": prompt, "theme": "默认", "mode": "goal"}).encode()
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "apikey": anon,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    counts: dict[str, int] = {}
    plan_steps: list[str] = []
    html = ""
    error_message = None
    start = time.time()
    try:
        with urllib.request.urlopen(req, timeout=280) as resp:
            for raw in resp:
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                payload_s = line[5:].strip()
                if not payload_s or payload_s == "[DONE]":
                    continue
                try:
                    event = json.loads(payload_s)
                except json.JSONDecodeError:
                    continue
                etype = event.get("type")
                counts[etype] = counts.get(etype, 0) + 1
                if etype == "plan":
                    plan_steps = event.get("steps") or []
                if etype == "app":
                    files = (event.get("app") or {}).get("files") or [{}]
                    html = files[0].get("content", "")
                if etype == "error":
                    error_message = event.get("message")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Edge Function HTTP {exc.code}: {exc.read().decode()[:300]}")

    elapsed = time.time() - start
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_file = OUT_DIR / f"baseline_{idx}.html"
    if html:
        out_file.write_text(html, encoding="utf-8")
    plan_file = OUT_DIR / f"baseline_{idx}_plan.json"
    plan_file.write_text(json.dumps(plan_steps, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"提示词[{idx}]: {prompt}")
    print(f"耗时 {elapsed:.1f}s,事件统计: {counts}")
    print(f"plan 步骤: {json.dumps(plan_steps, ensure_ascii=False)}")
    print(f"HTML 长度: {len(html)},已保存: {out_file}")
    if error_message:
        raise SystemExit(f"流内错误事件: {error_message}")

    # T9 质量门槛:结构纯净 / 布局实现 / 响应式 / plan 规范 / 事件完整性
    failures: list[str] = []
    low = html.strip().lower()
    if not (low.startswith("<!doctype html") or low.startswith("<html")):
        failures.append("HTML 未以 <!DOCTYPE html>/<html> 开头(存在前导杂文)")
    if not low.endswith("</html>"):
        failures.append("HTML 未以 </html> 结尾(存在尾随杂文)")
    if "```" in html:
        failures.append("HTML 含 Markdown 围栏残留")
    if ("flex" not in low) and ("grid" not in low):
        failures.append("未检测到 Flex/Grid 布局")
    if "@media" not in low:
        failures.append("缺少 @media 响应式规则")
    plan_text = " ".join(plan_steps)
    if not ("布局" in plan_text or "flex" in plan_text.lower() or "grid" in plan_text.lower()):
        failures.append("plan 缺少布局/Flex/Grid 规划")
    if not ("间距" in plan_text or "视觉" in plan_text or "圆角" in plan_text):
        failures.append("plan 缺少视觉规范")
    expected = {"message", "plan", "step-start", "step-done", "code-start", "code-delta", "app", "done"}
    missing = sorted(expected - set(counts))
    if missing:
        failures.append(f"缺少事件类型: {missing}")
    if failures:
        for item in failures:
            print(f"FAIL {item}")
        raise SystemExit(f"质量门槛未通过: {len(failures)} 项")
    assert counts.get("app", 0) == 1, "缺少 app 事件"
    print("质量门槛通过(纯文档/Flex/Grid/响应式/plan 规范/事件完整性)。")


if __name__ == "__main__":
    main()
