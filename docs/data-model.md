# 数据模型文档

> 状态:**已建并在线生效**。Supabase 项目 `pofchtyjqwevchiiqags`;本文档为 T30 重建版,
> 全部字段、RLS 策略、索引与默认值均以 `information_schema` / `pg_policies` / `pg_indexes` **实测核验**为准(2026-09-20),
> 迁移脚本见 `app/backend/migrations/001–008`(经 Management API 执行,均可幂等重复执行)。
> 演示模式(内存数据)仅作为本地未配置环境变量时的兜底。

## 1. 实体总览

| 实体(表名) | 类型 | 归属 | RLS 策略(实测) |
|------|------|------|------|
| profiles | 用户扩展 | 每用户 | SELECT/INSERT/UPDATE 仅本人(`auth.uid() = id`),无 DELETE |
| spaces | 工作区 | 每用户 | SELECT/INSERT/UPDATE/DELETE 仅属主(`owner_id`) |
| projects | 项目 | 每用户 | SELECT/INSERT/UPDATE/DELETE 仅属主(`user_id`) |
| conversations | 会话 | 每用户 | SELECT/INSERT/UPDATE/DELETE 仅属主(`user_id`) |
| messages | 消息 | 每用户(随会话) | SELECT/INSERT/DELETE 经所属会话校验属主,无 UPDATE |
| community_apps | 社区应用 | 公共**只读** | 仅 SELECT 对所有人开放(`using (true)`);无写策略,写入被 RLS 拒绝 |
| templates | 模板 | 公共**只读** | 仅 SELECT 对所有人开放;无写策略(种子数据经服务端写入) |
| project_versions | 版本快照 | 每用户 | 仅 SELECT/INSERT(`auth.uid() = user_id`);**无 UPDATE/DELETE——快照不可变** |

约束:用户体系复用 Supabase `auth.users`,**不自建用户表**;`profiles` 仅作为 `auth.users` 的扩展信息。

> 注:公共表在早期设计中预留「认证用户可写」,线上实测策略为**只读**(仅 `community_apps_public_read` / `templates_public_read` 两条 SELECT 策略)。社区应用与模板内容由运营侧经服务端写入,客户端不可变更——此为当前口径。

迁移文件与语义:

| 迁移 | 内容 |
|------|------|
| `001_initial_schema.sql` | 7 表建表、`updated_at` 触发器、messages 插入联动刷新会话时间(security definer)、RLS、索引、种子数据 |
| `002_add_app_html.sql` | `projects.app_html`(单文件应用 HTML) |
| `002_template_placeholders.sql` | `templates.placeholders` JSONB + 6 条模板占位种子 |
| `003_space_default_unique.sql` | 每人默认空间唯一(部分唯一索引)+ 清理历史重复默认空间 |
| `004_user_init_trigger.sql` | `handle_new_user` 触发器:注册瞬间自动创建资料与默认空间(`hashtext & 2147483647` 取色,修复负数下标 500) |
| `005_conversation_actions.sql` | `conversations.is_favorite` + 收藏优先排序索引 |
| `006_project_versions_and_metadata.sql` | `project_versions` 表 + `messages.metadata` + `projects.is_demo` + 存量 `app_html` 回填 v1 基线 |
| `007_conversation_archive_status.sql` | `conversations.status`(默认 `active`,CHECK `active|archived`)+ 状态查询索引 |
| `008_project_conversation_link.sql` | `projects.conversation_id`(FK→conversations,ON DELETE SET NULL)+ 索引(线上早已生效,本文件为 T30 补齐的迁移记录,便于环境重建) |

## 2. 实体定义(实测列结构)

所有表含 `created_at`/`updated_at`(timestamptz,默认 `now()`,`updated_at` 由触发器维护);`messages` 仅 `created_at`,`project_versions` 仅 `created_at`。

### 2.1 profiles(用户扩展)

| 字段 | 类型 | 约束/默认 | 说明 |
|------|------|------|------|
| id | uuid | PK,FK→`auth.users` ON DELETE CASCADE | = 认证用户 id |
| display_name | text | NOT NULL,默认 `''` | 显示名 |
| email | text | NOT NULL,默认 `''` | 邮箱 |
| avatar_color | text | NOT NULL,默认 `bg-violet-500` | 头像背景色(Tailwind 类),注册触发器按 hashtext 取色 |

### 2.2 spaces(工作区)

| 字段 | 类型 | 约束/默认 | 说明 |
|------|------|------|------|
| id | uuid | PK,`gen_random_uuid()` | |
| owner_id | uuid | NOT NULL,FK→`auth.users` CASCADE | 属主 |
| name | text | NOT NULL | 注册时触发器自动创建「<用户名> 的 Atoms」默认工作区 |
| is_default | boolean | NOT NULL,默认 false | 每人仅一个 `true`(部分唯一索引 `spaces_owner_default_uidx ON spaces(owner_id) WHERE is_default`) |

