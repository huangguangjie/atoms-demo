// T23 专项走查:AI 网关故障(主/备模型 403 → Edge Function 502)下的显式演示模式全链路
// 1) 无静默回退:初始生成失败必须显式失败卡,而非悄悄切本地演示
// 2) 失败卡含网关故障指引文案 + 「使用演示模式生成」入口
// 3) 点击后本地演示智能体接管(消息含【演示模式】标识,不再调用 Edge Function)
// 4) 应用查看器显式标注「演示模式」徽标,iframe 渲染演示应用真实内容
// 5) 演示项目落库,项目描述含「演示模式」标记
// 6) 刷新后历史回放:用户消息/演示消息持久化,关联项目回放至查看器(T16)
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t23-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const PROMPT = '做一个番茄钟计时器,25 分钟专注 + 5 分钟休息,显示倒计时和开始暂停按钮,浅色主题,中文界面';
const DEFAULT_SPACE = `t23-${TS} 的 Atoms`;

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

/** 密码授权获取用户级 access_token(REST 断言用,RLS 以真实用户身份读取) */
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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // 预期噪声:Edge Function 网关故障 502、运行时配置探测、转写接口
  if (t.includes('/functions/v1') || t.includes('/api/config') || t.includes('/transcribe')) return;
  result.consoleErrors.push(t.slice(0, 200));
});
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

// T28 回归适配:AI 网关已恢复(真实 SSE E2E 通过),原走查依赖的 402/502 外部故障窗口不再存在。
// 改用路由拦截对 Edge Function 返回确定性 402(余额不足,agent.ts 判定为非瞬时错误不重试),
// 稳定复现「显式失败卡 + 演示模式出口」路径;演示模式为本地智能体,不发网络请求,不受拦截影响。
await page.route('**/app_atoms_agent_generate*', (route) =>
  route.fulfill({
    status: 402,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'AI 账户余额不足,请充值后重试' }),
  }),
);

try {
  // 1) 注册新账号
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册新账号', signupResp.ok, `HTTP ${signupResp.status}`);

  // 2) 登录注入会话并原地等待首页就绪(默认工作区触发器;hash 会话建立期间不导航)
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
  log('登录注入并进入首页', ready, ready ? DEFAULT_SPACE : '默认工作区未出现');

  // 3) 提交生成 → 进入详情页
  await textarea.fill(PROMPT);
  await page.getByTitle('发送').click();
  await page.waitForURL(/\/chat\//, { timeout: 20000 });
  log('提交进入详情页', true);

  // 4) 网关故障窗口:失败卡与(被禁止的)静默演示回退竞速判定
  //    注意:应用查看器空态文案含「生成失败」子串,必须精确匹配,避免空态误判提前通过
  const errorCard = page.getByText('生成失败', { exact: true }).first();
  const viewerIframe = page.locator('iframe').first();
  let outcome = 'timeout';
  try {
    outcome = await Promise.race([
      errorCard.waitFor({ state: 'visible', timeout: 240000 }).then(() => 'error'),
      viewerIframe.waitFor({ state: 'visible', timeout: 240000 }).then(() => 'silent-demo'),
    ]);
  } catch { /* 超时 */ }
  log('T23 无静默回退:网关故障显式失败卡', outcome === 'error', `outcome=${outcome}`);
  if (outcome !== 'error') throw new Error(`预期失败卡,实际 ${outcome}`);
  await page.screenshot({ path: '.tmp-t23-error-card.png' });

  // 5) 失败卡内容:错误指引文案(T25 网关 402 余额不足 / T23 网关 502 故障均显式指引)+ 「使用演示模式生成」入口
  const guidance = await page.getByText(/AI 上游服务持续不可用|额度已耗尽/).first()
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  log('失败卡含错误显式指引文案(402/502 均可)', guidance);
  const demoBtn = page.getByRole('button', { name: '使用演示模式生成' });
  await demoBtn.waitFor({ state: 'visible', timeout: 10000 });
  log('失败卡提供「使用演示模式生成」入口', true);

  // 6) 显式演示模式:点击后本地演示智能体接管(消息含【演示模式】标识)
  await demoBtn.click();
  const demoMsg = page.getByText(/【演示模式】/).first();
  await demoMsg.waitFor({ state: 'visible', timeout: 15000 });
  log('演示智能体启动且消息含【演示模式】标识', true);

  // 7) 应用产出:iframe 渲染 + 查看器「演示模式」徽标
  await viewerIframe.waitFor({ state: 'visible', timeout: 30000 });
  const badge = page.getByText('演示模式', { exact: true }).first();
  const badgeVisible = await badge.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  log('演示应用渲染于应用查看器', true);
  log('查看器显式标注「演示模式」徽标', badgeVisible);
  await page.screenshot({ path: '.tmp-t23-demo-viewer.png' });

  // 8) iframe 内容真实性:演示应用 body 有实质内容
  const frameText = await viewerIframe.contentFrame().locator('body').innerText().catch(() => '');
  log('演示应用 iframe 内容非空', frameText.trim().length > 50, `${frameText.trim().length} 字符`);

  // 9) 项目落库:描述含「演示模式」标记(与「智能体生成的」真实产物区分)
  const { token, userId } = await freshLoginToken();
  let demoProject = null;
  for (let i = 0; i < 12 && !demoProject; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const resp = await fetch(`${BASE}/rest/v1/projects?user_id=eq.${userId}&select=id,name,description,app_html&order=created_at.desc&limit=10`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) continue;
    const rows = await resp.json();
    demoProject = rows.find((p) => String(p.description || '').includes('演示模式')) ?? null;
  }
  log('演示项目落库且描述标记「演示模式」', !!demoProject,
    demoProject ? `${demoProject.name} | ${demoProject.description} | app_html ${(demoProject.app_html || '').length} 字符` : '轮询 24s 未找到');

  // 10) 刷新 → 历史回放:用户消息与演示消息持久化
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(PROMPT).first().waitFor({ state: 'visible', timeout: 20000 });
  log('刷新回放:用户消息持久化', true);
  await page.getByText(/【演示模式】/).first().waitFor({ state: 'visible', timeout: 20000 });
  log('刷新回放:演示模式助手消息持久化', true);

  // 11) 刷新后关联项目自动恢复至查看器(T16 回放链路)
  const restored = await viewerIframe.waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  log('刷新后关联演示项目回放至查看器(T16)', restored);

  const failed = result.steps.filter((s) => !s.ok);
  console.log(`\nT23 走查:${result.steps.length - failed.length}/${result.steps.length} PASS`);
  fs.writeFileSync('t23-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error('走查异常:', error);
  fs.writeFileSync('t23-walkthrough-result.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.tmp-t23-crash.png' }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
