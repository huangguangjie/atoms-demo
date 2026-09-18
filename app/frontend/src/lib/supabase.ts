import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// 实体类型(与 Supabase 数据表一一对应)
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  display_name: string;
  email: string;
  avatar_color: string;
}

export interface Space {
  id: string;
  owner_id: string;
  name: string;
  is_default: boolean;
}

export type ProjectSource = 'created' | 'cloned' | 'template';

export interface Project {
  id: string;
  user_id: string;
  space_id: string | null;
  name: string;
  description: string | null;
  source: ProjectSource;
  favorite: boolean;
  cover_gradient: string;
  cover_emoji: string;
  views: number;
}

export interface Conversation {
  id: string;
  user_id: string;
  space_id: string | null;
  title: string;
  updated_at?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface CommunityApp {
  id: string;
  title: string;
  author_name: string;
  category: string;
  views: number;
  cover_gradient: string;
  cover_emoji: string;
}

export interface Template {
  id: string;
  title: string;
  description: string;
  category: string;
  cover_gradient: string;
  cover_emoji: string;
}

// ---------------------------------------------------------------------------
// Supabase 客户端
// ---------------------------------------------------------------------------

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** Supabase 是否已完成配置(环境变量注入);未配置时应用进入演示模式 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/** 返回 Supabase Edge Function 的完整 URL(未配置时返回 null);规范要求经 supabaseUrl 调用 */
export function getSupabaseFunctionUrl(name: string): string | null {
  if (!isSupabaseConfigured || !supabaseUrl) return null;
  return `${supabaseUrl}/functions/v1/${name}`;
}

// ---------------------------------------------------------------------------
// 演示模式常量与环境变量缺失时的兜底数据
// ---------------------------------------------------------------------------

export const demoProfile: Profile = {
  id: 'demo-user',
  display_name: 'guangjie huang',
  email: 'guangjie@atoms.dev',
  avatar_color: 'bg-violet-500',
};

export const demoSpace: Space = {
  id: 'demo-space',
  owner_id: 'demo-user',
  name: "guangjie huang's Atoms",
  is_default: true,
};

const COVER_GRADIENTS = [
  'from-violet-500 to-fuchsia-500',
  'from-blue-500 to-cyan-400',
  'from-emerald-500 to-teal-400',
  'from-amber-500 to-orange-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-sky-400',
];

function randomGradient(): string {
  return COVER_GRADIENTS[Math.floor(Math.random() * COVER_GRADIENTS.length)];
}

const seedCommunityApps: CommunityApp[] = [
  { id: 'ca-1', title: 'Birthday Matrix Site', author_name: 'Nova', category: 'Website', views: 434, cover_gradient: 'from-emerald-500 to-teal-400', cover_emoji: '🎂' },
  { id: 'ca-2', title: 'Simple Calculator', author_name: 'Leo', category: 'Productivity', views: 191, cover_gradient: 'from-slate-600 to-slate-400', cover_emoji: '🧮' },
  { id: 'ca-3', title: '2D Platformer Game', author_name: 'Mika', category: 'Game', views: 512, cover_gradient: 'from-blue-500 to-cyan-400', cover_emoji: '🎮' },
  { id: 'ca-4', title: 'Selling Digital Products', author_name: 'Ivy', category: 'E-commerce', views: 289, cover_gradient: 'from-amber-500 to-orange-500', cover_emoji: '🛍️' },
  { id: 'ca-5', title: 'Westershire Intranet', author_name: 'Owen', category: 'Website', views: 167, cover_gradient: 'from-indigo-500 to-sky-400', cover_emoji: '🏢' },
  { id: 'ca-6', title: 'tideline', author_name: 'Reef', category: 'Blog', views: 203, cover_gradient: 'from-cyan-500 to-blue-500', cover_emoji: '🌊' },
  { id: 'ca-7', title: '3B modeller', author_name: 'Kai', category: 'Prototype', views: 356, cover_gradient: 'from-violet-500 to-fuchsia-500', cover_emoji: '🧊' },
  { id: 'ca-8', title: 'Growth Data Dashboard', author_name: 'Chen', category: 'Data Analysis', views: 421, cover_gradient: 'from-rose-500 to-pink-500', cover_emoji: '📊' },
];

const seedTemplates: Template[] = [
  { id: 'tpl-1', title: 'Landing Page Kit', description: '现代 SaaS 落地页模板,含 Hero、功能、定价与 FAQ 区块,替换文案即可上线。', category: 'Website', cover_gradient: 'from-blue-500 to-cyan-400', cover_emoji: '🚀' },
  { id: 'tpl-2', title: 'E-commerce Starter', description: '含商品列表、购物车与订单流的电商基础方案,占位数据可直接替换为你的商品。', category: 'E-commerce', cover_gradient: 'from-amber-500 to-orange-500', cover_emoji: '🛒' },
  { id: 'tpl-3', title: 'Dashboard Starter', description: '数据看板模板,内置图表卡片网格与侧边导航,适合快速搭建管理后台。', category: 'Productivity', cover_gradient: 'from-violet-500 to-fuchsia-500', cover_emoji: '📈' },
  { id: 'tpl-4', title: 'Blog Starter', description: '极简博客模板,支持文章列表与详情页,替换 Markdown 内容即可发布。', category: 'Blog', cover_gradient: 'from-emerald-500 to-teal-400', cover_emoji: '✍️' },
  { id: 'tpl-5', title: 'Game Starter', description: 'Canvas 小游戏骨架,含主循环、计分与开始/结束界面,替换素材即可扩展。', category: 'Game', cover_gradient: 'from-indigo-500 to-sky-400', cover_emoji: '🕹️' },
  { id: 'tpl-6', title: 'Business Card', description: '个人名片页模板,含头像、社交链接与联系表单,适合快速展示个人品牌。', category: 'Business Card', cover_gradient: 'from-rose-500 to-pink-500', cover_emoji: '💼' },
];

// 内存演示态(未配置 Supabase 时的降级,仅当前浏览器会话内有效)
let demoConversations: Conversation[] = [];
let demoMessages: Message[] = [];
let demoProjects: Project[] = [
  { id: 'dp-1', user_id: 'demo-user', space_id: 'demo-space', name: '我的第一个应用', description: '通过首页对话创建的示例项目', source: 'created', favorite: true, cover_gradient: 'from-violet-500 to-fuchsia-500', cover_emoji: '✨', views: 12 },
  { id: 'dp-2', user_id: 'demo-user', space_id: 'demo-space', name: 'Simple Calculator 克隆', description: '从社区克隆的计算器应用', source: 'cloned', favorite: false, cover_gradient: 'from-slate-600 to-slate-400', cover_emoji: '🧮', views: 5 },
  { id: 'dp-3', user_id: 'demo-user', space_id: 'demo-space', name: 'Blog Starter 实例', description: '基于 Blog Starter 模板创建', source: 'template', favorite: false, cover_gradient: 'from-emerald-500 to-teal-400', cover_emoji: '✍️', views: 3 },
];

function demoId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// 数据访问助手
// ---------------------------------------------------------------------------

const AVATAR_COLORS = ['bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];

function pickAvatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 997;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** 确保当前用户存在 profile 与默认空间,返回空间列表 */
export async function ensureProfileAndSpace(
  userId: string,
  email: string,
  displayName: string,
): Promise<Space[]> {
  if (!isSupabaseConfigured) return [demoSpace];

  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (!existingProfile) {
    await supabase.from('profiles').insert({
      id: userId,
      display_name: displayName,
      email,
      avatar_color: pickAvatarColor(userId),
    });
    await supabase.from('spaces').insert({
      owner_id: userId,
      name: `${displayName} 的 Atoms`,
      is_default: true,
    });
  }

  const { data: spaces } = await supabase
    .from('spaces')
    .select('*')
    .eq('owner_id', userId)
    .order('is_default', { ascending: false });

  return (spaces as Space[]) ?? [];
}

export async function fetchRecentConversations(userId: string): Promise<Conversation[]> {
  if (!isSupabaseConfigured) {
    return [...demoConversations]
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
      .slice(0, 8);
  }
  const { data } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(8);
  return (data as Conversation[]) ?? [];
}

export async function createConversation(
  userId: string,
  spaceId: string | null,
  title: string,
): Promise<Conversation | null> {
  if (!isSupabaseConfigured) {
    const conversation: Conversation = {
      id: demoId('conv'),
      user_id: userId,
      space_id: spaceId,
      title,
      updated_at: new Date().toISOString(),
    };
    demoConversations = [conversation, ...demoConversations];
    return conversation;
  }
  const { data } = await supabase
    .from('conversations')
    .insert({ user_id: userId, space_id: spaceId, title })
    .select()
    .single();
  return data as Conversation | null;
}

export async function insertMessage(
  conversationId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  if (!isSupabaseConfigured) {
    demoMessages = [
      ...demoMessages,
      { id: demoId('msg'), conversation_id: conversationId, role, content },
    ];
    return;
  }
  await supabase.from('messages').insert({ conversation_id: conversationId, role, content });
}

/** 拉取某个对话的全部消息(按时间正序),供最近对话联动回放 */
export async function fetchConversationMessages(conversationId: string): Promise<Message[]> {
  if (!isSupabaseConfigured) {
    return demoMessages.filter((m) => m.conversation_id === conversationId);
  }
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return (data as Message[]) ?? [];
}

export interface CreateProjectInput {
  userId: string;
  spaceId: string | null;
  name: string;
  description?: string | null;
  source: ProjectSource;
  coverGradient?: string;
  coverEmoji?: string;
}

export async function createProject(input: CreateProjectInput): Promise<Project | null> {
  const row = {
    user_id: input.userId,
    space_id: input.spaceId,
    name: input.name,
    description: input.description ?? null,
    source: input.source,
    favorite: false,
    cover_gradient: input.coverGradient ?? randomGradient(),
    cover_emoji: input.coverEmoji ?? '📦',
    views: 0,
  };
  if (!isSupabaseConfigured) {
    const project: Project = { id: demoId('proj'), ...row };
    demoProjects = [project, ...demoProjects];
    return project;
  }
  const { data } = await supabase.from('projects').insert(row).select().single();
  return data as Project | null;
}

export async function fetchProjects(userId: string, favoriteOnly: boolean): Promise<Project[]> {
  if (!isSupabaseConfigured) {
    return demoProjects.filter(
      (p) => p.user_id === userId && (!favoriteOnly || p.favorite),
    );
  }
  let query = supabase.from('projects').select('*').eq('user_id', userId);
  if (favoriteOnly) query = query.eq('favorite', true);
  const { data } = await query.order('updated_at', { ascending: false });
  return (data as Project[]) ?? [];
}

export async function toggleProjectFavorite(project: Project): Promise<void> {
  if (!isSupabaseConfigured) {
    demoProjects = demoProjects.map((p) =>
      p.id === project.id ? { ...p, favorite: !p.favorite } : p,
    );
    return;
  }
  await supabase.from('projects').update({ favorite: !project.favorite }).eq('id', project.id);
}

export const COMMUNITY_CATEGORIES = [
  '全部',
  'Website',
  'Game',
  'E-commerce',
  'Productivity',
  'Prototype',
  'Data Analysis',
  'Blog',
  'Business Card',
];

export async function fetchCommunityApps(category: string): Promise<CommunityApp[]> {
  if (!isSupabaseConfigured) {
    return seedCommunityApps.filter((a) => category === '全部' || a.category === category);
  }
  let query = supabase.from('community_apps').select('*');
  if (category !== '全部') query = query.eq('category', category);
  const { data } = await query.order('views', { ascending: false });
  return (data as CommunityApp[]) ?? [];
}

export async function fetchTemplates(category: string): Promise<Template[]> {
  if (!isSupabaseConfigured) {
    return seedTemplates.filter((t) => category === '全部' || t.category === category);
  }
  let query = supabase.from('templates').select('*');
  if (category !== '全部') query = query.eq('category', category);
  const { data } = await query.order('created_at', { ascending: false });
  return (data as Template[]) ?? [];
}
