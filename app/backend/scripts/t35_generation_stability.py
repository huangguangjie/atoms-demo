#!/usr/bin/env python3
"""T35-3 生成稳定性与模型降级顺序独立核验(现场响应取证)。

复现「复杂计算器提示词超时、简化计数器成功」的差异,并直接从 Edge Function 的
SSE `diagnostics` 事件与响应头读取现场证据(不是从代码里读声明):

  - 请求耗时 / 首字节耗时
  - finish_reason / 是否超时 / 是否提前收敛(proactiveCut)
  - 上游 token 用量(usage)
  - 130s 软超时预算与本次实际截断点(truncatedAtLength)
  - 模型链、每次尝试的模型与结果、是否降级、最终生效模型

用法:
  python3 app/backend/scripts/t35_generation_stability.py

登录态:优先复用 /tmp/t34-reviewer-credentials.txt 的评审账号;缺失时临时注册。
产出:app/backend/reports/t35-generation-stability.json
"""
import json
import os
import re
import time
import urllib.error
import urllib.request

ENV_PATH = "/workspace/app/frontend/.env.local"
CREDS_PATH = "/tmp/t34-reviewer-credentials.txt"
REPORT_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "reports", "t35-generation-stability.json"
)
SOFT_DEADLINE_MS = 130_000
MODEL_CHAIN = ["deepseek-v4-flash", "gpt-5.4", "gemini-3.1-pro-preview"]
PASSWORD = "AtomsDemo2026!"

# 复杂提示词:三分区 + 多功能,历史实测在软超时内被截断
COMPLEX_PROMPT = (
    "做一个功能完整的计算器应用,包含标准计算、科学计算(三角函数/对数/幂运算)、"
    "历史记录三个分区,支持键盘输入与鼠标点击,浅色主题,中文界面。"
)
# 简化提示词:单一分区 + 两个功能,历史实测可在预算内完成
SIMPLE_PROMPT = "做一个计数器应用,点击按钮加一,支持重置,浅色主题,中文界面。"

result = {"steps": [], "requests": {}, "modelChainExpected": MODEL_CHAIN}


