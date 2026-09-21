/**
 * T28 死循环复现与守卫验证脚本(Node 直跑,无需浏览器)
 *
 * 场景构造(mock SSE 服务器模拟 Edge Function 行为,覆盖浏览器可观察到的两类截断):
 *   S1a 完整产出后优雅截断:发出 plan/进度/app 事件后,不发 done 直接结束响应
 *       (对应服务端软超时收尾丢包/网关提前 FIN)。修复前:agent.ts 抛「AI 生成连接中断」
 *       并判为瞬时错误,整轮重跑(重新规划→重新生成)最多 4 次,即用户看到的
 *       「代码 100% 后重新规划再生成」;修复后:已产出 app 即视为产物到手,静默收敛。
 *   S1b 完整产出后异常截断:发出 app 后直接 destroy socket(对应连接被硬回收)。
 *       修复前:reader 抛 network error 同样触发整轮重跑;修复后:app 已交付则禁止重跑。
 *   S2  正常收尾(app + done)——修复前后都应单次收敛。
 *   S3  真实错误(error + done 收尾,如 402)——确定性错误,单次收敛,错误透出,不重跑。
 *   S4  未产出 app 前优雅截断(半截 delta、无 done)——允许自动重试(保留 T21 韧性),
 *       但整轮调用必须封顶(≤4 次),不得无限循环。
 *
 * 断言口径:mock 服务器收到的请求次数 = runAgent 对上游的整轮调用次数。
 */
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const __dirname = new URL('.', import.meta.url).pathname;

// ---------- 1. esbuild 打包 agent.ts(桩替换 supabase 依赖) ----------
const outDir = mkdtempSync(join(tmpdir(), 't28-agent-'));
const bundlePath = join(outDir, 'agent.mjs');
const esbuildBin = join(__dirname, 'node_modules/.pnpm/node_modules/.bin/esbuild');
const build = spawnSync(
  esbuildBin,
  [
    join(__dirname, 't28-agent-entry.ts'),
    '--bundle',
    '--format=esm',
    '--platform=node',
    `--outfile=${bundlePath}`,
    `--alias:@/lib/supabase=${join(__dirname, 't28-stub-supabase.ts')}`,
    `--alias:@=${join(__dirname, 'src')}`,
  ],
  { encoding: 'utf8' },
);
if (build.status !== 0) {
  console.error('esbuild 打包失败:', build.stderr || build.stdout);
  process.exit(1);
}

const { runAgent, __t28State } = await import(pathToFileURL(bundlePath).href);

// ---------- 2. mock SSE 服务器 ----------
let hits = 0; // 上游整轮调用次数
let scenario = 'S1a';

const FULL_APP_HTML =
  '<!DOCTYPE html><html><head><title>mock</title></head><body>hello</body></html>';

function makeScenario(name) {
  const plan = { type: 'plan', steps: ['步骤1', '步骤2'] };
  const deltas = [
    { type: 'code-start', fileName: 'index.html' },
    { type: 'code-delta', delta: '<!DOCTYPE html>', percent: 50 },
    { type: 'code-delta', delta: FULL_APP_HTML.slice(16), percent: 99 },
    { type: 'code-delta', delta: '', percent: 100 },
  ];
  const app = {
    type: 'app',
    app: {
      title: 'Mock 应用',
      kind: 'landing',
      files: [{ name: 'index.html', content: FULL_APP_HTML, language: 'html' }],
    },
  };
  const done = { type: 'done', stopped: false };
  const error = { type: 'error', message: 'AI 账户余额不足,请充值后重试' };

  switch (name) {
    case 'S1a': // 完整产出 app 后不发 done,优雅结束响应(提前 FIN)
      return { events: [plan, ...deltas, app], close: 'end' };
    case 'S1b': // 完整产出 app 后 destroy socket(硬回收)
      return { events: [plan, ...deltas, app], close: 'destroy' };
    case 'S2': // 正常收尾
      return { events: [plan, ...deltas, app, done], close: 'end' };
    case 'S3': // 真实错误 + done 收尾(确定性错误)
      return { events: [plan, error, done], close: 'end' };
    case 'S4': // 未产出 app 前半截截断(无 done)
      return { events: [plan, deltas[0], deltas[1]], close: 'end' };
    default:
      throw new Error(`未知场景 ${name}`);
  }
}

