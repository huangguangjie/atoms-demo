/**
 * T28 复现专用桩模块:替代 @/lib/supabase,供 esbuild 打包 lib/agent.ts 时在 Node 环境运行。
 * 只暴露 agent.ts 依赖的两个导出,行为由测试脚本通过 globalThis 注入控制。
 */

export const __t28State: { functionUrl: string; sessionToken: string } = {
  functionUrl: 'http://mock.local/functions/v1/app_atoms_agent_generate',
  sessionToken: 'mock-jwt-token',
};

export function getSupabaseFunctionUrl(name: string): string | null {
  return `${__t28State.functionUrl.replace(/\/app_atoms_agent_generate$/, '')}/${name}`;
}

export const supabase = {
  auth: {
    async getSession() {
      return { data: { session: { access_token: __t28State.sessionToken } } };
    },
  },
};
