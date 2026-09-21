// T31 事务一致性与故障注入验收(不经 UI,直接打 REST/RPC)
//
// 目标:证明「更新项目产物 + 写入版本快照」不会出现半写状态。
// 覆盖 8 类注入:
//   I1 合法写入            → 版本号权威分配 +1,项目内容与快照同时生效
//   I2 唯一约束冲突        → 显式传已存在版本号,整体回滚(项目内容不被改写)
//   I3 非法版本来源        → CHECK 语义拒绝(22023),项目与版本均不变
//   I4 项目不存在          → P0002,无任何副作用
//   I5 越权写入他人项目    → 42501,属主数据不变
//   I6 未登录(anon)      → 无 EXECUTE 权限,请求被拒
//   I7 并发写入 6 路       → 版本号无重复、项目内容与最大版本快照一致
//   I8 网络中断(客户端 abort) → 库内仍自洽:项目内容 == 最大版本快照
import fs from 'node:fs';

const ENV = Object.fromEntries(
  fs.readFileSync('/workspace/app/frontend/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const BASE = ENV.VITE_SUPABASE_URL.replace(/\/$/, '');
const ANON = ENV.VITE_SUPABASE_ANON_KEY;
const TS = Date.now();
const PASSWORD = 'AtomsDemo2026!';
const EMAIL_A = `t31-tx-a-${TS}@atoms.test`;
const EMAIL_B = `t31-tx-b-${TS}@atoms.test`;

const result = { steps: [], evidence: {} };
const log = (name, ok, detail = '') => {
  result.steps.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
};
const html = (mark) => `<!doctype html><html><head><title>${mark}</title></head><body><h1>${mark}</h1></body></html>`;

async function signup(email) {
  const r = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return r.status;
}

async function login(email) {
  const r = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`密码授权失败 HTTP ${r.status}`);
  return { token: data.access_token, userId: data.user.id };
}

async function rest(token, path, init = {}) {
  const r = await fetch(`${BASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

/** 调用原子写入 RPC;返回 { status, body }(body.code 为 PG 错误码) */
async function rpcWrite(token, args, signal) {
  const r = await fetch(`${BASE}/rest/v1/rpc/app_write_project_version`, {
    method: 'POST',
    signal,
    headers: {
      apikey: ANON,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

const pgCode = (res) => (res?.body && typeof res.body === 'object' ? res.body.code : undefined) ?? null;

/** 读取项目当前内容与版本链(用于半写状态判定) */
async function snapshot(token, projectId) {
  const proj = await rest(token, `projects?id=eq.${projectId}&select=id,app_html,is_demo`);
  const vers = await rest(token, `project_versions?project_id=eq.${projectId}&select=version_number,source,label,app_html&order=version_number.asc`);
  const project = proj.body?.[0] ?? null;
  const versions = vers.body ?? [];
  const latest = versions.length ? versions[versions.length - 1] : null;
  return {
    html: project?.app_html ?? null,
    isDemo: project?.is_demo ?? null,
    versions,
    numbers: versions.map((v) => v.version_number),
    latest,
    /** 一致性:项目内容必须等于最大版本号快照内容(无半写) */
    consistent: !!latest && latest.app_html === (project?.app_html ?? null),
  };
}

try {
  // 0) 两个账号:属主 A 与越权者 B
  log('账号 A 注册', (await signup(EMAIL_A)) < 400);
  log('账号 B 注册', (await signup(EMAIL_B)) < 400);
  const a = await login(EMAIL_A);
  const b = await login(EMAIL_B);
  log('账号 A/B 登录获取 JWT', !!a.token && !!b.token);

  // 夹具项目:基线内容 BASE,初始无版本
  const created = await rest(a.token, 'projects', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: a.userId,
      name: `T31-TX-${TS}`,
      source: 'created',
      description: 'T31 事务一致性夹具',
      app_html: html('T31-TX-BASE'),
    }),
  });
  const projectId = created.body?.[0]?.id;
  log('夹具项目创建', created.status === 201 && !!projectId, `HTTP ${created.status}`);
  if (!projectId) throw new Error('夹具项目创建失败');

  const base = await snapshot(a.token, projectId);
  log('基线状态:无版本且项目为 BASE 内容', base.versions.length === 0 && base.html.includes('T31-TX-BASE'),
    `版本数 ${base.versions.length}`);

  // I1 合法写入
  const w1 = await rpcWrite(a.token, {
    p_project_id: projectId, p_source: 'generation', p_label: '首次生成', p_app_html: html('T31-TX-V1'),
  });
  const s1 = await snapshot(a.token, projectId);
  log('I1 合法写入成功且版本号为 1', w1.status < 300 && Number(w1.body) === 1, `HTTP ${w1.status} 返回 ${JSON.stringify(w1.body)}`);
  log('I1 项目内容与 v1 快照同时生效(原子)',
    s1.html.includes('T31-TX-V1') && s1.versions.length === 1 && s1.consistent,
    `一致=${s1.consistent} 版本链 ${s1.numbers.join(',')}`);

  // I2 唯一约束冲突 → 整体回滚
  const w2 = await rpcWrite(a.token, {
    p_project_id: projectId, p_source: 'generation', p_label: '冲突写入', p_app_html: html('T31-TX-CONFLICT'), p_version_number: 1,
  });
  const s2 = await snapshot(a.token, projectId);
  log('I2 显式重复版本号被唯一约束拒绝(23505)', w2.status >= 400 && pgCode(w2) === '23505', `HTTP ${w2.status} code=${pgCode(w2)}`);
  log('I2 冲突请求整体回滚:项目内容未被改写、版本链未增长',
    s2.html.includes('T31-TX-V1') && !s2.html.includes('T31-TX-CONFLICT') && s2.numbers.join(',') === '1' && s2.consistent,
    `一致=${s2.consistent} 版本链 ${s2.numbers.join(',')}`);

  // I3 非法来源
  const w3 = await rpcWrite(a.token, {
    p_project_id: projectId, p_source: 'bogus', p_label: '非法来源', p_app_html: html('T31-TX-BADSRC'),
  });
  const s3 = await snapshot(a.token, projectId);
  log('I3 非法版本来源被拒绝(22023)', w3.status >= 400 && pgCode(w3) === '22023', `HTTP ${w3.status} code=${pgCode(w3)}`);
  log('I3 拒绝后无副作用', !s3.html.includes('T31-TX-BADSRC') && s3.numbers.join(',') === '1' && s3.consistent, `一致=${s3.consistent}`);

  // I4 项目不存在
  const w4 = await rpcWrite(a.token, {
    p_project_id: '00000000-0000-4000-8000-000000000000', p_source: 'generation', p_label: '不存在', p_app_html: html('T31-TX-NOPROJ'),
  });
  log('I4 不存在的项目被拒绝(P0002)', w4.status >= 400 && pgCode(w4) === 'P0002', `HTTP ${w4.status} code=${pgCode(w4)}`);

  // I5 越权:用户 B 写用户 A 的项目
  const w5 = await rpcWrite(b.token, {
    p_project_id: projectId, p_source: 'edit', p_label: '越权写入', p_app_html: html('T31-TX-STOLEN'),
  });
  const s5 = await snapshot(a.token, projectId);
  // RLS 下越权者连项目行都不可见:函数内 SELECT ... FOR UPDATE 返回空 → P0002「项目不存在或无权访问」,
  // 既不写入也不泄露「该项目确实存在」这一事实(42501 为无权但可见时的分支)。两者均为合法拒绝。
  log('I5 越权写入被拒绝(RLS 隔离,不泄露项目存在性)',
    w5.status >= 400 && ['42501', 'P0002'].includes(pgCode(w5)), `HTTP ${w5.status} code=${pgCode(w5)}`);
  log('I5 属主数据未被越权改动', !s5.html.includes('T31-TX-STOLEN') && s5.numbers.join(',') === '1' && s5.consistent, `一致=${s5.consistent}`);

  // I6 未登录(anon)调用
  const w6 = await rpcWrite(null, {
    p_project_id: projectId, p_source: 'edit', p_label: '匿名写入', p_app_html: html('T31-TX-ANON'),
  });
  log('I6 未登录调用被拒绝(anon 无 EXECUTE 权限)', w6.status >= 400, `HTTP ${w6.status} code=${pgCode(w6)}`);

  // I7 并发 6 路写入:版本号不重复 + 项目内容与最大版本快照一致
  const concurrent = await Promise.all(
    Array.from({ length: 6 }, (_, i) => rpcWrite(a.token, {
      p_project_id: projectId, p_source: 'generation', p_label: `并发写入 ${i + 1}`, p_app_html: html(`T31-TX-CONC-${i + 1}`),
    })),
  );
  const okCount = concurrent.filter((r) => r.status < 300).length;
  const s7 = await snapshot(a.token, projectId);
  const uniqueNumbers = new Set(s7.numbers).size === s7.numbers.length;
  log('I7 并发写入完成(全部成功)', okCount === 6, `成功 ${okCount}/6`);
  log('I7 版本号权威分配无重复', uniqueNumbers, `版本链 ${s7.numbers.join(',')}`);
  log('I7 并发后项目内容 == 最大版本快照(无半写)', s7.consistent,
    `项目内容 ${s7.html?.match(/T31-TX-[A-Z0-9-]+/)?.[0]} | 最新快照 v${s7.latest?.version_number} ${s7.latest?.app_html?.match(/T31-TX-[A-Z0-9-]+/)?.[0]}`);
  result.evidence.concurrent = { okCount, numbers: s7.numbers, consistent: s7.consistent };

  // I8 网络中断:客户端 abort 后库内仍自洽
  const before8 = await snapshot(a.token, projectId);
  const controller = new AbortController();
  const pending = rpcWrite(a.token, {
    p_project_id: projectId, p_source: 'edit', p_label: '中断写入', p_app_html: html('T31-TX-ABORT'),
  }, controller.signal).catch((error) => ({ status: 0, body: { code: 'ABORTED', message: String(error?.name ?? error) } }));
  setTimeout(() => controller.abort(), 30);
  const w8 = await pending;
  await new Promise((r) => setTimeout(r, 3000));
  const s8 = await snapshot(a.token, projectId);
  const aborted = w8.body?.code === 'ABORTED' || w8.status === 0;
  log('I8 客户端中断请求(已触发 abort)', aborted, `HTTP ${w8.status} code=${pgCode(w8)}`);
  // 中断只有两种合法结果:服务端未开始/未提交(版本号不变),或中断前已完整提交(版本号 +1 且内容一致);
  // 不允许「项目内容变了但快照没写」或「快照写了但项目没变」的半写状态。
  const noWrite = s8.latest?.version_number === before8.latest?.version_number;
  const fullWrite = s8.latest?.version_number === (before8.latest?.version_number ?? 0) + 1;
  log('I8 中断后库内自洽:未提交或完整提交,无半写状态', s8.consistent && (noWrite || fullWrite),
    `一致=${s8.consistent} 结果=${noWrite ? '未提交' : fullWrite ? '中断前已完整提交' : '异常'} | 版本链 ${s8.numbers.join(',')}`);

  result.evidence.projectId = projectId;
  result.evidence.finalChain = s8.versions.map((v) => `v${v.version_number}:${v.source}:${v.label}`);
  const passed = result.steps.filter((s) => s.ok).length;
  console.log(`\nT31 事务一致性与故障注入:${passed}/${result.steps.length} PASS`);
  fs.writeFileSync('t31-transaction-injection-result.json', JSON.stringify(result, null, 2));
  process.exit(passed === result.steps.length ? 0 : 1);
} catch (error) {
  console.error('验收异常:', error);
  fs.writeFileSync('t31-transaction-injection-result.json', JSON.stringify(result, null, 2));
  process.exit(1);
}
