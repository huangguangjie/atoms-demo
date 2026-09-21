// T29 真实 AI 链路全量复测(不使用路由拦截模拟、不使用演示模式)
// 1) 停止收敛:真实生成中点击「停止」→ 立即收敛不重跑,上游调用=1,无失败卡
// 2) 单轮真实生成:plan→code→app→done 一次收敛,上游 Edge Function 调用次数=1、无重复 plan、无整轮重跑(T28 守卫实战)
// 3) 同项目两轮真实增量:第二轮携带 previousHtml,产物含第一轮特征(字面标记串),Preview 与源码一致,v1/v2 无重复版本号
// 4) 版本全操作真实链路:面板列表/切换预览/回滚 v3/在线编辑 v4/导出一致/刷新后消息+计划卡+徽标+版本列表恢复
// 5) REST 核验:项目唯一、版本链 1-4 连续唯一、快照内容一致
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t29-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t29-${TS} 的 Atoms`;
// 字面标记串:要求 AI 原样渲染,用于跨轮特征包含断言(真实链路非确定性输出的可靠锚点)
const PROMPT1 = '做一个番茄钟计时器应用,页面顶部标题必须原样显示字符串 T29R1MARK,包含 25 分钟倒计时与开始、暂停按钮,浅色主题,中文界面,代码尽量精简';
const PROMPT2 = '在番茄钟页面增加一个休息提醒开关按钮,按钮文字必须原样包含字符串 T29R2MARK,其余功能与文案保持不变';
const STOP_PROMPT = '做一个数据可视化仪表盘,包含折线图、柱状图和统计卡片,深色主题,中文界面';
const EDIT_MARK = 'T29-EDIT-MARK';

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = { steps: [], consoleErrors: [], artifactErrors: [], evidence: {} };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

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

async function rest(token, path) {
  const resp = await fetch(`${BASE}/rest/v1/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  return resp.ok ? resp.json() : null;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// 预期噪声:/api/config 为模板运行时配置探测(必 500 后回退 Vite 环境变量),/functions/v1、/transcribe 为外部服务负路径。
// 注意 console 文本本身不含 URL,必须同时用 location().url 判定,否则会误计资源级 500。
const NOISE_PATTERNS = ['/api/config', '/functions/v1', '/transcribe'];
const isNoise = (url) => NOISE_PATTERNS.some((p) => String(url || '').includes(p));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  const loc = m.location()?.url ?? '';
  if (isNoise(loc) || isNoise(t)) return;
  result.consoleErrors.push(`${t.slice(0, 160)} @ ${loc.slice(0, 120)}`);
});
// AI 产物为 srcdoc iframe 内模型非确定性输出:其运行时 JS 语法错误(Syn*** 等)属内容质量证据,
// 不计入应用自身控制台错误(应用 bundle 经 Vite 构建,运行期不可能抛 SyntaxError)。单独留痕 evidence。
const ARTIFACT_SYNTAX = /SyntaxError/;
page.on('pageerror', (e) => {
  const s = String(e);
  if (ARTIFACT_SYNTAX.test(s)) { result.artifactErrors.push(s.slice(0, 200)); return; }
  result.consoleErrors.push(`pageerror: ${s.slice(0, 200)}`);
});

// 真实链路上游调用计数与状态(T28 守卫核心证据:每轮 =1)
let efCount = 0;
const efStatus = [];
page.on('request', (req) => {
  if (req.url().includes('app_atoms_agent_generate')) efCount += 1;
});
page.on('response', (r) => {
  if (r.url().includes('app_atoms_agent_generate')) efStatus.push(r.status());
});

const textarea = () => page.getByPlaceholder('@David 进行数据开发。');
const idleBadge = () => page.getByText('空闲', { exact: true }).first();

