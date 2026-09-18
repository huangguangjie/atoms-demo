// T10 侧边栏对话操作回归:hover 省略号按钮 → 收藏/重命名/删除菜单 → 真实落库 → 二次确认删除 → 刷新持久化
// 预置数据经 Supabase REST API 写入(注册即拿 token,不依赖 AI 生成),UI 断言走浏览器。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t10-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t10-${TS} 的 Atoms`;
// 预置会话:convA 用于收藏+重命名验证,convB 用于删除验证(先建 convB,收藏 convA 后 convA 应回到首位附近展示星标)
const TITLE_A = `星标验证会话${TS}`;
const TITLE_A_RENAMED = `改名后的会话${TS}`;
const TITLE_B = `待删除会话${TS}`;

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = { steps: [], consoleErrors: [], patches: [], deletes: [] };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

const authHeaders = (token) => ({
  apikey: ANON,
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

// ---------- 预置:注册 + 建两个会话(各带一条消息) ----------
const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
log('注册测试账号', signupResp.ok, `HTTP ${signupResp.status}`);
const signupBody = await signupResp.json();
const TOKEN = signupBody.access_token;
const USER_ID = signupBody.user?.id;

// 获取默认工作区:会话需归属当前工作区才能通过侧边栏工作区过滤展示
const spaceResp = await fetch(`${BASE}/rest/v1/spaces?owner_id=eq.${USER_ID}&is_default=eq.true&select=id,name`, {
  headers: authHeaders(TOKEN),
});
const spaceRows = await spaceResp.json();
const SPACE_ID = Array.isArray(spaceRows) ? spaceRows[0]?.id : undefined;
log('获取默认工作区', Boolean(SPACE_ID), `${spaceRows?.[0]?.name ?? '未找到'} / ${SPACE_ID ?? 'N/A'}`);

async function createConversation(title) {
  const r = await fetch(`${BASE}/rest/v1/conversations`, {
    method: 'POST',
    headers: { ...authHeaders(TOKEN), Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: USER_ID, space_id: SPACE_ID, title, is_favorite: false }),
  });
  const rows = await r.json();
  const conv = Array.isArray(rows) ? rows[0] : rows;
  await fetch(`${BASE}/rest/v1/messages`, {
    method: 'POST',
    headers: authHeaders(TOKEN),
    body: JSON.stringify({ conversation_id: conv.id, role: 'user', content: `${title} 的首条消息` }),
  });
  return conv;
}
const convA = await createConversation(TITLE_A);
const convB = await createConversation(TITLE_B);
log('REST 预置两个会话(各带 1 条消息)', Boolean(convA?.id && convB?.id), `${convA?.id} / ${convB?.id}`);

// ---------- 浏览器走查 ----------
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('response', (r) => {
  const url = r.url();
  if (r.request().method() === 'PATCH' && url.includes('/rest/v1/conversations')) result.patches.push(r.status());
  if (r.request().method() === 'DELETE' && url.includes('/rest/v1/conversations')) result.deletes.push(r.status());
});

try {
  // 1) 登录注入,默认工作区就绪
  await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${APP}/**`, { timeout: 30000 });
  let spaceReady = false;
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(3000);
    spaceReady = await page.locator('aside').getByText(DEFAULT_SPACE).first().isVisible().catch(() => false);
    if (spaceReady) break;
  }
  log('登录后默认工作区就绪', spaceReady, DEFAULT_SPACE);

  // 2) 最近对话展示预置会话(默认标题)
  const rowA = page.locator('aside div.group').filter({ hasText: TITLE_A }).first();
  const rowB = page.locator('aside div.group').filter({ hasText: TITLE_B }).first();
  await rowA.waitFor({ state: 'visible', timeout: 15000 });
  log('最近对话展示预置会话', (await rowA.isVisible()) && (await rowB.isVisible()));

  // 3) 未 hover 时省略号按钮不可见(opacity-0)
  const btnA = rowA.locator('button[title="会话操作"]');
  const opacityBefore = await btnA.evaluate((el) => getComputedStyle(el).opacity);
  log('未 hover 时操作按钮隐藏', opacityBefore === '0', `opacity=${opacityBefore}`);

  // 4) hover 后操作按钮显现
  await rowA.hover();
  await page.waitForTimeout(300);
  const opacityHover = await btnA.evaluate((el) => getComputedStyle(el).opacity);
  log('hover 后操作按钮显现', Number(opacityHover) > 0.9, `opacity=${opacityHover}`);

  // 5) 点击省略号弹出菜单,含收藏/重命名/删除三项
  await btnA.click();
  const menuItemFav = page.getByRole('menuitem', { name: '收藏' });
  const menuItemRename = page.getByRole('menuitem', { name: '重命名' });
  const menuItemDelete = page.getByRole('menuitem', { name: '删除' });
  const menuOk = await menuItemFav.isVisible().catch(() => false)
    && await menuItemRename.isVisible().catch(() => false)
    && await menuItemDelete.isVisible().catch(() => false);
  log('菜单含收藏/重命名/删除三项', menuOk);

  // 6) 点击「收藏」→ PATCH 落库 → 列表刷新后星标出现且排序靠前
  await menuItemFav.click();
  for (let i = 0; i < 10 && result.patches.length === 0; i++) await page.waitForTimeout(300);
  const starA = rowA.locator('svg.lucide-star');
  let starVisible = false;
  for (let i = 0; i < 8 && !starVisible; i++) {
    await page.waitForTimeout(500);
    starVisible = await starA.first().isVisible().catch(() => false);
  }
  log('收藏 PATCH 落库 204', result.patches.every((s) => s === 204), JSON.stringify(result.patches));
  log('收藏后列表项显示星标', starVisible);

  // 7) hover convB → 菜单「删除」→ 二次确认弹窗 → 取消不删
  await rowB.hover();
  await rowB.locator('button[title="会话操作"]').click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  const dialogTitle = page.getByRole('heading', { name: '删除对话' });
  const dialogShown = await dialogTitle.isVisible().catch(() => false);
  await page.getByRole('button', { name: '取消' }).click();
  await page.waitForTimeout(500);
  const rowBStill = await rowB.isVisible().catch(() => false);
  log('删除弹出二次确认且取消不删', dialogShown && rowBStill);

  // 8) 再次删除并确认 → DELETE 204 → 列表项消失
  await rowB.hover();
  await rowB.locator('button[title="会话操作"]').click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  for (let i = 0; i < 10 && result.deletes.length === 0; i++) await page.waitForTimeout(300);
  let rowBGone = false;
  for (let i = 0; i < 8 && !rowBGone; i++) {
    await page.waitForTimeout(500);
    rowBGone = !(await rowB.isVisible().catch(() => false));
  }
  log('确认后 DELETE 落库 204', result.deletes.every((s) => s === 204), JSON.stringify(result.deletes));
  log('删除后列表项消失', rowBGone);

  // 9) 重命名:hover convA → 菜单「重命名」→ 行内输入框 → 新标题回车 → PATCH 204 → 列表更新
  await rowA.hover();
  await rowA.locator('button[title="会话操作"]').click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  const renameInput = page.getByLabel('重命名对话');
  await renameInput.waitFor({ state: 'visible', timeout: 5000 });
  const filledOld = (await renameInput.inputValue()) === TITLE_A;
  await renameInput.fill(TITLE_A_RENAMED);
  await renameInput.press('Enter');
  // 重命名后行文本已变为新标题,不能再依赖 hasText: TITLE_A 的 rowA 定位器(否则必超时)
  let renamedVisible = false;
  for (let i = 0; i < 10 && !renamedVisible; i++) {
    await page.waitForTimeout(500);
    renamedVisible = await page.locator('aside').getByText(TITLE_A_RENAMED).first().isVisible().catch(() => false);
  }
  log('重命名输入框预填旧标题', filledOld);
  log('重命名 PATCH 落库 204', result.patches.filter((s) => s === 204).length >= 2, JSON.stringify(result.patches));
  log('重命名后列表显示新标题', renamedVisible);

  // 10) 刷新持久化:新标题仍在(收藏+重命名落库),被删会话不回来
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const persisted = await page.locator('aside').getByText(TITLE_A_RENAMED).first().isVisible().catch(() => false);
  const deletedGone = !(await page.locator('aside').getByText(TITLE_B).first().isVisible().catch(() => false));
  log('刷新后收藏+重命名持久化', persisted);
  log('刷新后被删会话未恢复', deletedGone);

  // 11) 服务端核验:convA is_favorite=true 且标题已改;convB 与其消息级联删除
  const q = await fetch(`${BASE}/rest/v1/conversations?id=eq.${convA.id}&select=title,is_favorite`, { headers: authHeaders(TOKEN) });
  const rowsA = await q.json();
  log('服务端核验收藏+标题落库', rowsA[0]?.is_favorite === true && rowsA[0]?.title === TITLE_A_RENAMED, JSON.stringify(rowsA));
  const qB = await fetch(`${BASE}/rest/v1/conversations?id=eq.${convB.id}&select=id`, { headers: authHeaders(TOKEN) });
  const rowsB = await qB.json();
  const qM = await fetch(`${BASE}/rest/v1/messages?conversation_id=eq.${convB.id}&select=id`, { headers: authHeaders(TOKEN) });
  const rowsM = await qM.json();
  log('服务端核验会话+消息级联删除', rowsB.length === 0 && rowsM.length === 0, JSON.stringify({ convB: rowsB.length, msgs: rowsM.length }));
} catch (error) {
  log('执行异常', false, String(error).slice(0, 300));
}

const failed = result.steps.filter((s) => !s.ok);
const realErrors = result.consoleErrors.filter((t) => !t.includes('/api/config') && !t.includes('Failed to load resource'));
console.log(`\n== T10 回归结果: ${result.steps.length - failed.length}/${result.steps.length} PASS ==`);
if (failed.length) console.log('失败项:', failed.map((s) => s.name).join(' | '));
if (realErrors.length) console.log('控制台错误:', realErrors.slice(0, 5).join(' | '));
await browser.close();
process.exit(failed.length || realErrors.length ? 1 : 0);
