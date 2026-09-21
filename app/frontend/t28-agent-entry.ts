/** T28 复现入口:把 agent.ts 与桩模块一起打包,供 Node 动态导入 */
export { runAgent } from '@/lib/agent';
export { __t28State } from './t28-stub-supabase';
