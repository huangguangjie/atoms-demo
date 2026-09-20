-- 006: T25 项目产物版本历史 + 演示模式元数据持久化
-- 1) project_versions:项目产物版本记录(版本号/来源/标签/app_html 快照)
-- 2) messages.metadata:消息级元数据(演示模式标记等),修复刷新回放后展示一致性
-- 3) projects.is_demo:项目级演示模式标记,刷新恢复查看器徽标
-- 4) 存量项目 app_html 回填为 v1 基线版本
BEGIN;

CREATE TABLE IF NOT EXISTS project_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id uuid NOT NULL,
    version_number integer NOT NULL,
    source text NOT NULL CHECK (source IN ('generation', 'edit', 'rollback')),
    label text NOT NULL DEFAULT '',
    app_html text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_project_versions_project
    ON project_versions(project_id, version_number DESC);

ALTER TABLE project_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "versions_select_own" ON project_versions
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "versions_insert_own" ON project_versions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata jsonb;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

INSERT INTO project_versions (project_id, user_id, version_number, source, label, app_html)
SELECT p.id, p.user_id, 1, 'generation', '历史产物迁移为 v1 基线', p.app_html
FROM projects p
WHERE p.app_html IS NOT NULL
ON CONFLICT (project_id, version_number) DO NOTHING;

COMMIT;
