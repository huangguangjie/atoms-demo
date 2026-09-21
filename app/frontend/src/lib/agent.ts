/**
 * 智能体运行器:负责「分步计划 → 流式代码 → 可运行应用」的生成管线。
 *
 * - Supabase 已连接时:优先调用平台 Edge Function(app_atoms_agent_generate,SSE 流式),
 *   模型由服务端指定(claude-opus-5 [gentxt]),前端不持有任何第三方密钥。
 * - Supabase 未连接(演示模式):在本地执行完整的生成剧本,产出真实可运行的单文件
 *   HTML 应用,保证端到端体验;Edge Function 就绪后自动无缝切换。
 */

import { buildDemoApp, type DemoApp } from '@/lib/demo-apps';
import { getSupabaseFunctionUrl, supabase } from '@/lib/supabase';

export type AgentMode = 'build' | 'goal';

export interface AgentPlanStep {
  label: string;
  status: 'pending' | 'running' | 'done';
}

export type AgentEvent =
  | { type: 'message'; content: string }
  | { type: 'plan'; steps: string[] }
  | { type: 'step-start'; index: number }
  | { type: 'step-done'; index: number }
  | { type: 'code-start'; fileName: string }
  | { type: 'code-delta'; delta: string; percent?: number }
  | { type: 'app'; app: DemoApp }
  | { type: 'done'; stopped: boolean }
  | { type: 'error'; message: string };

export interface RunAgentOptions {
  prompt: string;
  theme: string;
  mode: AgentMode;
  signal: AbortSignal;
  onEvent: (event: AgentEvent) => void;
  /** T23:显式演示模式(仅由用户在失败卡主动触发),只走本地演示智能体,不尝试 Edge Function */
  explicitDemo?: boolean;
  /** T25:增量修改——当前版本完整 HTML,携带时 Edge Function 进入修改模式 */
  previousHtml?: string;
}

const AGENT_FUNCTION_NAME = 'app_atoms_agent_generate';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function planLabels(title: string): string[] {
  return [
    `分析需求,拆解「${title}」的功能点`,
    '设计页面布局与主题视觉',
    '实现核心交互逻辑',
    '完善样式与响应式适配',
    '生成可运行应用并接入预览',
  ];
}

// ---------------------------------------------------------------------------
// 演示模式智能体(本地完整剧本)
// ---------------------------------------------------------------------------

async function runDemoAgent(options: RunAgentOptions): Promise<void> {
  const { prompt, theme, mode, signal, onEvent } = options;
  // T23:演示产物携带 isDemo 标识,查看器据此标注「演示模式」;显式触发时消息同步声明
  const app: DemoApp = { ...buildDemoApp(prompt, theme), isDemo: true };
  const stopped = () => signal.aborted;
  const modeWord = mode === 'build' ? '构建' : '按目标自动规划';
  const demoPrefix = options.explicitDemo ? '【演示模式】' : '';

  onEvent({
    type: 'message',
    content: `${demoPrefix}收到!我来帮你${modeWord}「${app.title}」。先拆解一下执行计划:`,
  });
  await sleep(480);
  if (stopped()) {
    onEvent({ type: 'done', stopped: true });
    return;
  }

  const steps = planLabels(app.title);
  onEvent({ type: 'plan', steps });
  for (let i = 0; i < steps.length; i += 1) {
    onEvent({ type: 'step-start', index: i });
    await sleep(mode === 'goal' ? 400 : 620);
    if (stopped()) {
      onEvent({ type: 'done', stopped: true });
      return;
    }
    onEvent({ type: 'step-done', index: i });
  }

  onEvent({ type: 'message', content: '计划执行完毕,开始生成代码…' });
  onEvent({ type: 'code-start', fileName: app.files[0].name });
  const content = app.files[0].content;
  const chunkSize = 180;
  for (let i = 0; i < content.length; i += chunkSize) {
    if (stopped()) {
      onEvent({ type: 'done', stopped: true });
      return;
    }
    onEvent({
      type: 'code-delta',
      delta: content.slice(i, i + chunkSize),
      percent: Math.min(100, ((i + chunkSize) / content.length) * 100),
    });
    await sleep(22);
  }
  await sleep(200);
  if (stopped()) {
    onEvent({ type: 'done', stopped: true });
    return;
  }

  onEvent({ type: 'app', app });
  onEvent({
    type: 'message',
    content: `${demoPrefix}「${app.title}」已经生成完成(本地演示应用)!右侧预览可以直接体验;AI 服务恢复后可点击「重新生成」重新尝试真实生成。`,
  });
  onEvent({ type: 'done', stopped: false });
}

// ---------------------------------------------------------------------------
// Supabase Edge Function 分支(SSE 流式,预留:连接后无需改前端即可启用)
// ---------------------------------------------------------------------------

