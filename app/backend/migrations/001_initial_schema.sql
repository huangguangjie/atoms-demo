-- =============================================================================
-- atoms-demo 初始schema(执行方式:Supabase Management API /database/query)
-- 表:profiles / spaces / projects / conversations / messages / community_apps / templates
-- 规则:用户表关联 auth.users 并启用 RLS;community_apps/templates 公共只读
-- 幂等:可重复执行(重复创建/策略均先 drop)
-- =============================================================================

-- ---------- 1. 表结构 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  avatar_color text not null default 'bg-violet-500',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  name text not null,
  description text,
  source text not null default 'created' check (source in ('created', 'cloned', 'template')),
  favorite boolean not null default false,
  cover_gradient text not null default 'from-violet-500 to-fuchsia-500',
  cover_emoji text not null default '📦',
  views integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid references public.spaces(id) on delete set null,
  title text not null default '新对话',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.community_apps (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  author_name text not null default '',
  category text not null default 'Website',
  views integer not null default 0,
  cover_gradient text not null default 'from-violet-500 to-fuchsia-500',
  cover_emoji text not null default '📦',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.templates (
  id uuid primary key default gen_random_uuid(),
  title text not null unique,
  description text not null default '',
  category text not null default 'Website',
  cover_gradient text not null default 'from-violet-500 to-fuchsia-500',
  cover_emoji text not null default '📦',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_user_idx on public.projects (user_id, updated_at desc);
create index if not exists conversations_user_idx on public.conversations (user_id, updated_at desc);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------- 2. updated_at 维护与对话时间戳联动 ----------
create or replace function public.set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_spaces_updated on public.spaces;
create trigger trg_spaces_updated before update on public.spaces
  for each row execute function public.set_updated_at();

drop trigger if exists trg_projects_updated on public.projects;
create trigger trg_projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_conversations_updated on public.conversations;
create trigger trg_conversations_updated before update on public.conversations
  for each row execute function public.set_updated_at();

drop trigger if exists trg_community_apps_updated on public.community_apps;
create trigger trg_community_apps_updated before update on public.community_apps
  for each row execute function public.set_updated_at();

drop trigger if exists trg_templates_updated on public.templates;
create trigger trg_templates_updated before update on public.templates
  for each row execute function public.set_updated_at();

-- 新消息写入时,联动刷新所属对话的 updated_at(侧边栏「最近对话」排序依据)
create or replace function public.bump_conversation_updated() returns trigger as $$
begin
  update public.conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_messages_bump_conversation on public.messages;
create trigger trg_messages_bump_conversation after insert on public.messages
  for each row execute function public.bump_conversation_updated();

-- ---------- 3. RLS ----------
alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.projects enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.community_apps enable row level security;
alter table public.templates enable row level security;

-- profiles:仅本人可读写
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select using (auth.uid() = id);
drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles for insert with check (auth.uid() = id);
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- spaces:仅属主可读写删
drop policy if exists spaces_select_own on public.spaces;
create policy spaces_select_own on public.spaces for select using (auth.uid() = owner_id);
drop policy if exists spaces_insert_own on public.spaces;
create policy spaces_insert_own on public.spaces for insert with check (auth.uid() = owner_id);
drop policy if exists spaces_update_own on public.spaces;
create policy spaces_update_own on public.spaces for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists spaces_delete_own on public.spaces;
create policy spaces_delete_own on public.spaces for delete using (auth.uid() = owner_id);

-- projects:仅属主可读写删
drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects for select using (auth.uid() = user_id);
drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects for insert with check (auth.uid() = user_id);
drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects for delete using (auth.uid() = user_id);

-- conversations:仅属主可读写删
drop policy if exists conversations_select_own on public.conversations;
create policy conversations_select_own on public.conversations for select using (auth.uid() = user_id);
drop policy if exists conversations_insert_own on public.conversations;
create policy conversations_insert_own on public.conversations for insert with check (auth.uid() = user_id);
drop policy if exists conversations_update_own on public.conversations;
create policy conversations_update_own on public.conversations for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists conversations_delete_own on public.conversations;
create policy conversations_delete_own on public.conversations for delete using (auth.uid() = user_id);

-- messages:经所属对话校验属主
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages for select using (
  exists (select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = auth.uid())
);
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages for insert with check (
  exists (select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = auth.uid())
);
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete using (
  exists (select 1 from public.conversations c where c.id = messages.conversation_id and c.user_id = auth.uid())
);

-- 公共数据:匿名/登录用户均可读;写入仅限 service_role(不建 insert/update 策略)
drop policy if exists community_apps_public_read on public.community_apps;
create policy community_apps_public_read on public.community_apps for select using (true);
drop policy if exists templates_public_read on public.templates;
create policy templates_public_read on public.templates for select using (true);

-- ---------- 4. 种子数据(社区发现 + 模板) ----------
insert into public.community_apps (title, author_name, category, views, cover_gradient, cover_emoji) values
  ('Birthday Matrix Site', 'Nova', 'Website', 434, 'from-emerald-500 to-teal-400', '🎂'),
  ('Simple Calculator', 'Leo', 'Productivity', 191, 'from-slate-600 to-slate-400', '🧮'),
  ('2D Platformer Game', 'Mika', 'Game', 512, 'from-blue-500 to-cyan-400', '🎮'),
  ('Selling Digital Products', 'Ivy', 'E-commerce', 289, 'from-amber-500 to-orange-500', '🛍️'),
  ('Westershire Intranet', 'Owen', 'Website', 167, 'from-indigo-500 to-sky-400', '🏢'),
  ('tideline', 'Reef', 'Blog', 203, 'from-cyan-500 to-blue-500', '🌊'),
  ('3B modeller', 'Kai', 'Prototype', 356, 'from-violet-500 to-fuchsia-500', '🧊'),
  ('Growth Data Dashboard', 'Chen', 'Data Analysis', 421, 'from-rose-500 to-pink-500', '📊')
on conflict (title) do nothing;

insert into public.templates (title, description, category, cover_gradient, cover_emoji) values
  ('Landing Page Kit', '现代 SaaS 落地页模板,含 Hero、功能、定价与 FAQ 区块,替换文案即可上线。', 'Website', 'from-blue-500 to-cyan-400', '🚀'),
  ('E-commerce Starter', '含商品列表、购物车与订单流的电商基础方案,占位数据可直接替换为你的商品。', 'E-commerce', 'from-amber-500 to-orange-500', '🛒'),
  ('Dashboard Starter', '数据看板模板,内置图表卡片网格与侧边导航,适合快速搭建管理后台。', 'Productivity', 'from-violet-500 to-fuchsia-500', '📈'),
  ('Blog Starter', '极简博客模板,支持文章列表与详情页,替换 Markdown 内容即可发布。', 'Blog', 'from-emerald-500 to-teal-400', '✍️'),
  ('Game Starter', 'Canvas 小游戏骨架,含主循环、计分与开始/结束界面,替换素材即可扩展。', 'Game', 'from-indigo-500 to-sky-400', '🕹️'),
  ('Business Card', '个人名片页模板,含头像、社交链接与联系表单,适合快速展示个人品牌。', 'Business Card', 'from-rose-500 to-pink-500', '💼')
on conflict (title) do nothing;
