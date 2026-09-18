"""回归辅助:以邮箱+密码真实登录 Supabase,再 302 回前端并注入会话片段。

用法:python3 login-session-server.py
  GET /go?email=<邮箱>&password=<密码>
凭据由调用方通过查询参数传入,不落在代码里;仅本地回归使用,不部署。
"""
import json
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = ''
ANON = ''
for line in open('/workspace/app/frontend/.env.local', encoding='utf-8'):
    line = line.strip()
    if line.startswith('VITE_SUPABASE_URL='):
        BASE = line.split('=', 1)[1].rstrip('/')
    elif line.startswith('VITE_SUPABASE_ANON_KEY='):
        ANON = line.split('=', 1)[1]


def fresh_login(email: str, password: str) -> dict:
    body = json.dumps({'email': email, 'password': password}).encode()
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
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != '/go':
            self.send_response(404)
            self.end_headers()
            return
        qs = urllib.parse.parse_qs(parsed.query)
        email = (qs.get('email') or [''])[0]
        password = (qs.get('password') or [''])[0]
        if not email or not password:
            msg = b'missing email/password query params'
            self.send_response(400)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return
        try:
            data = fresh_login(email, password)
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
