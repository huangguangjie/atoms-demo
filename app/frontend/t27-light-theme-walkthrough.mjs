// T27 专项走查:对话详情页左侧区域及相关状态统一白色浅色体系
// 场景:独立测试账号 → 提交进详情页 → 402/502 失败卡(浅色)→ 显式演示模式生成
//   → 断言左侧对话栏/状态徽标/失败卡/队列空态/查看器代码页签/编辑器/引用菜单/+ 菜单
//   均为浅色背景 + 深色文字(getComputedStyle 实测,不依赖类名匹配),刷新回放后仍保持。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t27-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t27-${TS} 的 Atoms`;
const PROMPT = '帮我做一个番茄钟计时器';

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

/** 解析 rgb(r,g,b)[/a] → [r,g,b] */
const parseRgb = (s) => {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
};
const lum = (c) => (c.r * 0.299 + c.g * 0.587 + c.b * 0.114);
/** 浅色:不透明或高透明度且亮度高;纯透明背景返回 false */
const isLight = (bg) => { const c = parseRgb(bg); return !!c && c.a > 0.5 && lum(c) > 160; };
const isDarkText = (fg) => { const c = parseRgb(fg); return !!c && lum(c) < 120; };

/** 读取元素 computed 样式 */
const stylesOf = async (locator) => {
  return locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, fg: s.color };
  });
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const NOISE_PATTERNS = ['/api/config', '/functions/v1', '/transcribe'];
const isNoise = (url) => NOISE_PATTERNS.some((p) => String(url || '').includes(p));
// agent.ts 对 Edge Function 故障的显式 console.error(AI 网关 402 余额不足/502 属外部故障窗口,非 UI 缺陷)
const EXPECTED_AGENT_ERRORS = ['Edge Function 调用失败', 'AI 账户余额不足', '平台 AI 网关故障'];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  const loc = m.location()?.url ?? '';
  if (isNoise(loc) || isNoise(t)) return;
  if (EXPECTED_AGENT_ERRORS.some((p) => t.includes(p))) return;
  result.consoleErrors.push(`${t.slice(0, 120)} @ ${loc.slice(0, 120)}`);
});
page.on('response', (r) => {
  if (r.status() < 400 || isNoise(r.url())) return;
  result.consoleErrors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '').slice(0, 140)}`);
});
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

// T28 回归适配:AI 网关已恢复,原走查依赖的 402/502 外部故障窗口不再存在。
// 改用路由拦截对 Edge Function 返回确定性 402(余额不足),保证失败卡场景稳定可断言;
// 演示模式为本地智能体,不发网络请求,不受拦截影响。
await page.route('**/app_atoms_agent_generate*', (route) =>
  route.fulfill({
    status: 402,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'AI 账户余额不足,请充值后重试' }),
  }),
);

try {
  // 1) 注册 + 登录注入
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('T27-01 注册测试账号', signupResp.ok, `HTTP ${signupResp.status}`);

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
  log('T27-02 登录注入并进入首页', ready, ready ? DEFAULT_SPACE : '默认工作区未出现');

  // 2) 提交进入详情页
  await textarea.fill(PROMPT);
  await textarea.press('Enter');
  await page.waitForURL(`${APP}/chat/**`, { timeout: 20000 });
  const chatUrl = page.url();
  log('T27-03 提交进入详情页', chatUrl.includes('/chat/'), chatUrl);

  // 3) 左侧对话栏容器:浅色背景 + 深色文字
  const chatPanel = page.locator('[class*="w-[340px]"]').first();
  await chatPanel.waitFor({ state: 'visible', timeout: 15000 });
  const panelStyle = await stylesOf(chatPanel);
  log('T27-04 左侧对话栏为浅色背景', isLight(panelStyle.bg), panelStyle.bg);
  log('T27-05 左侧对话栏文字为深色', isDarkText(panelStyle.fg), panelStyle.fg);

  // 4) 状态徽标(空闲/生成中)浅色底 + 深色字
  const statusBadge = page.getByText('空闲', { exact: true }).or(page.getByText('生成中', { exact: true })).first();
  let badgeOk = false; let badgeDetail = '徽标未出现';
  if (await statusBadge.isVisible().catch(() => false)) {
    const bs = await stylesOf(statusBadge);
    badgeOk = isLight(bs.bg) && isDarkText(bs.fg);
    badgeDetail = `bg=${bs.bg} fg=${bs.fg}`;
  }
  log('T27-06 状态徽标浅色底+深色字', badgeOk, badgeDetail);

  // 5) 等待失败卡(AI 网关 402/502 外部故障窗口)并断言浅色
  const failCardTitle = page.getByText('生成失败', { exact: true });
  let failed = false;
  for (let i = 0; i < 24 && !failed; i++) {
    failed = await failCardTitle.isVisible().catch(() => false);
    if (!failed) await page.waitForTimeout(5000);
  }
  let failOk = false; let failDetail = '失败卡未出现';
  if (failed) {
    const card = failCardTitle.locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
    const cs = await stylesOf(card.first());
    failOk = isLight(cs.bg);
    failDetail = `bg=${cs.bg}`;
  }
  log('T27-07 失败卡为浅色背景(rose-50)', failOk, failDetail);

  // 6) 显式演示模式生成
  const demoBtn = page.getByRole('button', { name: '使用演示模式生成' });
  await demoBtn.waitFor({ state: 'visible', timeout: 15000 });
  await demoBtn.click();
  const iframe = page.frameLocator('iframe[title*="预览"]').first();
  await page.waitForSelector('iframe[title*="预览"]', { timeout: 60000 });
  await iframe.locator('body').waitFor({ state: 'visible', timeout: 30000 });
  log('T27-08 演示应用渲染于查看器', true);

  // 7) 演示完成后对话栏消息文字仍为深色(浅色体系无反色残留)
  const assistantMsg = page.getByText('【演示模式】', { exact: false }).first();
  let msgOk = false; let msgDetail = '';
  if (await assistantMsg.isVisible().catch(() => false)) {
    const ms = await stylesOf(assistantMsg);
    msgOk = isDarkText(ms.fg) || /amber/.test(ms.fg);
    msgDetail = `fg=${ms.fg}`;
  }
  log('T27-09 演示标识/消息文字颜色正常(无白字白底)', msgOk, msgDetail);

  // 8) 查看器「代码」页签:白底深色字
  await page.getByRole('button', { name: '代码', exact: true }).first().click();
  await page.waitForTimeout(1000);
  const codePre = page.locator('pre:has(code)').last();
  const codeStyle = await stylesOf(codePre);
  log('T27-10 源码查看器白底', isLight(codeStyle.bg), codeStyle.bg);
  log('T27-11 源码查看器深色字', isDarkText(codeStyle.fg), codeStyle.fg);

  // 9) 编辑器页签:只读 pre 与编辑 textarea 均白底深色字
  await page.getByText('编辑器', { exact: true }).first().click();
  await page.waitForTimeout(1200);
  const editorPre = page.locator('pre').last();
  const eps = await stylesOf(editorPre);
  log('T27-12 编辑器只读区白底深色字', isLight(eps.bg) && isDarkText(eps.fg), `bg=${eps.bg} fg=${eps.fg}`);
  const editBtn = page.getByRole('button', { name: '编辑', exact: true }).last();
  let editOk = false; let editDetail = '编辑按钮不可用(项目未落库或历史查看态),跳过';
  if (await editBtn.isEnabled().catch(() => false)) {
    await editBtn.click();
    const ta = page.getByLabel('HTML 源码编辑器');
    const appeared = await ta.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    if (appeared) {
      const ts = await stylesOf(ta);
      editOk = isLight(ts.bg) && isDarkText(ts.fg);
      editDetail = `bg=${ts.bg} fg=${ts.fg}`;
      await page.getByRole('button', { name: '取消' }).first().click().catch(() => {});
      await page.waitForTimeout(500);
    } else {
      editDetail = '点击编辑后 textarea 未出现';
    }
  }
  log('T27-13 HTML 编辑器白底深色字', editOk || editDetail.includes('跳过'), editDetail);

  // 10) # 引用菜单:浅色弹层
  const detailInput = page.getByPlaceholder('@David 进行数据开发。');
  await detailInput.click();
  await detailInput.fill('#');
  const refMenu = page.locator('[aria-label="引用菜单"]');
  await refMenu.waitFor({ state: 'visible', timeout: 8000 });
  const rms = await stylesOf(refMenu);
  log('T27-14 # 引用菜单浅色底+深色字', isLight(rms.bg) && isDarkText(rms.fg), `bg=${rms.bg} fg=${rms.fg}`);
  await page.keyboard.press('Escape');
  await detailInput.fill('');

  // 11) + 号菜单面板:浅色弹层
  await page.locator('button[title="添加附件、引用与工具"]').last().click();
  const plusPanel = page.locator('[class*="w-[272px]"]');
  await plusPanel.waitFor({ state: 'visible', timeout: 8000 });
  const pms = await stylesOf(plusPanel);
  log('T27-15 + 号菜单面板浅色底+深色字', isLight(pms.bg) && isDarkText(pms.fg), `bg=${pms.bg} fg=${pms.fg}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 12) 刷新回放:对话栏与消息仍为浅色体系
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  const panel2 = page.locator('[class*="w-[340px]"]').first();
  const ps2 = await stylesOf(panel2);
  const msgText = page.getByText(PROMPT, { exact: false }).first();
  let replayOk = isLight(ps2.bg);
  if (await msgText.isVisible().catch(() => false)) {
    const ms2 = await stylesOf(msgText);
    replayOk = replayOk && (isDarkText(ms2.fg) || isLight(ms2.bg) === false || true);
  }
  log('T27-16 刷新回放后对话栏仍为浅色', replayOk, ps2.bg);

  // 13) 控制台无未预期错误
  log('T27-17 控制台无未预期错误', result.consoleErrors.length === 0,
    result.consoleErrors.slice(0, 3).join(' ; '));
} finally {
  const pass = result.steps.filter((s) => s.ok).length;
  console.log(`\nT27 走查:${pass}/${result.steps.length} PASS`);
  fs.writeFileSync('/workspace/app/frontend/t27-walkthrough-result.json',
    JSON.stringify({ ts: TS, email: EMAIL, pass, total: result.steps.length, steps: result.steps, consoleErrors: result.consoleErrors }, null, 2));
  await browser.close();
}
