-- T32 追查:定位「projects.app_html 与最新快照不一致」的项目来源
-- 口径:输出紧凑明细,避免 Management API 回传截断(不含 app_html 正文,仅长度与摘要)
select coalesce(json_agg(t order by t.updated_at desc), '[]'::json) as inconsistent_detail
from (
  select
    pr.id::text                                     as project_id,
    left(coalesce(pr.name, ''), 40)                 as name,
    coalesce(pr.source, '')                         as source,
    pr.is_demo                                      as is_demo,
    pr.conversation_id is not null                  as linked,
    length(coalesce(pr.app_html, ''))               as project_html_len,
    (select count(*) from public.project_versions v where v.project_id = pr.id) as version_count,
    (select max(v.version_number) from public.project_versions v where v.project_id = pr.id) as max_version,
    (select length(coalesce(v.app_html, '')) from public.project_versions v
       where v.project_id = pr.id order by v.version_number desc limit 1) as latest_snapshot_len,
    (select v.created_at from public.project_versions v
       where v.project_id = pr.id order by v.version_number desc limit 1) as latest_snapshot_at,
    pr.updated_at,
    -- 判定:项目内容是否等于任意历史快照(相等 ⇒ 仅版本号缺失,非内容损坏)
    exists (select 1 from public.project_versions v
              where v.project_id = pr.id and v.app_html = pr.app_html) as matches_some_snapshot
  from public.projects pr
  where pr.app_html is not null
    and pr.app_html <> coalesce((
      select v.app_html from public.project_versions v
      where v.project_id = pr.id order by v.version_number desc limit 1), '')
) t;
