-- T26: 一次性归档清理(仅本人账号 huangguangjie2021@gmail.com)
-- 口径:
--   1. 仅处理该账号,其他账号一律不触碰;
--   2. 保留该账号 status='active' 会话中按 updated_at 倒序的最近 5 条;
--   3. 收藏会话(is_favorite = true)无条件保留,不参与"最近 5 条"名额裁剪;
--   4. 其余会话置 status='archived',不删除 conversations/messages,不修改 projects;
--   5. 临时禁用 updated_at 触发器,避免归档动作本身改写活跃时间影响排序。
-- 恢复单个会话: UPDATE public.conversations SET status='active' WHERE id='<uuid>';

BEGIN;

ALTER TABLE public.conversations DISABLE TRIGGER trg_conversations_updated;

UPDATE public.conversations c
SET status = 'archived'
WHERE c.user_id = (SELECT id FROM auth.users WHERE email = 'huangguangjie2021@gmail.com')
  AND c.status = 'active'
  AND c.is_favorite = false
  AND c.id NOT IN (
    SELECT id
    FROM public.conversations
    WHERE user_id = (SELECT id FROM auth.users WHERE email = 'huangguangjie2021@gmail.com')
      AND status = 'active'
    ORDER BY updated_at DESC
    LIMIT 5
  );

ALTER TABLE public.conversations ENABLE TRIGGER trg_conversations_updated;

COMMIT;

-- 执行前:6 条 active / 0 条收藏 / 0 条 archived
-- 执行后:5 条 active / 0 条 archived -> 1 条 archived(最早一条「帮我设计一个贪吃蛇游戏。」)
-- 核验:SELECT c.title, c.status, c.is_favorite, c.updated_at
--       FROM public.conversations c JOIN auth.users u ON u.id = c.user_id
--       WHERE u.email = 'huangguangjie2021@gmail.com' ORDER BY c.updated_at DESC;