const server = http.createServer((req, res) => {
  hits += 1;
  const { events, close } = makeScenario(scenario);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  let i = 0;
  const timer = setInterval(() => {
    if (i < events.length) {
      res.write(`data: ${JSON.stringify(events[i])}\n\n`);
      i += 1;
      return;
    }
    clearInterval(timer);
    if (close === 'destroy') res.destroy();
    else res.end();
  }, 5);
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
__t28State.functionUrl = `http://127.0.0.1:${port}/functions/v1/app_atoms_agent_generate`;

// ---------- 3. 驱动 runAgent 并采集事件序列 ----------
async function runOne(name) {
  scenario = name;
  hits = 0;
  const events = [];
  const controller = new AbortController();
  // 修复前 S1 会连续重跑 4 次(含退避等待),给足观察窗口后主动中止防止脚本挂死
  const watchdog = setTimeout(() => controller.abort(), 30_000);
  try {
    await runAgent({
      prompt: '做一个贪吃蛇',
      theme: '默认',
      mode: 'build',
      signal: controller.signal,
      onEvent: (e) => events.push(e.type),
    });
  } catch (error) {
    events.push(`throw:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(watchdog);
  }
  return { hits, events };
}

const results = [];
for (const name of ['S1a', 'S1b', 'S2', 'S3', 'S4']) {
  const r = await runOne(name);
  results.push({ scenario: name, ...r });
}
server.close();

// ---------- 4. 断言 ----------
const checks = [];
const assert = (label, ok, detail) => checks.push({ label, ok, detail });

const get = (name) => results.find((r) => r.scenario === name);
const s1a = get('S1a');
const s1b = get('S1b');
const s2 = get('S2');
const s3 = get('S3');
const s4 = get('S4');

assert(
  'S1a 已产出 app 后优雅截断:上游只调用 1 次(修复前会整轮重跑≥2次)',
  s1a.hits === 1,
  `hits=${s1a.hits}, events=${s1a.events.join(',')}`,
);
assert(
  'S1a 收敛信号:app 之后以 done 结束(产物已到手,静默收敛)',
  s1a.events.includes('app') && s1a.events[s1a.events.length - 1] === 'done',
  `events=${s1a.events.join(',')}`,
);
assert(
  'S1a 不得出现重复 plan(app 之后不再重新规划)',
  s1a.events.filter((e) => e === 'plan').length <= 1,
  `planCount=${s1a.events.filter((e) => e === 'plan').length}`,
);
assert(
  'S1b 已产出 app 后 socket 硬截断:上游只调用 1 次(app 已交付禁止重跑)',
  s1b.hits === 1,
  `hits=${s1b.hits}, events=${s1b.events.join(',')}`,
);
assert(
  'S1b 收敛信号:app 之后以 done 结束',
  s1b.events.includes('app') && s1b.events[s1b.events.length - 1] === 'done',
  `events=${s1b.events.join(',')}`,
);
assert('S2 正常收尾:上游只调用 1 次', s2.hits === 1, `hits=${s2.hits}`);
assert(
  'S2 收敛信号:app + done',
  s2.events.includes('app') && s2.events[s2.events.length - 1] === 'done',
  `events=${s2.events.join(',')}`,
);
assert('S3 确定性错误:上游只调用 1 次(不自动重试)', s3.hits === 1, `hits=${s3.hits}`);
assert(
  'S3 错误透出:收到 error 事件且以 done 收敛',
  s3.events.includes('error') && s3.events[s3.events.length - 1] === 'done',
  `events=${s3.events.join(',')}`,
);
assert(
  'S4 未产出 app 前截断:允许自动重试(hits>1,保留 T21 韧性)',
  s4.hits > 1,
  `hits=${s4.hits}, events=${s4.events.slice(0, 14).join(',')}...`,
);
assert(
  'S4 重试封顶:整轮调用 ≤4 次,不无限循环',
  s4.hits <= 4,
  `hits=${s4.hits}`,
);

let pass = 0;
for (const c of checks) {
  console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}  [${c.detail}]`);
  if (c.ok) pass += 1;
}
console.log(`\nT28 复现结果: ${pass}/${checks.length} PASS`);
writeFileSync(
  join(__dirname, 't28-walkthrough-result.json'),
  JSON.stringify(
    {
      task: 'T28 Agent 死循环修复',
      script: 't28-loop-repro.mjs',
      method: 'Mock SSE 服务器驱动真实 agent.ts(esbuild 打包 + supabase 桩)',
      total: checks.length,
      pass,
      checks,
      finished_at: new Date().toISOString(),
    },
    null,
    2,
  ),
);
process.exit(pass === checks.length ? 0 : 1);
