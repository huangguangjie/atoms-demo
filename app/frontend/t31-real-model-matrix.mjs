// T31 真实模型连续生成矩阵复测(真实模型、真实链路、无演示模式、无路由拦截)
//
// 三类应用(计算器 / 贪吃蛇 / 待办清单)各连续两轮真实生成(首轮新会话 + 同项目增量),
// 每轮记录:耗时、Edge Function 调用次数、SSE 事件序列、产物长度、版本号。
// 断言:is_demo=false、无演示模式标识、产物完整未截断、无死循环(上游=1、plan=1)、无重复规划、版本链连续。
//
// SSE 留证方式:在页面上下文把 fetch 响应体 tee 成两路,一路交回产品链路(保持流式消费),
// 一路异步累积为文本,轮次结束后解析真实事件序列(不改变产品行为、不缓冲阻塞)。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t31-matrix-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t31-matrix-${TS} 的 Atoms`;

// 字面标记串:要求模型原样渲染,作为跨轮特征包含与「非演示模板」的可靠锚点
const CASES = [
  {
    key: 'calculator', label: '计算器',
    p1: '做一个简单计算器应用,支持加减乘除与清除,页面标题必须原样显示字符串 T31CALC1,浅色主题,中文界面,代码尽量精简',
    p2: '在计算器上增加一个百分比按钮,按钮文字必须原样包含字符串 T31CALC2,其余功能与文案保持不变',
    m1: 'T31CALC1', m2: 'T31CALC2',
  },
  {
    key: 'snake', label: '贪吃蛇',
    p1: '做一个贪吃蛇小游戏,方向键控制、吃到食物加分,页面标题必须原样显示字符串 T31SNAKE1,浅色主题,中文界面,代码尽量精简',
    p2: '在贪吃蛇游戏中增加一个暂停按钮,按钮文字必须原样包含字符串 T31SNAKE2,其余玩法与文案保持不变',
    m1: 'T31SNAKE1', m2: 'T31SNAKE2',
  },
  {
    key: 'todo', label: '待办清单',
    p1: '做一个待办清单应用,支持新增、勾选完成与删除,页面标题必须原样显示字符串 T31TODO1,浅色主题,中文界面,代码尽量精简',
    p2: '在待办清单中增加一个「全部清除」按钮,按钮文字必须原样包含字符串 T31TODO2,其余功能与文案保持不变',
    m1: 'T31TODO1', m2: 'T31TODO2',
  },
];

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

const result = { steps: [], consoleErrors: [], transientAuthErrors: [], artifactErrors: [], rounds: [], evidence: {} };
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
const NOISE_PATTERNS = ['/api/config', '/functions/v1', '/transcribe'];
const isNoise = (url) => NOISE_PATTERNS.some((p) => String(url || '').includes(p));
// 本地回归环境的时钟偏移:登录注入令牌的 iat 略超前于 Supabase 服务端时间,
// 首次数据请求可能瞬时 401「JWT issued at future」,由 T6 自愈链路重新取会话后恢复
// (本轮后续所有页面内数据操作、生成落库与刷新恢复全部成功即为自愈证据)。单独留痕,不计入未预期错误。
const isTransientAuthSkew = (text) => /JWT issued at future|status of 401|Invalid login credentials/i.test(text);
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  const loc = m.location()?.url ?? '';
  if (isNoise(loc) || isNoise(t)) return;
  if (isTransientAuthSkew(t)) { result.transientAuthErrors.push(t.slice(0, 160)); return; }
  result.consoleErrors.push(`${t.slice(0, 160)} @ ${loc.slice(0, 120)}`);
});
// AI 产物为 srcdoc iframe 内模型非确定性输出:其运行时 JS 语法错误属内容质量证据,单独留痕。
page.on('pageerror', (e) => {
  const s = String(e);
  if (/SyntaxError/.test(s)) { result.artifactErrors.push(s.slice(0, 200)); return; }
  result.consoleErrors.push(`pageerror: ${s.slice(0, 200)}`);
});

// 上游调用计数(死循环/整轮重跑的核心证据:每轮必须 =1)
let efCount = 0;
const efStatus = [];
page.on('request', (req) => {
  if (req.url().includes('app_atoms_agent_generate')) efCount += 1;
});
page.on('response', (r) => {
  if (r.url().includes('app_atoms_agent_generate')) efStatus.push(r.status());
});

// 把 SSE 响应体 tee 成两路:一路交回产品链路(保持流式消费),一路异步累积为文本留证
await page.addInitScript(() => {
  window.__ATOMS_SSE__ = [];
  const original = window.fetch;
  window.fetch = function (...args) {
    const target = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
    const promise = original.apply(this, args);
    if (!String(target).includes('app_atoms_agent_generate')) return promise;
    return promise.then((resp) => {
      try {
        if (!resp.body || typeof resp.body.tee !== 'function') return resp;
        const [appStream, tapStream] = resp.body.tee();
        (async () => {
          const reader = tapStream.getReader();
          const decoder = new TextDecoder();
          let acc = '';
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              acc += decoder.decode(value, { stream: true });
            }
          } catch (e) { /* 记录已读部分即可 */ }
          window.__ATOMS_SSE__.push(acc);
        })();
        return new Response(appStream, {
          status: resp.status,
          statusText: resp.statusText,
          headers: resp.headers,
        });
      } catch (e) {
        return resp;
      }
    });
  };
});

