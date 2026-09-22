-- T32 评审账号回收执行脚本(不可逆)
-- 账号: t31.reviewer@atoms-demo.dev
-- 采用彻底删除方案:级联清理该账号的资料、工作区、会话、消息、项目与版本快照。
-- 关联口径(messages 无 user_id,经 conversation_id 归属):
--   messages.conversation_id -> conversations.id -> conversations.user_id
-- 回收后重复执行本脚本应为幂等(各项删除计数为 0)。
with target as (
  select id from auth.users where email = 't31.reviewer@atoms-demo.dev'
),
del_messages as (
  delete from public.messages
  where conversation_id in (select id from public.conversations where user_id in (select id from target))
  returning 1
),
del_versions as (
  delete from public.project_versions where user_id in (select id from target) returning 1
),
del_projects as (
  delete from public.projects where user_id in (select id from target) returning 1
),
del_conversations as (
  delete from public.conversations where user_id in (select id from target) returning 1
),
del_spaces as (
  delete from public.spaces where owner_id in (select id from target) returning 1
),
del_profiles as (
  delete from public.profiles where id in (select id from target) returning 1
),
del_user as (
  delete from auth.users where id in (select id from target) returning 1
)
select
  (select count(*) from del_messages)      as messages_deleted,
  (select count(*) from del_versions)      as versions_deleted,
  (select count(*) from del_projects)      as projects_deleted,
  (select count(*) from del_conversations) as conversations_deleted,
  (select count(*) from del_spaces)        as spaces_deleted,
  (select count(*) from del_profiles)      as profiles_deleted,
  (select count(*) from del_user)          as auth_users_deleted,
  (select count(*) from auth.users where email = 't31.reviewer@atoms-demo.dev') as remaining_users;