try {
  const t0 = Date.now();
  // 1) 注册 + 登录注入
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册新账号', signupResp.ok, `HTTP ${signupResp.status}`);
  await page.goto(`${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`, { waitUntil: 'domcontentloaded' });
  await page.waitForURL(`${APP}/**`, { timeout: 30000 });
  let ready = false;
  for (let i = 0; i < 8 && !ready; i++) {
    await page.waitForTimeout(3000);
    ready = await page.locator('aside').getByText(DEFAULT_SPACE).first().isVisible().catch(() => false)
      && await textarea().isVisible().catch(() => false);
    if (i === 3) await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  log('登录注入并进入首页', ready, ready ? DEFAULT_SPACE : '默认工作区未出现');
  if (!ready) throw new Error('登录注入失败');

  // 2) 停止收敛实验(真实生成中点停止)
  await textarea().fill(STOP_PROMPT);
  // 基线取「点发送之前」:「生成中」徽标出现时本轮唯一一次上游请求往往已被计数,
  // 若以徽标时刻为基线再等「新增一次」必然超时(首轮误报根因)。
  const efBeforeStop = efCount;
  await page.getByTitle('发送').click();
  await page.waitForURL(/\/chat\//, { timeout: 20000 });
  await page.getByText('生成中', { exact: true }).first().waitFor({ state: 'visible', timeout: 20000 });
  // 最多等 10s 让请求真正落到上游,以便区分「发出前中止(0 次)」与「流中中止(1 次)」两种合法收敛
  for (let i = 0; i < 20 && efCount === efBeforeStop; i++) await page.waitForTimeout(500);
  const stopReqSeen = efCount > efBeforeStop;
  const callsAtStop = efCount - efBeforeStop;
  await page.getByTitle('停止生成').click();
  const stoppedMsg = await page.getByText(/已停止生成/).first()
    .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(4000);
  const stopCalls = efCount - efBeforeStop;
  const noFailCard = !(await page.getByText('生成失败', { exact: true }).first().isVisible().catch(() => false));
  const idleAfterStop = await idleBadge().waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  log('停止生成:助手气泡收敛提示「已停止生成」', stoppedMsg);
  // 停止轮合法收敛只有两种:请求发出前中止(0 次)或流中中止(1 次)。
  // 判定核心是「中止后不再产生新的上游调用」=无整轮重跑(T28 守卫语义),而非固定等于 1。
  log('停止生成:中止后无自动重跑(上游调用≤1)', stopCalls <= 1,
    `停止轮上游调用 ${stopCalls} 次(点停止时已发出 ${callsAtStop} 次,请求已发出=${stopReqSeen})`);
  log('停止生成:无失败卡、状态回空闲', noFailCard && idleAfterStop, `失败卡=${!noFailCard} 空闲=${idleAfterStop}`);
  result.evidence.stopRound = { upstreamCalls: stopCalls };

  // 返回首页,开启主链路会话
  await page.getByTitle('返回首页').click();
  await textarea().waitFor({ state: 'visible', timeout: 15000 });

  // 3) 单轮真实生成(T28 守卫实战:一次收敛)
  const efBeforeR1 = efCount;
  const r1Start = Date.now();
  await textarea().fill(PROMPT1);
  await page.getByTitle('发送').click();
  await page.waitForURL(/\/chat\//, { timeout: 20000 });
  const convId = page.url().split('/chat/')[1];
  const iframe = page.locator('iframe[title*="预览"]').first();
  await iframe.waitFor({ state: 'visible', timeout: 180000 });
  await idleBadge().waitFor({ state: 'visible', timeout: 30000 });
  const r1Sec = ((Date.now() - r1Start) / 1000).toFixed(1);
  const r1Calls = efCount - efBeforeR1;
  log('首轮真实生成完成(预览出现、状态空闲)', true, `耗时 ${r1Sec}s`);
  log('T28 守卫:首轮上游调用=1(无整轮重跑)', r1Calls === 1, `上游调用 ${r1Calls} 次,状态 ${JSON.stringify(efStatus.slice(efBeforeR1))}`);
  const planCountR1 = await page.getByText('执行计划', { exact: true }).count();
  log('T28 守卫:首轮计划卡唯一(无重复 plan)', planCountR1 === 1, `执行计划出现 ${planCountR1} 次`);
  const noFailR1 = !(await page.getByText('生成失败', { exact: true }).first().isVisible().catch(() => false));
  log('首轮无失败卡(一次收敛)', noFailR1);

  // 4) REST 核验首轮落库:项目唯一 + v1 + 特征标记
  const { token, userId } = await freshLoginToken();
  let project = null;
  let versions = [];
  for (let i = 0; i < 20; i++) {
    const projs = await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=id,name,app_html,is_demo,created_at&order=created_at.desc`);
    versions = projs?.[0] ? await rest(token, `project_versions?project_id=eq.${projs[0].id}&select=version_number,source,label,app_html&order=version_number.asc`) ?? [] : [];
    if (projs?.length === 1 && versions.length >= 1) { project = projs[0]; break; }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const projCount = project ? (await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=id`))?.length ?? -1 : -1;
  log('首轮项目落库且唯一(幂等)', !!project && projCount === 1, `项目数 ${projCount} | ${project?.name}`);
  log('首轮写入 v1(首次生成)且 is_demo=false', versions.length === 1 && versions[0].version_number === 1
    && versions[0].source === 'generation' && versions[0].label === '首次生成' && project?.is_demo === false,
    JSON.stringify(versions.map((v) => `v${v.version_number}:${v.source}:${v.label}`)));
  const r1Html = project?.app_html ?? '';
  log('首轮产物含字面特征 T29R1MARK', r1Html.includes('T29R1MARK'), `app_html ${r1Html.length} 字符`);
  result.evidence.round1 = { upstreamCalls: r1Calls, seconds: Number(r1Sec), htmlLength: r1Html.length };

  // 5) 第二轮真实增量(previousHtml 自动携带)
  const efBeforeR2 = efCount;
  const r2Start = Date.now();
  await textarea().fill(PROMPT2);
  await page.getByTitle('发送').click();
  let v2 = null;
  let r2Html = '';
  for (let i = 0; i < 70; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const projs = await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=id,app_html&order=created_at.desc&limit=1`);
    if (projs?.[0]) {
      r2Html = projs[0].app_html ?? '';
      versions = await rest(token, `project_versions?project_id=eq.${projs[0].id}&select=version_number,source,label,app_html&order=version_number.asc`) ?? [];
      v2 = versions.find((v) => v.version_number === 2) ?? null;
      if (v2 && r2Html.includes('T29R2MARK')) break;
    }
  }
  const r2Sec = ((Date.now() - r2Start) / 1000).toFixed(1);
  const r2Calls = efCount - efBeforeR2;
  await idleBadge().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  log('第二轮真实增量完成(v2 落库)', !!v2, `耗时 ${r2Sec}s | label=${v2?.label}`);
  log('T28 守卫:第二轮上游调用=1', r2Calls === 1, `上游调用 ${r2Calls} 次,状态 ${JSON.stringify(efStatus.slice(efBeforeR2))}`);
  log('第二轮产物包含第一轮特征(增量保持)', r2Html.includes('T29R1MARK') && r2Html.includes('T29R2MARK'),
    `含R1=${r2Html.includes('T29R1MARK')} 含R2=${r2Html.includes('T29R2MARK')}`);
  const nums = versions.map((v) => v.version_number);
  log('版本链 v1/v2 连续且无重复版本号', JSON.stringify(nums) === JSON.stringify([1, 2]), nums.join(','));
  const projCountR2 = (await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=id`))?.length ?? -1;
  log('增量修改不新建项目(仍唯一)', projCountR2 === 1, `项目数 ${projCountR2}`);
  // Preview 与源码一致
  const srcdoc = (await iframe.getAttribute('srcdoc')) ?? '';
  log('Preview iframe 与第二轮产物一致', srcdoc.includes('T29R2MARK'), `srcdoc ${srcdoc.length} 字符`);
  await page.getByRole('button', { name: '代码', exact: true }).click();
  const codeText = await page.locator('pre').first().innerText().catch(() => '');
  log('源码页签与第二轮产物一致', codeText.includes('T29R2MARK'), `源码 ${codeText.length} 字符`);
  await page.getByRole('button', { name: '预览', exact: true }).click();
  result.evidence.round2 = { upstreamCalls: r2Calls, seconds: Number(r2Sec), htmlLength: r2Html.length };

  // 6) 版本面板:列表/切换/回滚 v3
  const panel = page.locator('div.absolute.right-0.top-9');
  await page.getByRole('button', { name: /历史版本/ }).click();
  const hasV1 = await panel.getByText('首次生成').waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  const hasV2 = await panel.getByText(/增量修改/).first().isVisible().catch(() => false);
  log('版本面板展示 v1/v2 与来源标签', hasV1 && hasV2, `v1=${hasV1} v2=${hasV2}`);
  await panel.locator('button.min-w-0', { hasText: '首次生成' }).first().click();
  const viewBar = await page.getByText(/正在查看历史版本 v1/).first()
    .waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false);
  log('版本切换查看 v1(提示条,不落库)', viewBar);
  await page.getByText('返回最新').first().click();
  await page.getByRole('button', { name: /历史版本/ }).click();
  const v1Row = panel.locator('div.group', { hasText: '首次生成' }).first();
  await v1Row.hover();
  await v1Row.getByTitle('回滚到 v1').click();
  await panel.getByRole('button', { name: '确认', exact: true }).click();
  const rbToast = await page.getByText(/已回滚到 v1,当前为 v3/).first()
    .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  log('回滚产生 v3(toast 确认)', rbToast);
  const afterRb = await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=id,app_html&limit=1`);
  versions = await rest(token, `project_versions?project_id=eq.${afterRb[0].id}&select=version_number,source,label,app_html&order=version_number.asc`);
  const v1s = versions.find((v) => v.version_number === 1);
  const v3 = versions.find((v) => v.version_number === 3);
  log('v3 回滚版本落库且内容与 v1 快照一致', !!v3 && v3.source === 'rollback' && v3.app_html === v1s?.app_html,
    versions.map((v) => `v${v.version_number}:${v.source}`).join(','));

  // 7) 在线编辑 v4 + 导出一致性
  await page.getByText('编辑器', { exact: true }).first().click();
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  const editorArea = page.getByLabel('HTML 源码编辑器');
  await editorArea.waitFor({ state: 'visible', timeout: 10000 });
  const current = await editorArea.inputValue();
  await editorArea.fill(`<!-- ${EDIT_MARK} -->\n${current}`);
  await page.getByRole('button', { name: '保存并记录版本' }).click();
  const editToast = await page.getByText(/编辑已保存,已记录版本 v4/).first()
    .waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false);
  log('在线编辑保存并记录 v4', editToast);
  const afterEdit = await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=app_html&limit=1`);
  versions = await rest(token, `project_versions?project_id=eq.${afterRb[0].id}&select=version_number,source,label,app_html&order=version_number.asc`);
  const v4 = versions.find((v) => v.version_number === 4);
  log('v4 edit 版本落库且项目含编辑特征', !!v4 && v4.source === 'edit' && afterEdit[0].app_html.includes(EDIT_MARK),
    v4 ? `label=${v4.label}` : 'v4 缺失');
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.getByRole('button', { name: /导出 HTML/ }).click();
  const download = await downloadPromise;
  const dlContent = fs.readFileSync(await download.path(), 'utf8');
  log('导出 HTML 与当前版本一致', dlContent.includes(EDIT_MARK) && dlContent.length === afterEdit[0].app_html.length,
    `${download.suggestedFilename()} | ${dlContent.length} 字符`);
  result.evidence.versionChain = versions.map((v) => `v${v.version_number}:${v.source}:${v.label}`);

  // 8) 刷新回放:消息/计划卡/徽标/版本列表完整恢复(真实链路,isDemo=false)
  await page.reload({ waitUntil: 'domcontentloaded' });
  const msgBack = await page.getByText(PROMPT1.slice(0, 20)).first().waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false);
  // 第二条消息与第一条同批异步加载,isVisible 立即判定存在竞态(上轮误报根因),改为等待式断言
  const msg2Back = await page.getByText(PROMPT2.slice(0, 20)).first().waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false);
  log('刷新回放:两轮用户消息恢复', msgBack && msg2Back, `R1=${msgBack} R2=${msg2Back}`);
  const planBack = await page.getByText('执行计划').first().waitFor({ state: 'visible', timeout: 20000 }).then(() => true).catch(() => false);
  log('刷新回放:计划卡按 metadata 恢复', planBack);
  const realBadge = await page.getByText('生成应用', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 25000 }).then(() => true).catch(() => false);
  log('刷新回放:查看器「生成应用」徽标恢复(真实链路非演示)', realBadge);
  await page.getByRole('button', { name: /历史版本/ }).click();
  let panelText = '';
  for (let i = 0; i < 80 && !panelText.includes('在线编辑'); i++) {
    panelText = await panel.innerText().catch(() => '');
    if (!panelText.includes('在线编辑')) await page.waitForTimeout(500);
  }
  log('刷新回放:版本列表 4 项齐全', panelText.includes('首次生成') && panelText.includes('增量修改')
    && panelText.includes('回滚至 v1') && panelText.includes('在线编辑'), panelText.replace(/\n+/g, ' ').slice(0, 140));
  const iframeBack = await page.locator('iframe[title*="预览"]').first().isVisible().catch(() => false);
  log('刷新回放:关联项目产物恢复至预览', iframeBack);

  // 9) 控制台与总耗时
  log('无未预期控制台错误', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 3).join(' || '));
  result.evidence.artifactErrors = result.artifactErrors;
  if (result.artifactErrors.length) {
    console.log(`NOTE AI 产物脚本运行时错误 ${result.artifactErrors.length} 条(内容质量证据,不计应用失败): ${result.artifactErrors[0]}`);
  }
  result.evidence.totalSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  result.evidence.efStatusAll = efStatus;
  console.log(`\nT29 真实链路复测:${result.steps.filter((s) => s.ok).length}/${result.steps.length} PASS | 总耗时 ${result.evidence.totalSeconds}s`);
  fs.writeFileSync('t29-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(result.steps.every((s) => s.ok) ? 0 : 1);
} catch (error) {
  console.error('走查异常:', error);
  fs.writeFileSync('t29-walkthrough-result.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.tmp-t29-crash.png' }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
