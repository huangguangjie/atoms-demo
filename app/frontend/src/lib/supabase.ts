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
  /** T16:关联的来源会话(id),详情页刷新后按会话回放生成应用 */
  conversation_id?: string | null;
  /** 生成的单文件应用 HTML,项目预览回放用 */
  app_html?: string | null;
  /** T25:项目级演示模式标记(刷新恢复后查看器徽标与项目描述保持一致) */
  is_demo?: boolean;
}

export interface Conversation {
  id: string;
  user_id: string;
  space_id: string | null;
  title: string;
  /** 收藏标记:侧边栏最近对话收藏项优先展示(T10) */
  is_favorite?: boolean;
  updated_at?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  /** T25:消息级元数据(演示模式标记等),持久化后刷新回放仍保持展示一致 */
  metadata?: MessageMeta | null;
}

/** T25:消息元数据(isDemo=演示模式产物;plan=执行计划步骤,刷新回放恢复徽标与计划卡) */
export interface MessageMeta {
  isDemo?: boolean;
  plan?: string[];
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

/** T25:演示模式(未配置 Supabase)的内存版本历史 */
const demoVersions = new Map<string, ProjectVersion[]>();

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

/** 新建工作区(云端落库 spaces,is_default=false,不影响默认工作区唯一索引) */
export async function createSpace(userId: string, name: string): Promise<Space> {
  if (!isSupabaseConfigured) {
    return { id: demoId('space'), owner_id: userId, name, is_default: false };
  }
  const { data, error } = await supabase
    .from('spaces')
    .insert({ owner_id: userId, name, is_default: false })
    .select()
    .single();
  if (error) {
    throw new Error(`创建工作区失败:${error.message}`);
  }
  return data as Space;
}

/** 最近对话:用户维度 + 可选工作区过滤(切换工作区后仅展示该工作区下的会话) */
export async function fetchRecentConversations(
  userId: string,
  spaceId?: string,
): Promise<Conversation[]> {
  if (!isSupabaseConfigured) {
    return demoConversations
      .filter((c) => !spaceId || c.space_id === spaceId)
      .sort((a, b) => {
        const fav = Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite));
        if (fav !== 0) return fav;
        return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
      })
      .slice(0, 8);
  }
  let query = supabase.from('conversations').select('*').eq('user_id', userId);
  if (spaceId) query = query.eq('space_id', spaceId);
  const { data, error } = await query
    .order('is_favorite', { ascending: false })
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
  metadata?: MessageMeta,
): Promise<void> {
  if (!isSupabaseConfigured) {
    demoMessages = [
      ...demoMessages,
      { id: demoId('msg'), conversation_id: conversationId, role, content, metadata: metadata ?? null },
    ];
    return;
  }
  const { error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, role, content, ...(metadata ? { metadata } : {}) });
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

/** 读取单个对话(详情页顶栏标题使用;RLS 保证只能读到自己的会话) */
export async function fetchConversation(conversationId: string): Promise<Conversation | null> {
  if (!isSupabaseConfigured) {
    return demoConversations.find((c) => c.id === conversationId) ?? null;
  }
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) {
    throw new Error(`读取对话失败:${error.message}`);
  }
  return (data as Conversation) ?? null;
}

/** 重命名对话:真实落库(失败显式抛错,由调用方 toast 透出) */
export async function renameConversation(
  userId: string,
  conversationId: string,
  title: string,
): Promise<void> {
  if (!isSupabaseConfigured) {
    demoConversations = demoConversations.map((c) =>
      c.id === conversationId && c.user_id === userId
        ? { ...c, title, updated_at: new Date().toISOString() }
        : c,
    );
    return;
  }
  const { error } = await supabase
    .from('conversations')
    .update({ title })
    .eq('id', conversationId)
    .eq('user_id', userId);
  if (error) {
    throw new Error(`重命名对话失败:${error.message}`);
  }
}

/** 收藏/取消收藏对话:真实落库,收藏项在最近列表中优先展示 */
export async function setConversationFavorite(
  userId: string,
  conversationId: string,
  favorite: boolean,
): Promise<void> {
  if (!isSupabaseConfigured) {
    demoConversations = demoConversations.map((c) =>
      c.id === conversationId && c.user_id === userId ? { ...c, is_favorite: favorite } : c,
    );
    return;
  }
  const { error } = await supabase
    .from('conversations')
    .update({ is_favorite: favorite })
    .eq('id', conversationId)
    .eq('user_id', userId);
  if (error) {
    throw new Error(`收藏操作失败:${error.message}`);
  }
}

/** 删除对话:消息随外键级联删除,失败显式抛错 */
export async function deleteConversation(userId: string, conversationId: string): Promise<void> {
  if (!isSupabaseConfigured) {
    demoConversations = demoConversations.filter(
      (c) => !(c.id === conversationId && c.user_id === userId),
    );
    demoMessages = demoMessages.filter((m) => m.conversation_id !== conversationId);
    return;
  }
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', userId);
  if (error) {
    throw new Error(`删除对话失败:${error.message}`);
  }
}

