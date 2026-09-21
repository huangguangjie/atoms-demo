-- =============================================================================
-- T16:项目与会话关联(线上已通过 Management API 执行,本文件补齐迁移记录,便于环境重建)
-- projects 新增 conversation_id:详情页刷新后按会话回放生成应用(fetchConversationProject)
-- 幂等:可重复执行;RLS 沿用 001 的属主策略,无需新增
-- 口径:会话删除时置 null(不级联删除项目),与 space_id 一致
-- =============================================================================

alter table public.projects
  add column if not exists conversation_id uuid
  references public.conversations(id) on delete set null;

-- 详情页按会话查关联项目的命中索引
create index if not exists projects_conversation_idx
  on public.projects (conversation_id);
