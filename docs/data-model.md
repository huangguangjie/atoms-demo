# 数据模型文档

> 状态:**已建**。Supabase 项目已连接(`pofchtyjqwevchiiqags`),建表、RLS、触发器、索引与种子数据均已通过
> `app/backend/migrations/` 迁移脚本(经 Management API 执行);前端已配置 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`。
> 演示模式(内存数据)仅作为本地未配置环境变量时的兜底。

## 1. 实体总览

| 实体(表名) | 类型 | 归属 | RLS 策略概述 |
|------|------|------|------|
| profiles | 用户扩展 | 每用户 | 仅本人读写(`auth.uid() = id`) |
| spaces | 空间 | 每用户 | 仅属主读写删(`owner_id`) |
| projects | 项目 | 每用户 | 仅属主读写删(`user_id`) |
| conversations | 会话 | 每用户 | 仅属主读写删(`user_id`) |
| messages | 消息 | 每用户(随会话) | 经所属会话校验属主 |
| community_apps | 社区应用 | 公共数据 | 所有人可读,认证用户可写 |
| templates | 模板 | 公共数据 | 所有人可读,认证用户可写 |

约束:用户体系复用 Supabase `auth.users`,**不自建用户表**;`profiles` 仅作为 `auth.users` 的扩展信息。

迁移文件:
- `app/backend/migrations/001_initial_schema.sql`:建表、`updated_at` 触发器、会话时间戳联动、RLS、索引、种子数据。
- `app/backend/migrations/002_add_app_html.sql`:`projects` 新增 `app_html` 列。
- `app/backend/migrations/002_template_placeholders.sql`:`templates` 新增 `placeholders` JSONB 列并写入占位种子数据。
- `app/backend/migrations/003_space_default_unique.sql`:每个用户默认空间唯一(部分唯一索引),并清理历史重复默认空间。
- `app/backend/migrations/004_user_init_trigger.sql`:`auth.users` 插入触发器 `handle_new_user`,注册瞬间自动创建资料与默认空间;前端 `ensureProfileAndSpace` 的幂等 upsert 保留为老账号/异常场景的兜底。

## 2. 实体定义

### 2.1 profiles(用户扩展)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键,= `auth.users.id`,级联删除 |
| display_name | text | 显示名,默认 '' |
| email | text | 邮箱,默认 '' |
| avatar_color | text | 头像背景色(Tailwind 类),默认 `bg-violet-500` |

### 2.2 spaces(空间)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键(gen_random_uuid) |
| owner_id | uuid | → `auth.users.id` |
| name | text | 空间名;注册时由触发器自动创建「<用户名> 的 Atoms」默认空间,后续可在侧边栏新建 |
| is_default | boolean | 是否默认空间;每人仅一个 `true`(003 部分唯一索引约束) |

工作区语义:会话(`conversations`)与项目(`projects`)通过 `space_id` 归属工作区;侧边栏「最近对话」按当前工作区过滤,切换工作区即切换会话视图,不同工作区数据互不可见。

### 2.3 projects(项目)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | → `auth.users.id` |
| space_id | uuid | → `spaces.id`,可空(删除空间置 null) |
| name | text | 项目名 |
| description | text | 项目描述 |
| source | text | 来源:`created` / `cloned` / `template` |
| favorite | boolean | 是否收藏,默认 false |
| cover_gradient | text | 封面渐变(Tailwind 类) |
| cover_emoji | text | 封面 emoji |
| views | integer | 浏览数,默认 0 |
| app_html | text | 单文件应用 HTML(002 迁移新增),首页预览分栏与项目页回放 iframe 的数据源 |

### 2.4 conversations(会话)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | → `auth.users.id` |
| space_id | uuid | → `spaces.id`;会话始终归属当前工作区(首页发起对话写入 `currentSpace.id`,无工作区时被守卫拦截) |
| title | text | 会话标题,默认「新对话」(首条提示词摘要) |

`updated_at` 由 messages 插入触发器自动刷新,作为侧边栏「最近对话」排序依据。

### 2.5 messages(消息)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| conversation_id | uuid | → `conversations.id`,级联删除 |
| role | text | `user` / `assistant` |
| content | text | 消息文本;assistant 消息可含计划与代码进度标记,会话回放时按事件协议解析 |

### 2.6 community_apps(社区应用,公共)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| title | text | 应用名,唯一 |
| author_name | text | 作者名 |
| category | text | 分类,默认 Website |
| views | integer | 浏览数 |
| cover_gradient / cover_emoji | text | 封面渐变与 emoji |

### 2.7 templates(模板,公共)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| title | text | 模板名,唯一 |
| description | text | 描述 |
| category | text | 分类(Website / E-commerce / Productivity / Blog / Game / Business Card) |
| cover_gradient / cover_emoji | text | 封面渐变与 emoji |
| placeholders | jsonb | 占位字段定义数组(002 迁移新增),可空 |

`placeholders` 元素结构:

```json
{
  "key": "brand_name",
  "label": "产品名称",
  "description": "用于导航栏 Logo、页脚与产品介绍",
  "default_value": "Landing Page Kit"
}
```

- `key`:占位键,与前端 `applyTemplateValues` 的替换映射对应。
- `label` / `description`:占位填写弹窗的表单文案。
- `default_value`:默认值,留空提交时保留默认内容。

6 条种子模板的占位字段数:Landing Page Kit(4)、E-commerce Starter(2)、Dashboard Starter(3)、Blog Starter(2)、Game Starter(1)、Business Card(3)。

## 3. RLS 策略与触发器

- 用户表启用 RLS:
  - profiles:`auth.uid() = id` 的 SELECT/INSERT/UPDATE。
  - spaces/projects/conversations:`auth.uid() = owner_id|user_id` 的 SELECT/INSERT/UPDATE/DELETE。
  - messages:`exists (select 1 from conversations c where c.id = messages.conversation_id and c.user_id = auth.uid())` 的 SELECT/INSERT/UPDATE。
- 公共表(community_apps、templates)启用 RLS:SELECT 对所有人开放(`using (true)`);写入仅限认证用户。
- 触发器:全部表 `updated_at` 自动维护;messages 插入后联动刷新所属 conversations 的 `updated_at`(security definer);`auth.users` 新增用户时 `handle_new_user`(security definer)自动创建 profiles 与默认 spaces,`on conflict do nothing` 配合 003 唯一索引保证幂等且防并发重复。
- 索引:`projects(user_id, updated_at desc)`、`conversations(user_id, updated_at desc)`、`messages(conversation_id, created_at)`。

## 4. 前端数据访问与演示模式

- 统一门面:`src/lib/supabase.ts`。`isSupabaseConfigured`(依据 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`)决定远程或演示分支;两分支返回同构实体,页面无感。
- 演示模式:内存数据兜底,仅用于未配置环境变量的本地预览,刷新即失。
- 跨组件刷新:生成/收藏等变更广播 `atoms:projects-updated` / `atoms:conversations-updated`,项目页与侧边栏监听刷新(远程模式下触发重新拉取)。

