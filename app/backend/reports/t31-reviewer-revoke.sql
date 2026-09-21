-- T31 评审账号回收脚本(评审结束后按需执行)
-- 账号: t31.reviewer@atoms-demo.dev  有效期至(UTC): 2026-09-22T12:10:42.896286+00:00

-- 1) 临时禁用(可逆):将用户置于封禁状态,登录立即失败,数据保留
-- update auth.users set banned_until = now() + interval '100 years' where email = 't31.reviewer@atoms-demo.dev';

-- 2) 恢复启用
-- update auth.users set banned_until = null where email = 't31.reviewer@atoms-demo.dev';

-- 3) 彻底删除(不可逆):级联删除该账号的资料、工作区、会话、消息、项目与版本快照
-- delete from auth.users where email = 't31.reviewer@atoms-demo.dev';

-- 核对
-- select u.email, u.banned_until, (select count(*) from projects p where p.user_id = u.id) as projects
-- from auth.users u where u.email = 't31.reviewer@atoms-demo.dev';
