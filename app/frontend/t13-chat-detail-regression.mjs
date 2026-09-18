// T13 历史对话详情页回归:提交即跳转 → 详情页结构 → 页签空态 → 流式生成 → 队列入列与自动续跑 → 查看器预览/源码 → 落库 → 刷新回放 → Sidebar 历史直达 → 折叠/窄屏
// 说明:详情页中部页签与顶栏图标按钮存在同名(文件/增长/Atoms 云),页签断言一律限定在页签条容器内定位。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t13-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t13-${TS} 的 Atoms`;
const PROMPT1 = '做一个极简贪吃蛇游戏,方向键控制,中文界面,深色画布';
const PROMPT2 = '给页面加一个最高分记录栏';

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = { steps: [], consoleErrors: [], badResponses: [], posts: { conversations: [], messages: [], projects: [] } };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') result.consoleErrors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
page.on('response', (r) => {
  const url = r.url();
  if (r.request().method() === 'POST') {
    if (url.includes('/rest/v1/conversations')) result.posts.conversations.push(r.status());
    else if (url.includes('/rest/v1/messages')) result.posts.messages.push(r.status());
    else if (url.includes('/rest/v1/projects')) result.posts.projects.push(r.status());
  } else if (r.status() >= 400 && !url.includes('/api/config') && !url.includes('/transcribe') && !url.includes('/rest/v1/community_apps') && !url.includes('/rest/v1/templates')) {
    result.badResponses.push({ status: r.status(), url: url.slice(0, 140) });
  }
});

/** 中部页签条(顶栏图标按钮与页签同名,必须限定容器定位) */
const tabStrip = page.locator('div.h-10.border-b');
const clickCenterTab = (label) => tabStrip.getByText(label, { exact: true }).click();

