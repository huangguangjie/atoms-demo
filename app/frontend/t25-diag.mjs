// T25 诊断:复用第二次走查账号,直接打开会话页(等价刷新回放),
// 抓取 projects / project_versions 网络请求,定位版本列表为空的层级
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const EMAIL = 't25-1789879460063@atoms.test';
const PASSWORD = 'AtomsDemo2026!';

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

// 1) 密码授权拿 token
const auth = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const ad = await auth.json();
const userId = ad.user?.id;
console.log('login', auth.status, userId);

// 2) 读最新项目与 conversation_id
const pj = await fetch(
  `${BASE}/rest/v1/projects?user_id=eq.${userId}&select=id,name,conversation_id,is_demo,app_html&order=created_at.desc&limit=1`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ad.access_token}` } },
);
const prows = await pj.json();
console.log('project(rest)', pj.status,
  JSON.stringify(prows.map((p) => ({ id: p.id, cid: p.conversation_id, is_demo: p.is_demo, html: p.app_html?.length }))));
const cid = prows[0]?.conversation_id;

// 3) REST 读版本数(服务端事实)
const vr = await fetch(
  `${BASE}/rest/v1/project_versions?project_id=eq.${prows[0]?.id}&select=version_number,source,label&order=version_number.asc`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ad.access_token}` } },
);
console.log('versions(rest)', vr.status, JSON.stringify(await vr.json()));

// 4) 浏览器:登录注入 → 直接打开 /chat/:cid → 抓 project_versions 请求 → 打开历史版本面板
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const netLog = [];
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('project_versions') || u.includes('/rest/v1/projects?')) {
    let body = '';
    try { body = (await r.text()).replace(/\s+/g, ' ').slice(0, 260); } catch {}
    netLog.push(`NET ${r.status()} ${u.replace(`${BASE}/rest/v1/`, '').slice(0, 120)} :: ${body}`);
  }
});
page.on('console', (m) => {
  if (m.type() === 'error') netLog.push(`CONSOLE ${m.text().slice(0, 260)}`);
});
page.on('pageerror', (e) => netLog.push(`PAGEERROR ${String(e).slice(0, 260)}`));

await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
await page.waitForURL(`${APP}/**`, { timeout: 30000 });
await page.waitForTimeout(3000);

console.log('open chat', cid);
await page.goto(`${APP}/chat/${cid}`, { waitUntil: 'domcontentloaded' });
await page.getByText('做一个番茄钟计时器').first().waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(4000);

const histBtn = page.getByRole('button', { name: /历史版本/ });
console.log('histBtn-count', await histBtn.count());
if (await histBtn.count() > 0) {
  await histBtn.first().click({ timeout: 10000 }).catch((e) => console.log('click-fail', String(e).slice(0, 200)));
  await page.waitForTimeout(3000);
  console.log('empty-panel-count', await page.getByText('暂无版本记录').count());
  // 查看器演示徽标是否真实存在(区别于消息气泡徽标)
  console.log('viewer-badge-count', await page.getByText('演示模式', { exact: true }).count());
}
console.log('--- network log ---');
console.log(netLog.join('\n') || '(no matched requests)');
await browser.close();
