-- 003: 默认空间唯一性约束(配合前端幂等初始化)
-- 场景:登录会话恢复与登录回调可能并发触发默认空间创建,缺少唯一约束时理论上可产生重复默认空间。
-- 先清理历史重复默认空间(每个用户保留最早创建的一条),再建立「每个用户至多一个默认空间」的部分唯一索引。

delete from public.spaces s
using public.spaces older
where s.owner_id = older.owner_id
  and s.is_default = true
  and older.is_default = true
  and (
    s.created_at > older.created_at
    or (s.created_at = older.created_at and s.id > older.id)
  );

create unique index if not exists spaces_owner_default_uidx
  on public.spaces (owner_id)
  where is_default;
