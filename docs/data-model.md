# 数据模型文档

> 状态:**待建**。Supabase 项目尚未在平台 UI 关联,建表与种子数据将在关联后执行;
> 关联前前端运行于演示模式,数据结构以下述实体定义为准(内存实现与之同构)。

## 1. 实体总览

| 实体(表名) | 类型 | 归属 | RLS 策略概述 |
|------|------|------|------|
| profiles | 用户扩展 | 每用户 | 本人读写 |
| spaces | 空间 | 每用户 | 本人读写 |
| projects | 项目 | 每用户 | 本人读写 |
| conversations | 会话 | 每用户 | 本人读写 |
| messages | 消息 | 每用户(随会话) | 本人读写 |
| community_apps | 社区应用 | 公共数据 | 所有人可读,认证用户可写(管理侧) |
| templates | 模板 | 公共数据 | 所有人可读,认证用户可写(管理侧) |

约束:用户体系复用 Supabase `auth.users`,**不自建用户表**;`profiles` 仅作为 `auth.users` 的扩展信息。

## 2. 实体定义

### 2.1 profiles(用户扩展)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键,= `auth.users.id` |
| username | text | 显示名 |
| avatar_url | text | 头像 URL |
| plan | text | 订阅档位(free/pro/max),默认 free |
| credits | integer | 剩余积分,默认 0 |
| ai_balance | numeric | AI 余额,默认 0 |

### 2.2 spaces(空间)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 自增主键 |
| user_id | uuid | → `auth.users.id` |
| name | text | 空间名(如 个人空间/团队空间) |
| icon | text | 图标标识 |

### 2.3 projects(项目)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 自增主键 |
| user_id | uuid | → `auth.users.id` |
| name | text | 项目名(默认取自会话首条提示词) |
| description | text | 项目描述 |
| preview | text | 预览摘要(emoji/缩略描述) |
| favorite | boolean | 是否收藏,默认 false |
| last_opened_at | timestamptz | 最近打开时间 |

### 2.4 conversations(会话)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 自增主键 |
| user_id | uuid | → `auth.users.id` |
| title | text | 会话标题(首条提示词摘要) |
| space_id | integer | → spaces.id,可空 |

### 2.5 messages(消息)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 自增主键 |
| user_id | uuid | → `auth.users.id` |
| conversation_id | integer | → conversations.id |
| role | text | `user` / `agent` |
| content | jsonb | 结构化消息体(文本、计划步骤、代码进度、应用产物等) |
| app_html | text | 智能体产出的单文件应用(可空) |

### 2.6 community_apps(社区应用,公共)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 自增主键 |
| name | text | 应用名 |
| description | text | 一句话描述 |
| author | text | 作者名 |
| category | text | 分类(工具/游戏/效率/教育等) |
| emoji | text | 卡片图标 |
| likes | integer | 点赞数 |
| remixes | integer | 魔改数 |
| url | text | 可选外链 |
| demo_html | text | 可选演示应用 HTML |

### 2.7 templates(模板,公共)

| 字段 | 类型 | 说明 |
|------|------|------|
| id | integer | 自增主键 |
| name | text | 模板名 |
| description | text | 描述 |
| category | text | 分类(落地页/待办/看板/笔记等) |
| emoji | text | 图标 |
| prompt | text | 一键使用的起始提示词 |
| uses | integer | 使用次数 |

## 3. RLS 策略(建表时执行)

- 用户表(profiles、spaces、projects、conversations、messages):启用 RLS,策略为 `auth.uid() = user_id`(profiles 为 `auth.uid() = id`)的 SELECT/INSERT/UPDATE/DELETE。
- 公共表(community_apps、templates):启用 RLS,SELECT 对所有人开放(`using (true)`);写入仅限认证用户(后续可收敛为 service role/管理策略)。
- 索引:`projects(user_id)`、`conversations(user_id, updated_at desc)`、`messages(conversation_id, created_at)`。

## 4. 前端数据访问与演示模式

- 统一门面:`src/lib/supabase.ts`。`isSupabaseConfigured`(依据 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`)决定远程或演示分支;两分支返回同构实体,页面无感。
- 演示模式:内存 Map 存储模拟用户空间、项目、会话与消息;刷新即失,仅用于预览。
- 跨组件刷新:首页生成后广播 `atoms:projects-updated` / `atoms:conversations-updated`,项目页与侧边栏监听刷新;Supabase 模式下同样生效(触发重新拉取)。

## 5. 建表执行计划(待 Supabase 关联后)

1. 通过平台建表能力创建上述 7 张表(用户表含 `user_id` 关联 `auth.users`,公共表 `create_only=false`)。
2. 启用 RLS 并应用第 3 节策略;创建第 3 节所列索引。
3. 写入种子数据:community_apps(≥8 条)、templates(≥6 条)。
4. 前端配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` 后回归验证:注册/登录 → 生成应用 → 项目/会话持久化 → 刷新后仍在。
