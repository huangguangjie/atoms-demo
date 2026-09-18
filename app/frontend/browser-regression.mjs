// 浏览器端真实回归脚本 v3(临时,不入库):严格等待生成开始/结束 + 服务端落库核验
// 修复 v2 缺陷:v2 在生成开始前就断言、并在生成中途刷新页面,导致助手消息/预览/项目断言失真。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN = 'http://127.0.0.1:8899/go';
const PROMPT = '做一个极简白噪音混音器,雨声/海浪/风声三轨切换,浅色主题,中文界面';
const MARK = '白噪音';

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = { steps: [], consoleErrors: [], badResponses: [], agentCalls: [], toasts: [], msgs: [], posts: { conversations: [], messages: [], projects: [] } };
const log = (name, ok, detail = '') => { result.steps.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`); };

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on('response', (r) => {
  const url = r.url();
  if (url.includes('app_atoms_agent_generate')) {
    result.agentCalls.push({ status: r.status() });
  } else if (r.request().method() === 'POST' && url.includes('/rest/v1/conversations')) {
    result.posts.conversations.push(r.status());
  } else if (r.request().method() === 'POST' && url.includes('/rest/v1/messages')) {
    result.posts.messages.push(r.status());
  } else if (r.request().method() === 'POST' && url.includes('/rest/v1/projects')) {
    result.posts.projects.push(r.status());
  } else if (r.status() >= 400 && !url.includes('/api/config')) {
    result.badResponses.push({ status: r.status(), url: url.slice(0, 140) });
  }
});
const collectToasts = async () => {
  for (const t of await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])) result.toasts.push(t.slice(0, 120));
};
const restGet = async (path, token) => (await fetch(`${BASE}${path}`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })).json();

try {
  // 1) 登录注入 + 自愈观察(AuthContext 现已带瞬时 401 有限重试)
  await page.goto(LOGIN, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${APP}/**`, { timeout: 30000 });
  let sidebarOk = false;
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(3000);
    sidebarOk = await page.getByText('browser-1789734428 的 Atoms').first().isVisible().catch(() => false);
    if (sidebarOk) break;
  }
  log('登录后侧边栏空间(含瞬时 401 自愈)', sidebarOk);
  await collectToasts();

  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token'));
    try { return JSON.parse(localStorage.getItem(key))?.access_token ?? null; } catch { return null; }
  });
  log('取得登录态 token', Boolean(token));

  // 2) 发起真实 AI 对话:严格等待「生成开始(停止按钮出现)→ 生成结束(发送按钮回归)」
  await page.getByPlaceholder(/描述你想要构建的应用/).fill(PROMPT);
  await page.getByTitle('发送').click();
  let started = true;
  try { await page.getByTitle('停止生成').waitFor({ state: 'visible', timeout: 30000 }); }
  catch { started = false; }
  log('生成已开始(停止按钮出现)', started, started ? `conversationsPOST=${JSON.stringify(result.posts.conversations)}` : (await page.locator('body').innerText()).slice(0, 200));
  const t0 = Date.now();
  let finished = true;
  try { await page.getByTitle('发送').waitFor({ state: 'visible', timeout: 300000 }); }
  catch { finished = false; }
  log('生成已结束(发送按钮回归)', finished, `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s agentCalls=${JSON.stringify(result.agentCalls)}`);
  await page.waitForTimeout(2500); // 等助手消息落库与项目保存
  await collectToasts();

  // 3) UI 断言:消息渲染 + 无错误 + 预览面板 + 写入请求均 201
  const mainText = await page.locator('main').first().innerText();
  log('用户消息渲染', mainText.includes(MARK));
  const uiErr = mainText.match(/生成出现问题[^\n]*/)?.[0] ?? '';
  log('UI 无生成错误提示', !uiErr, uiErr.slice(0, 160));
  log('应用预览面板出现', (await page.locator('iframe').count()) > 0);
  log('对话/消息/项目写入均 HTTP 201', result.posts.conversations.every((s) => s === 201)
    && result.posts.messages.filter((s) => s === 201).length >= 2
    && result.posts.projects.every((s) => s === 201)
    && result.posts.projects.length >= 1,
    JSON.stringify(result.posts));

  // 4) 服务端落库核验:最新对话 user+assistant 消息(轮询 30s)
  let msgs = [];
  for (let i = 0; i < 15; i++) {
    try {
      const convs = await restGet(`/rest/v1/conversations?title=like.*${encodeURIComponent(MARK)}*&select=id,title&order=created_at.desc&limit=1`, token);
      const conv = Array.isArray(convs) ? convs[0] : null;
      if (conv) {
        msgs = await restGet(`/rest/v1/messages?conversation_id=eq.${conv.id}&select=role,content&order=created_at.asc`, token);
        if (Array.isArray(msgs) && msgs.length >= 2) break;
      }
    } catch { /* 轮询重试 */ }
    await page.waitForTimeout(2000);
  }
  result.msgs = (Array.isArray(msgs) ? msgs : []).map((m) => ({ role: m.role, len: m.content.length, preview: m.content.slice(0, 60) }));
  log('用户+助手消息均落库', result.msgs.some((m) => m.role === 'user') && result.msgs.some((m) => m.role === 'assistant' && m.len > 20), JSON.stringify(result.msgs));

  // 5) 项目落库核验(source=created)
  const projects = await restGet('/rest/v1/projects?source=eq.created&select=name,source,created_at&order=created_at.desc&limit=3', token);
  if (Array.isArray(projects)) result.projects = projects;
  log('AI 生成项目落库(source=created)', result.projects.length > 0, JSON.stringify(result.projects).slice(0, 200));

  // 6) 刷新后最近对话回放(用户+助手消息均回放)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const recent = page.getByText(MARK, { exact: false }).first();
  const recentVisible = await recent.isVisible().catch(() => false);
  log('刷新后最近对话出现在侧边栏', recentVisible);
  if (recentVisible) {
    await recent.click();
    await page.waitForTimeout(3000);
    const replay = await page.locator('main').first().innerText();
    log('历史消息回放(含助手内容)', replay.includes(MARK) && replay.length > PROMPT.length + 60, `len=${replay.length}`);
  }
  await page.screenshot({ path: '/workspace/.tmp-browser-final3.png' });
} catch (err) {
  log('脚本异常', false, String(err).slice(0, 300));
  await page.screenshot({ path: '/workspace/.tmp-browser-error3.png' }).catch(() => {});
}
console.log('AGENT_CALLS ' + JSON.stringify(result.agentCalls));
console.log('BAD_RESPONSES ' + JSON.stringify(result.badResponses.slice(0, 8)));
console.log('TOASTS ' + JSON.stringify(result.toasts.slice(0, 6)));
console.log('CONSOLE_ERRORS ' + JSON.stringify(result.consoleErrors.slice(0, 8)));
await browser.close();
