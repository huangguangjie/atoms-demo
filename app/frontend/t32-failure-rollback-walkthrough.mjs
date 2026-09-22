// T32 失败回退与幂等加固走查(在 T31 原子版本 RPC 基础上)
//
// 断言目标(对应用户要求 1–7):
//   1 失败不生效        —— 生成失败 / 空产物 / 截断产物 / 语法错误产物 / 版本写入失败时,
//                          projects.app_html、Preview 与源码全部保持上一次成功版本
//   2 版本号            —— 失败不占用版本号;成功轮次 v1→v2 连续,无跳号无重复
//   3 快照一致性        —— 任一阶段「最新快照内容 == projects.app_html」,且失败不留下孤儿快照
//   4 历史保留          —— 新版本写入后旧快照(v1)内容原样保留
//   5 重试幂等          —— 同一 tick 连点「重新生成」只产生一次上游调用、只写入一个版本
//   6 源码/Preview 一致 —— 查看器 iframe srcdoc 与源码页签内容均等于当前生效版本
//   7 刷新恢复          —— 失败轮刷新后恢复失败卡与需求原文;成功轮刷新后不残留过期失败态,
//                          并恢复关联项目、当前成功版本与完整版本链
//
// 失败注入方式:Playwright 路由拦截 Edge Function SSE(可控产物)与原子版本 RPC(可控写入失败),
// 不依赖外部服务状态,结果确定性可复现。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t32-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t32-${TS} 的 Atoms`;
const PROMPT = '做一个番茄钟计时器,25 分钟专注 + 5 分钟休息,显示倒计时与开始暂停按钮,浅色主题,中文界面';
const MARK_R1 = 'T32R1MARK';
const MARK_R3 = 'T32R3MARK';
const MARK_R4 = 'T32R4MARK';

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = { steps: [], consoleErrors: [], expectedErrors: [], evidence: {} };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};
/** 注入的失败路径(原子版本 RPC 500 + 调用侧错误日志)属本轮刻意构造,单独留痕不计入未预期错误 */
let expectWriteFailure = false;
const INJECTED_FAILURE = /app_write_project_version|版本写入失败/;

/** 合法产物:含 </html> 且内联脚本可解析 */
const goodHtml = (mark) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${mark}</title></head>`
  + `<body><h1>${mark}</h1><script>document.body.dataset.mark='${mark}';</script></body></html>`;
/** 截断产物:缺 </html> */
const truncatedHtml = (mark) => `<!DOCTYPE html><html><body><h1>${mark}`;
/** 语法错误产物:内联脚本不可解析 */
const syntaxHtml = (mark) =>
  `<!DOCTYPE html><html><body><h1>${mark}</h1><script>const broken = ;</script></body></html>`;

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

/** 读取项目当前内容 + 版本链,并判定「最新快照 == 项目内容」(无半写/无孤儿快照) */
async function snapshot(token, projectId) {
  const proj = await rest(token, `projects?id=eq.${projectId}&select=id,app_html,is_demo`);
  const versions = await rest(
    token,
    `project_versions?project_id=eq.${projectId}&select=version_number,source,label,app_html&order=version_number.asc`,
  ) ?? [];
  const project = proj?.[0] ?? null;
  const latest = versions.length ? versions[versions.length - 1] : null;
  return {
    html: project?.app_html ?? null,
    versions,
    numbers: versions.map((v) => v.version_number),
    latest,
    consistent: !!latest && latest.app_html === (project?.app_html ?? null),
  };
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const NOISE_PATTERNS = ['/api/config', '/functions/v1', '/transcribe'];
const isNoise = (url) => NOISE_PATTERNS.some((p) => String(url || '').includes(p));
/**
 * 公开表读取(社区应用/模板)本可匿名读取:首屏若带上一枚服务端尚不接受的令牌会先吃一次 401,
 * 前端应刷新会话后重试并最终取到数据。这里按响应状态留痕,后续以「同路径随后 200」判定自愈。
 */
const PUBLIC_TABLE_PATHS = ['/rest/v1/templates', '/rest/v1/community_apps'];
const publicTableHits = { ok: [], auth: [] };
result.selfHealedPublicReads = [];
page.on('response', (r) => {
  const url = r.url();
  const hit = PUBLIC_TABLE_PATHS.find((p) => url.includes(p));
  if (!hit) return;
  if (r.status() === 200) publicTableHits.ok.push(hit);
  if (r.status() === 401 || r.status() === 403) publicTableHits.auth.push(hit);
});
/** 该条控制台错误是否为「瞬时鉴权 401 + 同路径随后成功」的自愈路径 */
const isSelfHealedPublicRead = (detail) => {
  const hit = PUBLIC_TABLE_PATHS.find((p) => detail.includes(p));
  return Boolean(hit) && /401|403/.test(detail) && publicTableHits.ok.includes(hit);
};
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  const loc = m.location()?.url ?? '';
  if (isNoise(loc) || isNoise(t)) return;
  if (expectWriteFailure && (INJECTED_FAILURE.test(loc) || INJECTED_FAILURE.test(t))) {
    result.expectedErrors.push(`${t.slice(0, 120)} @ ${loc.slice(0, 100)}`);
    return;
  }
  result.consoleErrors.push(`${t.slice(0, 160)} @ ${loc.slice(0, 120)}`);
});
page.on('pageerror', (e) => result.consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`));

