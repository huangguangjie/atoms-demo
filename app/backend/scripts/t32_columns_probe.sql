-- T32 探测:回收脚本所需的真实列结构(messages 是否以 conversation_id 关联)
select coalesce(json_agg(t), '[]'::json) as columns
from (
  select table_name, string_agg(column_name, ', ' order by ordinal_position) as cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('messages', 'conversations', 'projects', 'project_versions', 'spaces', 'profiles')
  group by table_name
  order by table_name
) t;
