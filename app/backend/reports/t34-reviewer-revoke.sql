-- T34 评审账号到期回收脚本(幂等,可重复执行)
-- 账号:    t34.reviewer@atoms-demo.dev
-- 创建时间(UTC): 2026-09-22 11:32:03
-- 到期时间(UTC): 2026-09-29 11:32:03  (自创建起 7 天 / 168 小时)
--
-- 使用说明:到期后直接整段执行本脚本即可彻底删除账号及其全部数据;
--           重复执行不会报错,计数会稳定为 0,可作为幂等核验。

begin;

-- 1) 彻底删除(级联删除资料、工作区、会话、消息、项目与版本快照)
with removed as (
  delete from auth.users where email = 't34.reviewer@atoms-demo.dev' returning id
)
select count(*) as auth_users_deleted from removed;

commit;

-- 2) 幂等核验:两个计数均应为 0
select
  (select count(*) from auth.users where email = 't34.reviewer@atoms-demo.dev') as remaining_users,
  (select count(*) from profiles where email = 't34.reviewer@atoms-demo.dev')   as remaining_profiles;

-- 可选:仅临时禁用(可逆),不删除数据
-- update auth.users set banned_until = now() + interval '100 years' where email = 't34.reviewer@atoms-demo.dev';
-- update auth.users set banned_until = null where email = 't34.reviewer@atoms-demo.dev';
