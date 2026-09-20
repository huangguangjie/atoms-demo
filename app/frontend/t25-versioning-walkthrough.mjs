// T25 专项走查:402 余额不足确定性错误下的版本管理全链路(真实 AI 恢复前的完整产品验证)
// 1) 真实 Edge Function 402:失败卡含「额度已耗尽」指引,无静默回退(重试无意义的确定性错误直接透出)
// 2) 显式演示模式作为基座:首轮生成落库项目(v1 首次生成)
// 3) 第二轮增量修改:再次 402 失败卡 → 显式演示接管 → 项目 app_html 更新并记录 v2(增量修改)
// 4) 版本面板:列表/来源标签/切换查看(仅预览不落库)/返回最新
// 5) 一键回滚:确认条提示「创建新版本不覆盖快照」,回滚后产生 v3 且旧快照保留
// 6) 在线编辑:编辑器页签 textarea 修改 → 保存记录 v4,Preview 与 REST app_html 同步
// 7) HTML 导出:Blob 下载当前版本,文件内容与在线保存内容一致
// 8) 刷新回放一致性:消息/【演示模式】标识/计划卡/查看器徽标/版本列表全部恢复
// 9) REST 核验:projects.is_demo、project_versions 四条版本(version_number 1-4,来源枚举正确)
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t25-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const PROMPT1 = '做一个番茄钟计时器,25 分钟专注 + 5 分钟休息,显示倒计时和开始暂停按钮,浅色主题,中文界面';
const PROMPT2 = '给番茄钟增加休息提醒音效开关按钮,放在开始按钮旁边,其余保持不变';
const EDIT_MARK = 'T25-EDIT-MARK';
const DEFAULT_SPACE = `t25-${TS} 的 Atoms`;

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

