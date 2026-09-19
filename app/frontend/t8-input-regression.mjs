// T8 首页输入区重构回归:登录 → 输入区结构走查(+ 菜单/主题/构建模式/语音/MCP)→ 发起对话 AI 生成链路
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t8-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t8-${TS} 的 Atoms`;
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

  // 3) 输入区结构走查:大圆角卡、placeholder、五控件布局
  const textarea = page.getByPlaceholder('@David 进行数据开发。');
  await textarea.waitFor({ state: 'visible', timeout: 15000 });
  const plusBtn = page.getByTitle('添加附件、引用与工具');
  const themeBtn = page.getByRole('button', { name: '主题' });
  const modeBtn = page.getByRole('button', { name: '目标' });
  const voiceBtn = page.getByTitle('语音输入');
  const sendBtn = page.getByTitle('发送');
  const structOk = await plusBtn.isVisible()
    && await themeBtn.isVisible()
    && await modeBtn.isVisible()
    && await voiceBtn.isVisible()
    && await sendBtn.isVisible()
    && await sendBtn.isDisabled();
  log('输入区五控件齐全且空输入时发送置灰', structOk);

  // 4) 参考图收纳要求:无独立「# 引用」按钮、无 MCP 连接横条
  const bodyText = await page.locator('main').first().innerText();
  const hasHashBtn = await page.getByTitle('引用文件/位置/关键信息').count();
  const hasMcpStrip = bodyText.includes('将你的工具连接到 Atoms');
  log('无独立 # 按钮、无 MCP 横条(已收纳)', hasHashBtn === 0 && !hasMcpStrip);

  // 5) 公告条可关闭
  const notice = page.getByText('Atoms 更新:智能体分步计划、实时预览与全新首页');
  const noticeVisible = await notice.isVisible();
  await page.getByLabel('关闭公告').click();
  await page.waitForTimeout(500);
  log('公告条展示并可关闭', noticeVisible && !(await notice.isVisible().catch(() => false)));

  // 6) + 面板:附件 → chip 出现 → 移除(T11 深色面板)
  await plusBtn.click();
  await page.getByRole('button', { name: '附件', exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: '需求说明.md', mimeType: 'text/plain', buffer: Buffer.from('做一个番茄钟'),
  });
  const chip = page.getByText('需求说明.md');
  const chipOk = await chip.isVisible();
  await page.getByLabel('移除附件 需求说明.md').click();
  await page.waitForTimeout(300);
  log('附件上传与移除(chip)', chipOk && !(await chip.isVisible().catch(() => false)));

  // 7) T17:输入框内 # 触发引用菜单(上传/AI/密钥/项目),支持实时过滤
  await textarea.click();
  await textarea.fill('');
  await textarea.pressSequentially('#', { delay: 80 });
  const refMenu = page.getByRole('listbox', { name: '引用菜单' });
  let refOpen = false;
  try { await refMenu.waitFor({ state: 'visible', timeout: 3000 }); refOpen = true; } catch {}
  const kindsOk = refOpen
    && await refMenu.getByText('上传', { exact: true }).isVisible().catch(() => false)
    && await refMenu.getByText('AI', { exact: true }).isVisible().catch(() => false)
    && await refMenu.getByText('密钥', { exact: true }).isVisible().catch(() => false)
    && await refMenu.getByText('项目', { exact: true }).isVisible().catch(() => false);
  log('# 菜单四类引用项齐全(上传/AI/密钥/项目)', kindsOk);

  // 7b) 实时过滤:输入 ai 后仅剩 AI 行
  await textarea.pressSequentially('ai', { delay: 80 });
  await page.waitForTimeout(200);
  const aiOnly = await refMenu.getByText('AI', { exact: true }).isVisible().catch(() => false)
    && !(await refMenu.getByText('密钥', { exact: true }).isVisible().catch(() => false));
  log('# 菜单实时过滤(ai 仅剩 AI 行)', aiOnly);

  // 7c) 回车选中 AI → 注入快捷指令 #AI
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const aiInjected = (await textarea.inputValue()).includes('#AI');
  log('AI 引用注入提示词(#AI 快捷指令)', aiInjected);

  // 7d) Esc 关闭菜单
  await textarea.pressSequentially('#', { delay: 80 });
  await page.waitForTimeout(200);
  const openedAgain = await refMenu.isVisible().catch(() => false);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const escClosed = openedAgain && !(await refMenu.isVisible().catch(() => false));
  log('# 菜单 Esc 关闭', escClosed);

  // 7e) 项目二级列表(新账号暂无项目 → 空态提示)
  await textarea.pressSequentially('#项', { delay: 80 });
  await page.waitForTimeout(200);
  await refMenu.getByText('项目', { exact: true }).click().catch(() => {});
  await page.waitForTimeout(200);
  const projectEmpty = await page.getByText(/暂无匹配项目/).isVisible().catch(() => false);
  await page.keyboard.press('Escape');
  log('项目二级列表与空态提示', projectEmpty);

  // 7f) 删除触发 # 菜单自动关闭
  await textarea.fill('');
  await textarea.pressSequentially('#', { delay: 80 });
  await page.waitForTimeout(200);
  const delOpened = await refMenu.isVisible().catch(() => false);
  await textarea.press('Backspace');
  await page.waitForTimeout(200);
  const delClosed = delOpened && !(await refMenu.isVisible().catch(() => false));
  log('删除 # 后菜单自动关闭', delClosed);
  await textarea.fill('');

  // 8) T12 主题面板:搜索过滤 + 主题切换(Notion)→ 触发按钮显示主题名 + 选中 ✓ 图标
  const initialThemeText = (await themeBtn.innerText()).trim();
  log('T15 主题默认无选中(触发按钮中性文案「主题」)', initialThemeText === '主题', initialThemeText);
  await themeBtn.click();
  await page.getByPlaceholder('搜索主题').fill('不存在的主题');
  const themeEmptyOk = await page.getByText(/没有匹配/).isVisible();
  await page.getByPlaceholder('搜索主题').fill('notion');
  const notionItem = page.getByRole('button', { name: 'Notion' });
  await notionItem.click();
  await page.waitForTimeout(300);
  const themeTriggerText = await themeBtn.innerText();
  log('主题搜索过滤与切换生效(触发按钮显示 Notion)', themeEmptyOk && themeTriggerText.includes('Notion'), `${themeEmptyOk}/${themeTriggerText.trim()}`);
  await themeBtn.click();
  await page.waitForTimeout(200);
  const themeCheckCount = await page.getByRole('button', { name: 'Notion' }).locator('svg.lucide-check').count();
  await page.keyboard.press('Escape');
  log('当前主题选中高亮(✓ 图标)', themeCheckCount === 1);

  // 9) 构建/目标模式切换 → 构建(T18:触发按钮仅文本+箭头,选中对勾唯一且在选中行)
  const modeIconCount = await modeBtn.locator('svg:not(.lucide-chevron-down)').count();
  await modeBtn.click();
  await page.getByRole('menuitem', { name: /^构建/ }).click();
  await page.waitForTimeout(300);
  const modeNow = await page.getByRole('button', { name: '构建' }).isVisible();
  await page.getByRole('button', { name: '构建' }).click();
  await page.waitForTimeout(200);
  const buildCheck = await page.getByRole('menuitem', { name: /^构建/ }).locator('svg.lucide-check').count();
  const goalCheck = await page.getByRole('menuitem', { name: /目标/ }).locator('svg.lucide-check').count();
  await page.keyboard.press('Escape');
  log('构建/目标模式切换', modeNow);
  log('T18 触发按钮无模式图标、选中对勾仅选中行显示', modeIconCount === 0 && buildCheck === 1 && goalCheck === 0, `icons=${modeIconCount} 构建✓=${buildCheck} 目标✓=${goalCheck}`);

  // 10) 语音按钮:无麦克风环境下应有明确反馈(转写/回退提示),不崩溃
  await voiceBtn.click();
  let voiceToast = '';
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(500);
    voiceToast = await page.locator('[data-sonner-toast]').first().innerText().catch(() => '');
    if (voiceToast) break;
  }
  log('语音入口有明确反馈(转写或回退提示)', /聆听|转写|识别|麦克风/.test(voiceToast), voiceToast.slice(0, 60));

  // 11) MCP:+ 面板打开连接弹窗 → 连接 GitHub → 连接器显示「已连 1」
  await plusBtn.click();
  await page.getByRole('button', { name: '连接器' }).click();
  await page.getByPlaceholder('服务名称,如:GitHub').fill('GitHub');
  await page.getByPlaceholder('https://mcp.example.com/sse').fill('https://mcp.example.com/sse');
  await page.getByRole('button', { name: '连接服务' }).click();
  const mcpRow = page.getByText('GitHubhttps://mcp.example.com/sse');
  await mcpRow.waitFor({ state: 'visible', timeout: 5000 });
  await page.keyboard.press('Escape');
  await plusBtn.click();
  const badge = await page.getByText('已连 1').isVisible();
  await page.keyboard.press('Escape');
  log('MCP 连接持久化并在 + 菜单显示数量', badge);

  // 12) 发起对话 → AI 生成链路
  await textarea.fill(PROMPT);
  await sendBtn.click();
  let started = true;
  try { await page.getByTitle('停止生成').waitFor({ state: 'visible', timeout: 30000 }); } catch { started = false; }
  log('生成已开始(停止按钮出现)', started);
  const t0 = Date.now();
  let finished = true;
  try { await page.getByTitle('发送').waitFor({ state: 'visible', timeout: 300000 }); } catch { finished = false; }
  log('生成已结束', finished, `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await page.waitForTimeout(2500);
  // T13 后提交会跳转 /chat/:id 详情页(无 main 元素),改用 body 全文轮询等待产出
  let markRendered = false;
  for (let i = 0; i < 12 && !markRendered; i++) {
    const bodyText = await page.locator('body').innerText();
    markRendered = bodyText.includes(MARK);
    if (!markRendered) await page.waitForTimeout(1000);
  }
  log('AI 产出渲染(番茄钟)', markRendered);
  // AI 网关 5xx 瞬时故障时,项目不会落库;此时降级只校验会话/消息写入(与 T7/T13 优雅降级策略一致)
  const gatewayDown = result.consoleErrors.some((e) => e.includes('502') || e.includes('403'));
  if (gatewayDown && result.posts.projects.length === 0) {
    log('对话/消息写入均 201(项目落库因 AI 网关故障降级跳过)', result.posts.conversations.every((s) => s === 201)
      && result.posts.messages.filter((s) => s === 201).length >= 2, JSON.stringify(result.posts));
  } else {
    log('对话/消息/项目写入均 201', result.posts.conversations.every((s) => s === 201)
      && result.posts.messages.filter((s) => s === 201).length >= 2
      && result.posts.projects.length >= 1
      && result.posts.projects.every((s) => s === 201), JSON.stringify(result.posts));
  }

  await page.screenshot({ path: '/workspace/.tmp-t8-final.png' });
} catch (err) {
  log('脚本异常', false, String(err).slice(0, 300));
  await page.screenshot({ path: '/workspace/.tmp-t8-error.png' }).catch(() => {});
}
console.log('POSTS ' + JSON.stringify(result.posts));
console.log('BAD_RESPONSES ' + JSON.stringify(result.badResponses.slice(0, 8)));
console.log('CONSOLE_ERRORS ' + JSON.stringify(result.consoleErrors.slice(0, 8)));
await browser.close();