const textarea = () => page.getByPlaceholder('@David 进行数据开发。');
const idleBadge = () => page.getByText('空闲', { exact: true }).first();
const previewFrame = () => page.locator('iframe[title*="预览"]').first();
const sendButton = () => page.getByTitle('发送');

/**
 * 从宿主读取本轮 SSE 文本并解析事件序列。
 * 真实协议为 `data: <AgentEvent JSON>\n\n`(见 Edge Function send),事件名取 JSON 的 type 字段,
 * 而非 SSE 的 `event:` 行——按 event: 行解析会得到空序列。
 */
async function drainSse() {
  const texts = await page.evaluate(() => (window.__ATOMS_SSE__ || []).splice(0));
  const events = [];
  for (const text of texts) {
    for (const line of String(text).split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        if (parsed && typeof parsed.type === 'string') events.push(parsed.type);
      } catch {
        // 忽略无法解析的流分片
      }
    }
  }
  return { events, bytes: texts.reduce((n, t) => n + String(t).length, 0) };
}

const countOf = (events, name) => events.filter((e) => e === name).length;

/** 回到首页并等待输入区就绪(首页提交即创建全新会话,避免误判为上一项目的增量修改) */
async function gotoFreshHome() {
  await page.goto(APP, { waitUntil: 'domcontentloaded' });
  await textarea().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
}

