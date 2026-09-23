// app_atoms_agent_generate:真实 AI 智能体生成(SSE 流式输出 AgentEvent)
// 输入: { prompt, theme, mode }
// 输出: text/event-stream,每行 data: <AgentEvent JSON>
// 模型:deepseek-v4-flash 主模型 + gpt-5.4 / gemini-3.1-pro-preview 备用通道
//      (T23:主模型失败时同请求内按序降级,SSE 开始输出后不再切换;经平台 AI 网关,密钥来自 Secrets)
// T9 提示词管线(意图识别 + 布局规划):
//   1) 意图识别(确定性规则):识别应用类型/内容分区/关键功能,模糊需求注入默认假设;
//   2) 布局规划:独立小调用产出含布局结构、Flex/Grid 策略、视觉规范与响应式的 5 步计划,
//      超时/解析失败回退本地启发式计划,规划失败不阻断生成;
//   3) 代码生成:系统提示注入布局工程硬约束(禁止无约束绝对定位、统一间距圆角、移动端适配、纯文档输出);
//   4) 产物净化:sanitizeHtml 剥离围栏与前后杂文,仅交付 <!DOCTYPE html>…</html> 完整文档。
// 韧性:输出不完整(max_tokens 截断/流提前结束)时自动以更精简约束重试一次;
//      超时/重试后仍不完整均以 error + done 显式收尾,绝不静默截断。
import { createClient } from 'npm:@supabase/supabase-js@2';

// T23:主模型 + 备用模型通道(按序降级);全部模型同报 403 视为平台 AI 网关整体故障,错误文案显式透出
const MODELS = ['deepseek-v4-flash', 'gpt-5.4', 'gemini-3.1-pro-preview'];
const MAX_TOKENS = 16000;
// 平台约 150s 强制回收:规划调用(≤15s)+ 连接余量与代码生成共享该预算,到点主动收尾
const SOFT_DEADLINE_MS = 130_000;
const PLAN_DEADLINE_MS = 15_000; // 规划调用独立预算,超时即回退启发式计划
// T35:复杂需求在软超时前提前收敛,把剩余预算让给「精简重试」,避免被平台回收后整轮失败
const PROACTIVE_CUT_MS = 35_000;
// T35:首字节停滞切换阈值——上游返回 200 却迟迟不吐首字节(长时间停在推理阶段)时,
// 与其把 130s 预算耗在单一通道上,不如在预算内切换到下一个模型通道继续生成。
const STALL_SWITCH_MS = 45_000;
const ESTIMATE_TOTAL = 8000; // code-delta 进度百分比估算基准
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonHeaders() {
  return { ...CORS, 'Content-Type': 'application/json' };
}

function titleFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/^(帮我|请|我想|我要)?(做一个|做个|做|构建|创建|开发)?/, '')
    .replace(/[。,.!?,.!?]+$/, '')
    .trim();
  return (cleaned || 'Atoms 应用').slice(0, 16);
}

// ---------------------------------------------------------------------------
// T9 意图识别:从提示词提炼应用类型、内容分区与关键功能,模糊处给默认假设
// ---------------------------------------------------------------------------

type AppType = 'game' | 'dashboard' | 'tool' | 'content' | 'landing';

interface Intent {
  appType: AppType;
  typeName: string;
  zones: string[];
  features: string[];
  assumptions: string[];
}

function analyzeIntent(prompt: string): Intent {
  const p = prompt.toLowerCase();
  const has = (re: RegExp) => re.test(p);

  let appType: AppType = 'tool';
  let typeName = '效率工具类应用';
  if (has(/游戏|game|贪吃蛇|俄罗斯方块|打砖块|五子棋|扫雷/)) {
    appType = 'game';
    typeName = '游戏类应用';
  } else if (has(/仪表盘|看板|统计|可视化|dashboard|分析/)) {
    appType = 'dashboard';
    typeName = '数据展示类应用';
  } else if (has(/落地页|landing|产品主页/)) {
    appType = 'landing';
    typeName = '落地页';
  } else if (has(/介绍|官网|宣传|博客|文章|文档|教程|专题/)) {
    appType = 'content';
    typeName = '内容展示类站点';
  } else if (has(/清单|待办|记账|笔记|打卡|计算|转换|番茄钟|计时|工具/)) {
    appType = 'tool';
    typeName = '效率工具类应用';
  }

  const zones: string[] = [];
  if (has(/介绍|文案|宣传语/)) zones.push('应用介绍');
  if (has(/游戏|棋盘|画布|canvas|board/)) zones.push('主功能区');
  if (has(/玩法|说明|文档|教程|规则|帮助|faq|指南|常见问题|问答/)) zones.push('说明文档');

  const features: string[] = [];
  if (has(/键盘|方向键|wasd|按键|操控/)) features.push('键盘操控');
  if (has(/得分|分数|计分|score/)) features.push('得分统计');
  if (has(/最高分|排行榜|历史|记录/)) features.push('数据留存(localStorage)');
  if (has(/添加|新增|录入|勾选|删除|编辑|完成/)) features.push('增删改交互');
  if (has(/占比|图表|趋势|可视化|统计/)) features.push('数据可视化');
  if (has(/音效|声音|音乐/)) features.push('音效反馈');

  const assumptions: string[] = [];
  if (prompt.length <= 12) {
    assumptions.push('需求较简短,按该类型应用的常规形态补全细节(默认交互、空状态与示例数据)');
  }
  if (features.length === 0) {
    if (appType === 'content') {
      assumptions.push('未指明章节结构:按「概览 → 核心内容分节 → 常见问题」组织,每节配导语与要点列表');
    } else {
      assumptions.push('未指明的交互按常规默认实现:提供重置入口、数据用 localStorage 本地保留、空状态给出引导');
    }
  }

  return { appType, typeName, zones, features, assumptions };
}

