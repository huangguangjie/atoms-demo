-- T32 线上核验:009 原子版本 RPC 的真实部署状态与版本/快照一致性
-- 说明:Management API 仅回传最后一条语句的结果,故全部核验收敛为「单条语句 → 单行结果」。
-- 判定口径(逐列):
--   fn_count = 1                    函数已部署且无同名重载
--   identity_args                  真实参数名与顺序(须与前端 rpc 调用键一致)
--   security_mode                  SECURITY DEFINER(函数内自行校验 auth.uid())
--   auth_can_execute = true        登录角色具备 EXECUTE 权限
--   inconsistent_projects = 0      无半写:项目 app_html 恒等于最新快照
--   version_gap_projects = 0       版本号从 1 起连续、无跳号无重复(失败不占号)
--   orphan_snapshots = 0           无孤儿快照(失败未留残骸)
--   empty_snapshots = 0            无空快照
with fn as (
  select p.oid,
         pg_get_function_identity_arguments(p.oid) as identity_args,
         pg_get_function_arguments(p.oid)          as full_args,
         case when p.prosecdef then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security_mode,
         p.provolatile                              as volatility,
         pg_get_functiondef(p.oid)                  as function_def,
         coalesce(array_to_string(p.proacl, ' | '), '(default: owner only)') as acl,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'app_write_project_version'
),
-- 半写判定口径:仅考察「已有版本快照」的项目,即必须经 RPC 写入过的项目。
-- 零版本项目(认证走查脚本直接 REST 建的占位夹具、或版本化之前的历史项目)不属半写,
-- 单独以 no_version_projects 计数以便观察。
inconsistent as (
  select count(*) as c
  from public.projects pr
  where pr.app_html is not null
    and exists (select 1 from public.project_versions v where v.project_id = pr.id)
    and pr.app_html <> coalesce((
      select v.app_html from public.project_versions v
      where v.project_id = pr.id order by v.version_number desc limit 1), '')
),
no_version as (
  select count(*) as c
  from public.projects pr
  where pr.app_html is not null
    and not exists (select 1 from public.project_versions v where v.project_id = pr.id)
),
gaps as (
  select count(*) as c from (
    select project_id
    from public.project_versions
    group by project_id
    having max(version_number) <> count(*) or min(version_number) <> 1
  ) t
),
orphans as (
  select count(*) as c from public.project_versions v
  where not exists (select 1 from public.projects pr where pr.id = v.project_id)
)
-- 小字段在前、长文本(function_def)在最后,避免 Management API 回传被截断
select
  (select count(*) from fn)                        as fn_count,
  (select security_mode from fn limit 1)           as security_mode,
  (select auth_can_execute from fn limit 1)        as auth_can_execute,
  (select identity_args from fn limit 1)           as identity_args,
  (select c from inconsistent)                     as inconsistent_projects,
  (select c from gaps)                             as version_gap_projects,
  (select c from orphans)                          as orphan_snapshots,
  (select c from no_version)                       as no_version_projects,
  (select count(*) from public.project_versions where coalesce(app_html, '') = '') as empty_snapshots,
  (select count(*) from public.project_versions)   as total_snapshots,
  (select count(*) from public.projects)           as total_projects,
  (select acl from fn limit 1)                     as function_acl,
  (select full_args from fn limit 1)               as full_args,
  (select function_def from fn limit 1)            as function_def;