工作区语义:会话与项目经 `space_id` 归属工作区;侧边栏「最近对话」按当前工作区过滤,切换即切换视图,数据互不可见;删除工作区时所属会话/项目的 `space_id` 置 null(SET NULL)。

### 2.3 projects(项目)

| 字段 | 类型 | 约束/默认 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| user_id | uuid | NOT NULL,FK→`auth.users` CASCADE | 属主 |
| space_id | uuid | FK→`spaces` SET NULL | 可空 |
| name | text | NOT NULL | 项目名 |
| description | text | 可空 | 演示模式产物含「演示模式生成的」标记 |
| source | text | NOT NULL,默认 `created`,CHECK `created\|cloned\|template` | 来源 |
| favorite | boolean | NOT NULL,默认 false | 收藏 |
| cover_gradient / cover_emoji | text | NOT NULL,默认渐变/📦 | 封面 |
| views | integer | NOT NULL,默认 0 | 浏览数 |
| app_html | text | 可空(002) | 单文件应用 HTML,预览回放数据源 |
| conversation_id | uuid | FK→`conversations` SET NULL(008) | T16 关联来源会话,详情页刷新按会话回放 |
| is_demo | boolean | NOT NULL,默认 false(006) | T25 演示模式产物标记,刷新恢复查看器徽标 |

索引:`projects_user_idx(user_id, updated_at desc)`、`projects_conversation_idx(conversation_id)`。

### 2.4 conversations(会话)

| 字段 | 类型 | 约束/默认 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| user_id | uuid | NOT NULL,FK→`auth.users` CASCADE | 属主 |
| space_id | uuid | FK→`spaces` SET NULL | 首页发起对话写入当前工作区 |
| title | text | NOT NULL,默认「新对话」 | 首条提示词摘要 |
| is_favorite | boolean | NOT NULL,默认 false(005) | 收藏优先排序且豁免「最近 5 条」归档规则 |
| status | text | NOT NULL,默认 `active`,CHECK `active\|archived`(007) | T26 归档状态 |

`updated_at` 由 messages 插入触发器联动刷新,作为「最近对话」排序依据。

索引:`conversations_user_idx(user_id, updated_at desc)`、`conversations_user_fav_idx(user_id, is_favorite desc, updated_at desc)`、`conversations_user_status_updated_idx(user_id, status, updated_at desc)`。

归档语义(T26):`status='archived'` 的会话不出现在侧边栏最近对话与详情页历史下拉(前端查询统一附加 `status=eq.active`);旧链接直达时提示「该会话已归档」并回落首页;会话行、消息、关联项目与版本快照全部保留,恢复方式为属主 `UPDATE ... SET status='active'`(RLS 允许)。一次性归档脚本 `app/backend/scripts/t26_archive_conversations.sql` 仅处理指定账号,规则「保留最近 5 条 + 收藏豁免」,不跨账号、不删除数据;侦查脚本 `t26_probe.sql`。

### 2.5 messages(消息)

| 字段 | 类型 | 约束/默认 | 说明 |
|------|------|------|------|
| id | uuid | PK | |
| conversation_id | uuid | NOT NULL,FK→`conversations` CASCADE | 会话删除时消息级联删除 |
| role | text | NOT NULL,CHECK `user\|assistant` | |
| content | text | NOT NULL,默认 `''` | 失败原因也如实落库,回放可见 |
| metadata | jsonb | 可空(006) | T25 消息元数据 `{isDemo?: boolean, plan?: string[]}`:刷新回放恢复【演示模式】标识与计划卡 |

索引:`messages_conversation_idx(conversation_id, created_at)`。

### 2.6 community_apps(社区应用,公共只读)

`id`(PK)、`title`(UNIQUE)、`author_name`、`category`(默认 Website)、`views`、`cover_gradient`、`cover_emoji`。RLS 仅公开 SELECT。

### 2.7 templates(模板,公共只读)

`id`(PK)、`title`(UNIQUE)、`description`、`category`、`cover_gradient`、`cover_emoji`、`placeholders`(jsonb,**NOT NULL 默认 `'[]'`**,002)。

`placeholders` 元素结构:

```json
{
  "key": "brand_name",
  "label": "产品名称",
  "description": "用于导航栏 Logo、页脚与产品介绍",
  "default_value": "Landing Page Kit"
}
```

- `key`:占位键,与前端 `applyTemplateValues` 替换映射对应(HTML 上下文 `esc` 转义,JS 单/双引号字符串上下文分别转义,空值保留默认)。
- `label` / `description`:占位填写弹窗表单文案;`default_value`:留空提交时保留的默认内容。
- 6 条种子模板占位数:Landing Page Kit(4)、E-commerce Starter(2)、Dashboard Starter(3)、Blog Starter(2)、Game Starter(1)、Business Card(3)。