// 各应用类型的布局基线(注入规划与代码生成提示词)
const TYPE_LAYOUT: Record<AppType, string> = {
  game: '游戏主区为视觉焦点并水平居中,画布/棋盘 max-width:100% 防溢出;得分栏与控制按钮排在游戏区上方或下方,绝不与游戏画面重叠;结束/暂停遮罩只允许覆盖在 position:relative 的游戏容器内部。',
  dashboard: '顶部指标卡片用 grid 多列等距排布,中部图表区,底部明细列表;卡片间距一致,数字用字号与颜色分层。',
  tool: '单列居中布局:操作/输入区在上,结果展示在下,按钮紧邻其作用区域;列表逐行渲染并自带操作入口。',
  content: '页头(标题+简介)之后按章节垂直排列内容卡片,每张卡片为「小标题+段落/列表」,章节间距一致,层级清晰。',
  landing: '首屏主视觉(大标题+副标题+CTA 按钮)居中,下方功能特性分栏展示,信息密度自上而下递减。',
};

const TYPE_LAYOUT_SHORT: Record<AppType, string> = {
  game: '游戏画布居中,状态栏/按钮上下排布',
  dashboard: 'Grid 指标卡 + 图表区 + 明细列表',
  tool: '单列居中:操作区在上、结果在下',
  content: '页头 + 分节卡片正文 + 页脚',
  landing: '主视觉首屏 + 特性分栏',
};

function buildLayoutDirective(intent: Intent): string {
  const parts = [TYPE_LAYOUT[intent.appType]];
  if (intent.zones.length >= 2 && intent.appType !== 'content') {
    parts.push(
      `页面含 ${intent.zones.length} 个内容分区(${intent.zones.join('、')}):桌面端用 flex(或 grid)横向分栏,各分区为独立卡片且顶部对齐;≤900px 时按原顺序纵向堆叠。`,
    );
  }
  return parts.join('');
}

// 规划调用失败/超时时的启发式计划(同样覆盖布局与视觉规范)
function fallbackSteps(intent: Intent): string[] {
  const zoneText = intent.zones.length ? `(${intent.zones.join('、')})` : '';
  const layoutShort =
    intent.zones.length >= 2 && intent.appType !== 'content'
      ? `Flex 分栏:${intent.zones.join('、')},桌面横排、≤900px 纵向堆叠`
      : TYPE_LAYOUT_SHORT[intent.appType];
  const featureText = intent.features.slice(0, 4).join('、') || '按需求实现主要交互';
  return [
    `分析需求:${intent.typeName}${zoneText},功能点 ${featureText}`,
    `布局规划:${layoutShort}`,
    '视觉规范:统一间距刻度(8/12/16/24)、8-16px 圆角、卡片边框+阴影分层',
    `实现核心交互:${featureText}`,
    '响应式与交付:媒体查询适配移动端,输出完整可运行单文件 HTML',
  ];
}

// T9 布局规划系统提示(独立小调用,只产出 JSON 数组)
const PLAN_SYSTEM = [
  '你是 Atoms 平台的应用规划智能体,在写代码前产出可执行的分步计划。',
  '只输出一个 JSON 字符串数组(形如 ["步骤1","步骤2","步骤3","步骤4","步骤5"]),不要输出任何解释、前后缀或 Markdown 围栏。',
  '必须恰好 5 步,每步不超过 26 字,中文;步骤需贴合用户需求而非泛泛而谈。',
  '第 1 步拆解应用类型与核心功能;第 2 步必须写明布局结构与 Flex/Grid 策略(多分区时写明桌面横排/移动端堆叠);第 3 步写视觉规范(间距刻度、圆角、层级);第 4 步列关键交互;第 5 步写响应式适配与交付。',
].join('\n');

// 代码生成系统提示(注入布局工程硬约束)
const CODE_SYSTEM = [
  '你是 Atoms 平台的应用生成智能体,负责把用户需求与既定计划变成真实可运行的单文件 HTML 应用。',
  '【输出纪律(最高优先级)】严格只输出一个完整的 HTML5 文档:第一个字符必须是 <,以 <!DOCTYPE html> 开头、</html> 结束;之前不得有任何问候、说明或 ``` 围栏,之后不得追加解释、总结或 Markdown。',
  '【布局工程硬约束】',
  '- 页面整体放入 max-width 容器,自根节点起用 flex/grid 组织内容;禁止用绝对/固定定位摆放页面级结构。',
  '- 绝对定位只允许用于有明确边界的局部浮层(如游戏结束遮罩),其父容器必须 position:relative。',
  '- 多内容分区按既定布局用 flex/grid 分栏为独立卡片,顶部对齐、间距一致;窄屏(≤900px)自动纵向堆叠。',
  '- 间距用统一刻度(8/12/16/24px),圆角统一(8-16px),层级用背景/边框/阴影区分,同类元素尺寸对齐一致。',
  '- 响应式必做:@media 适配移动端;canvas 等定宽元素 max-width:100%;可点元素不小于 40px。',
  '【内容与文案】全部使用真实可读的中文文案;说明/文档类内容用小标题+段落+<ul><li> 结构;界面禁止出现 #、*、``` 等 Markdown 原始符号或代码片段痕迹。',
  '【工程要求】内联全部 CSS 与 JS,无外部依赖;交互真实可用,不使用 alert/confirm 阻塞弹窗。',
  '【JS 语法硬约束】每个 const/let 声明必须紧跟 = 初始化器;禁止孤立变量名与残留逗号(错误示例:const a=1,b,fn=>fn(),必须写成 const b=默认值)。',
  '箭头函数、对象字面量、括号与引号必须成对闭合;输出前逐行自检内联脚本可被浏览器直接解析执行,任何一处语法错误都视为无效产物。',
  '【行数预算】严格遵守下方「本轮行数预算」指令,必须一次性输出到 </html>,宁可精简也不允许超时截断。',
].join('\n');

