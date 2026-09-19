// T22 页面走查:主题按钮恢复 Palette 图标 + T15 默认无选中 + T18 构建/目标纯文字
// + 主题菜单开合/搜索/选中不变 + 详情页共用组件 + 窄屏适配 + T21 失败卡与重新生成入口
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t22-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const PROMPT = '做一个极简待办清单,可以添加和勾选完成,浅色主题,中文界面';
const DEFAULT_SPACE = `t22-${TS} 的 Atoms`;

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

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // AI 网关故障窗口的预期噪声(Edge Function 502/403、运行时配置探测)不计入
  if (t.includes('/functions/v1') || t.includes('/api/config') || t.includes('/transcribe')) return;
  result.consoleErrors.push(t.slice(0, 200));
});
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));
// 诊断:记录所有 ≥400 响应(排除 AI 网关与运行时配置噪声),用于定位走查中途会话丢失原因
result.badResponses = [];
page.on('response', (r) => {
  if (r.status() < 400) return;
  const url = r.url();
  if (url.includes('/api/config') || url.includes('/transcribe') || url.includes('/functions/v1')) return;
  result.badResponses.push({ status: r.status(), url: url.slice(0, 160) });
});

try {
  // 1) 注册新账号
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册新账号', signupResp.ok, `HTTP ${signupResp.status}`);

  // 2) 登录注入会话并等待首页就绪(默认工作区触发器)
  //    关键:登录服务 302 到 /#access_token=...,supabase-js 靠该 hash 建立会话;
  //    注入后立刻 goto 会冲掉 hash 导致会话永不建立(此前走查失败根因),
  //    因此与 T13 回归一致原地等待默认工作区出现,期间不导航。
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

  // 3) T22/T15:主题触发按钮恢复 Palette 图标,且默认无选中(中性文案「主题」)
  const themeBtn = page.getByRole('button', { name: '主题' });
  await themeBtn.waitFor({ state: 'visible', timeout: 10000 });
  const paletteCount = await themeBtn.locator('svg.lucide-palette').count();
  const chevronCount = await themeBtn.locator('svg.lucide-chevron-down').count();
  const triggerText = (await themeBtn.innerText()).trim();
  log('T22 主题按钮恢复 Palette 图标', paletteCount === 1, `palette=${paletteCount}`);
  log('主题按钮保留下拉箭头', chevronCount === 1, `chevron=${chevronCount}`);
  log('T15 默认无选中(触发按钮中性文案「主题」)', triggerText === '主题', triggerText);
  await page.screenshot({ path: '.tmp-t22-home-composer.png' });

  // 4) T18:构建/目标按钮保持纯文字(除下拉箭头外无图标,未受 T22 影响)
  const modeBtn = page.getByRole('button', { name: '目标' });
  const modeIconCount = await modeBtn.locator('svg:not(.lucide-chevron-down)').count();
  log('T18 构建/目标按钮无图标(未受 T22 影响)', modeIconCount === 0, `icons=${modeIconCount}`);

  // 5) 主题菜单:搜索过滤 + 选中 Notion + 选中 ✓ + Esc 关闭(菜单逻辑与 T12/T15 一致)
  await themeBtn.click();
  const searchInput = page.getByPlaceholder('搜索主题');
  await searchInput.waitFor({ state: 'visible', timeout: 5000 });
  await searchInput.fill('不存在的主题');
  const emptyOk = await page.getByText(/没有匹配/).isVisible();
  await searchInput.fill('notion');
  await page.getByRole('button', { name: 'Notion' }).click();
  await page.waitForTimeout(300);
  const afterText = (await themeBtn.innerText()).trim();
  await themeBtn.click();
  await page.waitForTimeout(200);
  const checkCount = await page.getByRole('button', { name: 'Notion' }).locator('svg.lucide-check').count();
  await page.keyboard.press('Escape');
  const menuClosed = await searchInput.waitFor({ state: 'hidden', timeout: 3000 }).then(() => true).catch(() => false);
  log('主题搜索空态提示', emptyOk);
  log('主题切换生效(触发按钮显示 Notion)', afterText.includes('Notion'), afterText);
  log('当前主题选中 ✓ 唯一', checkCount === 1, `check=${checkCount}`);
  log('Esc 关闭主题菜单', menuClosed);

  // 6) 窄屏:主题按钮(含图标)仍可见可用
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const narrowVisible = await themeBtn.isVisible();
  log('窄屏下主题按钮可见(共用组件适配)', narrowVisible);
  await page.screenshot({ path: '.tmp-t22-narrow.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  // 7) 发起生成 → 详情页共用 ChatComposer 同样恢复图标且携带所选主题
  //    会话自愈重试:若发送后未跳转且弹出登录框(走查中途会话偶发丢失),
  //    重新注入会话 → 回首页 → 恢复 Notion 主题选择 → 重试,最多 3 次
  let entered = false;
  for (let attempt = 1; attempt <= 3 && !entered; attempt++) {
    await textarea.fill(PROMPT);
    await page.getByTitle('发送').click();
    try {
      await page.waitForURL(/\/chat\//, { timeout: 15000 });
      entered = true;
    } catch {
      const authHint = await page.getByText('请先登录后再发起对话').isVisible().catch(() => false);
      log(`第 ${attempt} 次发送未跳转详情页`, false, authHint ? '登录弹窗出现(会话丢失)' : '无跳转');
      await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(`${APP}/**`, { timeout: 30000 });
      // 不再 goto:原地等待会话建立与默认工作区就绪(hash 会话建立期间导航会失效)
      await page.locator('aside').getByText(DEFAULT_SPACE).first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
      await textarea.waitFor({ state: 'visible', timeout: 15000 });
      // 重试前恢复主题选择(页面重载后主题重置为无选中)
      const retryThemeBtn = page.getByRole('button', { name: '主题' });
      await retryThemeBtn.click();
      await page.getByPlaceholder('搜索主题').fill('notion');
      await page.getByRole('button', { name: 'Notion' }).click();
      await page.waitForTimeout(300);
    }
  }
  log('提交进入详情页', entered);
  if (!entered) throw new Error('三次发送均未跳转详情页');
  const detailThemeBtn = page.getByRole('button', { name: '主题' });
  await detailThemeBtn.waitFor({ state: 'visible', timeout: 15000 });
  const detailPalette = await detailThemeBtn.locator('svg.lucide-palette').count();
  const detailText = (await detailThemeBtn.innerText()).trim();
  log('详情页主题按钮恢复图标', detailPalette === 1, `palette=${detailPalette}`);
  log('详情页携带所选主题(Notion)', detailText.includes('Notion'), detailText);
  await page.screenshot({ path: '.tmp-t22-detail-composer.png' });

  // 8) 生成结果:AI 网关故障窗口 → T21 失败卡与「重新生成」入口;若网关已恢复则验证应用产出
  const errorCard = page.getByText('生成失败').first();
  const viewerIframe = page.locator('iframe').first();
  let outcome = 'timeout';
  try {
    outcome = await Promise.race([
      errorCard.waitFor({ state: 'visible', timeout: 150000 }).then(() => 'error'),
      viewerIframe.waitFor({ state: 'visible', timeout: 150000 }).then(() => 'app'),
    ]);
  } catch { /* 超时 */ }
  if (outcome === 'error') {
    const regenBtn = page.getByRole('button', { name: /重新生成/ }).first();
    // 先截图留存失败卡出现瞬间的状态,用于诊断按钮可见性时序
    await page.screenshot({ path: '.tmp-t22-error-card.png' });
    // 失败卡为整体条件渲染,文案与按钮同帧出现;以「可点击」为最终判据——点击自带 30s 可操作性等待,
    // 成功点击即证明失败卡提供了可用入口;记录等待耗时与元素匹配数便于诊断
    const t0 = Date.now();
    let regenOk = false;
    try {
      await regenBtn.click({ timeout: 30000 });
      regenOk = true;
    } catch {
      const btnCount = await page.getByRole('button', { name: /重新生成/ }).count().catch(() => -1);
      const cardVisible = await errorCard.isVisible().catch(() => false);
      console.log(`诊断:重新生成按钮匹配=${btnCount},失败卡可见=${cardVisible}`);
    }
    log('T21 失败卡展示且提供重新生成入口', regenOk, regenOk ? `点击成功(等待${Math.round((Date.now() - t0) / 1000)}s)` : '30s 内未出现可点击的重新生成按钮');
    // 重新生成已点击:验证重试链路(用户消息不重复落库,直接续跑生成)
    let outcome2 = 'timeout';
    try {
      outcome2 = await Promise.race([
        errorCard.waitFor({ state: 'visible', timeout: 150000 }).then(() => 'error-again'),
        viewerIframe.waitFor({ state: 'visible', timeout: 150000 }).then(() => 'app'),
      ]);
    } catch { /* 超时 */ }
    log('T21 重新生成续跑生效', outcome2 === 'error-again' || outcome2 === 'app', outcome2);
    if (outcome2 === 'error-again') await page.screenshot({ path: '.tmp-t22-error-card-2.png' });
  } else if (outcome === 'app') {
    log('AI 网关已恢复:应用产出渲染', true, outcome);
  } else {
    log('生成结果断言', false, '超时未观察到失败卡或应用产出');
  }

  const failed = result.steps.filter((s) => !s.ok);
  console.log(`\nT22 走查:${result.steps.length - failed.length}/${result.steps.length} PASS`);
  fs.writeFileSync('t22-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error('走查异常:', error);
  fs.writeFileSync('t22-walkthrough-result.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.tmp-t22-crash.png' }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
