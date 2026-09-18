#!/usr/bin/env python3
"""端到端验证 app_atoms_transcribe_audio:注册真实用户拿 JWT,上传真实语音文件,断言 scribe_v2 转写结果。"""
import json
import time

import requests

ENV_PATH = '/tmp/supabase_env'
AUDIO_PATH = '/workspace/assets/audios/voice-test.mp3'
EXPECT_KEYWORD = '番茄钟'


def load_env(path: str) -> dict:
    env = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            env[key.strip()] = value.strip().strip('"').strip("'")
    return env


def pick(env: dict, *names: str):
    for name in names:
        if env.get(name):
            return env[name]
    return None


def main() -> None:
    env = load_env(ENV_PATH)
    base = (pick(env, 'SUPABASE_URL', 'SUPABASE_PROJECT_URL', 'PROJECT_URL') or '').rstrip('/')
    anon = pick(env, 'SUPABASE_ANON_KEY', 'ANON_KEY', 'SUPABASE_KEY')
    if not base or not anon:
        raise SystemExit(f'env 缺少 SUPABASE_URL/ANON_KEY,现有键: {sorted(env)}')

    # 1. 注册新用户(mailer_autoconfirm 开启,响应直接带 access_token)
    email = f'voice-{int(time.time())}@atoms.test'
    password = 'Voice#Test2026!'
    r = requests.post(
        f'{base}/auth/v1/signup',
        headers={'apikey': anon, 'Content-Type': 'application/json'},
        json={'email': email, 'password': password},
        timeout=20,
    )
    r.raise_for_status()
    token = r.json().get('access_token')
    if not token:
        raise SystemExit(f'未获取到 access_token: {list(r.json())}')
    print(f'[1/2] 用户注册成功: {email}')

    # 2. 上传真实语音到转写 Edge Function
    with open(AUDIO_PATH, 'rb') as f:
        resp = requests.post(
            f'{base}/functions/v1/app_atoms_transcribe_audio',
            headers={'Authorization': f'Bearer {token}', 'apikey': anon},
            files={'audio': ('voice-test.mp3', f, 'audio/mpeg')},
            timeout=90,
        )
    print(f'[2/2] Edge Function HTTP {resp.status_code}')
    try:
        payload = resp.json()
    except Exception:
        print(resp.text[:2000])
        raise SystemExit(1)
    print(json.dumps(payload, ensure_ascii=False)[:800])

    assert resp.status_code == 200, '转写请求未返回 200'
    assert payload.get('model') == 'scribe_v2', f"model 不符: {payload.get('model')}"
    text = payload.get('text', '')
    assert EXPECT_KEYWORD in text, f'转写文本缺少关键词「{EXPECT_KEYWORD}」: {text}'
    print(f'E2E PASS: scribe_v2 转写成功, 耗时 {payload.get("cost_ms")}ms, 文本={text}')


if __name__ == '__main__':
    main()