// 截断重试时附加的更严格精简指令
const RETRY_SUFFIX =
  '\n注意:上一次输出中途被截断,未能输出完整 HTML。这次必须大幅精简:总代码量控制在 180 行以内,删减注释与装饰性细节,优先保证一次性输出完整 HTML(以 </html> 结束)。';

// T35 复杂度自适应行数预算:需求越复杂,越要在预算内更早收敛。
// 实测差异根因:复杂计算器提示词(多分区 + 多功能)按 250 行预算生成会在 130s 软超时内被截断,
// 而简化计数器提示词可在预算内完成——因此对复杂需求收紧行数上限,换取「一次性输出完整 HTML」。
function codeLineBudget(intent: Intent, prompt: string): number {
  const complex = prompt.length > 110 || intent.zones.length >= 2 || intent.features.length >= 4;
  return complex ? 190 : 250;
}

// 产物净化:剥离围栏/前后杂文,仅保留完整 HTML 文档
function sanitizeHtml(raw: string): string {
  let out = raw.trim();
  const doctype = out.match(/<!DOCTYPE html>/i);
  if (doctype?.index !== undefined && doctype.index > 0) {
    out = out.slice(doctype.index);
  } else if (!doctype) {
    const htmlIdx = out.search(/<html[\s>]/i);
    if (htmlIdx > 0) out = out.slice(htmlIdx);
  }
  const endIdx = out.toLowerCase().lastIndexOf('</html>');
  if (endIdx !== -1) out = out.slice(0, endIdx + '</html>'.length);
  return out.trim();
}

