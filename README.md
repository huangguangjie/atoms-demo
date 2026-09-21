# Atoms Demo — 类 Atoms 平台全栈演示

一个还原 [Atoms](https://atoms.dev) 产品形态的智能体应用平台:用户在首页输入应用创意,智能体产出分步计划、流式生成代码,并在应用查看器中实时预览可运行的单文件 HTML 应用。全栈使用 Supabase(项目 pofchtyjqwevchiiqags):Auth 认证、Postgres/RLS 数据持久化、Edge Functions 承载 AI 生成与语音转写;未配置 Supabase 环境变量时自动降级为演示模式(浏览器内存数据)。

## 功能全景(T1–T27)

### 全局框架
- 左右分栏布局:左侧边栏可折叠、可拖拽调宽(react-resizable-panels)
- 侧边栏:Logo、工作区选择器、首页/资源/我的项目导航、最近对话(收藏/行内重命名/删除)、新会话入口、用户/设置入口
- 认证:Supabase Auth(邮箱注册/登录/登出),OAuth/邮箱确认回调与错误页;注册触发器自动创建资料与默认工作区
- 工作区隔离:新建/切换工作区,会话按工作区过滤隔离(T7)

### 首页 · 智能体对话
- 欢迎视图:公告条、欢迎语、示例提示词快捷卡
- 提示词输入区(ChatComposer):
  - `+` 菜单(旋转 × 展开态):团队模式/附件/连接器/视频/深度研究/竞赛模式分组面板,附件 chip 增删
  - `#` 引用菜单:上传/AI/密钥/项目四类,实时过滤、键盘导航、Esc/外点关闭、删除触发符自动关闭
  - 主题菜单(Palette 图标):搜索 + 七款默认主题 + 色块 + 预览卡片;默认无选中(中性「主题」文案),主题真实注入 AI 生成提示词与演示色板
  - 构建/目标模式菜单(纯文字 + 箭头)、语音输入、发送/停止双态
- MCP 连接区:添加远程 MCP 服务(名称 + URL),连接状态与徽标展示于对话区

### 对话详情页(/chat/:conversationId)
- 提交即创建会话并跳转;Sidebar 历史会话直达;可返回首页
- 浅色对话栏(T27):`bg-white` 白底深色字,用户消息/计划卡/Agent 输出/代码进度完整回放;生成中提交自动入队续跑;停止可用
- 状态与反馈浅色化(T27):状态徽标、执行计划卡、生成失败卡(浅红底深红字)、空态、演示入口、消息队列面板统一浅色语义变量
- 应用查看器页签:概览(iframe 预览 + 源码)/编辑器(只读源码)/云/文件/增长(空态占位);源码查看器与 HTML 编辑器为白底深色字(T27)
- 刷新恢复:历史消息回放、conversation_id 关联项目自动加载(T16);消息按 metadata 恢复【演示模式】标识与计划卡,项目按 is_demo 恢复查看器徽标(T25)
- 历史版本面板(T25):版本列表(时间/来源/字节数)、点击切换预览不落库、一键回滚(回滚生成新版本、不覆盖旧快照)、在线编辑保存、HTML 导出;版本拉取含加载态与真取消重试,刷新后 v1–v4 稳定恢复
- 窄屏适配

### AI 生成管线与故障处理(T2/T9/T21/T23)
- Edge Function `app_atoms_agent_generate` 四段式管线:意图识别 → 布局规划(5 步计划)→ 代码硬约束生成 → 产物净化,以 SSE 流式返回
- 主备模型通道降级:主模型 `deepseek-v4-flash`,备用 `gpt-5.4`、`gemini-3.1-pro-preview` 按序降级;单模型瞬时错误先同模型重试,再切换下一通道;全部通道失败返回 HTTP 502「平台 AI 网关故障,请稍后重试」,不做静默兜底
- 增量修改(T25):`previousHtml` 透传当前版本完整 HTML,服务端跳过规划小调用、在原文基础上修改(除本次修改点外保持原样),产物同步 Preview 与版本快照
- 402 余额不足(T25):上游返回 HTTP 402「AI 账户余额不足,请充值后重试」时归类为确定性错误——不重试、不降级、不静默兜底,失败卡给出充值指引与「使用演示模式生成」出口
- 重试韧性:前端瞬时故障(5xx/429/网络)3 次指数退避自动重试(1.2s→2.4s→4.8s)并提示「连接出现瞬时中断,正在自动重试」;140s 软超时不静默截断
- 失败处理:失败卡展示错误文案与指引,提供「重新生成」续跑(不重复落库用户消息)与「使用演示模式生成」显式入口;演示模式绝不静默回退,消息带【演示模式】标识、查看器显示演示徽标、项目描述含标记
- 生成质量:5 类提示词(游戏/工具/数据/内容/复合三分区)通过质量门槛(纯 HTML 文档、Flex/Grid 布局、响应式、计划规范)

### 语音转写
- Edge Function `app_atoms_transcribe_audio`(scribe_v2):录音上传转写,仅登录用户,音频 ≤10MB/≤60s;失败或浏览器不支持时回退原生识别

### 资源页与项目
- 资源页:发现(社区应用)/模板双 Tab + 分类过滤;应用卡片体验/克隆/魔改入口
- 模板占位生成:模板卡片弹出占位填写弹窗,填写后替换占位内容并落库、可回放
- 我的项目:全部/已收藏切换、收藏/取消收藏、项目卡片打开回放
- 会话操作:收藏(星标排序)、行内重命名、删除二次确认、消息级联删除
- 会话归档(T26):`conversations.status`(`active`/`archived`)仅隐藏不删除数据;最近会话列表与单会话读取按 `status='active'` 过滤,收藏会话豁免「最近 5 条」限制;归档会话的旧链接直达时提示「该会话已归档」并回落首页,不误伤活跃会话

## 目录结构

```
/workspace
├── README.md                 # 本文件
├── PROJECT_NOTES.md          # 实现思路、架构设计与功能排期
├── docs/
│   ├── system-design.md      # 系统设计(认证、数据流、Edge Function、SSE 与 AI 管线)
│   ├── data-model.md         # Supabase 数据模型与 RLS
│   ├── deployment.md         # Secrets、部署、回归与发布流程
│   └── usage.md              # 使用说明(输入区、MCP、公告栏、工作区与智能体)
├── app/
│   ├── frontend/
│   │   ├── src/              # 页面、组件、数据层、智能体运行器
│   │   └── t*-*.mjs          # 浏览器回归走查脚本(T7/T8/T9/T10/T13/T22/T23/T25/T26)
│   └── backend/
│       ├── functions/        # Edge Functions(app_atoms_agent_generate、app_atoms_transcribe_audio)
│       ├── migrations/       # SQL 迁移(建表/RLS/触发器/索引)
│       └── scripts/          # 部署与验证脚本(e2e_verify、test_agent_e2e、test_t9_baseline 等)
└── uploads/                  # 需求截图等参考资料
```

## 本地开发

依赖:Node.js 18+ 与 pnpm。

```bash
cd app/frontend
pnpm install
pnpm run dev       # 开发服务器(热更新)
pnpm run lint      # ESLint 检查
pnpm run build     # 生产构建(含 sitemap/预渲染,输出 dist/)
```

### 环境变量

在 `app/frontend` 下创建 `.env.local`:

```
VITE_SUPABASE_URL=<你的 Supabase 项目 URL>
VITE_SUPABASE_ANON_KEY=<你的 Supabase anon key>
```

- 未配置时应用自动进入**演示模式**:数据保存在浏览器内存(刷新即失),智能体使用本地演示生成管线。
- 配置后自动连接 Supabase:认证、工作区、会话、消息、项目与收藏全部持久化;建表/RLS/触发器/索引脚本见 `app/backend/migrations/` 与 [docs/data-model.md](docs/data-model.md)。

## 回归验证

浏览器回归走查脚本(Playwright **1.52.0**,与本地 Chromium revision 1169 匹配),位于 `app/frontend/`:

| 脚本 | 覆盖范围 | 最近结果 |
|------|----------|----------|
| `t7-workspace-regression.mjs` | 工作区触发器/新建切换/会话隔离/刷新恢复 | 15/15 PASS |
| `t8-input-regression.mjs` | 输入区全套菜单/主题/MCP/语音/# 引用 | 22/22 PASS |
| `t9-agent-quality-regression.mjs` | AI 生成全链路/SSE/iframe 质量/落库/回放 | 14/14 PASS |
| `t10-sidebar-actions-regression.mjs` | 收藏/重命名/删除/持久化 | 20/20 PASS |
| `t13-chat-detail-regression.mjs` | 详情页/队列/停止/回放/窄屏 | 17/17 PASS |
| `t22-theme-icon-walkthrough.mjs` | 主题图标/失败卡重新生成续跑 | 16/16 PASS |
| `t23-demo-mode-walkthrough.mjs` | 显式演示模式全链路/无静默回退 | 14/14 PASS |
| `t25-versioning-walkthrough.mjs` | 402 失败卡/两轮增量 v1→v2/版本面板/回滚 v3/在线编辑 v4/导出/刷新恢复 | 26/26 PASS |
| `t26-archive-walkthrough.mjs` | 会话归档过滤/收藏豁免/归档直达守卫/数据不删除 | 14/14 PASS |
| `t27-light-theme-walkthrough.mjs` | 详情页左侧及相关状态浅色体系(实测背景与文字亮度,含源码/编辑器/两类菜单/刷新回放) | 17/17 PASS |

后端验证脚本(`app/backend/scripts/`):`e2e_verify.py`(认证/资料/工作区/项目/RLS 隔离/越权拦截)、`test_agent_e2e.py`(登录态 AI SSE E2E)、`test_t9_baseline.py`(5 类生成质量门槛)、`test_transcribe.py`(语音转写)、`deploy_function.py`(Edge Function 部署)。

## 部署

详见 [docs/deployment.md](docs/deployment.md)。要点:

- 平台发布:在 App Viewer 点击 Publish 获得发布链接。
- 静态托管:`pnpm run build` 后部署 `app/frontend/dist/`(任意静态托管平台均可)。
- 后端:Supabase 项目 pofchtyjqwevchiiqags 已连接;Edge Functions 已部署,AI 密钥仅存 Supabase Secrets(`APP_AI_KEY`/`APP_AI_BASE_URL`),前端不持有密钥。

## 文档索引

| 文档 | 说明 |
|------|------|
| [PROJECT_NOTES.md](PROJECT_NOTES.md) | 实现思路与取舍、架构设计、功能完成度与排期计划 |
| [docs/system-design.md](docs/system-design.md) | 系统架构、模块设计、数据流与智能体管线 |
| [docs/data-model.md](docs/data-model.md) | 实体与数据模型、RLS 策略 |
| [docs/deployment.md](docs/deployment.md) | Secrets、平台发布、回归与发布流程 |
| [docs/usage.md](docs/usage.md) | 功能走查与使用说明、演示模式说明 |

## 已知外部问题

- **平台 AI 网关账户余额不足(HTTP 402)**(属外部服务问题,非本项目缺陷):上游主备模型通道均返回 402「AI 账户余额不足,请充值后重试」(该故障早期表现为 403「error code: 1010」,已定位为账户余额问题)。瞬时故障时服务端三级降级链路依次为——① 同模型瞬时错误重试 → ② 备用模型通道按序切换(gpt-5.4 → gemini-3.1-pro-preview)→ ③ 全部通道失败后返回 HTTP 502「平台 AI 网关故障,请稍后重试」;402 为确定性错误,直接透出专属文案不降级;前端另有 3 次指数退避自动重试(仅瞬时故障)。此时用户侧表现为:自动重试提示(1/3→3/3)→ 失败卡(含充值/网关指引文案)。
- **演示模式兜底(显式)**:失败卡出现后,用户可点击「使用演示模式生成」以本地演示智能体完成本次生成——仅由用户主动触发,绝不静默回退;消息带【演示模式】标识、查看器显示演示徽标、项目描述含标记,刷新后可回放。会话与用户消息落库不受网关故障影响。
- AI 账户充值/网关恢复后需复测:`test_agent_e2e.py`、`t9-agent-quality-regression.mjs`(真实 AI SSE、项目落库、历史回放、重新生成全链路),以及同一项目两轮真实增量修改与版本链路。
- community_apps 401 探针与模板自带 `/api/config` 500 为预期负路径,不影响功能。