## 5. 模板占位数据流(模板 → 项目)

1. `fetchTemplates` 读取 `templates`(含 `placeholders`)。
2. `TemplatePlaceholderDialog` 按 `label/description/default_value` 渲染表单(首页模板快捷区与资源页共用)。
3. 确认后 `buildDemoApp(kind, title, values)` 生成单文件 HTML:`TEMPLATE_CATEGORY_KIND` 将模板分类映射为应用类型,`applyTemplateValues` 做真实值替换(HTML 上下文 `esc` 转义,JS 单/双引号字符串上下文分别转义,空值保留默认)。
4. `createProject(source='template', app_html=产物)` 落库。
5. 首页预览分栏与项目页回放 iframe 加载 `app_html`。

## 6. 验证

- `app/backend/scripts/e2e_verify.py`:注册/登录、默认空间、项目落库、模板/社区读取、收藏、跨用户隔离与越权更新拦截。
- `app/backend/scripts/test_transcribe.py`:登录态调用转写函数,验证 `scribe_v2` 模型与转写文本(HTTP 200,约 2.3s)。
- `app/frontend/t7-workspace-regression.mjs`(浏览器回归):新账号注册 → 默认工作区自动就绪(触发器)→ 新会话 AI 生成落库(space_id 归属默认工作区)→ 新建工作区自动切换且会话隔离(服务端核验 0 会话)→ 切回默认工作区会话恢复 → 刷新后工作区与会话恢复,16 项断言全部通过。