/** REST 读取当前用户最新项目(演示标记项目) */
async function fetchDemoProject(token, userId) {
  const resp = await fetch(
    `${BASE}/rest/v1/projects?user_id=eq.${userId}&select=id,name,description,is_demo,app_html&order=created_at.desc&limit=10`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  return rows.find((p) => String(p.description || '').includes('演示模式')) ?? null;
}

/** REST 读取项目版本列表(version_number 正序) */
async function fetchVersions(token, projectId) {
  const resp = await fetch(
    `${BASE}/rest/v1/project_versions?project_id=eq.${projectId}&select=version_number,source,label,app_html&order=version_number.asc`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  if (!resp.ok) return [];
  return resp.json();
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  // 预期噪声:Edge Function 402、运行时配置探测、转写接口
  if (t.includes('/functions/v1') || t.includes('/api/config') || t.includes('/transcribe')) return;
  result.consoleErrors.push(t.slice(0, 200));
});
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

// 诊断:记录 rest/auth 请求状态与 project_versions/projects 响应体,定位「刷新后版本列表为空」的发生层级
const netLog = [];
const netMark = (tag) => netLog.push(`=== ${tag} ===`);
page.on('console', (m) => {
  const t = m.text();
  if (t.includes('T25DIAG')) netLog.push(`PAGE ${t.slice(0, 240)}`);
});
page.on('response', async (r) => {
  const u = r.url();
  if (!u.includes('/rest/v1/') && !u.includes('/auth/v1/')) return;
  let body = '';
  if (u.includes('project_versions') || u.includes('/rest/v1/projects')) {
    try { body = ' :: ' + (await r.text()).replace(/\s+/g, ' ').slice(0, 200); } catch {}
  }
  netLog.push(`NET ${r.status()} ${u.replace(BASE, '').slice(0, 160)}${body}`);
});
// 诊断增强:记录「已发出但未收到响应」的请求,区分 JS 侧挂起与网络侧挂起
page.on('request', (req) => {
  const u = req.url();
  if (!u.includes('/rest/v1/') && !u.includes('/auth/v1/')) return;
  if (u.includes('project_versions') || u.includes('spaces')) {
    netLog.push(`REQ> ${req.method()} ${u.replace(BASE, '').slice(0, 160)}`);
  }
});
page.on('requestfailed', (req) => {
  const u = req.url();
  if (!u.includes('/rest/v1/') && !u.includes('/auth/v1/')) return;
  netLog.push(`REQX ${u.replace(BASE, '').slice(0, 160)} :: ${req.failure()?.errorText ?? ''}`);
});

/** 等待 402 失败卡出现(真实 Edge Function 余额错误,确定性不重试,数秒内出现) */
async function waitErrorCard() {
  const errorCard = page.getByText('生成失败', { exact: true }).first();
  await errorCard.waitFor({ state: 'visible', timeout: 90000 });
  return errorCard;
}

try {
  // 1) 注册新账号
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册新账号', signupResp.ok, `HTTP ${signupResp.status}`);

  // 2) 登录注入会话并原地等待首页就绪
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

  // 3) 提交首轮需求 → 进入详情页
  await textarea.fill(PROMPT1);
  await page.getByTitle('发送').click();
  await page.waitForURL(/\/chat\//, { timeout: 20000 });
  log('提交进入详情页', true);

  // 4) 真实 402 链路:确定性余额错误显式失败卡(不重试、无静默回退)
  await waitErrorCard();
  log('真实 Edge Function 402 显式失败卡(无静默回退)', true);
  const guidance = await page.getByText(/额度已耗尽/).first()
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  log('失败卡含 402 余额不足专属指引文案', guidance);
  await page.screenshot({ path: '.tmp-t25-402-card.png' });
  const demoBtn = page.getByRole('button', { name: '使用演示模式生成' });
  await demoBtn.waitFor({ state: 'visible', timeout: 10000 });

  // 5) 显式演示模式首轮生成:基座项目落库(v1)
  await demoBtn.click();
  const viewerIframe = page.locator('iframe').first();
  await page.getByText(/【演示模式】/).first().waitFor({ state: 'visible', timeout: 15000 });
  await viewerIframe.waitFor({ state: 'visible', timeout: 30000 });
  const badgeVisible = await page.getByText('演示模式', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  log('显式演示模式产出应用并标注徽标', badgeVisible);

  // 6) REST 核验:演示项目落库 + v1 首次生成版本
  const { token, userId } = await freshLoginToken();
  let project = null;
  for (let i = 0; i < 12 && !project; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    project = await fetchDemoProject(token, userId);
  }
  log('演示项目落库(is_demo + 描述标记)', !!project && project.is_demo === true,
    project ? `${project.name} | is_demo=${project.is_demo} | app_html ${(project.app_html || '').length} 字符` : '轮询 24s 未找到');
  let versions = project ? await fetchVersions(token, project.id) : [];
  log('首轮生成写入 v1(首次生成)', versions.length === 1 && versions[0].version_number === 1
    && versions[0].source === 'generation' && versions[0].label === '首次生成',
    JSON.stringify(versions.map((v) => `v${v.version_number}:${v.source}:${v.label}`)));

  // 7) 第二轮增量修改:再次 402 失败卡 → 显式演示接管 → v2(增量修改)
  await textarea.fill(PROMPT2);
  await page.getByTitle('发送').click();
  await waitErrorCard();
  const demoBtn2 = page.getByRole('button', { name: '使用演示模式生成' });
  await demoBtn2.waitFor({ state: 'visible', timeout: 10000 });
  await demoBtn2.click();
  const v2Toast = await page.getByText(/应用已更新,已记录版本 v2/).first()
    .waitFor({ state: 'visible', timeout: 40000 }).then(() => true).catch(() => false);
  log('第二轮增量生成记录 v2', v2Toast, v2Toast ? '' : '未捕获「应用已更新,已记录版本 v2」toast');

  // 8) REST 核验:v2 增量修改,项目 app_html 已更新
  const afterRound2 = await fetchDemoProject(token, userId);
  versions = afterRound2 ? await fetchVersions(token, afterRound2.id) : [];
  const v2 = versions.find((v) => v.version_number === 2);
  log('v2 增量修改落库且 app_html 变化', !!v2 && v2.source === 'generation'
    && String(v2.label || '').startsWith('增量修改') && afterRound2.app_html !== project.app_html,
    v2 ? `label=${v2.label} | app_html ${(afterRound2.app_html || '').length} 字符` : 'v2 缺失');
  project = afterRound2;

  // 9) 版本面板:列表与来源标签
  await page.getByRole('button', { name: /历史版本/ }).click();
  const panel = page.locator('div.absolute.right-0.top-9');
  await panel.getByText('首次生成').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const hasV1 = await panel.getByText('首次生成').isVisible().catch(() => false);
  const hasV2 = await panel.getByText(/增量修改/).first().isVisible().catch(() => false);
  log('版本面板展示 v1/v2 与来源标签', hasV1 && hasV2, `v1=${hasV1} v2=${hasV2}`);
  await page.screenshot({ path: '.tmp-t25-version-panel.png' });

  // 10) 版本切换查看:点击 v1 行主按钮(v{n} 为行内文本节点,不可按纯文本定位)→ 醒目提示条(仅预览不落库)
  await panel.locator('button.min-w-0', { hasText: '首次生成' }).first().click();
  const viewingBar = page.getByText(/正在查看历史版本 v1/).first();
  const barVisible = await viewingBar.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  const snapshotHint = await page.getByText(/历史快照 v1/).first().isVisible().catch(() => false);
  log('版本切换查看(v1 提示条 + 快照状态)', barVisible && snapshotHint);
  await page.getByText('返回最新').first().click();
  await viewingBar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  log('返回最新退出历史查看', true);

  // 11) 一键回滚:确认条 → 回滚产生 v3,旧快照保留
  await page.getByRole('button', { name: /历史版本/ }).click();
  await panel.getByText('首次生成').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  const v1Row = panel.locator('div.group', { hasText: '首次生成' }).first();
  await v1Row.hover();
  await v1Row.getByTitle('回滚到 v1').click();
  const confirmText = await panel.getByText(/回滚会创建新版本,不覆盖此快照/).first()
    .waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
  log('回滚确认条明确「创建新版本不覆盖快照」', confirmText);
  await panel.getByRole('button', { name: '确认', exact: true }).click();
  const rollbackToast = await page.getByText(/已回滚到 v1,当前为 v3/).first()
    .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  log('回滚完成并创建 v3', rollbackToast, rollbackToast ? '' : '未捕获「已回滚到 v1,当前为 v3」toast');
  await page.screenshot({ path: '.tmp-t25-rollback.png' });

  // 12) REST 核验:v3 回滚版本 + 项目 app_html 等于 v1 快照 + v1/v2 快照保留
  const afterRollback = await fetchDemoProject(token, userId);
  versions = afterRollback ? await fetchVersions(token, afterRollback.id) : [];
  const v1Snap = versions.find((v) => v.version_number === 1);
  const v3 = versions.find((v) => v.version_number === 3);
  log('v3 回滚版本落库且内容与 v1 快照一致', !!v3 && v3.source === 'rollback' && !!v1Snap
    && v3.app_html === v1Snap.app_html,
    versions.map((v) => `v${v.version_number}:${v.source}`).join(','));
  log('v1/v2 旧快照保留', !!v1Snap && versions.some((v) => v.version_number === 2),
    `v1=${!!v1Snap} v2=${versions.some((v) => v.version_number === 2)}`);
  log('回滚后项目 app_html 与 v1 快照一致', afterRollback.app_html === v1Snap?.app_html,
    `项目 ${(afterRollback.app_html || '').length} vs v1 ${(v1Snap?.app_html || '').length} 字符`);
  project = afterRollback;

  // 13) 在线编辑:编辑器页签 → 编辑 → 注入特征 → 保存记录 v4
  await page.getByText('编辑器', { exact: true }).first().click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const editorArea = page.getByLabel('HTML 源码编辑器');
  await editorArea.waitFor({ state: 'visible', timeout: 10000 });
  const current = await editorArea.inputValue();
  await editorArea.fill(`<!-- ${EDIT_MARK} 在线编辑注入 -->\n${current}`);
  await page.getByRole('button', { name: '保存并记录版本' }).click();
  const saveToast = await page.getByText(/编辑已保存,已记录版本 v4/).first()
    .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  log('在线编辑保存并记录 v4', saveToast, saveToast ? '' : '未捕获「编辑已保存,已记录版本 v4」toast');

  // 14) REST 核验:v4 修改版本 + 项目 app_html 含编辑特征
  const afterEdit = await fetchDemoProject(token, userId);
  versions = afterEdit ? await fetchVersions(token, afterEdit.id) : [];
  const v4 = versions.find((v) => v.version_number === 4);
  log('v4 修改版本落库且项目 app_html 含编辑特征', !!v4 && v4.source === 'edit'
    && v4.label === '在线编辑' && afterEdit.app_html.includes(EDIT_MARK),
    v4 ? `label=${v4.label} | 含特征=${afterEdit.app_html.includes(EDIT_MARK)}` : 'v4 缺失');
  project = afterEdit;

  // 15) HTML 导出:Blob 下载当前版本,内容与在线保存一致
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: /导出 HTML/ }).click();
  const download = await downloadPromise;
  const dlPath = await download.path();
  const dlContent = fs.readFileSync(dlPath, 'utf8');
  log('导出 HTML 文件内容与当前版本一致', download.suggestedFilename().endsWith('.html')
    && dlContent.includes(EDIT_MARK) && dlContent.length === project.app_html.length,
    `${download.suggestedFilename()} | ${dlContent.length} 字符`);

  // 16) 刷新回放一致性:消息/演示标识/计划卡/徽标/版本列表恢复
  netMark('RELOAD');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(PROMPT1).first().waitFor({ state: 'visible', timeout: 20000 });
  log('刷新回放:两轮用户消息持久化', await page.getByText(PROMPT2).first().isVisible().catch(() => false));
  const demoMsgs = await page.getByText(/【演示模式】/).count();
  log('刷新回放:【演示模式】标识恢复(两轮)', demoMsgs >= 2, `${demoMsgs} 处`);
  const planCard = await page.getByText('执行计划').first()
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  log('刷新回放:计划卡按 metadata 恢复', planCard);
  const restoredBadge = await page.getByText('演示模式', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  log('刷新回放:查看器演示徽标恢复(is_demo)', restoredBadge);
  await page.getByRole('button', { name: /历史版本/ }).click();
  await panel.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  // 版本历史在项目恢复后异步拉取;数据层含 4s 超时 + 最多 3 次中断重试,
  // 最坏耗时约 13s,故轮询窗口放宽到 40s,避免读取早于加载完成造成误判。
  let panelText = '';
  for (let i = 0; i < 80 && !panelText.includes('在线编辑'); i++) {
    panelText = await panel.innerText().catch(() => '');
    if (!panelText.includes('在线编辑')) await page.waitForTimeout(500);
  }
  log('刷新回放:版本列表恢复(4 个版本齐全)', panelText.includes('首次生成')
    && panelText.includes('增量修改') && panelText.includes('回滚至 v1') && panelText.includes('在线编辑'),
    panelText.replace(/\n+/g, ' ').slice(0, 120));
  netMark('END');
  console.log('--- 网络日志(RELOAD 起) ---');
  const ri = netLog.findIndex((l) => l.includes('=== RELOAD ==='));
  console.log(netLog.slice(ri === -1 ? 0 : ri).join('\n') || '(无匹配请求)');

  // 17) 汇总
  const failed = result.steps.filter((s) => !s.ok);
  console.log(`\nT25 走查:${result.steps.length - failed.length}/${result.steps.length} PASS`);
  fs.writeFileSync('t25-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error('走查异常:', error);
  fs.writeFileSync('t25-walkthrough-result.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.tmp-t25-crash.png' }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
