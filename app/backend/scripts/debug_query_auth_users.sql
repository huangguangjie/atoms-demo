-- 调试:查看 auth.users 最近账号与 auth 错误日志相关配置
select id, email, email_confirmed_at, created_at
from auth.users
order by created_at desc
limit 10;