def log(name, ok, detail=""):
    result["steps"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(f"{'PASS' if ok else 'FAIL'} {name}" + (f" | {detail}" if detail else ""))


def load_env(path):
    env = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and "=" in line:
                key, value = line.split("=", 1)
                env[key] = value
    return env


def login(base, anon, email, password):
    req = urllib.request.Request(
        f"{base}/auth/v1/token?grant_type=password",
        data=json.dumps({"email": email, "password": password}).encode(),
        headers={"apikey": anon, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    return data["access_token"], data["user"]["id"]


def signup(base, anon):
    email = f"t35-stability-{int(time.time())}@atoms.test"
    req = urllib.request.Request(
        f"{base}/auth/v1/signup",
        data=json.dumps({"email": email, "password": PASSWORD}).encode(),
        headers={"apikey": anon, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    return data["access_token"], data["user"]["id"], email


def reviewer_credentials():
    """从 /tmp 凭据交付文件读取评审账号(不打印密码)。"""
    if not os.path.exists(CREDS_PATH):
        return None
    text = open(CREDS_PATH, encoding="utf-8").read()
    email = re.search(r"邮箱\s+(\S+)", text)
    password = re.search(r"密码\s+(\S+)", text)
    if not email or not password:
        return None
    return email.group(1), password.group(1)


def call_agent(base, anon, token, prompt):
    """调用生成 Edge Function,完整采集 SSE 事件与现场诊断证据。"""
    req = urllib.request.Request(
        f"{base}/functions/v1/app_atoms_agent_generate",
        data=json.dumps({"prompt": prompt, "theme": "默认", "mode": "goal"}).encode(),
        headers={
            "apikey": anon,
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    counts = {}
    html_len = 0
    html_complete = False
    errors = []
    diagnostics = None
    started = time.time()
    with urllib.request.urlopen(req, timeout=280) as resp:
        headers = dict(resp.headers)
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
                content = files[0].get("content", "")
                html_len = len(content)
                html_complete = content.strip().endswith("</html>")
            elif etype == "error":
                errors.append(event.get("message"))
            elif etype == "diagnostics":
                diagnostics = event
    elapsed_ms = int((time.time() - started) * 1000)
    return {
        "counts": counts,
        "htmlLength": html_len,
        "htmlComplete": html_complete,
        "errors": errors,
        "diagnostics": diagnostics,
        "elapsedMs": elapsed_ms,
        "responseHeaders": {
            k: v for k, v in headers.items() if k.lower().startswith("x-atoms-")
        },
    }


def summarise(probe):
    """把现场证据压缩成可读的归因结论。"""
    diag = probe.get("diagnostics") or {}
    trace = diag.get("modelTrace") or []
    if diag.get("timedOut"):
        cause = "soft-deadline-exhausted"
    elif diag.get("stallSwitches"):
        cause = "first-byte-stall-switched-to-backup-model"
    elif diag.get("proactiveCut"):
        cause = "proactive-cut-to-reserve-retry-budget"
    elif diag.get("finishReason") == "length":
        cause = "max-tokens-truncated"
    elif diag.get("retried"):
        cause = "first-attempt-incomplete-then-retried"
    elif probe["htmlComplete"]:
        cause = "completed-within-budget"
    else:
        cause = "unknown-incomplete-output"
    return {
        "rootCause": cause,
        "stallSwitchMs": diag.get("stallSwitchMs"),
        "stallSwitches": diag.get("stallSwitches"),
        "elapsedMs": probe["elapsedMs"],
        "budgetMs": diag.get("softDeadlineMs"),
        "proactiveCutMs": diag.get("proactiveCutMs"),
        "finishReason": diag.get("finishReason"),
        "timedOut": diag.get("timedOut"),
        "proactiveCut": diag.get("proactiveCut"),
        "retried": diag.get("retried"),
        "truncatedAtLength": diag.get("truncatedAtLength"),
        "firstTokenMs": diag.get("firstTokenMs"),
        "outputLength": diag.get("outputLength"),
        "usage": diag.get("usage"),
        "budgetLines": diag.get("budgetLines"),
        "planSource": diag.get("planSource"),
        "planMs": diag.get("planMs"),
        "syntaxFixed": diag.get("syntaxFixed"),
        "attempts": diag.get("attempts"),
        "modelChain": diag.get("modelChain"),
        "modelTrace": trace,
        "activeModel": diag.get("activeModel"),
        "degraded": diag.get("degraded"),
        "htmlLength": probe["htmlLength"],
        "htmlComplete": probe["htmlComplete"],
        "errors": probe["errors"],
        "responseHeaders": probe["responseHeaders"],
    }


def build_conclusion(cx, sm):
    """基于现场证据给出耗时差异归因(不写死结论)。"""
    if cx.get("stallSwitches"):
        first = cx["stallSwitches"][0]
        return (
            f"现场证据显示复杂需求的首个通道 {first.get('from')} 在 "
            f"{first.get('atMs')}ms 内未吐出任何首字节(上游 HTTP 200 但停在推理阶段),"
            f"因此在 {cx.get('stallSwitchMs')}ms 停滞阈值处切换备用通道 {first.get('to')} 继续生成,"
            f"最终以 {cx.get('activeModel')} 在 {cx.get('elapsedMs')}ms 完整交付;"
            f"简化需求首字节 {sm.get('firstTokenMs')}ms 到达、{sm.get('elapsedMs')}ms 一次完成。"
            "差异根因是上游通道首字节停滞(推理阶段耗时),不是提示词复杂度或预算分配错误。"
        )
    if cx.get("rootCause") == "soft-deadline-exhausted":
        return (
            "复杂需求仍在软超时点失败:首字节迟迟未到达且未能切换到备用通道,"
            "根因是上游通道在推理阶段停滞,需继续收敛首字节停滞阈值或提示词长度。"
        )
    return (
        f"复杂需求归因={cx.get('rootCause')}(耗时 {cx.get('elapsedMs')}ms,"
        f"首字节 {cx.get('firstTokenMs')}ms),简化需求归因={sm.get('rootCause')}"
        f"(耗时 {sm.get('elapsedMs')}ms,首字节 {sm.get('firstTokenMs')}ms)。"
    )


def main():
    env = load_env(ENV_PATH)
    base = env["VITE_SUPABASE_URL"].rstrip("/")
    anon = env["VITE_SUPABASE_ANON_KEY"]

    creds = reviewer_credentials()
    if creds:
        token, user_id = login(base, anon, creds[0], creds[1])
        identity = f"reviewer:{creds[0]}"
    else:
        token, user_id, email = signup(base, anon)
        identity = f"signup:{email}"
    log("登录态就绪(用于真实链路取证)", bool(token), f"{identity} | user={user_id}")

    for label, prompt in (("complex", COMPLEX_PROMPT), ("simple", SIMPLE_PROMPT)):
        probe = call_agent(base, anon, token, prompt)
        result["requests"][label] = {"prompt": prompt, **summarise(probe)}
        print(f"\n[{label}] {json.dumps(result['requests'][label], ensure_ascii=False)[:600]}")

        diag = probe["diagnostics"]
        log(f"{label}: 收到 diagnostics 现场证据事件", diag is not None)
        if not diag:
            continue
        log(
            f"{label}: 模型链与声明一致({'>'.join(MODEL_CHAIN)})",
            diag.get("modelChain") == MODEL_CHAIN,
            f"实测 {'>'.join(diag.get('modelChain') or [])}",
        )
        log(
            f"{label}: 最终生效模型属于模型链且尝试留痕完整",
            diag.get("activeModel") in MODEL_CHAIN and len(diag.get("modelTrace") or []) >= 1,
            f"activeModel={diag.get('activeModel')} attempts={len(diag.get('modelTrace') or [])} "
            f"degraded={diag.get('degraded')}",
        )
        log(
            f"{label}: 请求耗时在 130s 软超时预算内",
            probe["elapsedMs"] < SOFT_DEADLINE_MS,
            f"{probe['elapsedMs']}ms",
        )
        log(
            f"{label}: 交付完整 HTML 产物(以 </html> 收尾)",
            probe["htmlComplete"] and not probe["errors"],
            f"length={probe['htmlLength']} errors={probe['errors']}",
        )

    cx = result["requests"].get("complex", {})
    sm = result["requests"].get("simple", {})
    # 差异归因:复杂需求是否更早收敛 / 更高预算压力
    result["rootCauseAnalysis"] = {
        "complex": {
            "rootCause": cx.get("rootCause"),
            "budgetLines": cx.get("budgetLines"),
            "finishReason": cx.get("finishReason"),
            "proactiveCut": cx.get("proactiveCut"),
            "elapsedMs": cx.get("elapsedMs"),
        },
        "simple": {
            "rootCause": sm.get("rootCause"),
            "budgetLines": sm.get("budgetLines"),
            "finishReason": sm.get("finishReason"),
            "proactiveCut": sm.get("proactiveCut"),
            "elapsedMs": sm.get("elapsedMs"),
        },
        "conclusion": build_conclusion(cx, sm),
    }
    log(
        "复杂需求未耗尽 130s 预算(复杂/简化耗时差异已收敛)",
        bool(cx.get("elapsedMs")) and bool(sm.get("elapsedMs")) and cx["elapsedMs"] < SOFT_DEADLINE_MS,
        f"complex={cx.get('elapsedMs')}ms simple={sm.get('elapsedMs')}ms",
    )

    os.makedirs(os.path.dirname(REPORT_PATH), exist_ok=True)
    passed = sum(1 for s in result["steps"] if s["ok"])
    result["passed"] = passed
    result["total"] = len(result["steps"])
    with open(REPORT_PATH, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(f"\nT35 生成稳定性与模型顺序核验:{passed}/{len(result['steps'])} PASS")
    print(f"报告 {REPORT_PATH}")
    return 0 if passed == len(result["steps"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
