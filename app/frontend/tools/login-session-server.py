"""临时登录注入辅助(回归用,不入库):任何 GET 都先做一次真实密码登录,再 302 到带会话片段的首页。

Browser.goto('http://127.0.0.1:8899/go') -> localhost:3000/#access_token=...
令牌由服务端程序化拼接,避免手工转写超长 JWT 出错。
"""
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ENV = {}
for line in open('/workspace/app/frontend/.env.local', encoding='utf-8'):
    line = line.strip()
    if '=' in line:
        k, v = line.split('=', 1)
        ENV[k] = v

BASE = ENV['VITE_SUPABASE_URL'].rstrip('/')
ANON = ENV['VITE_SUPABASE_ANON_KEY']
EMAIL = 'browser-1789734428@atoms.test'
PASSWORD = 'AtomsDemo2026!'


def fresh_login() -> dict:
    body = json.dumps({'email': EMAIL, 'password': PASSWORD}).encode()
    req = urllib.request.Request(
        f'{BASE}/auth/v1/token?grant_type=password', data=body,
        headers={'apikey': ANON, 'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode())


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/favicon'):
            self.send_response(204)
            self.end_headers()
            return
        try:
            data = fresh_login()
        except Exception as exc:  # noqa: BLE001
            msg = f'login failed: {exc}'.encode()
            self.send_response(500)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return
        frag = (
            f"access_token={data['access_token']}"
            f"&expires_in={data.get('expires_in', 3600)}"
            f"&refresh_token={data['refresh_token']}"
            '&token_type=bearer'
        )
        self.send_response(302)
        self.send_header('Location', f'http://localhost:3000/#{frag}')
        self.end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    ThreadingHTTPServer(('127.0.0.1', 8899), Handler).serve_forever()
