// T7 工作区与会话结构回归:注册新账号 → 默认工作区自动就绪 → 新建会话生成落库 → 新建/切换工作区会话隔离 → 刷新恢复
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t7-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const PREFIX = `t7-${TS}`;
const DEFAULT_SPACE = `${PREFIX} 的 Atoms`;
const NEW_SPACE = '产品探索';
const PROMPT = '做一个极简番茄钟,25 分钟专注 + 5 分钟休息,浅色主题,中文界面';
const MARK = '番茄钟';

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = {
  steps: [], consoleErrors: [], badResponses: [],
  posts: { conversations: [], messages: [], projects: [], spaces: [] },
};
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('response', (r) => {
  const url = r.url();
  if (r.request().method() === 'POST') {
    if (url.includes('/rest/v1/conversations')) result.posts.conversations.push(r.status());
    else if (url.includes('/rest/v1/messages')) result.posts.messages.push(r.status());
    else if (url.includes('/rest/v1/projects')) result.posts.projects.push(r.status());
    else if (url.includes('/rest/v1/spaces')) result.posts.spaces.push(r.status());
  } else if (r.status() >= 400 && !url.includes('/api/config')) {
    result.badResponses.push({ status: r.status(), url: url.slice(0, 140) });
  }
});
const restGet = async (path, token) => {
  const resp = await fetch(`${BASE}${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
  if (!resp.ok) throw new Error(`${path} -> HTTP ${resp.status}`);
  return resp.json();
};
const getToken = () => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
  try { return JSON.parse(localStorage.getItem(key))?.access_token ?? null; } catch { return null; }
});

try {
  // 1) 注册新账号(mailer_autoconfirm 开启;DB 触发器应在注册瞬间建好 profile + 默认工作区)
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册新账号', signupResp.ok, `HTTP ${signupResp.status}`);

  // 2) 真实密码登录注入会话
  await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${APP}/**`, { timeout: 30000 });
  let defaultSpaceVisible = false;
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(3000);
    defaultSpaceVisible = await page.locator('aside').getByText(DEFAULT_SPACE).first().isVisible().catch(() => false);
    if (defaultSpaceVisible) break;
  }
  log('登录后默认工作区自动就绪(触发器)', defaultSpaceVisible, DEFAULT_SPACE);

  const token = await getToken();
  log('取得登录态 token', Boolean(token));

  // 3) 服务端核验:spaces 存在默认工作区
  let spaces = [];
  try { spaces = await restGet('/rest/v1/spaces?select=id,name,is_default&order=created_at.asc', token); } catch (e) { log('读取 spaces 失败', false, String(e)); }
  const defaultSpace = Array.isArray(spaces) ? spaces.find((s) => s.is_default) : null;
  log('服务端存在默认工作区', Boolean(defaultSpace), JSON.stringify(spaces));

  // 4) 「新会话」入口 → 发起 AI 对话
  await page.getByTitle('在当前工作区新建会话').click();
  await page.waitForTimeout(1000);
  await page.getByPlaceholder('@David 进行数据开发。').fill(PROMPT);
  await page.getByTitle('发送').click();
  let started = true;
  try { await page.getByTitle('停止生成').waitFor({ state: 'visible', timeout: 30000 }); } catch { started = false; }
  log('生成已开始(新会话)', started);
  const t0 = Date.now();
  let finished = true;
  try { await page.getByTitle('发送').waitFor({ state: 'visible', timeout: 300000 }); } catch { finished = false; }
  log('生成已结束', finished, `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.waitForTimeout(2500);
  const mainText = await page.locator('main').first().innerText();
  log('对话内容渲染', mainText.includes(MARK));
  log('会话/消息/项目写入均 201', result.posts.conversations.every((s) => s === 201)
    && result.posts.messages.filter((s) => s === 201).length >= 2
    && result.posts.projects.length >= 1
    && result.posts.projects.every((s) => s === 201), JSON.stringify(result.posts));

  // 5) 会话归属默认工作区
  let convs = [];
  try { convs = await restGet('/rest/v1/conversations?select=id,space_id,title&order=created_at.desc&limit=3', token); } catch { /* 轮询重试 */ }
  const conv = Array.isArray(convs) ? convs[0] : null;
  log('新会话 space_id=默认工作区', Boolean(conv && defaultSpace && conv.space_id === defaultSpace.id), JSON.stringify(convs));

  // 6) 新建工作区 → 会话隔离
  await page.locator('aside').getByText(/选择工作区|的 Atoms/).first().click();
  await page.getByRole('menuitem', { name: '新建工作区' }).click();
  await page.getByPlaceholder('例如:产品探索、个人实验').fill(NEW_SPACE);
  await page.getByRole('button', { name: '创建工作区' }).click();
  let newSpaceActive = false;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    newSpaceActive = await page.locator('aside').getByText(NEW_SPACE).first().isVisible().catch(() => false);
    if (newSpaceActive) break;
  }
  log('新建工作区并自动切换', newSpaceActive, NEW_SPACE);
  let emptyTip = false;
  for (let i = 0; i < 4; i++) {
    emptyTip = await page.locator('aside').getByText('当前工作区还没有会话').isVisible().catch(() => false);
    if (emptyTip) break;
    await page.waitForTimeout(1500);
  }
  log('新工作区会话列表为空(隔离)', emptyTip);
  let newSpaceId = Array.isArray(spaces) ? spaces.find((s) => s.name === NEW_SPACE)?.id ?? null : null;
  for (let i = 0; i < 3 && !newSpaceId; i++) {
    await page.waitForTimeout(1500);
    try {
      const refetched = await restGet('/rest/v1/spaces?select=id,name,is_default', token);
      newSpaceId = (Array.isArray(refetched) ? refetched.find((s) => s.name === NEW_SPACE) : null)?.id ?? null;
    } catch { /* 轮询重试 */ }
  }
  if (newSpaceId) {
    try {
      const inNew = await restGet(`/rest/v1/conversations?space_id=eq.${newSpaceId}&select=id`, token);
      log('服务端核验:新工作区 0 会话', Array.isArray(inNew) && inNew.length === 0, JSON.stringify(inNew));
    } catch (e) { log('服务端核验新工作区会话失败', false, String(e)); }
  } else {
    log('服务端核验:新工作区 0 会话', false, '未取得新工作区 id');
  }

  // 7) 切回默认工作区 → 最近会话恢复
  await page.locator('aside').getByText(NEW_SPACE).first().click();
  await page.getByRole('menuitem', { name: DEFAULT_SPACE }).click();
  let backOk = false;
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    const visible = await page.locator('aside').getByText(MARK).first().isVisible().catch(() => false);
    if (visible) { backOk = true; break; }
  }
  log('切回默认工作区后最近会话恢复', backOk);

  // 8) 刷新后:默认工作区为当前 + 最近会话仍在
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const refreshSpace = await page.locator('aside').getByText(DEFAULT_SPACE).first().isVisible().catch(() => false);
  const refreshConv = await page.locator('aside').getByText(MARK).first().isVisible().catch(() => false);
  log('刷新后默认工作区仍为当前', refreshSpace);
  log('刷新后最近会话仍在', refreshConv);
  await page.screenshot({ path: '/workspace/.tmp-t7-final.png' });
} catch (err) {
  log('脚本异常', false, String(err).slice(0, 300));
  await page.screenshot({ path: '/workspace/.tmp-t7-error.png' }).catch(() => {});
}
console.log('POSTS ' + JSON.stringify(result.posts));
console.log('BAD_RESPONSES ' + JSON.stringify(result.badResponses.slice(0, 8)));
console.log('CONSOLE_ERRORS ' + JSON.stringify(result.consoleErrors.slice(0, 8)));
await browser.close();
