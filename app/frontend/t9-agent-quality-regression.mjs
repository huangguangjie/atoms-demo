// T9 智能体生成质量优化回归:登录 → 复合三分区提示词生成 → 计划卡(布局规划)→ 预览 iframe 质量断言 → 落库 → 历史回放
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t9-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t9-${TS} 的 Atoms`;
// 与截图同源的复合提示词:介绍 + 游戏本体 + 玩法文档 三分区
const PROMPT =
  '做一个贪吃蛇游戏应用,页面左边要有应用介绍文案,中间是游戏本体,右边放玩法说明文档(用列表逐条写清楚),键盘方向键控制,有得分统计。';

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = {
  steps: [], consoleErrors: [], badResponses: [],
  posts: { conversations: [], messages: [], projects: [] },
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
  } else if (r.status() >= 400 && !url.includes('/api/config') && !url.includes('/transcribe')) {
    result.badResponses.push({ status: r.status(), url: url.slice(0, 140) });
  }
});

try {
  // 1) 注册新账号
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册新账号', signupResp.ok, `HTTP ${signupResp.status}`);

  // 2) 登录注入会话,默认工作区就绪
  await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${APP}/**`, { timeout: 30000 });
  let spaceReady = false;
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(3000);
    spaceReady = await page.locator('aside').getByText(DEFAULT_SPACE).first().isVisible().catch(() => false);
    if (spaceReady) break;
  }
  log('登录后默认工作区就绪', spaceReady, DEFAULT_SPACE);

  // 3) 发起复合三分区提示词生成
  const textarea = page.getByPlaceholder('@David 进行数据开发。');
  await textarea.waitFor({ state: 'visible', timeout: 15000 });
  await textarea.fill(PROMPT);
  const sendBtn = page.getByTitle('发送');
  await sendBtn.click();

  // 4) 分步计划卡出现,且计划含布局/Flex/Grid 规划(T9 布局规划管线生效)
  await page.getByText('执行计划').first().waitFor({ state: 'visible', timeout: 30000 });
  const planCard = page.locator('div.rounded-xl.border', { hasText: '执行计划' }).first();
  const planSteps = await planCard.locator('ol li').allInnerTexts();
  const planHasLayout = planSteps.join(' ').match(/布局|Flex|Grid|flex|grid/) !== null;
  log('计划卡出现且含布局规划', planHasLayout, planSteps.join(' / ').slice(0, 180));

  // 5) 等待生成完成(代码进度 → 完成)
  await page.getByText('代码生成完成').waitFor({ state: 'visible', timeout: 240000 });
  log('代码流式生成完成', true);

  // 6) 预览面板出现
  const previewBadge = page.getByText('生成应用').first();
  await previewBadge.waitFor({ state: 'visible', timeout: 20000 });
  const frameTitle = await page.locator('iframe').first().getAttribute('title');
  const appTitle = (frameTitle || '').replace(/ 预览$/, '');
  log('预览面板出现', Boolean(appTitle), `应用标题: ${appTitle}`);

  // 7) iframe 内容质量断言:Flex/Grid 布局、@media 响应式、canvas 游戏区、无 Markdown 残留
  const frameHandle = await page.locator('iframe').first().elementHandle();
  const frame = await frameHandle.contentFrame();
  await frame.waitForSelector('body', { timeout: 10000 });
  const frameHtml = await frame.evaluate(() => document.documentElement.outerHTML);
  const canvasVisible = await page.frameLocator('iframe').locator('canvas').first().isVisible().catch(() => false);
  const frameText = await frame.evaluate(() => document.body.innerText);
  const q = {
    doctype: frame.evaluate(() => document.doctype !== null),
    layout: /flex|grid/i.test(frameHtml),
    media: frameHtml.includes('@media'),
    noFence: !frameHtml.includes('```'),
    noMdRaw: !/[#＃]{1,6}\s|(\*\*)/.test(frameText),
  };
  log('iframe 文档结构(DOCTYPE 完整、无围栏残留)', await q.doctype && q.noFence);
  log('iframe 布局(Flex/Grid)与响应式(@media)', q.layout && q.media);
  log('游戏画布可见', canvasVisible);
  log('正文无 Markdown 原始符号', q.noMdRaw, frameText.slice(0, 60).replace(/\n/g, ' '));

  // 8) 最终完成消息
  const doneMsg = await page.getByText('已经生成完成').first().isVisible().catch(() => false);
  log('生成完成消息展示', doneMsg);

  // 9) 数据落库:会话/消息/项目 POST 全部 201(完成消息先于项目 POST 响应渲染,轮询等待响应落地再断言)
  for (let i = 0; i < 20 && result.posts.projects.length === 0; i++) {
    await page.waitForTimeout(500);
  }
  const postsOk = result.posts.conversations.every((s) => s === 201)
    && result.posts.messages.every((s) => s === 201)
    && result.posts.projects.every((s) => s === 201)
    && result.posts.conversations.length > 0 && result.posts.projects.length > 0;
  log('会话/消息/项目落库 201', postsOk, JSON.stringify(result.posts));

  // 10) 刷新后历史回放:最近对话恢复
  // T28 回归适配:①T16 起详情页为整页布局(无全局 aside),刷新后停留在 /chat/:id,
  // 需先返回首页再断言侧边栏最近对话;②侧边栏为异步加载(会话恢复+空间初始化+列表查询),
  // 固定 4s 等待在真实 AI 链路下存在时序竞态,改为轮询等待
  await page.reload({ waitUntil: 'domcontentloaded' });
  if (page.url().includes('/chat/')) {
    const backHome = page.getByText('返回首页').first();
    const clicked = await backHome.waitFor({ state: 'visible', timeout: 10000 })
      .then(async () => { await backHome.click(); return true; })
      .catch(() => false);
    if (!clicked) await page.goto(APP, { waitUntil: 'domcontentloaded' });
  }
  const recentItem = page.locator('aside').getByText(PROMPT.slice(0, 12)).first();
  const recentItemFallback = page.locator('aside').getByText(PROMPT.slice(0, 6)).first();
  let recentVisible = false;
  for (let i = 0; i < 15 && !recentVisible; i++) {
    await page.waitForTimeout(2000);
    recentVisible = await recentItem.isVisible().catch(() => false)
      || await recentItemFallback.isVisible().catch(() => false);
  }
  log('刷新后最近对话可见', recentVisible);
  if (recentVisible) {
    const target = await recentItem.isVisible().catch(() => false) ? recentItem : recentItemFallback;
    await target.click();
    await page.getByText('执行计划').first().waitFor({ state: 'visible', timeout: 15000 });
    log('历史回放恢复计划卡与消息', true);
  }

  // 11) 我的项目页出现生成应用
  await page.getByRole('link', { name: '我的项目' }).click().catch(async () => {
    await page.locator('aside').getByText('我的项目').first().click();
  });
  await page.waitForTimeout(2500);
  const projectCard = await page.getByText(appTitle || '贪吃蛇').first().isVisible().catch(() => false);
  log('我的项目页生成应用落库', projectCard, appTitle);

  // 汇总
  const failed = result.steps.filter((s) => !s.ok);
  console.log('\n==== T9 回归汇总 ====');
  console.log(`通过 ${result.steps.length - failed.length}/${result.steps.length}`);
  const realErrors = result.consoleErrors.filter((e) => !e.includes('/api/config'));
  if (realErrors.length) console.log('控制台错误:', realErrors.slice(0, 5));
  const bad = result.badResponses.filter((r) => !r.url.includes('/functions/v1/app_atoms_agent_generate'));
  if (bad.length) console.log('异常响应:', bad.slice(0, 5));
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error('回归脚本异常:', String(error).slice(0, 500));
  process.exit(1);
} finally {
  await browser.close();
}