const textarea = () => page.getByPlaceholder('@David 进行数据开发。');
const iframe = () => page.locator('iframe[title*="预览"]').first();
const errorCard = () => page.getByText('生成失败', { exact: true }).first();

// ---------------------------------------------------------------------------
// 失败注入:Edge Function SSE 产物可控 + 原子版本 RPC 写入可控
// ---------------------------------------------------------------------------
/** success | empty | truncated | syntax —— 控制本轮产出的产物形态 */
let artifactMode = 'success';
let artifactMark = MARK_R1;
/** true 时原子版本 RPC 返回 500,模拟「事务已回滚」的写入失败 */
let blockVersionWrite = false;
let upstreamCalls = 0;

await page.route('**/app_atoms_agent_generate*', async (route) => {
  upstreamCalls += 1;
  const html = artifactMode === 'empty'
    ? ''
    : artifactMode === 'truncated'
      ? truncatedHtml(artifactMark)
      : artifactMode === 'syntax'
        ? syntaxHtml(artifactMark)
        : goodHtml(artifactMark);
  const events = [
    { type: 'plan', steps: ['分析需求', '设计布局', '实现交互', '适配响应式', '生成应用'] },
    { type: 'code-start', fileName: 'index.html' },
    { type: 'code-delta', delta: html.slice(0, 48), percent: 50 },
    { type: 'code-delta', delta: '', percent: 100 },
    {
      type: 'app',
      app: {
        title: 'T32 走查应用',
        kind: 'landing',
        files: [{ name: 'index.html', content: html, language: 'html' }],
      },
    },
    { type: 'done', stopped: false },
  ];
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''),
  });
});

await page.route('**/rest/v1/rpc/app_write_project_version*', async (route) => {
  if (!blockVersionWrite) {
    await route.continue();
    return;
  }
  await route.fulfill({
    status: 500,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'T32 注入:版本写入失败(事务已回滚)' }),
  });
});

/** 等待失败卡出现(失败轮收敛判据) */
async function waitFailureCard(timeout = 60000) {
  await errorCard().waitFor({ state: 'visible', timeout });
  return true;
}

/**
 * 发起新一轮生成并等待本轮收敛(失败或成功)。
 * 失败卡存在时点「重新生成」续跑;不存在时(上一轮成功,如首次注入失败)从输入区提交同一需求。
 */
async function regenerate() {
  const before = upstreamCalls;
  const regenBtn = page.getByRole('button', { name: '重新生成' });
  if (await regenBtn.isVisible().catch(() => false)) {
    await regenBtn.click();
  } else {
    await textarea().fill(PROMPT);
    await page.getByTitle('发送').click();
  }
  for (let i = 0; i < 120 && upstreamCalls === before; i++) await page.waitForTimeout(500);
  // 先等生成态出现(流式收尾可能极快,未捕捉到不阻塞),再等回到空闲
  await page.getByText('生成中', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
  await page.getByText('空闲', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 90000 }).catch(() => undefined);
  await page.waitForTimeout(1000);
}

/** 当前生效产物的预览与源码文本 */
async function currentArtifact() {
  const srcdoc = (await iframe().getAttribute('srcdoc').catch(() => '')) ?? '';
  await page.getByRole('button', { name: '代码', exact: true }).click();
  const code = await page.locator('pre').first().innerText().catch(() => '');
  await page.getByRole('button', { name: '预览', exact: true }).click();
  return { srcdoc, code };
}

