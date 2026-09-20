// T26 专项走查:会话归档过滤(仅隐藏不删除)
// 场景构造(独立测试账号,不触碰真实用户数据;全部经 REST + 用户 JWT 落库):
//   C1..C7 七条会话,updated_at 依次递减 1 小时;C7 收藏且时间最旧(收藏豁免);
//   C6 直接以 status='archived' 落库(最近5条之外且非收藏)。
// 断言:
//   1) 侧边栏展示 C1-C5(最近5条)与 C7(收藏豁免),不展示 C6(已归档);
//   2) 详情页历史下拉同样隐藏 C6;
//   3) 直接打开活跃会话 C1 正常,不被归档守卫误伤;
//   4) 直接导航归档会话 C6 → toast「该会话已归档」并回落首页;
//   5) REST status=eq.active 过滤后不含 C6(前端过滤的数据面依据);
//   6) 归档不删除数据:C6 行与消息完整保留;
//   7) 控制台无未预期错误。
// 真实账号(huangguangjie2021@gmail.com)5 active + 1 archived 与「其他账号零误归档」
// 由服务端 SQL 断言单独核验(见 .atoms/PROGRESS.md T26 记录)。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t26-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t26-${TS} 的 Atoms`;
const ARCHIVED_TITLE = 'T26 会话 C6';

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = { steps: [], consoleErrors: [] };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

/** 密码授权获取用户级 access_token(REST 以真实用户身份读写,走 RLS) */
async function freshLoginToken() {
  const resp = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(`密码授权失败 HTTP ${resp.status}`);
  return { token: data.access_token, userId: data.user.id };
}

