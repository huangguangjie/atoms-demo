// T31 认证全流程真实走查:注册 → 登出 → 重登 → 清空存储 → 无痕上下文 → 会话持久化 → JWT 刷新
//
// 全部动作走产品真实 UI(侧边栏头像 → AuthDialog),不直接调用 AuthContext;
// 仅数据准备(会话/项目)与令牌交换使用 REST,用于构造可恢复的云端数据与验证刷新令牌链路。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const TS = Date.now();
// 支持两种模式:
//   默认      —— 走查自行注册临时账号(原 T31 口径)
//   环境变量  —— REVIEWER_EMAIL / REVIEWER_PASSWORD 指定已存在账号(T34 reviewer 复验口径)
const REUSE_EMAIL = process.env.REVIEWER_EMAIL || '';
const REUSE_PASSWORD = process.env.REVIEWER_PASSWORD || '';
const REUSE = Boolean(REUSE_EMAIL && REUSE_PASSWORD);
const EMAIL = REUSE ? REUSE_EMAIL : `t31-auth-${TS}@atoms.test`;
const PASSWORD = REUSE ? REUSE_PASSWORD : 'AtomsDemo2026!';
const SPACE_NAME = REUSE
  ? (process.env.REVIEWER_SPACE_NAME || 'T34 验收评审 的 Atoms')
  : `t31-auth-${TS} 的 Atoms`;
const CONV_TITLE = `T31 认证恢复会话 ${TS}`;
const PROJECT_NAME = `T31 认证恢复项目 ${TS}`;

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;
const REF = BASE.split('//')[1].split('.')[0];
const STORAGE_KEY = `sb-${REF}-auth-token`;

const result = { steps: [], consoleErrors: [] };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

const rest = (path, init = {}, token) =>
  fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

const browser = await chromium.launch({ headless: true });

/** 挂载控制台噪声过滤(与既有走查口径一致:外部/预期错误不计入未预期错误) */
function attachConsoleFilter(page) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    const loc = m.location()?.url ?? '';
    if (['/api/config', '/functions/v1', '/auth/v1'].some((p) => loc.includes(p) || text.includes(p))) return;
    if (/Failed to load resource|net::ERR|401|Unauthorized|Invalid login credentials/i.test(text)) return;
    result.consoleErrors.push(text.slice(0, 160));
  });
}

// 侧边栏底部头像:折叠/展开态均为 rounded-full + text-white;会话操作按钮虽也含 rounded-full 但无 text-white,须排除
const avatar = (page) => page.locator('aside button.rounded-full.text-white').first();
const authDialog = (page) => page.getByRole('dialog').filter({ hasText: '登录 Atoms' });

