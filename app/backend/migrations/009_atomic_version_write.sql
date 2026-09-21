-- 009: T31 版本写入原子化
-- 背景:此前「更新 projects.app_html」与「插入 project_versions 快照」是两次独立 REST 调用,
-- 任一步失败(唯一约束冲突 / 网络中断 / 权限抖动)都会留下半写状态:
--   a) 项目内容已更新但版本快照缺失(版本链与当前内容不一致)
--   b) 客户端自行算号(最新+1)在并发/重试下撞 UNIQUE(project_id, version_number)
-- 本迁移提供单事务 RPC:同一事务内锁项目行 → 分配权威版本号 → 更新项目产物 → 写入版本快照,
-- 任一步失败整体回滚,项目内容与版本快照永远一致。
BEGIN;

CREATE OR REPLACE FUNCTION public.app_write_project_version(
    p_project_id uuid,
    p_source text,
    p_label text,
    p_app_html text,
    p_version_number integer DEFAULT NULL,
    p_is_demo boolean DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_owner uuid;
    v_next integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION '未登录,无法写入版本记录' USING ERRCODE = '28000';
    END IF;

    -- 行锁:同一项目的并发写入串行化,消除「客户端算号」竞态
    SELECT user_id INTO v_owner FROM public.projects WHERE id = p_project_id FOR UPDATE;
    IF v_owner IS NULL THEN
        RAISE EXCEPTION '项目不存在或无权访问' USING ERRCODE = 'P0002';
    END IF;
    IF v_owner <> v_uid THEN
        RAISE EXCEPTION '无权写入他人项目的版本记录' USING ERRCODE = '42501';
    END IF;

    IF p_source IS NULL OR p_source NOT IN ('generation', 'edit', 'rollback') THEN
        RAISE EXCEPTION '非法版本来源:%', p_source USING ERRCODE = '22023';
    END IF;

    -- 版本号权威分配:默认取当前最大版本号 + 1(行锁保护下无竞态);
    -- 显式传入时沿用传入值,冲突由 UNIQUE(project_id, version_number) 拦截并整体回滚
    IF p_version_number IS NULL THEN
        SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next
        FROM public.project_versions WHERE project_id = p_project_id;
    ELSE
        v_next := p_version_number;
    END IF;

    IF p_is_demo IS NULL THEN
        UPDATE public.projects SET app_html = p_app_html
        WHERE id = p_project_id AND user_id = v_uid;
    ELSE
        UPDATE public.projects SET app_html = p_app_html, is_demo = p_is_demo
        WHERE id = p_project_id AND user_id = v_uid;
    END IF;

    INSERT INTO public.project_versions (project_id, user_id, version_number, source, label, app_html)
    VALUES (p_project_id, v_uid, v_next, p_source, COALESCE(p_label, ''), p_app_html);

    RETURN v_next;
END;
$$;

GRANT EXECUTE ON FUNCTION public.app_write_project_version(uuid, text, text, text, integer, boolean) TO authenticated;

COMMIT;
