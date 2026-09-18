-- 004: 注册时自动初始化 profile 与默认工作区(DB 触发器)
-- 方案说明(T7):以数据库触发器为主——用户在 auth.users 落库的瞬间即拥有资料与默认工作区;
-- 前端 ensureProfileAndSpace 的幂等 upsert 逻辑保留作为兜底(老账号/触发器异常时仍可自愈)。

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name, email, avatar_color)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, 'developer'), '@', 1)
    ),
    coalesce(new.email, ''),
    (array['bg-violet-500','bg-blue-500','bg-emerald-500','bg-amber-500','bg-rose-500','bg-cyan-500'])
      [1 + (hashtext(new.id::text) % 6)]
  )
  on conflict (id) do nothing;

  -- 默认工作区:与 003 的部分唯一索引 spaces_owner_default_uidx 配合,并发下不产生重复默认空间
  insert into public.spaces (owner_id, name, is_default)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      nullif(new.raw_user_meta_data ->> 'name', ''),
      split_part(coalesce(new.email, 'developer'), '@', 1)
    ) || ' 的 Atoms',
    true
  )
  on conflict (owner_id) where is_default do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