// T29 产物语法自检:提取内联 <script> 用 new Function 做纯语法校验(不执行函数体),
// 真实链路复测发现模型偶发输出 `const a=1,b,fn=>fn()` 这类缺初始化器的非法声明,导致 iframe 运行期 SyntaxError
function findScriptSyntaxErrors(html: string): string[] {
  const errors: string[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null = re.exec(html);
  while (m !== null) {
    const attrs = m[1] ?? '';
    const code = m[2] ?? '';
    m = re.exec(html);
    if (/\bsrc\s*=/i.test(attrs)) continue;
    if (/type\s*=\s*["']?(module|application\/json)/i.test(attrs)) continue;
    if (!code.trim()) continue;
    try {
      // eslint-disable-next-line no-new-func
      new Function(code);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('SyntaxError')) errors.push(msg.slice(0, 160));
    }
  }
  return errors;
}

// 修复轮专用:消费上游 SSE 但只收集完整文本(不透传 delta,避免前端代码区重复渲染)
async function collectFullText(
  body: ReadableStream<Uint8Array>,
  deadlineLeftMs: number,
): Promise<{ text: string; timedOut: boolean }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const started = Date.now();
  let text = '';
  let buffer = '';
  let timedOut = false;
  for (;;) {
    const remaining = deadlineLeftMs - (Date.now() - started);
    if (remaining <= 0) {
      timedOut = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    const raced = await Promise.race([
      reader.read(),
      new Promise<'deadline'>((resolve) => setTimeout(() => resolve('deadline'), remaining)),
    ]);
    if (raced === 'deadline') {
      timedOut = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    const { done, value } = raced;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const chunk = JSON.parse(payload);
        const piece = chunk?.choices?.[0]?.delta?.content;
        if (typeof piece === 'string') text += piece;
      } catch {
        // 忽略无法解析的分片
      }
    }
  }
  return { text, timedOut };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 请求体解析(规范要求 try-catch,必填字段缺失返回 400)
  let body: { prompt?: string; theme?: string; mode?: string; previousHtml?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: '请求体必须是 JSON' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  const prompt = String(body.prompt ?? '').trim();
  if (!prompt) {
    return new Response(JSON.stringify({ error: 'prompt 不能为空' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  const theme = String(body.theme ?? '默认');
  const mode = String(body.mode ?? 'build');
  // T25:增量修改——携带上一版完整 HTML 时进入修改模式,基于当前版本做定向调整
  const previousHtml =
    typeof body.previousHtml === 'string' && body.previousHtml.includes('</html>')
      ? body.previousHtml
      : '';
  console.log(
    JSON.stringify({ requestId, method: req.method, promptLength: prompt.length, theme, mode }),
  );

  // 鉴权:携带 JWT 时必须有效(用 service role 验证);未携带允许匿名体验
  const authHeader = req.headers.get('Authorization') ?? '';
  if (authHeader.startsWith('Bearer ') && authHeader.length > 7) {
    const token = authHeader.slice(7);
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { error } = await admin.auth.getUser(token);
    if (error) {
      return new Response(JSON.stringify({ error: '登录状态无效,请重新登录' }), {
        status: 401,
        headers: jsonHeaders(),
      });
    }
  }

  // AI 网关配置(Secrets 注入,不硬编码密钥)
  const aiBase = Deno.env.get('APP_AI_BASE_URL');
  const aiKey = Deno.env.get('APP_AI_KEY');
  if (!aiBase || !aiKey) {
    console.error(requestId, 'AI secrets missing');
    return new Response(JSON.stringify({ error: 'AI 服务未配置' }), {
      status: 500,
      headers: jsonHeaders(),
    });
  }
  // T25 排查:上游 Cloudflare WAF 会拦截无 User-Agent 的请求(error code 1010),显式携带 UA 保证网关可达
  const aiHeaders = {
    Authorization: `Bearer ${aiKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'atoms-agent/1.0',
  };

  const requestStartedAt = Date.now();

  // ---- T9 第 1 步:意图识别 ----
  const intent = analyzeIntent(prompt);
  const layoutDirective = buildLayoutDirective(intent);
  const intentLine = `类型=${intent.typeName};内容分区=${intent.zones.join('、') || '单一主区'};关键功能=${
    intent.features.join('、') || '常规交互'
  }`;

  // ---- T9 第 2 步:布局规划(独立小调用,超时/解析失败回退启发式计划) ----
  // T25:增量修改模式——计划改为修改导向的确定性步骤,跳过 LLM 规划小调用,降低时延
  let planSteps = previousHtml
    ? [
        '读取当前版本代码,定位需要修改的模块',
        '应用本次修改,未涉及部分保持原样',
        '校验交互与样式一致性,补齐响应式适配',
        '输出修改后的完整单文件 HTML(禁止只给片段)',
      ]
    : fallbackSteps(intent);
  let planSource: 'llm' | 'fallback' = 'fallback';
  const planStartedAt = Date.now();
  const planUserContent = [
    `应用需求:${prompt}`,
    `意图识别:${intentLine}`,
    intent.assumptions.length ? `默认假设:${intent.assumptions.join(';')}` : '',
    // T15:主题为「默认」(用户未选择主题)时不注入主题提示,由模型按中性/自动配色决定
    theme !== '默认' ? `界面主题:${theme}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const planController = new AbortController();
  const planTimer = setTimeout(() => planController.abort(), PLAN_DEADLINE_MS);
  try {
    // T23:规划调用共享 15s 独立预算,主→备模型按序尝试;全部失败回退启发式计划,规划失败不阻断生成
    for (const model of MODELS) {
      // T25:增量修改模式跳过 LLM 规划,直接使用上方确定性修改步骤
      if (planController.signal.aborted || previousHtml) break;
      try {
        const planResp = await fetch(`${aiBase.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: aiHeaders,
          body: JSON.stringify({
            model,
            stream: false,
            max_tokens: 500,
            enable_thinking: false,
            messages: [
              { role: 'system', content: PLAN_SYSTEM },
              { role: 'user', content: planUserContent },
            ],
          }),
          signal: planController.signal,
        });
        if (!planResp.ok) continue;
        const data = await planResp.json();
        const text = String(data?.choices?.[0]?.message?.content ?? '');
        const m = text.match(/\[[\s\S]*\]/);
        const arr = m ? JSON.parse(m[0]) : null;
        if (!Array.isArray(arr)) continue;
        const steps = arr
          .filter((s) => typeof s === 'string' && s.trim())
          .map((s) => String(s).trim())
          .slice(0, 5);
        if (steps.length === 5) {
          planSteps = steps;
          planSource = 'llm';
          break;
        }
      } catch (error) {
        // 预算耗尽(abort)直接放弃规划;单个模型网络异常则尝试下一个备用模型
        if (planController.signal.aborted) break;
        console.warn(JSON.stringify({ requestId, planModelFailed: model, reason: String(error).slice(0, 160) }));
        continue;
      }
    }
  } finally {
    clearTimeout(planTimer);
  }
  const planMs = Date.now() - planStartedAt;
  console.log(
    JSON.stringify({ requestId, planSource, planMs, appType: intent.appType, zones: intent.zones.length }),
  );

  // ---- T9 第 3 步:代码生成(意图/布局指令/计划全部注入) ----
  const userPrompt = [
    `应用需求:${prompt}`,
    // T25:增量修改——把上一版完整 HTML 作为上下文注入,要求在原版本上定向修改
    ...(previousHtml
      ? [
          '当前版本完整 HTML 如下。请把它当作唯一基线,只做本次要求的修改;' +
            '其中所有已有可见文案(含标题、字符串常量、按钮文字)与结构必须原样保留:',
          '```html',
          previousHtml,
          '```',
        ]
      : []),
    // T15:主题为「默认」(用户未选择主题)时不注入主题提示,由模型按中性/自动配色决定
    theme !== '默认' ? `界面主题:${theme}` : '',
    `执行模式:${mode === 'goal' ? '按目标自动规划' : '逐步构建'}`,
    `意图识别:${intentLine}`,
    intent.assumptions.length ? `默认假设(未指明处按此实现):${intent.assumptions.join(';')}` : '',
    `布局指令:${layoutDirective}`,
    '既定执行计划(生成时必须遵循):',
    ...planSteps.map((s, i) => `${i + 1}. ${s}`),
    previousHtml
      ? '请在当前版本基础上完成上述修改,直接输出修改后的完整单文件 HTML(禁止只输出片段或差异说明)。' +
        '输出前逐条自检:当前版本中的每一段可见文字是否都仍原样存在于你的输出中(本次要求修改的除外)。'
      : '请严格按以上意图、布局指令与计划,直接给出完整单文件 HTML。',
  ]
    .filter(Boolean)
    .join('\n');

  // T29 增量保留硬约束:真实链路复测发现第二轮增量产物会「重写式精简」丢失第一轮既有文案
  // (如标题中的字面字符串),故增量模式下显式禁止改动未涉及内容,并放宽行数上限避免为省行删内容。
  const INCREMENT_SYSTEM = [
    '',
    '【增量修改硬约束(优先级高于上文所有精简要求)】',
    '- 本次任务是在用户提供的「当前版本完整 HTML」上做定向修改:除用户本次明确要求新增或调整的部分外,',
    '  当前版本中的所有可见文字(标题、副标题、按钮文案、提示语、示例数据)、DOM 结构与样式必须原样保留,一字不改。',
    '- 禁止重写、重新组织、合并、精简或替换未涉及本次需求的任何模块;禁止更换标题措辞或删改字符串常量。',
    '- 新产物 = 当前版本 + 本次修改的合并结果,而不是重新设计的新页面。',
    '- 上文 250 行上限在增量模式下放宽到 340 行;若两者冲突,一律以「完整保留当前版本内容」为先,绝不允许为控制行数删掉既有内容。',
    '- 输出前自检:当前版本里每一段可见文字都必须能在新产物中原样找到(本次要求修改的除外),缺失即为错误输出。',
  ].join('\n');
  const budgetLines = codeLineBudget(intent, prompt);
  const BUDGET_DIRECTIVE =
    `\n【本轮行数预算】总代码量必须控制在 ${budgetLines} 行以内(约 ${Math.round((budgetLines * 34) / 1024)}KB):` +
    '注释与空行最少化,样式精炼复用,功能优先保证核心交互完整;必须一次性输出到 </html>。';
  const codeSystem = (previousHtml ? CODE_SYSTEM + INCREMENT_SYSTEM : CODE_SYSTEM) + BUDGET_DIRECTIVE;

  // T35:token 用量为可选增强——若上游不接受 stream_options,自动去掉该参数重试一次,绝不影响生成
  let usageUnsupported = false;
  const callGateway = (userContent: string, model: string, includeUsage = true) =>
    fetch(`${aiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: aiHeaders,
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: MAX_TOKENS,
        enable_thinking: false,
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        messages: [
          { role: 'system', content: codeSystem },
          { role: 'user', content: userContent },
        ],
      }),
    });

  const callGatewayResilient = async (userContent: string, model: string): Promise<Response> => {
    const resp = await callGateway(userContent, model, !usageUnsupported);
    if (resp.ok || usageUnsupported || resp.status !== 400) return resp;
    const detail = await resp.text().catch(() => '');
    if (!/stream_options|usage/i.test(detail)) return new Response(detail, { status: 400 });
    usageUnsupported = true;
    console.warn(JSON.stringify({ requestId, streamOptionsUnsupported: true, model }));
    return callGateway(userContent, model, false);
  };

  // T23:主模型失败(连接异常/4xx/5xx/限流)时在同一次请求内按序尝试备用模型;
  // 同一模型遇 5xx/429 先短暂退避原地重试一次(T21 韧性保留),仍失败才降级到下一个模型。
  // 拿到可读流即锁定该模型,SSE 透传开始后不再切换(截断重试也沿用同一模型)。
  // 预算守卫:剩余软超时不足 15s 时停止降级,直接显式失败,避免被平台强制回收。
  let upstream: Response | null = null;
  let activeModel = '';
  const triedModels: { model: string; status: string }[] = [];
  // T35:模型降级链的现场证据——每次尝试的模型/结果/耗时逐条留痕,随 SSE diagnostics 事件与日志透出
  const modelTrace: { model: string; outcome: string; status: string; elapsedMs: number; degraded: boolean }[] = [];
  // T35:首字节停滞切换留痕,随 diagnostics 事件透出
  const stallSwitches: { from: string; to: string; atMs: number }[] = [];
  outer: for (const model of MODELS) {
    for (let sameModelAttempt = 1; sameModelAttempt <= 2; sameModelAttempt += 1) {
      if (Date.now() - requestStartedAt > SOFT_DEADLINE_MS - 15_000) {
        modelTrace.push({ model, outcome: 'skipped-budget-exhausted', status: 'not-attempted', elapsedMs: 0, degraded: true });
        break outer;
      }
      const attemptStartedAt = Date.now();
      try {
        const resp = await callGatewayResilient(userPrompt, model);
        if (resp.ok && resp.body) {
          upstream = resp;
          activeModel = model;
          modelTrace.push({
            model,
            outcome: 'selected',
            status: String(resp.status),
            elapsedMs: Date.now() - attemptStartedAt,
            degraded: modelTrace.some((t) => t.model !== model),
          });
          break outer;
        }
        const detail = await resp.text().catch(() => '');
        // T25 排查:403 需区分「账户余额不足」(业务错误,重试无意义)与网关拦截,按响应体归类
        const status = /balance is insufficient/i.test(detail) ? 'insufficient-balance' : String(resp.status);
        triedModels.push({ model, status });
        modelTrace.push({
          model,
          outcome: sameModelAttempt === 1 && (resp.status >= 500 || resp.status === 429) ? 'http-error-retrying' : 'http-error',
          status,
          elapsedMs: Date.now() - attemptStartedAt,
          degraded: true,
        });
        console.warn(JSON.stringify({ requestId, modelFallback: true, model, status: resp.status, detail: detail.slice(0, 200) }));
        if ((resp.status >= 500 || resp.status === 429) && sameModelAttempt === 1) {
          await sleep(resp.status === 429 ? 2000 : 1500);
          continue;
        }
        // 4xx(含 403)或同一模型二连失败:降级到下一个备用模型
        break;
      } catch (error) {
        triedModels.push({ model, status: 'connection-error' });
        modelTrace.push({ model, outcome: 'connection-error', status: 'n/a', elapsedMs: Date.now() - attemptStartedAt, degraded: true });
        console.warn(JSON.stringify({ requestId, modelFallback: true, model, error: String(error).slice(0, 200) }));
        break;
      }
    }
  }
  if (!upstream) {
    // T23:全部模型同报 403 → 平台 AI 网关整体故障,给出明确文案;其余按各模型状态汇总透出
    // T25 排查:全部模型均「余额不足」属账户额度问题(确定性故障),以 402 显式区分,前端不做无谓重试
    const allForbidden = triedModels.length > 0 && triedModels.every((t) => t.status === '403');
    const allBalance = triedModels.length > 0 && triedModels.every((t) => t.status === 'insufficient-balance');
    const summary = triedModels.map((t) => `${t.model}:${t.status}`).join(', ');
    console.error(JSON.stringify({ requestId, allModelsFailed: true, triedModels }));
    if (allBalance) {
      return new Response(JSON.stringify({ error: 'AI 账户余额不足,请充值后重试' }), {
        status: 402,
        headers: {
          ...jsonHeaders(),
          'X-Atoms-Model-Chain': MODELS.join(','),
          'X-Atoms-Tried-Models': summary,
          'Access-Control-Expose-Headers': 'X-Atoms-Model-Chain,X-Atoms-Tried-Models',
        },
      });
    }
    return new Response(
      JSON.stringify({
        error: allForbidden
          ? '平台 AI 网关故障,请稍后重试'
          : `AI 服务响应异常(${summary || '网关无响应'})`,
      }),
      {
        status: 502,
        headers: {
          ...jsonHeaders(),
          'X-Atoms-Model-Chain': MODELS.join(','),
          'X-Atoms-Tried-Models': summary,
          'Access-Control-Expose-Headers': 'X-Atoms-Model-Chain,X-Atoms-Tried-Models',
        },
      },
    );
  }
  // 闭包内 TS 不保留可变变量判空收窄:选定响应固化为常量,流内截断重试改用局部变量
  const selectedUpstream: Response = upstream;

  const eventHeaders = {
    ...CORS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    // T35:模型链与当前生效模型以响应头透出,可从现场响应独立核验(不依赖 SSE 解析)
    'Access-Control-Expose-Headers': 'X-Atoms-Model-Chain,X-Atoms-Active-Model',
    'X-Atoms-Model-Chain': MODELS.join(','),
    'X-Atoms-Active-Model': activeModel,
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // 分步计划:T9 布局规划产物(或启发式回退),事件协议不变
      const title = titleFromPrompt(prompt);
      send({
        type: 'message',
        content: previousHtml
          ? `收到修改需求!我会在「${title}」当前版本基础上定向调整。执行计划如下:`
          : `收到!我来帮你${mode === 'goal' ? '按目标自动规划' : '构建'}「${title}」。先拆解一下执行计划:`,
      });
      send({ type: 'plan', steps: planSteps });
      for (let i = 0; i < planSteps.length; i += 1) {
        send({ type: 'step-start', index: i });
        await new Promise((resolve) => setTimeout(resolve, 220));
        send({ type: 'step-done', index: i });
      }
      send({ type: 'message', content: '计划执行完毕,开始生成代码…' });
      send({ type: 'code-start', fileName: 'index.html' });

      // 消费上游 OpenAI 兼容 SSE:透传 delta.content,记录 finish_reason,忽略 reasoning 分片。
      // 最多两轮:首轮输出不完整(且未超时)时,以更精简指令重试一次,共享软超时预算(含规划调用耗时)。
      const startedAt = requestStartedAt;
      let html = '';
      let timedOut = false;
      let finishReason: string | null = null;
      let retried = false;
      let currentUpstream: Response = selectedUpstream;
      // T35 归因字段:首字节耗时、提前收敛标记、被截断时的字符数、上游 token 用量
      let firstTokenMs: number | null = null;
      let proactiveCut = false;
      let truncatedAtLength = 0;
      // T35:当前生效通道的首字节停滞窗口起点(切换模型后重置)与停滞标记
      let modelAttemptStartedAt = Date.now();
      let stalledFirstByte = false;
      let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (attempt === 2) {
          console.warn(
            JSON.stringify({ requestId, retry: true, firstOutputLength: html.length, finishReason }),
          );
          send({ type: 'message', content: '首轮生成未完整结束,正在用更精简的方案重试…' });
          html = '';
          try {
            const retryResp = await callGatewayResilient(userPrompt + RETRY_SUFFIX, activeModel);
            if (!retryResp.ok || !retryResp.body) {
              const detail = await retryResp.text().catch(() => '');
              console.error(requestId, `重试时 AI 网关返回 ${retryResp.status}`, detail.slice(0, 300));
              break;
            }
            currentUpstream = retryResp;
          } catch (error) {
            console.error(requestId, '重试连接 AI 网关失败', error);
            break;
          }
          retried = true;
        }

        const reader = currentUpstream.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
          for (;;) {
            const remaining = SOFT_DEADLINE_MS - (Date.now() - startedAt);
            if (remaining <= 0) {
              timedOut = true;
              await reader.cancel().catch(() => undefined);
              break;
            }
            // T35:首轮临近软超时且尚未收尾时主动切断,把剩余预算交给「精简重试」,
            // 避免耗到 130s 被平台回收后整轮失败(复杂提示词超时、简化提示词成功的差异根因)
            if (attempt === 1 && !retried && remaining <= PROACTIVE_CUT_MS && !html.includes('</html>')) {
              proactiveCut = true;
              truncatedAtLength = html.length;
              await reader.cancel().catch(() => undefined);
              break;
            }
            // 即使上游停滞不吐数据,也要在软超时点醒来收尾,而不是被平台强制回收;
            // T35:首字节尚未到达且仍有备用通道时,提前在停滞阈值醒来以便切换模型。
            const nextModelIndex = MODELS.indexOf(activeModel) + 1;
            const stallBudget =
              firstTokenMs === null && nextModelIndex < MODELS.length
                ? Math.max(0, modelAttemptStartedAt + STALL_SWITCH_MS - Date.now())
                : Number.POSITIVE_INFINITY;
            const waitMs = Math.min(remaining, stallBudget);
            const raced = await Promise.race([
              reader.read(),
              new Promise<'deadline' | 'stall'>((resolve) =>
                setTimeout(
                  () => resolve(waitMs === remaining ? 'deadline' : 'stall'),
                  Math.max(1, waitMs),
                ),
              ),
            ]);
            if (raced === 'deadline') {
              timedOut = true;
              await reader.cancel().catch(() => undefined);
              break;
            }
            if (raced === 'stall') {
              stalledFirstByte = true;
              await reader.cancel().catch(() => undefined);
              break;
            }
            const { done, value } = raced;
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data:')) continue;
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === '[DONE]') continue;
              try {
                const chunk = JSON.parse(payload);
                if (chunk?.usage) usage = chunk.usage;
                const choice = chunk?.choices?.[0];
                if (choice?.finish_reason) finishReason = String(choice.finish_reason);
                const piece = typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
                if (!piece) continue;
                if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt;
                html += piece;
                const percent = Math.min(99, Math.round((html.length / ESTIMATE_TOTAL) * 100));
                send({ type: 'code-delta', delta: piece, percent });
              } catch {
                // 忽略无法解析的分片
              }
            }
          }
        } catch (error) {
          // 错误统一由收尾分支透出,避免重复 error 事件
          console.error(requestId, '读取 AI 流失败', error);
        }
        // T35:首字节停滞(上游 200 但长时间无任何内容)时,在预算内切换到下一个模型通道继续生成,
        // 而不是把整轮预算耗尽后失败;切换后重新计入该通道的首字节停滞窗口。
        if (stalledFirstByte && !timedOut && !html) {
          const stallRemaining = SOFT_DEADLINE_MS - (Date.now() - startedAt);
          const switchIndex = MODELS.indexOf(activeModel) + 1;
          if (stallRemaining > 30_000 && switchIndex < MODELS.length) {
            const stalledModel = activeModel;
            const nextModel = MODELS[switchIndex];
            modelTrace.push({
              model: stalledModel,
              outcome: 'stalled-first-byte',
              status: '200-no-output',
              elapsedMs: Date.now() - modelAttemptStartedAt,
              degraded: true,
            });
            stallSwitches.push({ from: stalledModel, to: nextModel, atMs: Date.now() - startedAt });
            console.warn(JSON.stringify({ requestId, stallSwitch: true, from: stalledModel, to: nextModel }));
            send({ type: 'message', content: '当前模型响应较慢,正在切换备用模型继续生成…' });
            try {
              const switched = await callGatewayResilient(userPrompt, nextModel);
              if (switched.ok && switched.body) {
                currentUpstream = switched;
                activeModel = nextModel;
                modelAttemptStartedAt = Date.now();
                stalledFirstByte = false;
                modelTrace.push({
                  model: nextModel,
                  outcome: 'selected-after-stall',
                  status: String(switched.status),
                  elapsedMs: 0,
                  degraded: true,
                });
                attempt = 0; // 复位轮次:切换模型后仍保留「精简重试」额度
                continue;
              }
              modelTrace.push({
                model: nextModel,
                outcome: 'http-error',
                status: String(switched.status),
                elapsedMs: 0,
                degraded: true,
              });
            } catch (error) {
              modelTrace.push({
                model: nextModel,
                outcome: 'connection-error',
                status: 'n/a',
                elapsedMs: 0,
                degraded: true,
              });
              console.error(requestId, '切换备用模型失败', String(error).slice(0, 200));
            }
          }
        }
        if (html.includes('</html>') || timedOut) break;
      }

      // T9 第 4 步:产物净化后交付,避免围栏/前后杂文进入预览
      let finalHtml = sanitizeHtml(html);
      // T29 语法自检:模型偶发输出缺初始化器的 const 声明导致 iframe 运行期 SyntaxError,
      // 交付前做一次内容保全式修复(仅修语法、不改文案/结构/逻辑);修复失败或预算不足则保留原产物并留痕
      let syntaxErrors = findScriptSyntaxErrors(finalHtml);
      let syntaxFixed = false;
      if (finalHtml.includes('</html>') && syntaxErrors.length > 0) {
        const remainingBudget = SOFT_DEADLINE_MS - (Date.now() - startedAt);
        console.warn(JSON.stringify({ requestId, syntaxErrorsBeforeFix: syntaxErrors, remainingBudget }));
        if (remainingBudget > 25_000) {
          send({ type: 'message', content: '检测到产物代码存在语法问题,正在自动修复…' });
          try {
            const fixResp = await callGatewayResilient(
              '以下单文件 HTML 应用的 JavaScript 存在语法错误:' +
                `${syntaxErrors.join('; ').slice(0, 300)}。\n` +
                '请输出修复后的完整 HTML 文档:只允许修复语法错误(如 const/let 缺少 = 初始化器、残留逗号、未闭合括号),' +
                '所有可见文字、DOM 结构、样式与功能逻辑必须原样保留,禁止任何精简或改写;' +
                '第一个字符必须是 <,不要输出解释或代码围栏。\n\n' +
                finalHtml,
              activeModel,
            );
            if (fixResp.ok && fixResp.body) {
              const { text: fixedText } = await collectFullText(fixResp.body, remainingBudget - 5_000);
              const fixedHtml = sanitizeHtml(fixedText);
              if (fixedHtml.includes('</html>') && findScriptSyntaxErrors(fixedHtml).length === 0) {
                finalHtml = fixedHtml;
                syntaxFixed = true;
                syntaxErrors = [];
              }
            }
          } catch (error) {
            console.error(requestId, '语法修复调用失败,保留原产物', String(error).slice(0, 200));
          }
          console.log(JSON.stringify({ requestId, syntaxFixed, outputLength: finalHtml.length }));
        }
      }
      if (finalHtml.includes('</html>')) {
        const lower = prompt.toLowerCase();
        const kind = /游戏|game/.test(lower)
          ? 'notes'
          : /看板|仪表|数据|dashboard/.test(lower)
            ? 'dashboard'
            : /待办|todo/.test(lower)
              ? 'todo'
              : /阅读|reading|文章/.test(lower)
                ? 'reading'
                : /计算|calculator/.test(lower)
                  ? 'calculator'
                  : 'landing';
        const m = finalHtml.match(/<title>([^<]*)<\/title>/i);
        const appTitle = (m?.[1]?.trim() || title).slice(0, 24);
        send({
          type: 'app',
          app: { title: appTitle, kind, files: [{ name: 'index.html', content: finalHtml, language: 'html' }] },
        });
        send({
          type: 'message',
          content: previousHtml
            ? `修改完成!「${appTitle}」已更新,右侧预览可直接体验。`
            : `「${appTitle}」已经生成完成!右侧预览可以直接体验,继续告诉我需要调整的地方即可。`,
        });
      }
      // 输出不完整或为空(含超时截断)时:显式透出真实错误,绝不静默结束
      if (!finalHtml.includes('</html>')) {
        const reason = timedOut
          ? '生成超时(超过平台时限),请简化需求后重试'
          : finishReason === 'length'
            ? '生成内容超出单次上限,请简化需求后重试'
            : '生成中断,请重试';
        console.error(JSON.stringify({ requestId, timedOut, outputLength: finalHtml.length, finishReason, retried }));
        send({ type: 'error', message: reason });
      }
      // T35:诊断事件——把「真实 Provider/模型顺序 + 超时与截断归因」显式写进响应流,
      // 供走查脚本从现场响应独立断言,而不是只从代码里声明模型链。
      const diagnostics = {
        type: 'diagnostics',
        modelChain: MODELS,
        modelTrace,
        activeModel,
        degraded: modelTrace.filter((t) => t.outcome !== 'selected').length > 0,
        planSource,
        planMs,
        budgetLines,
        softDeadlineMs: SOFT_DEADLINE_MS,
        proactiveCutMs: PROACTIVE_CUT_MS,
        stallSwitchMs: STALL_SWITCH_MS,
        stallSwitches,
        elapsedMs: Date.now() - requestStartedAt,
        firstTokenMs: firstTokenMs,
        finishReason,
        timedOut,
        proactiveCut,
        retried,
        truncatedAtLength,
        syntaxFixed,
        outputLength: finalHtml.length,
        usage,
        attempts: modelTrace.length,
      };
      send(diagnostics);
      send({ type: 'done', stopped: false });
      closed = true;
      controller.close();
      console.log(
        JSON.stringify({
          requestId,
          model: activeModel,
          outputLength: finalHtml.length,
          planSource,
          planMs,
          timedOut,
          finishReason,
          retried,
          syntaxFixed,
          triedModels,
          modelTrace,
          stallSwitches,
          proactiveCut,
          truncatedAtLength,
          usage,
          elapsedMs: diagnostics.elapsedMs,
        }),
      );
    },
  });

  return new Response(stream, { headers: eventHeaders });
});
