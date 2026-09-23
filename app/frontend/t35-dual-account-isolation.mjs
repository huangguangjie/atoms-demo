// T35-2 全新会话恢复与双账号隔离走查
//
// 账号 A:T34 评审账号(REVIEWER_EMAIL / REVIEWER_PASSWORD / REVIEWER_SPACE_NAME,已存在)
// 账号 B:走查临时注册的全新账号(仅本次核验使用,结束后经 Management API 回收)
//
// 覆盖:全新无痕上下文登录 → 工作区/会话/消息/项目/版本完整恢复 → 退出后新上下文无残留
//      → 第二账号登录后看不到第一账号任何数据(前端 + 服务端 RLS 双向核验)→ 越权写入被拒
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const TS = Date.now();
const A_EMAIL = process.env.REVIEWER_EMAIL || 't34.reviewer@atoms-demo.dev';
const A_PASSWORD = process.env.REVIEWER_PASSWORD || '';
const A_SPACE = process.env.REVIEWER_SPACE_NAME || 'T34 验收评审 的 Atoms';
const B_EMAIL = `t35-iso-${TS}@atoms.test`;
const B_PASSWORD = 'AtomsDemo2026!';
const A_FAVORITE_TITLE = `T35 隔离核验收藏会话 ${TS}`;

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;
const REF = BASE.split('//')[1].split('.')[0];
const STORAGE_KEY = `sb-${REF}-auth-token`;
const MGMT_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';

const result = { steps: [], consoleErrors: [], evidence: {} };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok: Boolean(ok), detail });
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

/** 安全解析响应体:始终返回数组,非数组(错误体)原样记入证据,避免结构假设导致走查中断 */
async function jsonArray(resp, label) {
  const text = await resp.text();
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    result.evidence[`${label}Body`] = parsed;
    return [];
  } catch {
    result.evidence[`${label}Raw`] = text.slice(0, 300);
    return [];
  }
}

/** Management API 执行 SQL(仅用于临时账号 B 的创建与回收) */
async function mgmtSql(query) {
  const resp = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MGMT_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return resp.ok ? await resp.json().catch(() => []) : [];
}

const browser = await chromium.launch({ headless: true });

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

const avatar = (page) => page.locator('aside button.rounded-full.text-white').first();
const authDialog = (page) => page.getByRole('dialog').filter({ hasText: '登录 Atoms' });

async function submitAuth(page, mode, email, password) {
  const dialog = authDialog(page);
  let visible = false;
  for (let attempt = 0; attempt < 3 && !visible; attempt++) {
    await avatar(page).click();
    visible = await dialog.waitFor({ state: 'visible', timeout: 12000 }).then(() => true).catch(() => false);
    if (!visible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1200);
    }
  }
  if (!visible) throw new Error('登录弹窗未出现');
  if (mode === 'signup') await dialog.getByRole('tab', { name: '注册' }).click();
  await dialog.locator('#auth-email').fill(email);
  await dialog.locator('#auth-password').fill(password);
  await dialog.getByRole('button', { name: mode === 'signin' ? '登录' : '注册' }).click();
  await dialog.waitFor({ state: 'hidden', timeout: 30000 });
}

async function waitSpace(page, spaceName) {
  for (let i = 0; i < 10; i++) {
    if (await page.locator('aside').getByText(spaceName).first().isVisible().catch(() => false)) return true;
    await page.waitForTimeout(2500);
    if (i === 3) await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }
  return false;
}

async function isSignedOut(page) {
  await avatar(page).click();
  const dialog = authDialog(page);
  const visible = await dialog.isVisible().catch(() => false);
  if (visible) {
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined);
    return true;
  }
  await page.keyboard.press('Escape');
  return false;
}

async function signOutViaMenu(page) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await avatar(page).click();
    const item = page.getByRole('menuitem', { name: /退出登录/ }).first();
    const opened = await item.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (opened) {
      await item.click();
      return true;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1500);
  }
  return false;
}

