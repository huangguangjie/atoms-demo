// app_atoms_agent_generate:真实 AI 智能体生成(SSE 流式输出 AgentEvent)
// 输入: { prompt, theme, mode }
// 输出: text/event-stream,每行 data: <AgentEvent JSON>
// 模型:deepseek-v4-flash(经平台 AI 网关,密钥来自 Edge Function Secrets;速度快以满足 150s 平台时限)
// 韧性:输出不完整(max_tokens 截断/流提前结束)时自动以更精简约束重试一次;
//      超时/重试后仍不完整均以 error + done 显式收尾,绝不静默截断。
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'deepseek-v4-flash';
const MAX_TOKENS = 16000;
const SOFT_DEADLINE_MS = 140_000; // 平台约 150s 强制回收,提前 10s 主动收尾
const ESTIMATE_TOTAL = 8000; // code-delta 进度百分比估算基准
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

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

// 截断重试时附加的更严格精简指令
const RETRY_SUFFIX =
  '\n注意:上一次输出中途被截断,未能输出完整 HTML。这次必须大幅精简:总代码量控制在 180 行以内,删减注释与装饰性细节,优先保证一次性输出完整 HTML(以 </html> 结束)。';

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

  const systemPrompt = [
    '你是 Atoms 平台的应用生成智能体,负责把用户需求变成真实可运行的单文件 HTML 应用。',
    '严格只输出一个完整的 HTML5 文档(从 <!DOCTYPE html> 开始,以 </html> 结束),不要输出任何解释、Markdown 或代码围栏。',
    '要求:内联全部 CSS 与 JS,无外部依赖;界面美观现代(渐变、圆角、阴影、合理留白);交互真实可用;移动端适配;中文文案。',
    '总代码量必须控制在 250 行以内(约 8KB):注释与空行最少化,样式精炼复用,功能优先保证核心交互完整;宁可精简也不允许超时截断,必须一次性输出到 </html>。',
  ].join('\n');
  const userPrompt = [
    `应用需求:${prompt}`,
    `界面主题:${theme}`,
    `执行模式:${mode === 'goal' ? '按目标自动规划' : '逐步构建'}`,
    '请直接给出完整单文件 HTML。',
  ].join('\n');

  const callGateway = (userContent: string) =>
    fetch(`${aiBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        max_tokens: MAX_TOKENS,
        enable_thinking: false,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
      }),
    });

  let upstream: Response;
  try {
    upstream = await callGateway(userPrompt);
  } catch (error) {
    console.error(requestId, 'AI 网关连接失败', error);
    return new Response(JSON.stringify({ error: 'AI 服务连接失败' }), {
      status: 502,
      headers: jsonHeaders(),
    });
  }
  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => '');
    console.error(requestId, `AI 网关返回 ${upstream.status}`, detail.slice(0, 500));
    return new Response(JSON.stringify({ error: `AI 服务响应异常(${upstream.status})` }), {
      status: 502,
      headers: jsonHeaders(),
    });
  }

  const eventHeaders = {
    ...CORS,
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  };
  const firstUpstream = upstream;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // 分步计划(与前端演示剧本一致的事件协议)
      const title = titleFromPrompt(prompt);
      send({
        type: 'message',
        content: `收到!我来帮你${mode === 'goal' ? '按目标自动规划' : '构建'}「${title}」。先拆解一下执行计划:`,
      });
      const steps = [
        `分析需求,拆解「${title}」的功能点`,
        '设计页面布局与主题视觉',
        '实现核心交互逻辑',
        '完善样式与响应式适配',
        '生成可运行应用并接入预览',
      ];
      send({ type: 'plan', steps });
      for (let i = 0; i < steps.length; i += 1) {
        send({ type: 'step-start', index: i });
        await new Promise((resolve) => setTimeout(resolve, 220));
        send({ type: 'step-done', index: i });
      }
      send({ type: 'message', content: '计划执行完毕,开始生成代码…' });
      send({ type: 'code-start', fileName: 'index.html' });

      // 消费上游 OpenAI 兼容 SSE:透传 delta.content,记录 finish_reason,忽略 reasoning 分片。
      // 最多两轮:首轮输出不完整(且未超时)时,以更精简指令重试一次,共享软超时预算。
      const startedAt = Date.now();
      let html = '';
      let timedOut = false;
      let finishReason: string | null = null;
      let retried = false;

      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (attempt === 2) {
          console.warn(
            JSON.stringify({ requestId, retry: true, firstOutputLength: html.length, finishReason }),
          );
          send({ type: 'message', content: '首轮生成未完整结束,正在用更精简的方案重试…' });
          html = '';
          try {
            upstream = await callGateway(userPrompt + RETRY_SUFFIX);
          } catch (error) {
            console.error(requestId, '重试连接 AI 网关失败', error);
            break;
          }
          if (!upstream.ok || !upstream.body) {
            const detail = await upstream.text().catch(() => '');
            console.error(requestId, `重试时 AI 网关返回 ${upstream.status}`, detail.slice(0, 300));
            break;
          }
          retried = true;
        }

        const reader = upstream.body!.getReader();
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

      html = html.trim();
      // 仅在 HTML 文档完整时交付;不完整输出由收尾分支统一以 error 事件透出
      if (html.includes('</html>')) {
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
        const m = html.match(/<title>([^<]*)<\/title>/i);
        const appTitle = (m?.[1]?.trim() || title).slice(0, 24);
        send({
          type: 'app',
          app: { title: appTitle, kind, files: [{ name: 'index.html', content: html, language: 'html' }] },
        });
        send({
          type: 'message',
          content: `「${appTitle}」已经生成完成!右侧预览可以直接体验,继续告诉我需要调整的地方即可。`,
        });
      }
      // 输出不完整或为空(含超时截断)时:显式透出真实错误,绝不静默结束
      if (!html.includes('</html>')) {
        const reason = timedOut
          ? '生成超时(超过平台时限),请简化需求后重试'
          : finishReason === 'length'
            ? '生成内容超出单次上限,请简化需求后重试'
            : '生成中断,请重试';
        console.error(JSON.stringify({ requestId, timedOut, outputLength: html.length, finishReason, retried }));
        send({ type: 'error', message: reason });
      }
      send({ type: 'done', stopped: false });
      closed = true;
      controller.close();
      console.log(JSON.stringify({ requestId, outputLength: html.length, timedOut, finishReason, retried }));
    },
  });

  void firstUpstream;
  return new Response(stream, { headers: eventHeaders });
});
