-- T26: 会话归档状态列
-- 口径:归档即置 status='archived',不删除任何 conversations/messages;
-- 恢复方式:UPDATE public.conversations SET status='active' WHERE id=...;
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'));

-- 侧边栏/历史查询按 用户+状态+活跃时间 命中
CREATE INDEX IF NOT EXISTS conversations_user_status_updated_idx
  ON public.conversations (user_id, status, updated_at DESC);
