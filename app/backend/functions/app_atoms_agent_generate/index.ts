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
  '总代码量必须控制在 250 行以内(约 8KB):注释与空行最少化,样式精炼复用,功能优先保证核心交互完整;宁可精简也不允许超时截断,必须一次性输出到 </html>。',
].join('\n');

// 截断重试时附加的更严格精简指令
const RETRY_SUFFIX =
  '\n注意:上一次输出中途被截断,未能输出完整 HTML。这次必须大幅精简:总代码量控制在 180 行以内,删减注释与装饰性细节,优先保证一次性输出完整 HTML(以 </html> 结束)。';

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

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 请求体解析(规范要求 try-catch,必填字段缺失返回 400)
  let body: { prompt?: string; theme?: string; mode?: string };
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

  const requestStartedAt = Date.now();

  // ---- T9 第 1 步:意图识别 ----
  const intent = analyzeIntent(prompt);
  const layoutDirective = buildLayoutDirective(intent);
  const intentLine = `类型=${intent.typeName};内容分区=${intent.zones.join('、') || '单一主区'};关键功能=${
    intent.features.join('、') || '常规交互'
  }`;

  // ---- T9 第 2 步:布局规划(独立小调用,超时/解析失败回退启发式计划) ----
  let planSteps = fallbackSteps(intent);
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
      if (planController.signal.aborted) break;
      try {
        const planResp = await fetch(`${aiBase.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
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
    // T15:主题为「默认」(用户未选择主题)时不注入主题提示,由模型按中性/自动配色决定
    theme !== '默认' ? `界面主题:${theme}` : '',
    `执行模式:${mode === 'goal' ? '按目标自动规划' : '逐步构建'}`,
    `意图识别:${intentLine}`,
    intent.assumptions.length ? `默认假设(未指明处按此实现):${intent.assumptions.join(';')}` : '',
    `布局指令:${layoutDirective}`,
    '既定执行计划(生成时必须遵循):',
    ...planSteps.map((s, i) => `${i + 1}. ${s}`),
    '请严格按以上意图、布局指令与计划,直接给出完整单文件 HTML。',
  ]
    .filter(Boolean)
    .join('\n');

  const callGateway = (userContent: string, model: string) =>
    fetch(`${aiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: true,
        max_tokens: MAX_TOKENS,
        enable_thinking: false,
        messages: [
          { role: 'system', content: CODE_SYSTEM },
          { role: 'user', content: userContent },
        ],
      }),
    });

  // T23:主模型失败(连接异常/4xx/5xx/限流)时在同一次请求内按序尝试备用模型;
  // 同一模型遇 5xx/429 先短暂退避原地重试一次(T21 韧性保留),仍失败才降级到下一个模型。
  // 拿到可读流即锁定该模型,SSE 透传开始后不再切换(截断重试也沿用同一模型)。
  // 预算守卫:剩余软超时不足 15s 时停止降级,直接显式失败,避免被平台强制回收。
  let upstream: Response | null = null;
  let activeModel = '';
  const triedModels: { model: string; status: string }[] = [];
  outer: for (const model of MODELS) {
    for (let sameModelAttempt = 1; sameModelAttempt <= 2; sameModelAttempt += 1) {
      if (Date.now() - requestStartedAt > SOFT_DEADLINE_MS - 15_000) break outer;
      try {
        const resp = await callGateway(userPrompt, model);
        if (resp.ok && resp.body) {
          upstream = resp;
          activeModel = model;
          break outer;
        }
        const detail = await resp.text().catch(() => '');
        triedModels.push({ model, status: String(resp.status) });
        console.warn(JSON.stringify({ requestId, modelFallback: true, model, status: resp.status, detail: detail.slice(0, 200) }));
        if ((resp.status >= 500 || resp.status === 429) && sameModelAttempt === 1) {
          await sleep(resp.status === 429 ? 2000 : 1500);
          continue;
        }
        // 4xx(含 403)或同一模型二连失败:降级到下一个备用模型
        break;
      } catch (error) {
        triedModels.push({ model, status: 'connection-error' });
        console.warn(JSON.stringify({ requestId, modelFallback: true, model, error: String(error).slice(0, 200) }));
        break;
      }
    }
  }
  if (!upstream) {
    // T23:全部模型同报 403 → 平台 AI 网关整体故障,给出明确文案;其余按各模型状态汇总透出
    const allForbidden = triedModels.length > 0 && triedModels.every((t) => t.status === '403');
    const summary = triedModels.map((t) => `${t.model}:${t.status}`).join(', ');
    console.error(JSON.stringify({ requestId, allModelsFailed: true, triedModels }));
    return new Response(
      JSON.stringify({
        error: allForbidden
          ? '平台 AI 网关故障,请稍后重试'
          : `AI 服务响应异常(${summary || '网关无响应'})`,
      }),
      { status: 502, headers: jsonHeaders() },
    );
  }
  // 闭包内 TS 不保留可变变量判空收窄:选定响应固化为常量,流内截断重试改用局部变量
  const selectedUpstream: Response = upstream;

  const eventHeaders = {
    ...CORS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
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
        content: `收到!我来帮你${mode === 'goal' ? '按目标自动规划' : '构建'}「${title}」。先拆解一下执行计划:`,
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

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (attempt === 2) {
          console.warn(
            JSON.stringify({ requestId, retry: true, firstOutputLength: html.length, finishReason }),
          );
          send({ type: 'message', content: '首轮生成未完整结束,正在用更精简的方案重试…' });
          html = '';
          try {
            const retryResp = await callGateway(userPrompt + RETRY_SUFFIX, activeModel);
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
            // 即使上游停滞不吐数据,也要在软超时点醒来收尾,而不是被平台强制回收
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
                const choice = chunk?.choices?.[0];
                if (choice?.finish_reason) finishReason = String(choice.finish_reason);
                const piece = typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
                if (!piece) continue;
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
        if (html.includes('</html>') || timedOut) break;
      }

      // T9 第 4 步:产物净化后交付,避免围栏/前后杂文进入预览
      const finalHtml = sanitizeHtml(html);
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
          content: `「${appTitle}」已经生成完成!右侧预览可以直接体验,继续告诉我需要调整的地方即可。`,
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
          triedModels,
        }),
      );
    },
  });

  return new Response(stream, { headers: eventHeaders });
});