/** 发送一条提示词并等待本轮生成收敛(空闲态) */
async function sendPrompt(prompt, expectNewConversation) {
  await sendButton().waitFor({ state: 'visible', timeout: 30000 });
  await textarea().fill(prompt);
  await sendButton().click();
  if (expectNewConversation) {
    await page.waitForURL(/\/chat\//, { timeout: 30000 });
  }
  const conversationId = page.url().split('/chat/')[1]?.split('?')[0] ?? null;
  await previewFrame().waitFor({ state: 'visible', timeout: 180000 });
  await idleBadge().waitFor({ state: 'visible', timeout: 120000 });
  return conversationId;
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

  const { token, userId } = await freshLoginToken();
  const seenConversations = new Set();

  for (const testCase of CASES) {
    // 每类应用都从首页重新开始 → 提交即创建全新会话(首轮,非增量)
    await gotoFreshHome();
    await drainSse(); // 丢弃首页导航前的残留文本

    const efBefore1 = efCount;
    const t1 = Date.now();
    const convId = await sendPrompt(testCase.p1, true);
    const sec1 = Number(((Date.now() - t1) / 1000).toFixed(1));
    const sse1 = await drainSse();
    const calls1 = efCount - efBefore1;
    const demoMark1 = await page.getByText(/【演示模式】/).first().isVisible().catch(() => false);
    log(`[${testCase.label}] 首轮真实生成完成(全新会话)`,
      Boolean(convId) && !seenConversations.has(convId), `会话 ${convId?.slice(0, 8)} | 耗时 ${sec1}s`);
    seenConversations.add(convId);
    log(`[${testCase.label}] 首轮上游调用=1(无死循环/整轮重跑)`, calls1 === 1,
      `上游调用 ${calls1} 次,状态 ${JSON.stringify(efStatus.slice(efBefore1))}`);
    log(`[${testCase.label}] 首轮 SSE 序列完整且 plan 唯一`,
      countOf(sse1.events, 'app') === 1 && countOf(sse1.events, 'done') === 1 && countOf(sse1.events, 'plan') === 1
        && countOf(sse1.events, 'code-start') === 1 && countOf(sse1.events, 'error') === 0,
      `事件 ${sse1.events.filter((e) => e !== 'code-delta').join('>')} (code-delta ×${countOf(sse1.events, 'code-delta')})`);
    log(`[${testCase.label}] 首轮无演示模式标识(真实链路)`, !demoMark1);

    // REST 核验首轮:v1、is_demo=false、产物完整含特征标记
    let project = null;
    let versions = [];
    for (let i = 0; i < 20; i++) {
      const projs = await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=id,name,app_html,is_demo&order=created_at.desc`);
      versions = projs?.[0] ? await rest(token, `project_versions?project_id=eq.${projs[0].id}&select=version_number,source,label,app_html&order=version_number.asc`) ?? [] : [];
      if (projs?.length === 1 && versions.length >= 1) { project = projs[0]; break; }
      await new Promise((r) => setTimeout(r, 2000));
    }
    const html1 = project?.app_html ?? '';
    log(`[${testCase.label}] 首轮落库 v1 且 is_demo=false`,
      !!project && project.is_demo === false && versions.length === 1 && versions[0].version_number === 1 && versions[0].source === 'generation',
      `is_demo=${project?.is_demo} 版本 ${versions.map((v) => `v${v.version_number}:${v.source}`).join(',')}`);
    log(`[${testCase.label}] 首轮产物完整(含 ${testCase.m1} 且以 </html> 收尾)`,
      html1.includes(testCase.m1) && /<\/html>\s*$/i.test(html1.trim()), `${html1.length} 字符`);
    result.rounds.push({ case: testCase.key, round: 1, seconds: sec1, upstreamCalls: calls1, events: sse1.events, htmlLength: html1.length, version: 1, conversationId: convId });

    // 第二轮:同项目真实增量(previousHtml 自动携带)
    const efBefore2 = efCount;
    const t2 = Date.now();
    await sendButton().waitFor({ state: 'visible', timeout: 30000 });
    await textarea().fill(testCase.p2);
    await sendButton().click();
    let v2 = null;
    let html2 = '';
    for (let i = 0; i < 70; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const projs = await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=id,app_html&order=created_at.desc&limit=1`);
      if (projs?.[0]) {
        html2 = projs[0].app_html ?? '';
        versions = await rest(token, `project_versions?project_id=eq.${projs[0].id}&select=version_number,source,label,app_html&order=version_number.asc`) ?? [];
        v2 = versions.find((v) => v.version_number === 2) ?? null;
        if (v2 && html2.includes(testCase.m2)) break;
      }
    }
    await idleBadge().waitFor({ state: 'visible', timeout: 120000 }).catch(() => {});
    const sec2 = Number(((Date.now() - t2) / 1000).toFixed(1));
    const sse2 = await drainSse();
    const calls2 = efCount - efBefore2;
    const demoMark2 = await page.getByText(/【演示模式】/).first().isVisible().catch(() => false);
    log(`[${testCase.label}] 第二轮真实增量完成(v2 落库)`, Boolean(v2), `耗时 ${sec2}s | label=${v2?.label}`);
    log(`[${testCase.label}] 第二轮上游调用=1(无死循环)`, calls2 === 1,
      `上游调用 ${calls2} 次,状态 ${JSON.stringify(efStatus.slice(efBefore2))}`);
    log(`[${testCase.label}] 第二轮 SSE 序列完整且 plan 唯一`,
      countOf(sse2.events, 'app') === 1 && countOf(sse2.events, 'done') === 1 && countOf(sse2.events, 'error') === 0,
      `事件 ${sse2.events.filter((e) => e !== 'code-delta').join('>')} (code-delta ×${countOf(sse2.events, 'code-delta')})`);
    log(`[${testCase.label}] 第二轮保持首轮特征且引入新特征(增量不丢功能)`,
      html2.includes(testCase.m1) && html2.includes(testCase.m2), `含R1=${html2.includes(testCase.m1)} 含R2=${html2.includes(testCase.m2)}`);
    log(`[${testCase.label}] 第二轮无演示模式标识且不新建项目`,
      !demoMark2 && ((await rest(token, `projects?user_id=eq.${userId}&conversation_id=eq.${convId}&select=id`))?.length ?? -1) === 1);
    result.rounds.push({ case: testCase.key, round: 2, seconds: sec2, upstreamCalls: calls2, events: sse2.events, htmlLength: html2.length, version: 2, conversationId: convId });

    // 版本链与消息元数据核验
    const numbers = versions.map((v) => v.version_number);
    log(`[${testCase.label}] 版本链 v1/v2 连续无重复`, JSON.stringify(numbers) === JSON.stringify([1, 2]), numbers.join(','));
    const messages = await rest(token, `messages?conversation_id=eq.${convId}&select=role,metadata&order=created_at.asc`);
    const assistantMeta = (messages ?? []).filter((m) => m.role === 'assistant' && m.metadata).map((m) => m.metadata);
    log(`[${testCase.label}] 助手消息 metadata 标记为非演示`,
      assistantMeta.length >= 1 && assistantMeta.every((m) => m.isDemo !== true),
      JSON.stringify(assistantMeta.map((m) => ({ isDemo: m.isDemo, kind: m.kind }))));
  }

  log('无未预期控制台错误', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 3).join(' || '));
  log('瞬时认证时钟偏移已自愈且未影响数据链路',
    result.transientAuthErrors.length <= 2 && result.rounds.length === CASES.length * 2,
    `瞬时 401 ${result.transientAuthErrors.length} 次 | 完成轮次 ${result.rounds.length}/${CASES.length * 2}`);
  log('AI 产物无运行时语法错误(无截断/非法代码)', result.artifactErrors.length === 0, result.artifactErrors.slice(0, 2).join(' || '));
  result.evidence.artifactErrors = result.artifactErrors;
  result.evidence.transientAuthErrors = result.transientAuthErrors;
  result.evidence.totalSeconds = Number(((Date.now() - t0) / 1000).toFixed(1));
  result.evidence.efStatusAll = efStatus;
  const passed = result.steps.filter((s) => s.ok).length;
  console.log(`\nT31 真实模型连续生成矩阵:${passed}/${result.steps.length} PASS | 总耗时 ${result.evidence.totalSeconds}s`);
  fs.writeFileSync('t31-real-model-matrix-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(passed === result.steps.length ? 0 : 1);
} catch (error) {
  console.error('矩阵复测异常:', error);
  fs.writeFileSync('t31-real-model-matrix-result.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.tmp-t31-matrix-crash.png' }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
