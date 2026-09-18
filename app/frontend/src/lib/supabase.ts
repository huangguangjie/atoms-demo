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
  /** 生成的单文件应用 HTML,项目预览回放用 */
  app_html?: string | null;
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

export interface TemplatePlaceholder {
  key: string;
  label: string;
  description?: string;
  default_value?: string;
}

export interface Template {
  id: string;
  title: string;
  description: string;
  category: string;
  cover_gradient: string;
  cover_emoji: string;
  placeholders?: TemplatePlaceholder[] | null;
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
// 平台语音转写(scribe_v2,经 Edge Function 转发平台 AI 网关,密钥不出服务端)
// ---------------------------------------------------------------------------

const TRANSCRIBE_FUNCTION_NAME = 'app_atoms_transcribe_audio';

export interface TranscribeResult {
  text: string;
  model: string;
  cost_ms: number;
}

/** 上传录音文件到转写 Edge Function,返回识别文本;失败时抛错由调用方回退浏览器识别 */
export async function transcribeAudio(file: File): Promise<TranscribeResult> {
  const url = getSupabaseFunctionUrl(TRANSCRIBE_FUNCTION_NAME);
  if (!url) throw new Error('语音转写服务未配置');
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const form = new FormData();
  form.append('audio', file, file.name || 'voice.webm');
  const resp = await fetch(url, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  });
  const data = (await resp.json().catch(() => null)) as { text?: string; model?: string; cost_ms?: number; error?: string } | null;
  if (!resp.ok || !data?.text) {
    throw new Error(String(data?.error ?? `转写服务响应异常(${resp.status})`));
  }
  return {
    text: String(data.text),
    model: String(data.model ?? ''),
    cost_ms: Number(data.cost_ms ?? 0),
  };
}

/** 平台语音转写是否可用(已配置 Supabase 时可用);不可用时调用方直接回退浏览器识别 */
export function isTranscribeAvailable(): boolean {
  return Boolean(getSupabaseFunctionUrl(TRANSCRIBE_FUNCTION_NAME));
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
  {
    id: 'tpl-1', title: 'Landing Page Kit', description: '现代 SaaS 落地页模板,含 Hero、功能、定价与 FAQ 区块,替换文案即可上线。', category: 'Website', cover_gradient: 'from-blue-500 to-cyan-400', cover_emoji: '🚀',
    placeholders: [
      { key: 'brand_name', label: '产品名称', description: '用于导航栏 Logo、页脚与产品介绍', default_value: 'Landing Page Kit' },
      { key: 'hero_slogan', label: '主标语', description: '首页 Hero 区的大标题文案', default_value: '让团队协作快人一步' },
      { key: 'hero_desc', label: '产品简介', description: 'Hero 区一句话介绍你的产品价值', default_value: '帮你把想法变成可执行的任务流,实时同步、自动提醒,团队效率提升 3 倍。' },
      { key: 'price_pro', label: '专业版定价', description: '展示为「¥xx/人/月」,填数字即可', default_value: '68' },
    ],
  },
  {
    id: 'tpl-2', title: 'E-commerce Starter', description: '含商品列表、购物车与订单流的电商基础方案,占位数据可直接替换为你的商品。', category: 'E-commerce', cover_gradient: 'from-amber-500 to-orange-500', cover_emoji: '🛒',
    placeholders: [
      { key: 'shop_name', label: '店铺名称', description: '看板标题与品牌展示位', default_value: 'E-commerce Starter' },
      { key: 'total_revenue', label: '总收入金额', description: '看板「总收入」指标卡金额', default_value: '¥ 128,460' },
    ],
  },
  {
    id: 'tpl-3', title: 'Dashboard Starter', description: '数据看板模板,内置图表卡片网格与侧边导航,适合快速搭建管理后台。', category: 'Productivity', cover_gradient: 'from-violet-500 to-fuchsia-500', cover_emoji: '📈',
    placeholders: [
      { key: 'dashboard_title', label: '看板名称', description: '看板页大标题', default_value: 'Dashboard Starter' },
      { key: 'kpi_revenue', label: '总收入指标', description: '「总收入」指标卡金额', default_value: '¥ 128,460' },
      { key: 'kpi_users', label: '新增用户指标', description: '「新增用户」指标卡数值', default_value: '3,208' },
    ],
  },
  {
    id: 'tpl-4', title: 'Blog Starter', description: '极简博客模板,支持文章列表与详情页,替换 Markdown 内容即可发布。', category: 'Blog', cover_gradient: 'from-emerald-500 to-teal-400', cover_emoji: '✍️',
    placeholders: [
      { key: 'blog_name', label: '博客名称', description: '博客标题与展示名', default_value: 'Blog Starter' },
      { key: 'first_post_intro', label: '首篇文章简介', description: '默认第一篇博文的正文内容', default_value: '这是我用 Atoms 智能体生成的第一个应用,点击卡片可以编辑,右上角 × 可以删除。' },
    ],
  },
  {
    id: 'tpl-5', title: 'Game Starter', description: 'Canvas 小游戏骨架,含主循环、计分与开始/结束界面,替换素材即可扩展。', category: 'Game', cover_gradient: 'from-indigo-500 to-sky-400', cover_emoji: '🕹️',
    placeholders: [
      { key: 'game_name', label: '游戏名称', description: '页面标题与展示名', default_value: 'Game Starter' },
    ],
  },
  {
    id: 'tpl-6', title: 'Business Card', description: '个人名片页模板,含头像、社交链接与联系表单,适合快速展示个人品牌。', category: 'Business Card', cover_gradient: 'from-rose-500 to-pink-500', cover_emoji: '💼',
    placeholders: [
      { key: 'person_name', label: '姓名/品牌名', description: '名片页 Logo、页脚与自我介绍中使用', default_value: 'Business Card' },
      { key: 'personal_tagline', label: '个人标语', description: '名片页大标题一句话', default_value: '让团队协作快人一步' },
      { key: 'personal_intro', label: '个人简介', description: '名片页副标题,介绍你自己', default_value: '帮你把想法变成可执行的任务流,实时同步、自动提醒,团队效率提升 3 倍。' },
    ],
  },
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

/** 确保当前用户存在 profile 与默认空间,返回空间列表;失败时抛出真实报错(不静默吞掉) */
export async function ensureProfileAndSpace(
  userId: string,
  email: string,
  displayName: string,
): Promise<Space[]> {
  if (!isSupabaseConfigured) return [demoSpace];

  // 初始化必须幂等:会话恢复(getSession)与登录事件(onAuthStateChange)可能并发触发,
  // upsert + ignoreDuplicates 避免并发插入撞 profiles_pkey(线上曾出现 duplicate key 误报)
  const { error: profileUpsertError } = await supabase.from('profiles').upsert(
    {
      id: userId,
      display_name: displayName,
      email,
      avatar_color: pickAvatarColor(userId),
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (profileUpsertError) {
    throw new Error(`初始化用户资料失败:${profileUpsertError.message}`);
  }

  const { data: spaces, error: spacesError } = await supabase
    .from('spaces')
    .select('*')
    .eq('owner_id', userId)
    .order('is_default', { ascending: false });
  if (spacesError) {
    throw new Error(`读取空间列表失败:${spacesError.message}`);
  }

  if (!spaces || spaces.length === 0) {
    const { error: spaceInsertError } = await supabase.from('spaces').insert({
      owner_id: userId,
      name: `${displayName} 的 Atoms`,
      is_default: true,
    });
    // 并发兜底:另一路已建好默认空间时,数据库唯一索引会拦截为 23505,视为已初始化
    if (spaceInsertError && spaceInsertError.code !== '23505') {
      throw new Error(`初始化默认空间失败:${spaceInsertError.message}`);
    }
    const { data: refetchedSpaces, error: refetchError } = await supabase
      .from('spaces')
      .select('*')
      .eq('owner_id', userId)
      .order('is_default', { ascending: false });
    if (refetchError) {
      throw new Error(`读取空间列表失败:${refetchError.message}`);
    }
    return (refetchedSpaces as Space[]) ?? [];
  }

  return (spaces as Space[]) ?? [];
}

export async function fetchRecentConversations(userId: string): Promise<Conversation[]> {
  if (!isSupabaseConfigured) {
    return [...demoConversations]
      .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
      .slice(0, 8);
  }
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(8);
  if (error) {
    throw new Error(`读取最近对话失败:${error.message}`);
  }
  return (data as Conversation[]) ?? [];
}

/** 创建对话;Supabase 报错(RLS/外键/网络)原样抛出,由调用方展示真实原因 */
export async function createConversation(
  userId: string,
  spaceId: string | null,
  title: string,
): Promise<Conversation> {
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
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, space_id: spaceId, title })
    .select()
    .single();
  if (error) {
    throw new Error(`创建对话失败:${error.message}`);
  }
  return data as Conversation;
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
  const { error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, content });
  if (error) {
    throw new Error(`消息写入失败:${error.message}`);
  }
}

