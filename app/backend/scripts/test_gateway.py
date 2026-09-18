#!/usr/bin/env python3
"""直测 AI 网关流式生成耗时(验证 enable_thinking=false 是否生效)。"""
import json
import os
import sys
import time
import urllib.request

BASE = os.environ["APP_AI_BASE_URL"].rstrip("/")
KEY = os.environ["APP_AI_KEY"]

body = {
    "model": "claude-opus-5",
    "stream": True,
    "max_tokens": 8000,
    "enable_thinking": False,
    "messages": [
        {
            "role": "system",
            "content": (
                "你是应用生成智能体,严格只输出一个完整的 HTML5 文档(<!DOCTYPE html> 开头、</html> 结束),"
                "不要解释、不要 Markdown 围栏。要求:内联 CSS/JS 无外部依赖;界面现代美观;"
                "总代码量控制在 400 行以内,精炼但功能完整。"
            ),
        },
        {"role": "user", "content": "做一个番茄钟计时器:25 分钟工作/5 分钟休息切换、进度环、开始暂停重置、中文界面。"},
    ],
}

req = urllib.request.Request(
    f"{BASE}/chat/completions",
    data=json.dumps(body).encode(),
    headers={
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
        "User-Agent": "atoms-agent-test/1.0",
    },
)

start = time.time()
first_reasoning = None
first_content = None
content_chars = 0
reasoning_chars = 0

try:
    with urllib.request.urlopen(req, timeout=280) as resp:
        print(f"HTTP {resp.status}")
        buffer = ""
        for raw in resp:
            line = raw.decode("utf-8", "replace").strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if not payload or payload == "[DONE]":
                continue
            try:
                chunk = json.loads(payload)
            except json.JSONDecodeError:
                continue
            choices = chunk.get("choices") or []
            if not choices:
                continue
            delta = choices[0].get("delta", {})
            reasoning = delta.get("reasoning") or ""
            content = delta.get("content") or ""
            if reasoning:
                reasoning_chars += len(reasoning)
                if first_reasoning is None:
                    first_reasoning = time.time() - start
            if content:
                content_chars += len(content)
                if first_content is None:
                    first_content = time.time() - start
except Exception as exc:  # noqa: BLE001
    print(f"请求异常: {exc}")

end = time.time() - start
print(f"总耗时: {end:.1f}s")
print(f"首个 reasoning 分片: {first_reasoning if first_reasoning is not None else '无'}")
print(f"首个 content 分片: {first_content if first_content is not None else '无'}")
print(f"reasoning 字符数: {reasoning_chars}, content 字符数: {content_chars}")
sys.exit(0 if content_chars > 500 else 1)
