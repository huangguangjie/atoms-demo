-- =============================================================================
-- T10:对话历史 hover 操作(收藏/重命名/删除)
-- conversations 新增 is_favorite:侧边栏最近对话收藏标记,收藏项优先展示
-- 幂等:可重复执行;RLS 沿用 001 的属主 update/delete 策略,无需新增
-- =============================================================================

alter table public.conversations add column if not exists is_favorite boolean not null default false;

-- 侧边栏排序索引:收藏优先,其余按 updated_at 倒序
create index if not exists conversations_user_fav_idx
  on public.conversations (user_id, is_favorite desc, updated_at desc);