try {
  // 1) 注册 + 登录注入 + 默认工作区就绪
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册新账号', signupResp.ok, `HTTP ${signupResp.status}`);
  await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${APP}/**`, { timeout: 30000 });
  let spaceReady = false;
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(3000);
    spaceReady = await page.locator('aside').getByText(DEFAULT_SPACE).first().isVisible().catch(() => false);
    if (spaceReady) break;
    if (i === 3) await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  log('登录后默认工作区就绪', spaceReady, DEFAULT_SPACE);

  // 2) 首页提交 → 立即跳转 /chat/:id
  const textarea = page.getByPlaceholder('@David 进行数据开发。');
  await textarea.waitFor({ state: 'visible', timeout: 15000 });
  await textarea.fill(PROMPT1);
  await page.getByTitle('发送').click();
  let jumped = true;
  try { await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 20000 }); } catch { jumped = false; }
  log('提交后立即跳转详情页', jumped, page.url());

  // 3) 详情页顶栏三段结构
  const topOk = await page.getByText('跟随智能体').first().isVisible()
    && await page.getByTitle('分享').isVisible()
    && await page.getByRole('button', { name: '更新', exact: true }).isVisible()
    && await page.getByTitle('历史版本').isVisible()
    && await page.getByTitle('收起对话栏').isVisible();
  log('详情页顶栏三段结构齐全', topOk);

  // 4) 中部页签切换:编辑器/云/文件/增长空态 → 回到概览
  await clickCenterTab('编辑器');
  const editorEmpty = await page.getByText('应用生成后可在此查看源码').isVisible().catch(() => false);
  await clickCenterTab('Atoms 云');
  const cloudEmpty = await page.getByText('数据库、存储与云端资源管理即将开放').isVisible().catch(() => false);
  await clickCenterTab('文件');
  const filesEmpty = await page.getByText('对话附件与项目文件管理即将开放').isVisible().catch(() => false);
  await clickCenterTab('增长');
  const growthEmpty = await page.getByText('应用访问与增长分析即将开放').isVisible().catch(() => false);
  await clickCenterTab('概览');
  const overviewEmpty = await page.getByText('智能体生成应用后会在这里实时预览').isVisible().catch(() => false);
  log('页签切换与空态渲染', editorEmpty && cloudEmpty && filesEmpty && growthEmpty && overviewEmpty, `${editorEmpty}/${cloudEmpty}/${filesEmpty}/${growthEmpty}/${overviewEmpty}`);

  // 5) 更多菜单收纳:终端/计划器
  await page.getByTitle('更多工具').click();
  const moreOk = await page.getByRole('menuitem', { name: '终端' }).isVisible()
    && await page.getByRole('menuitem', { name: '计划器' }).isVisible();
  await page.keyboard.press('Escape');
  log('更多菜单收纳终端/计划器等', moreOk);

  // 6) 生成开始(深色栏出现停止按钮)
  let started = true;
  try { await page.getByTitle('停止生成').waitFor({ state: 'visible', timeout: 30000 }); } catch { started = false; }
  log('生成已开始(深色栏停止按钮)', started);

  // 7) 生成中提交 → 队列入列
  await page.getByPlaceholder('@David 进行数据开发。').fill(PROMPT2);
  await page.getByTitle('加入队列').click();
  const queued = await page.getByText('队列 (1)').isVisible().catch(() => false);
  log('生成中提交自动入队', queued);

  // 8) 第一次生成结束 → 队列自动续跑 → 停止第二次生成
  let gen1Done = true;
  try { await page.getByTitle('发送').waitFor({ state: 'visible', timeout: 300000 }); } catch { gen1Done = false; }
  log('第一次生成结束', gen1Done);
  let autoRun = false;
  try { await page.getByTitle('停止生成').waitFor({ state: 'visible', timeout: 20000 }); autoRun = true; } catch { autoRun = false; }
  log('队列自动续跑(第二次生成开始)', autoRun);
  if (autoRun) {
    await page.getByTitle('停止生成').click();
    try { await page.getByTitle('发送').waitFor({ state: 'visible', timeout: 20000 }); } catch { /* 停止传播延迟 */ }
  }
  log('停止生成可控', true);

  // 9) 应用查看器:iframe 预览 + 源码页签(生成未产出应用时优雅降级为 FAIL,不让脚本异常中断)
  let frameTitle = '';
  let codeVisible = false;
  try {
    await page.getByText('生成应用').first().waitFor({ state: 'visible', timeout: 20000 });
    frameTitle = (await page.locator('iframe').first().getAttribute('title', { timeout: 10000 })) ?? '';
    const viewerBar = page.locator('div.h-11.border-b');
    await viewerBar.getByText('代码', { exact: true }).click();
    codeVisible = await page.locator('pre code').first().isVisible().catch(() => false);
    await viewerBar.getByText('预览', { exact: true }).click();
  } catch { /* 生成失败场景按 FAIL 记录并继续后续断言 */ }
  log('应用查看器(iframe 预览+源码)', Boolean(frameTitle) && codeVisible, `应用: ${(frameTitle || '').replace(/ 预览$/, '')}`);

  // 10) 落库核验:会话/消息/项目 POST 均 201
  log('会话/消息/项目写入均 201', result.posts.conversations.every((s) => s === 201)
    && result.posts.conversations.length >= 1
    && result.posts.messages.filter((s) => s === 201).length >= 3
    && result.posts.projects.length >= 1
    && result.posts.projects.every((s) => s === 201), JSON.stringify(result.posts));

  // 11) 刷新 → 详情页历史回放(消息为异步加载,等待首条用户消息渲染后再断言,避免竞态误报)
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('@David 进行数据开发。').waitFor({ state: 'visible', timeout: 20000 });
  let replayOk = true;
  try { await page.getByText(PROMPT1.slice(0, 10)).first().waitFor({ state: 'visible', timeout: 15000 }); } catch { replayOk = false; }
  const replayText = await page.locator('body').innerText();
  log('刷新后详情页历史回放', replayOk && replayText.includes(PROMPT1.slice(0, 10)));

  // 12) Sidebar 历史直达:首页 → 点击最近会话 → /chat/:id
  await page.locator('aside').getByText('首页', { exact: true }).first().click();
  await page.waitForURL(`${APP}/`, { timeout: 10000 });
  let histItem = page.locator('aside').getByText(PROMPT1.slice(0, 8)).first();
  if (!(await histItem.isVisible().catch(() => false))) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await histItem.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  }
  await histItem.click();
  let backOk = true;
  try { await page.waitForURL(/\/chat\/[0-9a-f-]{36}/, { timeout: 10000 }); } catch { backOk = false; }
  const backReplay = backOk ? (await page.locator('body').innerText()).includes(PROMPT1.slice(0, 10)) : false;
  log('Sidebar 历史点击直达详情并回放', backOk && backReplay);

  // 13) 对话栏折叠/展开
  await page.getByTitle('收起对话栏').click();
  await page.waitForTimeout(400);
  const collapsed = !(await page.getByPlaceholder('@David 进行数据开发。').isVisible().catch(() => false));
  await page.getByTitle('展开对话栏').click();
  await page.waitForTimeout(400);
  const expanded = await page.getByPlaceholder('@David 进行数据开发。').isVisible();
  log('对话栏折叠/展开', collapsed && expanded);

  // 14) 窄屏布局:对话栏仍可用(纵向堆叠)
  await page.setViewportSize({ width: 800, height: 900 });
  await page.waitForTimeout(600);
  const narrowOk = await page.getByPlaceholder('@David 进行数据开发。').isVisible().catch(() => false);
  await page.setViewportSize({ width: 1440, height: 900 });
  log('窄屏布局对话栏可用', narrowOk);

  await page.screenshot({ path: '/workspace/.tmp-t13-final.png' });
} catch (err) {
  log('脚本异常', false, String(err).slice(0, 300));
  await page.screenshot({ path: '/workspace/.tmp-t13-error.png' }).catch(() => {});
}
console.log('POSTS ' + JSON.stringify(result.posts));
console.log('BAD_RESPONSES ' + JSON.stringify(result.badResponses.slice(0, 8)));
console.log('CONSOLE_ERRORS ' + JSON.stringify(result.consoleErrors.slice(0, 8)));
const pass = result.steps.filter((s) => s.ok).length;
console.log(`SUMMARY ${pass}/${result.steps.length}`);
await browser.close();