/** T16:读取会话关联的生成项目(详情页刷新后回放应用查看器) */
export async function fetchConversationProject(
  conversationId: string,
  userId: string,
): Promise<Project | null> {
  if (!isSupabaseConfigured) {
    return demoProjects.find((p) => p.user_id === userId && p.conversation_id === conversationId) ?? null;
  }
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) {
    throw new Error(`读取会话关联项目失败:${error.message}`);
  }
  return (data as Project[])[0] ?? null;
}

export interface CreateProjectInput {
  userId: string;
  spaceId: string | null;
  name: string;
  description?: string | null;
  source: ProjectSource;
  coverGradient?: string;
  coverEmoji?: string;
  /** T16:来源会话 id(生成应用落库时关联,详情页刷新可回放) */
  conversationId?: string | null;
  /** 生成的单文件应用 HTML(智能体生成/克隆魔改时落库,支持项目预览回放) */
  appHtml?: string;
  /** T25:演示模式产物标记(项目页与详情页回放时徽标一致) */
  isDemo?: boolean;
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
    conversation_id: input.conversationId ?? null,
    is_demo: input.isDemo ?? false,
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

// ---------------------------------------------------------------------------
// T25:项目产物版本历史(版本号/来源/标签/app_html 快照)
// ---------------------------------------------------------------------------

export type ProjectVersionSource = 'generation' | 'edit' | 'rollback';

export interface ProjectVersion {
  id: string;
  project_id: string;
  version_number: number;
  source: ProjectVersionSource;
  label: string;
  app_html: string;
  created_at: string;
}

export const PROJECT_VERSION_SOURCE_LABEL: Record<ProjectVersionSource, string> = {
  generation: '生成',
  edit: '修改',
  rollback: '回滚',
};

/**
 * 读取项目版本历史(版本号倒序;RLS 保证只能读到自己的项目版本)
 * T25 韧性:刷新恢复阶段偶发出现请求已发出但长期无响应(浏览器侧连接被占用/网关挂起),
 * 导致版本面板停留在「暂无版本记录」。仅用 Promise.race 计时并不会取消底层请求,
 * 挂起的连接会一直占用同一 host 的连接池,后续重试同样排队,表现为「永远拿不到数据」。
 * 这里改为 AbortController + abortSignal 真正中断超时请求,释放连接后再重试(最多 3 次)。
 */
export async function fetchProjectVersions(projectId: string): Promise<ProjectVersion[]> {
  if (!isSupabaseConfigured) {
    return (demoVersions.get(projectId) ?? [])
      .slice()
      .sort((a, b) => b.version_number - a.version_number);
  }

  const attemptOnce = async (): Promise<ProjectVersion[]> => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    try {
      const { data, error } = await supabase
        .from('project_versions')
        .select('id, project_id, version_number, source, label, app_html, created_at')
        .eq('project_id', projectId)
        .order('version_number', { ascending: false })
        .abortSignal(controller.signal);
      if (error) throw new Error(error.message);
      return (data as ProjectVersion[]) ?? [];
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('请求超时(4s,已中断重试)');
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  };

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await attemptOnce();
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 300));
      }
    }
  }
  throw new Error(`读取版本历史失败:${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** 写入一条版本快照(版本号由调用方按最新版本 + 1 递增,数据库唯一约束兜底) */
export async function insertProjectVersion(input: {
  projectId: string;
  userId: string;
  versionNumber: number;
  source: ProjectVersionSource;
  label: string;
  appHtml: string;
}): Promise<void> {
  if (!isSupabaseConfigured) {
    const list = demoVersions.get(input.projectId) ?? [];
    demoVersions.set(input.projectId, [
      ...list,
      {
        id: demoId('ver'),
        project_id: input.projectId,
        version_number: input.versionNumber,
        source: input.source,
        label: input.label,
        app_html: input.appHtml,
        created_at: new Date().toISOString(),
      },
    ]);
    return;
  }
  const { error } = await supabase.from('project_versions').insert({
    project_id: input.projectId,
    user_id: input.userId,
    version_number: input.versionNumber,
    source: input.source,
    label: input.label,
    app_html: input.appHtml,
  });
  if (error) {
    throw new Error(`写入版本记录失败:${error.message}`);
  }
}

/** 更新项目当前产物(增量修改/回滚/在线编辑后同步 projects.app_html) */
export async function updateProjectAppHtml(
  projectId: string,
  appHtml: string,
  isDemo?: boolean,
): Promise<void> {
  const patch: Record<string, unknown> = { app_html: appHtml };
  if (isDemo !== undefined) patch.is_demo = isDemo;
  if (!isSupabaseConfigured) {
    demoProjects = demoProjects.map((p) =>
      p.id === projectId ? { ...p, ...patch } as Project : p,
    );
    return;
  }
  const { error } = await supabase.from('projects').update(patch).eq('id', projectId);
  if (error) {
    throw new Error(`更新项目产物失败:${error.message}`);
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
