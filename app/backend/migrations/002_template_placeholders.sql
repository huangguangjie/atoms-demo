-- =============================================================================
-- atoms-demo 迁移 002:模板占位字段(模板占位内容替换生成应用)
-- 1) templates 增加 placeholders jsonb 列(公共只读数据,写入仅限 service_role)
-- 2) 为 6 个种子模板写入占位字段定义(key/label/description/default_value)
--    占位 key 与前端 demo-apps.ts 的占位注册保持一致,替换值会真实体现在生成结果中
-- 幂等:可重复执行(列 add if not exists,种子按 title 覆盖更新)
-- =============================================================================

alter table public.templates add column if not exists placeholders jsonb not null default '[]'::jsonb;

update public.templates set placeholders = '[
  {"key":"brand_name","label":"产品名称","description":"用于导航栏 Logo、页脚与产品介绍","default_value":"Landing Page Kit"},
  {"key":"hero_slogan","label":"主标语","description":"首页 Hero 区的大标题文案","default_value":"让团队协作快人一步"},
  {"key":"hero_desc","label":"产品简介","description":"Hero 区一句话介绍你的产品价值","default_value":"帮你把想法变成可执行的任务流,实时同步、自动提醒,团队效率提升 3 倍。"},
  {"key":"price_pro","label":"专业版定价","description":"展示为「¥xx/人/月」,填数字即可","default_value":"68"}
]'::jsonb
where title = 'Landing Page Kit';

update public.templates set placeholders = '[
  {"key":"shop_name","label":"店铺名称","description":"页面标题与品牌展示位","default_value":"E-commerce Starter"},
  {"key":"total_revenue","label":"总收入金额","description":"看板「总收入」指标卡金额","default_value":"¥ 128,460"}
]'::jsonb
where title = 'E-commerce Starter';

update public.templates set placeholders = '[
  {"key":"dashboard_title","label":"看板名称","description":"看板页大标题","default_value":"Dashboard Starter"},
  {"key":"kpi_revenue","label":"总收入指标","description":"「总收入」指标卡金额","default_value":"¥ 128,460"},
  {"key":"kpi_users","label":"新增用户指标","description":"「新增用户」指标卡数值","default_value":"3,208"}
]'::jsonb
where title = 'Dashboard Starter';

update public.templates set placeholders = '[
  {"key":"blog_name","label":"博客名称","description":"博客标题与首篇文章卡片中的展示名","default_value":"Blog Starter"},
  {"key":"first_post_intro","label":"首篇文章简介","description":"默认第一篇博文的正文内容","default_value":"这是我用 Atoms 智能体生成的第一个应用,点击卡片可以编辑,右上角 × 可以删除。"}
]'::jsonb
where title = 'Blog Starter';

update public.templates set placeholders = '[
  {"key":"game_name","label":"游戏名称","description":"页面标题与展示名","default_value":"Game Starter"}
]'::jsonb
where title = 'Game Starter';

update public.templates set placeholders = '[
  {"key":"person_name","label":"姓名/品牌名","description":"名片页 Logo、页脚与自我介绍中使用","default_value":"Business Card"},
  {"key":"personal_tagline","label":"个人标语","description":"名片页大标题一句话","default_value":"让团队协作快人一步"},
  {"key":"personal_intro","label":"个人简介","description":"名片页副标题,介绍你自己","default_value":"帮你把想法变成可执行的任务流,实时同步、自动提醒,团队效率提升 3 倍。"}
]'::jsonb
where title = 'Business Card';