async function runEdgeAgent(options: RunAgentOptions): Promise<void> {
  const url = getSupabaseFunctionUrl(AGENT_FUNCTION_NAME);
  if (!url) throw new Error('Edge Function 尚未可用');

  // 规范要求:先 await getSession 拿 token,并通过 supabaseUrl 调用函数
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      prompt: options.prompt,
      theme: options.theme,
      mode: options.mode,
      // T25:增量修改——已有产物时携带上一版 HTML,服务端按修改模式生成
      ...(options.previousHtml ? { previousHtml: options.previousHtml } : {}),
    }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    // T23:透传服务端错误详情(如「平台 AI 网关故障」);保留状态码格式,维持 T21 瞬时故障重试判定不变
    const detail = await response.text().catch(() => '');
    let serverMessage = '';
    try {
      serverMessage = String((JSON.parse(detail) as { error?: string })?.error ?? '');
    } catch {
      // 非 JSON 错误体,忽略
    }
    throw new Error(
      serverMessage
        ? `Edge Function 响应异常:${response.status}(${serverMessage})`
        : `Edge Function 响应异常:${response.status}`,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
  let sawApp = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
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
          const event = JSON.parse(payload) as AgentEvent;
          if (event.type === 'done') sawDone = true;
          if (event.type === 'app') sawApp = true;
          options.onEvent(event);
        } catch {
          // 忽略无法解析的流分片
        }
      }
    }
  } catch (error) {
    // T28 终止守卫:流读取中途连接被硬截断(socket hang up 等)。
    // app 事件已交付时产物到手,按成功收敛,绝不整轮重跑(重新规划→重新生成);
    // 未交付产物则原样抛出,交由上层按 T21 瞬时错误有限重试。
    if (sawApp && !options.signal.aborted) {
      options.onEvent({ type: 'done', stopped: false });
      return;
    }
    throw error;
  }
  // T28 终止守卫:产物(app 事件)已交付时,流结束即视为成功收敛。
  // 平台超时回收/网关提前 FIN 可能丢掉末尾 done 分片,但那不代表生成失败;
  // 若此时抛「连接中断」会触发整轮重跑(重新规划→重新生成),即用户看到的
  // 「代码 100% 后重新规划再生成」死循环。补发 done 事件让调用方正常结束流式态。
  if (!sawDone && !options.signal.aborted) {
    if (sawApp) {
      options.onEvent({ type: 'done', stopped: false });
      return;
    }
    // 流结束却未收到 done 且产物未交付:连接被异常截断,以真实错误透出(允许瞬时重试)
    throw new Error('AI 生成连接中断,请重试');
  }
}

// ---------------------------------------------------------------------------
// 入口:优先 Edge Function,失败或未配置时回退演示智能体
// ---------------------------------------------------------------------------

/** 判断是否为可自动重试的瞬时故障:流被截断/网络抖动/网关 5xx;4xx 等确定性错误不重试,直接透出 */
function isTransientAgentError(message: string): boolean {
  return (
    message.includes('连接中断')
    || message.includes('Failed to fetch')
    || message.includes('NetworkError')
    || message.includes('network')
    || /响应异常[:：]\s*(5\d{2}|429)/.test(message)
  );
}

export async function runAgent(options: RunAgentOptions): Promise<void> {
  // T23:显式演示模式——仅由用户在失败卡主动触发,不尝试 Edge Function,也不作为静默回退
  if (options.explicitDemo) {
    await runDemoAgent(options);
    return;
  }
  if (getSupabaseFunctionUrl(AGENT_FUNCTION_NAME)) {
    // T28 终止守卫:本次 runAgent 生命周期内一旦收到 app 事件即视为产物已交付,
    // 之后任何收尾异常都不得触发整轮重跑(重新规划→重新生成),只能补发 done 收敛。
    let deliveredApp = false;
    const guarded: RunAgentOptions = {
      ...options,
      onEvent: (event) => {
        if (event.type === 'app') deliveredApp = true;
        options.onEvent(event);
      },
    };
    // T21:瞬时故障(网络抖动/5xx/429)自动重试 3 次,指数退避 1.2s→2.4s→4.8s;仍失败才向 UI 透出真实错误
    const MAX_ATTEMPTS = 4;
    const RETRY_DELAYS_MS = [1200, 2400, 4800];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await runEdgeAgent(guarded);
        return;
      } catch (error) {
        if (options.signal.aborted) {
          options.onEvent({ type: 'done', stopped: true });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        // T28:产物已交付后禁止自动重跑,补发 done 正常收敛(错误仅日志,不打断已生成的应用)
        if (deliveredApp) {
          console.warn('[agent] 产物已交付后连接收尾异常,按成功收敛,不重跑:', message);
          options.onEvent({ type: 'done', stopped: false });
          return;
        }
        if (attempt < MAX_ATTEMPTS && isTransientAgentError(message)) {
          console.warn('[agent] 连接瞬时中断,自动重试:', message);
          options.onEvent({
            type: 'message',
            content: `连接出现瞬时中断,正在自动重试(${attempt}/${MAX_ATTEMPTS - 1})…`,
          });
          await sleep(RETRY_DELAYS_MS[attempt - 1] ?? 4800);
          continue;
        }
        // Supabase 已配置时必须暴露真实报错,不允许静默回退演示智能体
        // (否则线上问题只会被演示剧本掩盖,永远无法定位根因)
        console.error('[agent] Edge Function 调用失败:', error);
        options.onEvent({ type: 'error', message });
        return;
      }
    }
  }
  await runDemoAgent(options);
}