/** 拉取某个对话的全部消息(按时间正序),供最近对话联动回放 */
export async function fetchConversationMessages(conversationId: string): Promise<Message[]> {
  if (!isSupabaseConfigured) {
    return demoMessages.filter((m) => m.conversation_id === conversationId);
  }
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`读取对话消息失败:${error.message}`);
  }
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
  /** 生成的单文件应用 HTML(智能体生成/克隆魔改时落库,支持项目预览回放) */
  appHtml?: string;
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
    ...(input.appHtml ? { app_html: input.appHtml } : {}),
  };
  if (!isSupabaseConfigured) {
    const project: Project = { id: demoId('proj'), ...row };
    demoProjects = [project, ...demoProjects];
    return project;
  }
  const { data, error } = await supabase.from('projects').insert(row).select().single();
  if (error) {
    throw new Error(`创建项目失败:${error.message}`);
  }
  return data as Project;
}

export async function fetchProjects(userId: string, favoriteOnly: boolean): Promise<Project[]> {
  if (!isSupabaseConfigured) {
    return demoProjects.filter(
      (p) => p.user_id === userId && (!favoriteOnly || p.favorite),
    );
  }
  let query = supabase.from('projects').select('*').eq('user_id', userId);
  if (favoriteOnly) query = query.eq('favorite', true);
  const { data, error } = await query.order('updated_at', { ascending: false });
  if (error) {
    throw new Error(`读取项目列表失败:${error.message}`);
  }
  return (data as Project[]) ?? [];
}

export async function toggleProjectFavorite(project: Project): Promise<void> {
  if (!isSupabaseConfigured) {
    demoProjects = demoProjects.map((p) =>
      p.id === project.id ? { ...p, favorite: !p.favorite } : p,
    );
    return;
  }
  const { error } = await supabase
    .from('projects')
    .update({ favorite: !project.favorite })
    .eq('id', project.id);
  if (error) {
    throw new Error(`更新收藏状态失败:${error.message}`);
  }
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