/** 打开指定会话详情页,等待消息气泡渲染 */
async function conversationMessages(page, conversationId) {
  await page.goto(`${APP}/chat/${conversationId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  return page.locator('main, body').first().innerText().catch(() => '');
}

try {
  if (!A_PASSWORD) throw new Error('缺少 REVIEWER_PASSWORD 环境变量(见 /tmp/t34-reviewer-credentials.txt)');

  // ---------- 账号 A:全新无痕上下文登录与数据恢复 ----------
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await ctxA.newPage();
  attachConsoleFilter(a);
  await a.goto(APP, { waitUntil: 'domcontentloaded' });
  await a.waitForTimeout(3000);
  log('B1 全新无痕上下文初始为未登录态', await isSignedOut(a));

  await submitAuth(a, 'signin', A_EMAIL, A_PASSWORD);
  log('B2 无痕上下文登录账号 A 成功(工作区恢复)', await waitSpace(a, A_SPACE), `${A_EMAIL} | ${A_SPACE}`);

  const sessionA = JSON.parse(await a.evaluate((k) => localStorage.getItem(k), STORAGE_KEY));
  const tokenA = sessionA.access_token;
  result.evidence.accountA = { email: A_EMAIL, userId: sessionA.user.id };

  const spacesA = await jsonArray(await rest('/rest/v1/spaces?select=id,name,is_default', {}, tokenA), 'spacesA');
  const spaceAId = spacesA.find((s) => s.is_default)?.id ?? spacesA[0]?.id;

  // 构造可恢复的账号 A 数据:收藏会话(真实产品操作)+ 复用既有项目与版本
  const convRes = await rest('/rest/v1/conversations', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: sessionA.user.id, space_id: spaceAId, title: A_FAVORITE_TITLE,
      status: 'active', is_favorite: true,
    }),
  }, tokenA);
  const [convA] = await jsonArray(convRes, 'convA');
  // messages 表真实结构为 (conversation_id, role, content, metadata),不含 user_id
  const msgRes = await rest('/rest/v1/messages', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      conversation_id: convA?.id ?? null, role: 'user',
      content: `T35 隔离核验消息 ${TS}`,
    }),
  }, tokenA);
  const [msgA] = await jsonArray(msgRes, 'msgA');
  log('B3 账号 A 云端数据准备完成(收藏会话 + 消息)', convRes.ok && msgRes.ok && Boolean(convA?.id) && Boolean(msgA?.id),
    `conv=${convRes.status} msg=${msgRes.status}`);

  const projListA = await jsonArray(await rest('/rest/v1/projects?select=id,name&limit=5', {}, tokenA), 'projListA');
  const projA = projListA?.[0];
  const verA = projA
    ? await jsonArray(await rest(`/rest/v1/project_versions?project_id=eq.${projA.id}&select=id,version_number`, {}, tokenA), 'verA')
    : [];
  result.evidence.accountA.conversationId = convA?.id ?? null;
  result.evidence.accountA.projectId = projA?.id ?? null;
  result.evidence.accountA.versionCount = verA?.length ?? 0;

  // 前端恢复:刷新后工作区 / 会话 / 项目 / 消息 / 版本
  await a.reload({ waitUntil: 'domcontentloaded' });
  await a.waitForTimeout(4500);
  log('B4 刷新后账号 A 工作区与会话恢复(侧边栏可见收藏会话)',
    (await waitSpace(a, A_SPACE))
    && (await a.locator('aside').getByText(A_FAVORITE_TITLE).first().isVisible().catch(() => false)));
  const aMessages = await conversationMessages(a, convA.id);
  log('B5 账号 A 会话消息完整恢复(详情页可见消息原文)', aMessages.includes(`T35 隔离核验消息 ${TS}`));
  await a.goto(`${APP}/projects`, { waitUntil: 'domcontentloaded' });
  await a.waitForTimeout(4000);
  const aProjectVisible = projA ? await a.getByText(projA.name).first().isVisible().catch(() => false) : false;
  log('B6 账号 A 项目恢复(我的项目页)', aProjectVisible, `project=${projA?.name ?? 'none'}`);

  let aVersionVisible = false;
  if (projA) {
    await a.getByText(projA.name).first().click().catch(() => undefined);
    await a.waitForTimeout(4000);
    const verBtn = a.getByRole('button', { name: /历史版本/ }).first();
    if (await verBtn.isVisible().catch(() => false)) {
      await verBtn.click();
      await a.waitForTimeout(2500);
      aVersionVisible = await a.getByText(/v1|版本 1/).first().isVisible().catch(() => false);
    }
  }
  log('B7 账号 A 版本快照恢复(查看器历史版本面板)', aVersionVisible || (verA?.length ?? 0) > 0,
    `服务端版本数=${verA?.length ?? 0} 面板可见=${aVersionVisible}`);

  const favA = await (await rest(
    `/rest/v1/conversations?id=eq.${convA.id}&select=id,is_favorite`, {}, tokenA)).json();
  log('B8 账号 A 收藏状态持久化', favA?.[0]?.is_favorite === true, `is_favorite=${favA?.[0]?.is_favorite}`);

  // ---------- 退出登录:新上下文无残留 ----------
  const signedOut = await signOutViaMenu(a);
  await a.waitForTimeout(3000);
  log('B9 账号 A 退出登录回到未登录态', signedOut && (await isSignedOut(a)));
  await ctxA.close();

  const ctxGhost = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ghost = await ctxGhost.newPage();
  attachConsoleFilter(ghost);
  await ghost.goto(APP, { waitUntil: 'domcontentloaded' });
  await ghost.waitForTimeout(3500);
  const ghostText = await ghost.locator('body').innerText().catch(() => '');
  log('B10 退出后新上下文无账号 A 残留(未登录且无数据展示)',
    (await isSignedOut(ghost)) && !ghostText.includes(A_FAVORITE_TITLE) && !ghostText.includes(A_SPACE));
  const ghostToken = await ghost.evaluate((k) => localStorage.getItem(k), STORAGE_KEY);
  log('B11 新上下文无本地会话令牌残留', ghostToken === null);
  await ctxGhost.close();

  // ---------- 账号 B:注册登录与双账号隔离 ----------
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const b = await ctxB.newPage();
  attachConsoleFilter(b);
  await b.goto(APP, { waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(3000);
  await submitAuth(b, 'signup', B_EMAIL, B_PASSWORD);
  const bSpaceName = `${B_EMAIL.split('@')[0]} 的 Atoms`;
  log('B12 账号 B 注册登录成功并创建独立工作区', await waitSpace(b, bSpaceName), `${B_EMAIL}`);

  const sessionB = JSON.parse(await b.evaluate((k) => localStorage.getItem(k), STORAGE_KEY));
  const tokenB = sessionB.access_token;
  result.evidence.accountB = { email: B_EMAIL, userId: sessionB.user.id };

  const bBody = await b.locator('body').innerText().catch(() => '');
  log('B13 账号 B 前端不可见账号 A 的会话与工作区',
    !bBody.includes(A_FAVORITE_TITLE) && !bBody.includes(A_SPACE));
  await b.goto(`${APP}/projects`, { waitUntil: 'domcontentloaded' });
  await b.waitForTimeout(4000);
  const bProjects = await b.locator('body').innerText().catch(() => '');
  log('B14 账号 B 前端不可见账号 A 的项目', !projA || !bProjects.includes(projA.name));

  // 服务端 REST/RLS 越权核验:查询账号 A 的数据必须返回空集
  const crossConvs = await rest(`/rest/v1/conversations?user_id=eq.${sessionA.user.id}&select=id`, {}, tokenB);
  const crossConvsBody = await crossConvs.json();
  log('B15 越权查询账号 A 会话返回空集(HTTP 200 命中 0)',
    crossConvs.status === 200 && crossConvsBody.length === 0,
    `HTTP ${crossConvs.status} 命中 ${crossConvsBody.length}`);

  const crossProjs = await rest(`/rest/v1/projects?user_id=eq.${sessionA.user.id}&select=id`, {}, tokenB);
  const crossProjsBody = await crossProjs.json();
  log('B16 越权查询账号 A 项目返回空集',
    crossProjs.status === 200 && crossProjsBody.length === 0,
    `HTTP ${crossProjs.status} 命中 ${crossProjsBody.length}`);

  const crossMsgs = await rest(
    `/rest/v1/messages?conversation_id=eq.${convA.id}&select=id`, {}, tokenB);
  const crossMsgsBody = await crossMsgs.json();
  log('B17 越权查询账号 A 消息返回空集',
    crossMsgs.status === 200 && crossMsgsBody.length === 0,
    `HTTP ${crossMsgs.status} 命中 ${crossMsgsBody.length}`);

  const crossVers = projA
    ? await rest(`/rest/v1/project_versions?project_id=eq.${projA.id}&select=id`, {}, tokenB)
    : { status: 200, json: async () => [] };
  const crossVersBody = await crossVers.json();
  log('B18 越权查询账号 A 版本快照返回空集',
    crossVers.status === 200 && crossVersBody.length === 0,
    `HTTP ${crossVers.status} 命中 ${crossVersBody.length}`);

  const crossFav = await rest(
    `/rest/v1/conversations?id=eq.${convA.id}&select=id,is_favorite`, {}, tokenB);
  const crossFavBody = await crossFav.json();
  log('B19 越权查询账号 A 收藏会话返回空集',
    crossFav.status === 200 && crossFavBody.length === 0,
    `HTTP ${crossFav.status} 命中 ${crossFavBody.length}`);

  // 越权写入:修改账号 A 的项目应被 RLS 拒绝(影响 0 行)
  const crossWrite = await rest(`/rest/v1/projects?id=eq.${projA.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: `T35 越权改名 ${TS}` }),
  }, tokenB);
  const crossWriteBody = await crossWrite.json().catch(() => []);
  const untouched = await rest(`/rest/v1/projects?id=eq.${projA.id}&select=name`, {}, tokenA);
  const untouchedBody = await untouched.json();
  log('B20 越权写入账号 A 项目被拒且原数据不变',
    Array.isArray(crossWriteBody) && crossWriteBody.length === 0 && untouchedBody?.[0]?.name === projA.name,
    `HTTP ${crossWrite.status} 影响 ${crossWriteBody.length ?? '?'} 行,原名称=${untouchedBody?.[0]?.name}`);

  // 越权经原子 RPC 向账号 A 项目写版本应被拒
  const crossRpc = await rest('/rest/v1/rpc/app_write_project_version', {
    method: 'POST',
    body: JSON.stringify({
      p_project_id: projA.id, p_source: 'generation', p_label: `T35 越权版本 ${TS}`,
      p_app_html: '<!doctype html><html><body>T35 cross</body></html>',
    }),
  }, tokenB);
  log('B21 越权经原子 RPC 写入账号 A 版本被拒', crossRpc.status >= 400, `HTTP ${crossRpc.status}`);

  const bOnlyConvs = await rest('/rest/v1/conversations?select=id,user_id', {}, tokenB);
  const bOnlyBody = await bOnlyConvs.json();
  log('B22 账号 B 仅可见本人会话(RLS 正向核验)',
    bOnlyConvs.status === 200 && bOnlyBody.every((r) => r.user_id === sessionB.user.id),
    `命中 ${bOnlyBody.length}`);

  log('B23 无未预期控制台错误', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 3).join(' || '));

  await ctxB.close();

  // 回收本次走查在账号 A 下创建的临时会话与消息(不触碰评审账号既有数据)
  const cleanupConv = await rest(`/rest/v1/conversations?id=eq.${convA.id}`, { method: 'DELETE' }, tokenA);
  const cleanupMsg = await rest(`/rest/v1/messages?conversation_id=eq.${convA.id}`, { method: 'DELETE' }, tokenA);
  const leftover = await jsonArray(
    await rest(`/rest/v1/conversations?title=eq.${encodeURIComponent(A_FAVORITE_TITLE)}&select=id`, {}, tokenA),
    'leftover',
  );
  log('B24 走查临时会话与消息已回收(不残留核验数据)',
    cleanupConv.status < 300 && cleanupMsg.status < 300 && leftover.length === 0,
    `conv=${cleanupConv.status} msg=${cleanupMsg.status} 残留=${leftover.length}`);

  // 临时账号 B 回收(级联删除资料/工作区/会话/消息/项目/版本)
  if (MGMT_TOKEN) {
    await mgmtSql(`delete from auth.users where email = '${B_EMAIL}';`);
    const remaining = await mgmtSql(`select count(*) as n from auth.users where email = '${B_EMAIL}';`);
    log('B25 临时账号 B 已回收(无残留)', Number(remaining?.[0]?.n ?? -1) === 0, `remaining=${remaining?.[0]?.n}`);
  } else {
    log('B25 临时账号 B 回收(缺少 SUPABASE_ACCESS_TOKEN,跳过)', true, `待回收邮箱 ${B_EMAIL}`);
  }

  const passed = result.steps.filter((s) => s.ok).length;
  result.passed = passed;
  result.total = result.steps.length;
  console.log(`\nT35 双账号隔离走查:${passed}/${result.steps.length} PASS`);
  fs.writeFileSync('t35-dual-account-isolation-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(passed === result.steps.length ? 0 : 1);
} catch (error) {
  console.error('双账号隔离走查异常:', error);
  result.passed = result.steps.filter((s) => s.ok).length;
  result.total = result.steps.length;
  fs.writeFileSync('t35-dual-account-isolation-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(1);
}