### 2.8 project_versions(版本快照,006)

| 字段 | 类型 | 约束/默认 | 说明 |
|------|------|------|------|
| id | uuid | PK,`gen_random_uuid()` | |
| project_id | uuid | NOT NULL,FK→`projects` CASCADE | |
| user_id | uuid | NOT NULL | 属主(RLS 依据) |
| version_number | integer | NOT NULL,`UNIQUE(project_id, version_number)` | 版本号=最新+1,唯一约束兜底并发 |
| source | text | NOT NULL,CHECK `generation\|edit\|rollback` | 首次/增量生成、在线编辑、回滚 |
| label | text | NOT NULL,默认 `''` | 版本标签(如「首次生成」「本次修改摘要」) |
| app_html | text | NOT NULL | 该版本完整 HTML 快照 |
| created_at | timestamptz | NOT NULL,默认 `now()` | |

索引:`idx_project_versions_project(project_id, version_number desc)`。RLS 仅 SELECT/INSERT——**快照不可变**;回滚不改写历史,以目标内容新建 `rollback` 版本。006 执行时已将存量项目 `app_html` 回填为 v1 基线(19 条)。

## 3. RLS 策略与触发器(实测清单)

- profiles:`profiles_select_own` / `profiles_insert_own` / `profiles_update_own`(均 `auth.uid() = id`)。
- spaces:`spaces_select_own` / `insert_own` / `update_own` / `delete_own`(`auth.uid() = owner_id`)。
- projects:`projects_select_own` / `insert_own` / `update_own` / `delete_own`(`auth.uid() = user_id`)。
- conversations:`conversations_select_own` / `insert_own` / `update_own` / `delete_own`(`auth.uid() = user_id`)。
- messages:`messages_select_own` / `insert_own` / `delete_own`——经 `exists (select 1 from conversations c where c.id = messages.conversation_id and c.user_id = auth.uid())`。
- community_apps:`community_apps_public_read`(SELECT `true`);templates:`templates_public_read`(SELECT `true`)。
- project_versions:`versions_select_own` / `versions_insert_own`(`auth.uid() = user_id`)。
- 触发器:全表 `updated_at` 自动维护;`bump_conversation_updated`(messages 插入后刷新会话时间,security definer);`handle_new_user`(注册建资料与默认空间,security definer,`on conflict do nothing` 幂等)。

## 4. 前端数据访问与演示模式

- 统一门面:`src/lib/supabase.ts`。`isSupabaseConfigured`(依据 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`)决定远程或演示分支;两分支返回同构实体,页面无感。
- 写操作与主要查询显式检查 Supabase 错误并抛出(T6),由调用侧 toast 透出真实原因;活跃会话查询统一 `status=eq.active`(T26)。
- 版本 API:`fetchProjectVersions`(AbortController 真取消 + 4s 超时 + 最多 3 次重试 + 加载态)、`insertProjectVersion`、`updateProjectAppHtml`。
- 演示模式:内存数据兜底,仅用于未配置环境变量的本地预览,刷新即失。
- 跨组件刷新:广播 `atoms:projects-updated` / `atoms:conversations-updated`,项目页与侧边栏监听刷新。

## 5. 模板占位数据流(模板 → 项目)

1. `fetchTemplates` 读取 `templates`(含 `placeholders`)。
2. `TemplatePlaceholderDialog` 按 `label/description/default_value` 渲染表单(首页模板快捷区与资源页共用)。
3. 确认后 `buildDemoApp(kind, title, values)` 生成单文件 HTML:`TEMPLATE_CATEGORY_KIND` 将模板分类映射为应用类型,`applyTemplateValues` 做真实值替换。
4. `createProject(source='template', app_html=产物)` 落库。
5. 首页预览分栏与项目页回放 iframe 加载 `app_html`。

## 6. 验证

- `app/backend/scripts/e2e_verify.py`:注册/登录、默认空间、项目落库、模板/社区读取、收藏、跨用户隔离与越权更新拦截。
- `app/backend/scripts/t26_probe.sql` + `t26_archive_conversations.sql`:T26 归档侦查与一次性归档(结果 5 active + 1 archived,消息完整保留,其他账号零影响)。
- 浏览器回归:`t7-workspace-regression.mjs`(15/15)、`t10-sidebar-actions-regression.mjs`(20/20,服务端核验 is_favorite/重命名/消息级联删除)、`t26-archive-walkthrough.mjs`(14/14,REST 核验归档不删数据)、`t25-versioning-walkthrough.mjs`(26/26,REST 核验 project_versions 快照)、`t29-real-chain-walkthrough.mjs`(32/32,真实链路 v1→v4 版本链与刷新恢复)。
