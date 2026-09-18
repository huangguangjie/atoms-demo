// app_atoms_transcribe_audio:平台语音转写(scribe_v2,经平台 AI 网关)
// 输入:multipart/form-data,字段 audio = 音频文件(webm/ogg/mp3/wav/m4a)
// 输出:JSON { text, model, cost_ms };密钥仅存于 Edge Function Secrets,前端不持有
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = 'scribe_v2';
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
};

function jsonHeaders() {
  return { ...CORS, 'Content-Type': 'application/json' };
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: '仅支持 POST 请求' }), {
      status: 405,
      headers: jsonHeaders(),
    });
  }

  // 鉴权:携带 JWT 时必须有效(用 service role 验证);未携带允许匿名体验(与生成函数策略一致)
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
    return new Response(JSON.stringify({ error: '语音转写服务未配置' }), {
      status: 500,
      headers: jsonHeaders(),
    });
  }

  // 解析 multipart 表单(规范要求 try-catch,必填字段缺失返回 400)
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: '请求必须是 multipart/form-data 表单' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  const audio = form.get('audio');
  if (!audio || typeof audio === 'string') {
    return new Response(JSON.stringify({ error: '缺少 audio 音频文件字段' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  const file = audio as File;
  if (file.size === 0) {
    return new Response(JSON.stringify({ error: '音频文件为空' }), {
      status: 400,
      headers: jsonHeaders(),
    });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return new Response(JSON.stringify({ error: '音频文件过大(上限 20MB)' }), {
      status: 413,
      headers: jsonHeaders(),
    });
  }
  const startedAt = Date.now();
  console.log(
    JSON.stringify({
      requestId,
      method: req.method,
      fileName: file.name || 'audio',
      fileSize: file.size,
    }),
  );

  // 转发平台 AI 网关:OpenAI 兼容 /audio/transcriptions,模型 scribe_v2
  const upstreamForm = new FormData();
  upstreamForm.append('file', file, file.name || 'audio.webm');
  upstreamForm.append('model', MODEL);
  upstreamForm.append('response_format', 'json');

  try {
    const upstream = await fetch(`${aiBase.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${aiKey}` },
      body: upstreamForm,
    });
    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(requestId, `转写网关返回 ${upstream.status}`, detail.slice(0, 500));
      return new Response(
        JSON.stringify({ error: `转写服务响应异常(${upstream.status})` }),
        { status: 502, headers: jsonHeaders() },
      );
    }
    const data = await upstream.json().catch(() => null);
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) {
      console.error(requestId, '转写结果为空', JSON.stringify(data)?.slice(0, 300));
      return new Response(
        JSON.stringify({ error: '转写结果为空,请靠近麦克风重说一遍' }),
        { status: 502, headers: jsonHeaders() },
      );
    }
    console.log(
      JSON.stringify({ requestId, textLength: text.length, costMs: Date.now() - startedAt }),
    );
    return new Response(
      JSON.stringify({ text, model: MODEL, cost_ms: Date.now() - startedAt }),
      { headers: jsonHeaders() },
    );
  } catch (error) {
    console.error(requestId, '转写网关连接失败', error);
    return new Response(JSON.stringify({ error: '转写服务连接失败' }), {
      status: 502,
      headers: jsonHeaders(),
    });
  }
});
