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
  const app = buildDemoApp(prompt, theme);
  const stopped = () => signal.aborted;
  const modeWord = mode === 'build' ? '构建' : '按目标自动规划';

  onEvent({
    type: 'message',
    content: `收到!我来帮你${modeWord}「${app.title}」。先拆解一下执行计划:`,
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
    content: `「${app.title}」已经生成完成!右侧预览可以直接体验,继续告诉我需要调整的地方即可。`,
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
    }),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Edge Function 响应异常:${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sawDone = false;
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
        options.onEvent(event);
      } catch {
        // 忽略无法解析的流分片
      }
    }
  }
  // 服务端(含软超时收尾分支)总会以 done 结束;流结束却未收到 done,
  // 说明连接被异常截断(如平台超时回收),必须以真实错误透出,不允许静默当作成功
  if (!sawDone && !options.signal.aborted) {
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
  if (getSupabaseFunctionUrl(AGENT_FUNCTION_NAME)) {
    // T21:瞬时故障(网络抖动/5xx/429)自动重试 3 次,指数退避 1.2s→2.4s→4.8s;仍失败才向 UI 透出真实错误
    const MAX_ATTEMPTS = 4;
    const RETRY_DELAYS_MS = [1200, 2400, 4800];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await runEdgeAgent(options);
        return;
      } catch (error) {
        if (options.signal.aborted) {
          options.onEvent({ type: 'done', stopped: true });
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
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