try {
  const t0 = Date.now();
  // 1) 注册 + 登录注入
  const signupResp = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册新账号', signupResp.ok, `HTTP ${signupResp.status}`);
  await page.goto(
    `${LOGIN_BASE}?email=${encodeURIComponent(EMAIL)}&password=${encodeURIComponent(PASSWORD)}`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.waitForURL(`${APP}/**`, { timeout: 30000 });
  let ready = false;
  for (let i = 0; i < 8 && !ready; i++) {
    await page.waitForTimeout(3000);
    ready = await page.locator('aside').getByText(DEFAULT_SPACE).first().isVisible().catch(() => false)
      && await textarea().isVisible().catch(() => false);
    if (i === 3) await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
  }
  log('登录注入并进入首页', ready, ready ? DEFAULT_SPACE : '默认工作区未出现');
  if (!ready) throw new Error('登录注入失败');

  // 2) 首轮成功生成 → v1(后续失败轮的「上一次成功版本」基线)
  artifactMode = 'success';
  artifactMark = MARK_R1;
  await textarea().fill(PROMPT);
  await page.getByTitle('发送').click();
  await page.waitForURL(/\/chat\//, { timeout: 20000 });
  const convId = page.url().split('/chat/')[1];
  await iframe().waitFor({ state: 'visible', timeout: 60000 });
  await page.getByText('空闲', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 60000 }).catch(() => undefined);
  const { token, userId } = await freshLoginToken();
  let project = null;
  for (let i = 0; i < 15 && !project; i++) {
    await page.waitForTimeout(1000);
    const rows = await rest(token, `projects?conversation_id=eq.${convId}&select=id,app_html,is_demo`);
    project = rows?.[0] ?? null;
  }
  log('首轮成功生成并落库项目', !!project, project ? `app_html ${(project.app_html || '').length} 字符` : '15s 内未落库');
  if (!project) throw new Error('首轮项目未落库');
  const projectId = project.id;
  let snap = await snapshot(token, projectId);
  log('首轮写入 v1 且版本链连续', JSON.stringify(snap.numbers) === JSON.stringify([1]),
    `版本链 ${snap.numbers.join(',')}`);
  log('首轮内容与最新快照一致(无半写)', snap.consistent && snap.html.includes(MARK_R1),
    `一致=${snap.consistent} 含 R1=${snap.html.includes(MARK_R1)}`);
  const successHtml = snap.html;

  // 3) 失败轮 A:空产物 → 守卫拦截为失败,不落库、不切换预览
  artifactMode = 'empty';
  await regenerate();
  log('空产物:失败卡出现(守卫拦截,不进入成功路径)', await waitFailureCard());
  let art = await currentArtifact();
  log('空产物:Preview 与源码仍为上一次成功版本', art.srcdoc.includes(MARK_R1) && art.code.includes(MARK_R1),
    `srcdoc 含R1=${art.srcdoc.includes(MARK_R1)} 源码含R1=${art.code.includes(MARK_R1)}`);
  snap = await snapshot(token, projectId);
  log('空产物:项目内容未被改写、未新增版本、无孤儿快照',
    snap.html === successHtml && JSON.stringify(snap.numbers) === JSON.stringify([1]) && snap.consistent,
    `版本链 ${snap.numbers.join(',')} 一致=${snap.consistent}`);

  // 4) 刷新恢复:失败态(失败卡 + 需求原文)恢复,当前生效版本仍为 v1
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(PROMPT).first().waitFor({ state: 'visible', timeout: 30000 });
  const restoredFailure = await waitFailureCard(30000).catch(() => false);
  const restoredPrompt = await page.getByText(/需求已保留/).first()
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  log('刷新恢复:失败卡与需求原文按消息 metadata 恢复', restoredFailure && restoredPrompt,
    `失败卡=${restoredFailure} 需求原文=${restoredPrompt}`);
  const restoredRegen = await page.getByRole('button', { name: '重新生成' }).isVisible().catch(() => false);
  log('刷新恢复:保留「重新生成」入口', restoredRegen);
  await iframe().waitFor({ state: 'visible', timeout: 30000 });
  const reloadArt = (await iframe().getAttribute('srcdoc').catch(() => '')) ?? '';
  log('刷新恢复:关联项目与当前成功版本(v1)恢复到预览', reloadArt.includes(MARK_R1),
    `srcdoc ${reloadArt.length} 字符`);

  // 5) 失败轮 B:截断产物(缺 </html>)
  artifactMode = 'truncated';
  await regenerate();
  log('截断产物:失败卡出现', await waitFailureCard());
  art = await currentArtifact();
  log('截断产物:Preview 与源码保持上一次成功版本', art.srcdoc.includes(MARK_R1) && art.code.includes(MARK_R1));
  snap = await snapshot(token, projectId);
  log('截断产物:未写入、未占版本号', snap.html === successHtml && JSON.stringify(snap.numbers) === JSON.stringify([1]),
    `版本链 ${snap.numbers.join(',')}`);

  // 6) 失败轮 C:语法错误产物
  artifactMode = 'syntax';
  await regenerate();
  log('语法错误产物:失败卡出现', await waitFailureCard());
  art = await currentArtifact();
  log('语法错误产物:Preview 与源码保持上一次成功版本', art.srcdoc.includes(MARK_R1) && art.code.includes(MARK_R1));
  snap = await snapshot(token, projectId);
  log('语法错误产物:未写入、未占版本号', snap.html === successHtml && JSON.stringify(snap.numbers) === JSON.stringify([1]),
    `版本链 ${snap.numbers.join(',')}`);

  // 7) 失败轮 D:产物合法但版本写入失败(原子 RPC 整体回滚)→ 失败不生效
  artifactMode = 'success';
  artifactMark = MARK_R3;
  blockVersionWrite = true;
  expectWriteFailure = true;
  await regenerate();
  log('版本写入失败:失败卡出现(事务已回滚)', await waitFailureCard());
  const rollbackHint = await page.getByText(/未能写入云端/).first()
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  log('版本写入失败:失败卡明确「事务已回滚,保持上一次成功结果」', rollbackHint);
  art = await currentArtifact();
  log('版本写入失败:Preview 与源码未出现失败产物 R3',
    art.srcdoc.includes(MARK_R1) && !art.srcdoc.includes(MARK_R3)
    && art.code.includes(MARK_R1) && !art.code.includes(MARK_R3),
    `srcdoc 含R3=${art.srcdoc.includes(MARK_R3)} 源码含R3=${art.code.includes(MARK_R3)}`);
  snap = await snapshot(token, projectId);
  log('版本写入失败:项目内容与版本链均未前进(失败不占号、无孤儿快照)',
    snap.html === successHtml && JSON.stringify(snap.numbers) === JSON.stringify([1]) && snap.consistent,
    `版本链 ${snap.numbers.join(',')} 一致=${snap.consistent} 项目含R3=${snap.html.includes(MARK_R3)}`);
  blockVersionWrite = false;
  expectWriteFailure = false;

  // 8) 重试幂等:同一 tick 连点「重新生成」→ 只 1 次上游调用、只写入 1 个版本
  artifactMode = 'success';
  artifactMark = MARK_R4;
  const callsBeforeRetry = upstreamCalls;
  const versionsBeforeRetry = (await snapshot(token, projectId)).numbers.length;
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find((b) => (b.textContent || '').includes('重新生成'));
    if (btn) {
      // 同一 JS tick 内触发两次点击:生成态 setState 尚未生效,只有同步锁能拦住第二次
      btn.click();
      btn.click();
    }
  });
  for (let i = 0; i < 120 && upstreamCalls === callsBeforeRetry; i++) await page.waitForTimeout(500);
  await page.getByText('空闲', { exact: true }).first()
    .waitFor({ state: 'visible', timeout: 90000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
  const retryCalls = upstreamCalls - callsBeforeRetry;
  log('重试幂等:连点「重新生成」只产生 1 次上游调用', retryCalls === 1, `上游调用 ${retryCalls} 次`);
  snap = await snapshot(token, projectId);
  log('重试幂等:只写入 1 个新版本(无重复版本号)', snap.numbers.length === versionsBeforeRetry + 1
    && new Set(snap.numbers).size === snap.numbers.length,
    `版本链 ${snap.numbers.join(',')}`);

  // 9) 成功轮 v2:版本号连续、历史保留、快照与项目内容一致
  log('成功轮写入 v2 且版本号连续(v1→v2,失败轮未占号)',
    JSON.stringify(snap.numbers) === JSON.stringify([1, 2]), `版本链 ${snap.numbers.join(',')}`);
  log('v2 来源与标签正确(增量修改)', snap.latest?.source === 'generation'
    && String(snap.latest?.label || '').startsWith('增量修改'),
    `v${snap.latest?.version_number}:${snap.latest?.source}:${snap.latest?.label}`);
  log('最新快照内容 == projects.app_html(T31 原子写入保持)',
    snap.consistent && snap.html.includes(MARK_R4), `一致=${snap.consistent}`);
  const v1Snap = snap.versions.find((v) => v.version_number === 1);
  log('历史保留:v1 快照内容原样未变', v1Snap?.app_html === successHtml && v1Snap.app_html.includes(MARK_R1),
    `v1 ${(v1Snap?.app_html || '').length} 字符 含R1=${!!v1Snap?.app_html.includes(MARK_R1)}`);

  // 10) 源码 / Preview 一致(当前生效版本 v2)
  art = await currentArtifact();
  log('源码与 Preview 均为当前生效版本 v2',
    art.srcdoc.includes(MARK_R4) && art.code.includes(MARK_R4)
    && !art.code.includes(MARK_R1),
    `srcdoc 含R4=${art.srcdoc.includes(MARK_R4)} 源码含R4=${art.code.includes(MARK_R4)}`);
  const h1Text = snap.html.match(/<h1>([^<]*)<\/h1>/)?.[1] ?? '';
  log('Preview srcdoc 与数据库 app_html 同源一致',
    !!h1Text && art.srcdoc.includes(h1Text) && snap.html.includes(h1Text), `h1=${h1Text}`);

  // 11) 刷新恢复:成功轮之后不残留过期失败态,并恢复完整版本链与当前版本
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(PROMPT).first().waitFor({ state: 'visible', timeout: 30000 });
  await iframe().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(3000);
  const staleFailure = await errorCard().isVisible().catch(() => false);
  log('刷新恢复:成功轮之后不残留过期失败卡', !staleFailure, `失败卡可见=${staleFailure}`);
  const finalArt = (await iframe().getAttribute('srcdoc').catch(() => '')) ?? '';
  log('刷新恢复:当前成功版本 v2 恢复到预览', finalArt.includes(MARK_R4), `srcdoc ${finalArt.length} 字符`);
  await page.getByRole('button', { name: /历史版本/ }).click();
  const panel = page.locator('div.absolute.right-0.top-9');
  await panel.waitFor({ state: 'visible', timeout: 10000 }).catch(() => undefined);
  let panelText = '';
  for (let i = 0; i < 80 && !panelText.includes('增量修改'); i++) {
    panelText = await panel.innerText().catch(() => '');
    if (!panelText.includes('增量修改')) await page.waitForTimeout(500);
  }
  log('刷新恢复:版本链 v1/v2 完整恢复', panelText.includes('首次生成') && panelText.includes('增量修改'),
    panelText.replace(/\n+/g, ' ').slice(0, 120));
  const finalSnap = await snapshot(token, projectId);
  log('刷新后库内仍自洽(项目内容 == 最新快照)', finalSnap.consistent
    && JSON.stringify(finalSnap.numbers) === JSON.stringify([1, 2]),
    `版本链 ${finalSnap.numbers.join(',')} 一致=${finalSnap.consistent}`);

  // 12) 汇总
  result.evidence = {
    projectId,
    conversationId: convId,
    upstreamCalls,
    finalChain: finalSnap.versions.map((v) => `v${v.version_number}:${v.source}:${v.label}`),
    failureRounds: 4,
    artifactLengths: { success: successHtml.length, latest: finalSnap.html.length },
    totalSeconds: Number(((Date.now() - t0) / 1000).toFixed(1)),
  };
  // 公开表瞬时鉴权自愈:凡出现过 401/403 的路径,必须能看到随后成功的同路径请求
  const authPaths = [...new Set(publicTableHits.auth)];
  const healed = authPaths.filter((p) => publicTableHits.ok.includes(p));
  result.selfHealedPublicReads = healed;
  log('公开表读取的瞬时鉴权已自愈(401 后同路径重试成功)',
    authPaths.every((p) => publicTableHits.ok.includes(p)),
    authPaths.length === 0
      ? '本轮未出现瞬时 401(公开读一次成功)'
      : `瞬时 401 路径 ${authPaths.join(',')} 自愈 ${healed.join(',') || '无'}`);
  // 已自愈的瞬时 401 单列留痕,不计入未预期错误;其余错误照常判定失败
  result.consoleErrors = result.consoleErrors.filter((e) => {
    if (!isSelfHealedPublicRead(e)) return true;
    result.expectedErrors.push(`瞬时鉴权自愈(会话刷新后重试成功):${e.slice(0, 140)}`);
    return false;
  });
  log('无未预期控制台错误', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 3).join(' || '));
  const passed = result.steps.filter((s) => s.ok).length;
  console.log(`\nT32 失败回退与幂等加固:${passed}/${result.steps.length} PASS | 总耗时 ${result.evidence.totalSeconds}s`);
  fs.writeFileSync('t32-failure-rollback-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(passed === result.steps.length ? 0 : 1);
} catch (error) {
  console.error('走查异常:', error);
  const passed = result.steps.filter((s) => s.ok).length;
  result.evidence.totalSeconds = Number(((Date.now() - 0) / 1000).toFixed(1));
  console.log(`\nT32 走查中断:${passed}/${result.steps.length} PASS`);
  fs.writeFileSync('t32-failure-rollback-walkthrough-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(1);
}