/** 通过产品真实弹窗完成登录/注册 */
async function submitAuth(page, mode, email, password) {
  const dialog = authDialog(page);
  let visible = false;
  for (let attempt = 0; attempt < 3 && !visible; attempt++) {
    await avatar(page).click();
    visible = await dialog.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
    if (!visible) {
      // 误开了用户下拉菜单(说明仍处于登录态)时先关闭再重试
      result.authDialogDiagnostics = await page.locator('[role="menu"]').allInnerTexts().catch(() => []);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }
  }
  if (!visible) throw new Error(`登录弹窗未出现,诊断 ${JSON.stringify(result.authDialogDiagnostics ?? [])}`);
  if (mode === 'signup') await dialog.getByRole('tab', { name: '注册' }).click();
  await dialog.locator('#auth-email').fill(email);
  await dialog.locator('#auth-password').fill(password);
  await dialog.getByRole('button', { name: mode === 'signin' ? '登录' : '注册' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
}

/** 等待登录态数据就绪(默认工作区出现在侧边栏) */
async function waitSignedIn(page) {
  for (let i = 0; i < 10; i++) {
    if (await page.locator('aside').getByText(SPACE_NAME).first().isVisible().catch(() => false)) return true;
    await page.waitForTimeout(2500);
    if (i === 3) await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }
  return false;
}

/** 点击头像后若弹出登录弹窗,说明当前处于未登录态;无论结果如何都关闭弹窗,避免遮罩拦截后续点击 */
async function isSignedOut(page) {
  await avatar(page).click();
  const dialog = authDialog(page);
  const visible = await dialog.isVisible().catch(() => false);
  if (visible) {
    await page.keyboard.press('Escape');
    const closed = await dialog.waitFor({ state: 'hidden', timeout: 5000 }).then(() => true).catch(() => false);
    if (!closed) {
      // 兜底:Esc 未生效时点击弹窗关闭按钮
      await dialog.getByRole('button', { name: /关闭|Close/ }).first().click({ timeout: 5000 }).catch(() => undefined);
      await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    }
    return true;
  }
  await page.keyboard.press('Escape');
  return false;
}

/** 通过头像下拉菜单执行退出登录(菜单为 portal 渲染,带重试与诊断) */
async function signOutViaMenu(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await avatar(page).click();
    const item = page.getByRole('menuitem', { name: /退出登录/ }).first();
    const opened = await item.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (opened) {
      await item.click();
      return true;
    }
    result.menuDiagnostics = await page.locator('[role="menu"]').allInnerTexts().catch(() => []);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }
  return false;
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  attachConsoleFilter(page);
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // 1) 首次访问未登录:点击头像弹出登录弹窗
  log('A1 未登录访问时提供登录入口(头像 → 登录 Atoms 弹窗)', await isSignedOut(page));

  // 2) 注册(复用模式下改为直接登录已存在的 reviewer 账号)
  await submitAuth(page, REUSE ? 'signin' : 'signup', EMAIL, PASSWORD);
  log(REUSE
    ? 'A2 reviewer 账号登录成功并进入登录态(默认工作区已就绪)'
    : 'A2 注册成功并进入登录态(默认工作区自动创建)',
  await waitSignedIn(page), `${EMAIL} | ${SPACE_NAME}`);

  // 3) 令牌与数据准备(REST,构造可恢复的云端数据)
  const session = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY));
  const token = session.access_token;
  const refreshToken = session.refresh_token;
  log('A3 会话已持久化到浏览器存储(access/refresh 齐全)',
    Boolean(token && refreshToken && session.user?.id), `user=${session.user?.id}`);

  const spacesRes = await rest('/rest/v1/spaces?select=id,name,is_default', {}, token);
  const spaces = await spacesRes.json();
  const spaceId = spaces.find((s) => s.is_default)?.id ?? spaces[0]?.id;
  log('A4 云端默认工作区与界面一致', spacesRes.ok && Boolean(spaceId) && spaces.some((s) => s.name === SPACE_NAME),
    `spaces=${spaces.length}`);

  const convRes = await rest('/rest/v1/conversations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: session.user.id, space_id: spaceId, title: CONV_TITLE, status: 'active' }),
  }, token);
  const [conversation] = await convRes.json();
  const projRes = await rest('/rest/v1/projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: session.user.id, space_id: spaceId, name: PROJECT_NAME, source: 'created',
      conversation_id: conversation?.id ?? null, is_demo: false,
      app_html: '<!doctype html><html><body><h1>T31 auth</h1></body></html>',
    }),
  }, token);
  log('A5 云端数据准备完成(会话 + 项目)', convRes.ok && projRes.ok, `conv=${convRes.status} proj=${projRes.status}`);

  // 4) 刷新后登录态与数据保持
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  log('A6 刷新后登录态保持(无需重新登录)', await waitSignedIn(page));
  log('A7 刷新后会话列表恢复', await page.locator('aside').getByText(CONV_TITLE).first().isVisible().catch(() => false));
  await page.goto(`${APP}/projects`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  log('A8 刷新后项目数据恢复(我的项目页)', await page.getByText(PROJECT_NAME).first().isVisible().catch(() => false));

  // 5) 退出登录
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);
  const signedOut = await signOutViaMenu(page);
  await page.waitForTimeout(3000);
  log('A9 退出登录后回到未登录态', signedOut && (await isSignedOut(page)),
    signedOut ? '' : `菜单诊断 ${JSON.stringify(result.menuDiagnostics ?? [])}`);
  log('A10 退出登录后云端数据不再展示(工作区名消失)',
    !(await page.locator('aside').getByText(SPACE_NAME).first().isVisible().catch(() => false)));
  const cleared = await page.evaluate((k) => localStorage.getItem(k) === null, STORAGE_KEY);
  log('A11 退出登录清理本地会话令牌', cleared);

  // 6) 重新登录:数据恢复
  await submitAuth(page, 'signin', EMAIL, PASSWORD);
  log('A12 重新登录成功', await waitSignedIn(page));
  log('A13 重新登录后会话恢复', await page.locator('aside').getByText(CONV_TITLE).first().isVisible().catch(() => false));

  // 7) 清空浏览器存储(模拟本地数据被清)
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  log('A14 清空存储后回到未登录态', await isSignedOut(page));
  await submitAuth(page, 'signin', EMAIL, PASSWORD);
  log('A15 清空存储后重新登录数据完整恢复(工作区 + 会话)',
    (await waitSignedIn(page)) && (await page.locator('aside').getByText(CONV_TITLE).first().isVisible().catch(() => false)));

  // 8) JWT 刷新令牌链路
  const before = JSON.parse(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY));
  const refreshRes = await rest('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: before.refresh_token }),
  });
  const refreshed = await refreshRes.json();
  log('A16 刷新令牌可换取新访问令牌(HTTP 200)',
    refreshRes.ok && Boolean(refreshed.access_token) && refreshed.access_token !== before.access_token,
    `HTTP ${refreshRes.status}`);
  const userRes = await rest('/auth/v1/user', {}, refreshed.access_token);
  log('A17 新访问令牌可访问受保护资源(用户信息)', userRes.ok && (await userRes.json()).id === session.user.id);

  // 9) 无痕上下文(全新浏览器配置,零本地数据)
  const incognito = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ghost = await incognito.newPage();
  attachConsoleFilter(ghost);
  await ghost.goto(APP, { waitUntil: 'domcontentloaded' });
  await ghost.waitForTimeout(3000);
  log('A18 无痕上下文初始为未登录态', await isSignedOut(ghost));
  await submitAuth(ghost, 'signin', EMAIL, PASSWORD);
  log('A19 无痕上下文登录后工作区恢复', await waitSignedIn(ghost));
  log('A20 无痕上下文登录后会话与项目恢复',
    (await ghost.locator('aside').getByText(CONV_TITLE).first().isVisible().catch(() => false))
    && (await (async () => {
      await ghost.goto(`${APP}/projects`, { waitUntil: 'domcontentloaded' });
      await ghost.waitForTimeout(3500);
      return ghost.getByText(PROJECT_NAME).first().isVisible().catch(() => false);
    })()));
  await incognito.close();

  log('A21 无未预期控制台错误', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 3).join(' || '));

  const passed = result.steps.filter((s) => s.ok).length;
  result.passed = passed;
  result.total = result.steps.length;
  console.log(`\nT31 认证全流程走查:${passed}/${result.steps.length} PASS`);
  fs.writeFileSync('t31-auth-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(passed === result.steps.length ? 0 : 1);
} catch (error) {
  console.error('认证走查异常:', error);
  result.passed = result.steps.filter((s) => s.ok).length;
  result.total = result.steps.length;
  fs.writeFileSync('t31-auth-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(1);
}
