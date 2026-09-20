// T25 诊断2:同账号先基线验证版本面板 → 再 page.reload() 完全复刻走查路径,
// 抓取 reload 后 project_versions 请求状态/响应与最终面板文本
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

const auth = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const ad = await auth.json();
const userId = ad.user?.id;
const pj = await fetch(
  `${BASE}/rest/v1/projects?user_id=eq.${userId}&select=id,conversation_id&order=created_at.desc&limit=1`,
  { headers: { apikey: ANON, Authorization: `Bearer ${ad.access_token}` } },
);
const prows = await pj.json();
const cid = prows[0]?.conversation_id;
console.log('cid', cid);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const netLog = [];
page.on('response', async (r) => {
  const u = r.url();
  if (u.includes('project_versions')) {
    let body = '';
    try { body = (await r.text()).replace(/\s+/g, ' ').slice(0, 200); } catch {}
    netLog.push(`NET ${r.status()} pv :: ${body}`);
  } else if (u.includes('/rest/v1/') && r.status() >= 400) {
    netLog.push(`NET-ERR ${r.status()} ${u.replace(`${BASE}/rest/v1/`, '').slice(0, 140)}`);
  }
});
page.on('console', (m) => {
  if (m.type() === 'error') netLog.push(`CONSOLE ${m.text().slice(0, 160)}`);
});
page.on('pageerror', (e) => netLog.push(`PAGEERROR ${String(e).slice(0, 200)}`));

await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
await page.waitForURL(`${APP}/**`, { timeout: 30000 });
await page.waitForTimeout(2000);

console.log('=== 阶段1:直连打开会话(基线) ===');
await page.goto(`${APP}/chat/${cid}`, { waitUntil: 'domcontentloaded' });
await page.getByText('做一个番茄钟计时器').first().waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(3000);
await page.getByRole('button', { name: /历史版本/ }).click();
await page.waitForTimeout(1500);
const basePanel = await page.locator('.absolute.right-0.top-9').innerText().catch((e) => `ERR ${String(e).slice(0, 80)}`);
console.log('基线面板含在线编辑:', basePanel.includes('在线编辑'), '| 含暂无版本记录:', basePanel.includes('暂无版本记录'));
netLog.length = 0; // 清空基线期日志,只观察 reload 后

console.log('=== 阶段2:reload 复刻走查 ===');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('做一个番茄钟计时器').first().waitFor({ state: 'visible', timeout: 20000 });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /历史版本/ }).click();
let panelText = '';
for (let i = 0; i < 24 && !panelText.includes('在线编辑'); i++) {
  panelText = await page.locator('.absolute.right-0.top-9').innerText().catch(() => '');
  if (!panelText.includes('在线编辑')) await page.waitForTimeout(500);
}
console.log('reload 后面板含在线编辑:', panelText.includes('在线编辑'),
  '| 含暂无版本记录:', panelText.includes('暂无版本记录'));
console.log('面板文本(截断):', panelText.replace(/\n+/g, ' ').slice(0, 160));
console.log('--- reload 后网络/控制台 ---');
console.log(netLog.join('\n') || '(无匹配请求)');
await browser.close();