const rest = (path) => `${BASE}/rest/v1/${path}`;
const authHeaders = (token) => ({
  apikey: ANON,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// 预期负路径:模板自带 /api/config 运行时配置探测(失败自动回退 Vite 环境变量)、
// Edge Function 与转写接口(AI 网关 402/502 外部故障窗口)
const NOISE_PATTERNS = ['/api/config', '/functions/v1', '/transcribe'];
const isNoise = (url) => NOISE_PATTERNS.some((p) => String(url || '').includes(p));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  const loc = m.location()?.url ?? '';
  // console 消息文本不含 URL,须按 location.url 归类预期噪声
  if (isNoise(loc) || isNoise(t)) return;
  result.consoleErrors.push(`${t.slice(0, 120)} @ ${loc.slice(0, 120)}`);
});
page.on('response', (r) => {
  if (r.status() < 400 || isNoise(r.url())) return;
  result.consoleErrors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 140)}`);
});
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

try {
  // 1) 注册新账号(004 触发器自动建资料与默认工作区)
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('T26-01 注册测试账号', signupResp.ok, `HTTP ${signupResp.status}`);

  // 2) 登录注入会话并原地等待首页就绪(默认工作区出现)
  await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${APP}/**`, { timeout: 30000 });
  const textarea = page.getByPlaceholder('@David 进行数据开发。');
  let ready = false;
  for (let i = 0; i < 8 && !ready; i++) {
    await page.waitForTimeout(3000);
    ready = await page.locator('aside').getByText(DEFAULT_SPACE).first().isVisible().catch(() => false)
      && await textarea.isVisible().catch(() => false);
    if (i === 3) await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  log('T26-02 登录注入并进入首页', ready, ready ? DEFAULT_SPACE : '默认工作区未出现');

  // 3) REST 构造 7 条会话(C1 最新 → C7 最旧且收藏;C6 直接 archived 落库)
  //    updated_at 显式指定(INSERT 不触发 updated_at 触发器),时间可控可复现
  const { token, userId } = await freshLoginToken();
  const spaceRows = await fetch(rest(`spaces?owner_id=eq.${userId}&is_default=eq.true&select=id`), {
    headers: authHeaders(token),
  }).then((r) => r.json());
  const spaceId = Array.isArray(spaceRows) && spaceRows[0] ? spaceRows[0].id : null;
  const now = Date.now();
  const convRows = Array.from({ length: 7 }, (_, i) => ({
    user_id: userId,
    space_id: spaceId,
    title: `T26 会话 C${i + 1}`,
    is_favorite: i === 6, // C7 收藏且时间最旧 → 收藏豁免
    status: i === 5 ? 'archived' : 'active', // C6 已归档
    updated_at: new Date(now - i * 3600_000).toISOString(),
  }));
  const inserted = await fetch(rest('conversations'), {
    method: 'POST',
    headers: { ...authHeaders(token), Prefer: 'return=representation' },
    body: JSON.stringify(convRows),
  }).then((r) => r.json());
  const convIds = Array.isArray(inserted) ? Object.fromEntries(inserted.map((c) => [c.title, c.id])) : {};
  log('T26-03 构造 7 条会话(C6 归档 / C7 收藏豁免)', Object.keys(convIds).length === 7, `space=${spaceId ? 'ok' : 'missing'}`);

  // 4) 为归档会话 C6 写入消息(验证归档不删除数据)
  const msgResp = await fetch(rest('messages'), {
    method: 'POST',
    headers: { ...authHeaders(token), Prefer: 'return=minimal' },
    body: JSON.stringify([
      { conversation_id: convIds[ARCHIVED_TITLE], role: 'user', content: 'T26 归档验证消息' },
      { conversation_id: convIds[ARCHIVED_TITLE], role: 'assistant', content: 'T26 归档验证回复' },
    ]),
  });
  log('T26-04 归档会话 C6 消息落库', msgResp.ok, `HTTP ${msgResp.status}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  // 5) 侧边栏:最近 5 条(C1-C5)展示
  const aside = page.locator('aside');
  const visibleShown = [];
  for (const n of [1, 2, 3, 4, 5]) {
    visibleShown.push(await aside.getByText(`T26 会话 C${n}`, { exact: true }).first().isVisible().catch(() => false));
  }
  log('T26-05 侧边栏展示最近 5 条(C1-C5)', visibleShown.every(Boolean), visibleShown.join(','));

  // 6) 侧边栏:收藏 C7(时间最旧)豁免展示
  const favShown = await aside.getByText('T26 会话 C7', { exact: true }).first().isVisible().catch(() => false);
  log('T26-06 收藏会话 C7(最旧)豁免展示', favShown);

  // 7) 侧边栏:已归档 C6 不展示
  const archivedHidden = !(await aside.getByText(ARCHIVED_TITLE, { exact: true }).first().isVisible().catch(() => false));
  log('T26-07 已归档 C6 不出现在侧边栏', archivedHidden);

  // 8) 直接打开活跃会话 C1 正常(归档守卫不误伤 active 会话)
  let c1Opened = false;
  const c1Id = convIds['T26 会话 C1'];
  if (c1Id) {
    await page.goto(`${APP}/chat/${c1Id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);
    c1Opened = page.url().includes(`/chat/${c1Id}`)
      && await page.getByText('T26 会话 C1', { exact: true }).first().isVisible().catch(() => false);
  }
  log('T26-08 直接打开活跃会话 C1 不被误判归档', c1Opened, c1Id ? c1Id.slice(0, 8) : '未取得 id');

  // 9) 详情页历史下拉:隐藏归档 C6、展示收藏 C7
  const historyBtn = page.getByTitle('历史会话').first();
  let historyOk = false;
  if (await historyBtn.isVisible().catch(() => false)) {
    await historyBtn.click();
    await page.waitForTimeout(1500);
    const menu = page.locator('[role="menu"]');
    const menuC6 = await menu.getByText(ARCHIVED_TITLE, { exact: true }).first().isVisible().catch(() => false);
    const menuC7 = await menu.getByText('T26 会话 C7', { exact: true }).first().isVisible().catch(() => false);
    historyOk = !menuC6 && menuC7;
    await page.screenshot({ path: '.tmp-t26-history.png' }).catch(() => {});
    await page.keyboard.press('Escape');
  }
  log('T26-09 历史下拉隐藏 C6 且展示收藏 C7', historyOk);

  // 10) 直接导航归档会话 C6 → 提示已归档并回落首页
  let archivedRedirect = false;
  let archivedToast = false;
  const c6Id = convIds[ARCHIVED_TITLE];
  if (c6Id) {
    await page.goto(`${APP}/chat/${c6Id}`, { waitUntil: 'domcontentloaded' });
    archivedToast = await page.getByText(/该会话已归档/).first()
      .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(2000);
    archivedRedirect = new URL(page.url()).pathname === '/';
  }
  log('T26-10 归档会话直达提示「该会话已归档」', archivedToast, c6Id ? c6Id.slice(0, 8) : '未取得 id');
  log('T26-11 归档会话直达回落到首页', archivedRedirect, page.url());
  await page.screenshot({ path: '.tmp-t26-final.png' });

  // 12) REST status=eq.active 过滤后不含 C6(前端过滤的数据面依据)
  const activeRows = await fetch(rest(`conversations?user_id=eq.${userId}&status=eq.active&select=id`), {
    headers: authHeaders(token),
  }).then((r) => r.json());
  const activeOnly = Array.isArray(activeRows)
    && activeRows.every((r) => r.id !== c6Id)
    && activeRows.length === 6; // C1-C5 + C7
  log('T26-12 status=active 过滤恰为 6 条且不含 C6', activeOnly, `active=${Array.isArray(activeRows) ? activeRows.length : '?'}`);

  // 13) 归档不删除数据:C6 行与消息完整保留
  const c6Row = await fetch(rest(`conversations?id=eq.${c6Id}&select=id,status`), {
    headers: authHeaders(token),
  }).then((r) => r.json()).catch(() => null);
  const c6Msgs = await fetch(rest(`messages?conversation_id=eq.${c6Id}&select=id`), {
    headers: authHeaders(token),
  }).then((r) => r.json()).catch(() => null);
  const kept = Array.isArray(c6Row) && c6Row.length === 1 && c6Row[0].status === 'archived'
    && Array.isArray(c6Msgs) && c6Msgs.length === 2;
  log('T26-13 归档会话行与消息完整保留(不删除)', kept, `row=${Array.isArray(c6Row) ? c6Row.length : '?'}, msgs=${Array.isArray(c6Msgs) ? c6Msgs.length : '?'}`);

  log('T26-14 控制台无未预期错误', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 3).join(' | '));
} catch (error) {
  log('走查异常中断', false, String(error).slice(0, 300));
  await page.screenshot({ path: '.tmp-t26-crash.png' }).catch(() => {});
} finally {
  fs.writeFileSync('/workspace/app/frontend/t26-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
}
const passed = result.steps.filter((s) => s.ok).length;
console.log(`\nT26 走查结果:${passed}/${result.steps.length} PASS`);
process.exit(passed === result.steps.length ? 0 : 1);
