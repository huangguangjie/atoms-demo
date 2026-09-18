# 系统设计文档

> 项目:Atoms Demo — 类 Atoms 平台智能体应用生成前端
> 状态:演示模式全流程可用;Supabase 真实数据打通待平台 UI 关联后执行

## 1. 系统概览

系统为前端 SPA,按 Atoms 官网布局组织:左侧可折叠/可拖拽侧边栏 + 右侧内容区。核心链路是首页「智能体对话」:用户输入应用创意 → 智能体产出分步执行计划 → 流式生成代码 → 产出的单文件应用在右侧分栏 iframe 中实时运行。数据层统一封装,Supabase 已配置时走远程数据库与 Auth,未配置时自动降级为演示模式(内存数据)。

```
┌────────────────────────────────────────────────────────┐
│ AppLayout (react-resizable-panels)                     │
│ ┌────────────┐ ┌─────────────────────────────────────┐ │
│ │ Sidebar    │ │ Routes                              │ │
│ │ 导航/最近   │ │  /          HomePage(欢迎|对话+预览) │ │
│ │ 会话/用户   │ │  /resources ResourcesPage           │ │
│ └────────────┘ │  /projects   ProjectsPage           │ │
│                │  /auth/*     Callback / Error        │ │
│                └─────────────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
         │ 数据访问层 src/lib/supabase.ts(统一门面)
         ├─ Supabase 已配置:Auth + Postgres(待建表) + Edge Functions
         └─ 未配置:演示模式(内存数据 + 内置智能体管线)
```

## 2. 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | React 18 + TypeScript | SPA,react-router-dom v6 路由 |
| 构建 | Vite 5 | 含 sitemap 与预渲染插件(产出 `/` 与 `/blog/`) |
| 样式 | Tailwind CSS 3 + shadcn/ui | 组件库按需引入 |
| 布局 | react-resizable-panels | 侧边栏拖拽调宽/折叠、对话+预览分栏 |
| 状态/数据 | @supabase/supabase-js v2、@tanstack/react-query | 数据门面 + 查询缓存 |
| 通知 | sonner | Toast 提示 |
| 后端 | Supabase | Auth + Postgres/RLS + Edge Functions(待关联) |

## 3. 模块设计

| 模块 | 职责 | 关键文件 |
|------|------|----------|
| 应用框架 | Provider 组合、路由、布局容器 | `src/App.tsx`、`src/components/layout/AppLayout.tsx` |
| 侧边栏 | 导航、空间选择、最近对话、用户区、登录弹窗 | `src/components/layout/Sidebar.tsx` |
| 首页 | 欢迎视图、输入区(附件/主题/模式/#引用/语音)、MCP 面板、对话视图、预览分栏 | `src/pages/HomePage.tsx` |
| 智能体管线 | 分步计划 → 流式代码 → 应用产物;中止;Edge Function SSE 预留分支 | `src/lib/agent.ts` |
| 演示应用生成 | 按提示词匹配 6 类真实可运行单文件 HTML 应用(阅读/待办/计算器/看板/落地页/笔记) | `src/lib/demo-apps.ts` |
| 消息渲染 | 用户/智能体气泡、计划步骤卡、代码生成进度 | `src/components/chat/ChatMessage.tsx` |
| 应用预览 | iframe 实时运行、预览/代码标签、刷新、关闭 | `src/components/preview/AppPreview.tsx` |
| 资源页 | 发现/模板双 Tab、分类过滤 | `src/pages/ResourcesPage.tsx` |
| 我的项目 | 全部/已收藏、收藏操作 | `src/pages/ProjectsPage.tsx` |
| 认证 | Supabase 会话、邮箱登录/注册、演示身份 | `src/contexts/AuthContext.tsx` |
| 数据访问 | 实体类型、客户端、CRUD、演示兜底、Edge Function URL | `src/lib/supabase.ts` |
| 配置 | 运行时 API 配置加载 | `src/lib/config.ts`、`src/main.tsx` |

## 4. 关键数据流

### 4.1 智能体生成管线(演示模式)

1. 用户发送提示词 → 首页切换到对话视图,创建/复用会话。
2. `runAgent` 先产出**分步计划**(分析需求 → 设计界面 → 生成代码 → 预览验证),事件驱动逐步推进:每个步骤从「进行中」到「完成」。
3. **代码生成阶段**以流式事件输出代码片段,`ChatMessage` 展示进度百分比。
4. 产出单文件 HTML 应用(demo-apps 按关键词匹配模板:阅读站/待办/计算器/数据看板/落地页/笔记,主题色板映射用户选择)。
5. 应用内容写入会话消息与项目记录;广播 `atoms:projects-updated` / `atoms:conversations-updated`,「我的项目」页与侧边栏最近对话自动刷新。
6. `AppPreview` 用 `srcDoc` 在 iframe 中运行应用;用户可切「代码」标签查看源码、刷新或关闭预览。
7. 生成过程中发送按钮变为停止按钮,可随时中止(AbortController + 事件流中止)。

### 4.2 Edge Function 分支(已部署并实测通过)

`src/lib/agent.ts` 优先调用已部署的 `app_atoms_agent_generate` Edge Function(地址由 `src/lib/supabase.ts` 提供):服务端经平台 AI 网关调用 `claude-opus-5 [gentxt]` 生成单文件 HTML,密钥仅存于 Supabase Edge Function Secrets(`APP_AI_KEY`/`APP_AI_BASE_URL`),前端不持有任何第三方密钥;请求携带 JWT 时由服务端校验登录态。函数以 SSE 返回与演示模式一致的事件协议(`message`、`plan`、`step-start/step-done`、`code-start`、`code-delta`、`app`、`done`、`error`),生成完成后前端照常落库项目。错误策略:Supabase 已配置时调用失败会通过 `error` 事件把真实原因透出到对话流,不再静默回退演示智能体(避免兜底掩盖线上故障);仅本地未配置 Supabase 时才使用内置演示智能体。端到端验证脚本:`app/backend/scripts/test_agent_e2e.py`(登录态 SSE 生成,断言 message/plan/app 事件与 HTML 产出)。

### 4.3 认证与会话联动

- Supabase 模式:邮箱注册/登录经 `AuthContext` 管理;`conversations`/`messages` 直接读写远程表;`/auth/callback`、`/auth/error` 处理 OAuth/邮箱确认。
- 登录守卫:Supabase 模式下未登录发起对话/克隆/模板生成时先弹出登录框,不以 `demo-user` 等非法 UUID 写库(此前正是已发布版「创建对话失败,请重试」的根因)。
- 错误透出:数据层(`src/lib/supabase.ts`)写操作与主要查询显式检查 Supabase 错误并抛出,页面以 toast 展示真实原因,不再静默吞错。
- 演示模式:内存身份 `demo-user`,数据写入内存 Map,刷新即失。
- 侧边栏「最近」点击会话 → `navigate('/', { state: { conversationId } })` → 首页回放该会话消息。

## 5. 路由结构

| 路由 | 页面 | 说明 |
|------|------|------|
| `/` | HomePage | 欢迎/对话双视图,`location.state.conversationId` 支持会话回放 |
| `/resources` | ResourcesPage | 发现/模板 + 分类过滤 |
| `/projects` | ProjectsPage | 全部/已收藏 |
| `/auth/callback` | AuthCallback | OAuth/邮箱确认回调 |
| `/auth/error` | AuthError | 认证错误展示 |

## 6. 技术决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 用户体系 | 复用 Supabase `auth.users` | 平台规范,不自建用户表 |
| 未连接兜底 | 演示模式(内存数据) | Supabase 关联前 UI 可完整端到端预览 |
| 布局 | react-resizable-panels | 复用模板封装,支持拖拽与折叠 |
| 数据 SDK | @supabase/supabase-js v2 | 替换模板遗留 @metagptx/web-sdk |
| 智能体 | 前端事件驱动管线 + Edge Function 预留 | 演示即真实可用;后端就绪后零改动切换 |
| 错误处理 | 显式抛出 + toast 真实报错,不静默回退 | 静默兜底会掩盖线上故障(「创建对话失败」根因),透出才能定位 |
| 预览 | 单文件应用 + iframe srcDoc | 免沙箱依赖;Node 项目沙箱(WebContainer)留作后续 |
| 跨组件联动 | window CustomEvent | 项目页/侧边栏与首页解耦刷新 |

## 7. 已知边界与演进

- 语音输入优先走平台转写 Edge Function(`scribe_v2 [transcribe]`,登录用户可用),失败或浏览器不支持时回退浏览器原生 SpeechRecognition。
- 复杂多文件 Node.js 项目的沙箱运行计划接入 `@webcontainer/api`,当前预览覆盖单文件 HTML 应用。
- 真实数据打通(建表 + 资源页/项目页接 Supabase)在用户完成平台 UI 的 Supabase 关联后另行执行。
