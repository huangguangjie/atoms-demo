# Atoms Demo — 类 Atoms 平台全栈演示

一个还原 [Atoms](https://atoms.dev) 产品形态的智能体应用平台:用户在首页输入应用创意,智能体产出分步计划、流式生成代码,并在应用查看器中实时预览可运行的单文件 HTML 应用。全栈使用 Supabase(项目 pofchtyjqwevchiiqags):Auth 认证、Postgres/RLS 数据持久化、Edge Functions 承载 AI 生成与语音转写;未配置 Supabase 环境变量时自动降级为演示模式(浏览器内存数据)。

## 功能全景(T1–T32)

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

### AI 生成管线与故障处理(T2/T9/T21/T23/T28/T29)
- Edge Function `app_atoms_agent_generate` 四段式管线:意图识别 → 布局规划(5 步计划)→ 代码硬约束生成 → 产物净化,以 SSE 流式返回
- 主备模型通道降级:主模型 `deepseek-v4-flash`,备用 `gpt-5.4`、`gemini-3.1-pro-preview` 按序降级;单模型瞬时错误先同模型重试,再切换下一通道;全部通道失败返回 HTTP 502「平台 AI 网关故障,请稍后重试」,不做静默兜底
- 增量修改(T25):`previousHtml` 透传当前版本完整 HTML,服务端跳过规划小调用、在原文基础上修改(除本次修改点外保持原样),产物同步 Preview 与版本快照
- 402 余额不足(T25):上游返回 HTTP 402「AI 账户余额不足,请充值后重试」时归类为确定性错误——不重试、不降级、不静默兜底,失败卡给出充值指引与「使用演示模式生成」出口
- 终止守卫(T28):单次生成生命周期内 `app` 产物一旦交付,后续 SSE 流缺失 `done` 分片或连接被截断,一律补发 `done` 正常收敛,绝不整轮重跑——修复「代码生成到 100% 后又重新规划再生成」死循环;确定性错误(402 余额不足等)只透出失败、不自动继续
- 幂等落库(T28):同一生成轮次的重复 `app` 事件只落库一次项目与版本快照,避免重试竞态产生重复项目与重复版本号
- 产物语法自检与自动修复(T29):Edge Function 在交付前对内联 `<script>` 做纯语法校验(`new Function` 试编译,不执行代码),检出语法错误(如模型产出的非法 `const` 声明)时发起一次**内容保全式**AI 修复重试——仅修语法、不改功能与文案,修复后复检通过再交付,并记录 `syntaxFixed` 日志;确保预览 iframe 不出现运行时语法报错
- 重试韧性:仅**尚未产出应用产物**时的瞬时故障(5xx/429/网络)自动重试,3 次指数退避(1.2s→2.4s→4.8s,整轮上游调用封顶 4 次)并提示「连接出现瞬时中断,正在自动重试」;130s 软超时(`SOFT_DEADLINE_MS=130_000`)不静默截断
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

## T31 验收、加固与部署溯源

### 原子版本写入(事务)
- 迁移 `009_atomic_version_write.sql` 新增 RPC `app_write_project_version`,把「项目 `app_html` 更新 + 版本快照插入 + 版本号取号」收敛为**单个数据库事务**。
- 并发取号由表级 `UNIQUE(project_id, version_number)` 兜底:并发写入只有一个事务成功,失败方以最新版本号重试,不产生重复版本号与半写状态(项目已更新但快照缺失)。
- 中断注入(客户端主动断开、事务内语句报错)后项目与版本快照保持前后一致,不遗留孤儿快照;`source` 仍受 `generation|edit|rollback` CHECK 约束。

### 认证、状态恢复与安全
- 认证全流程走查 `t31-auth-walkthrough.mjs` 覆盖 A1–A21:未登录登录入口 → 注册并自动创建默认工作区 → 会话持久化到浏览器存储 → 刷新保持登录态/会话/项目 → 退出登录并清理令牌 → 重新登录数据恢复 → 清空存储回到未登录 → refresh token 换新 access token 并访问受保护资源 → 无痕上下文登录后工作区/会话/项目完整恢复。
- 认证复测账号(评审账号)由 `t31_reviewer_account.py` 创建,验证注册触发器建资料与默认工作区、本人数据 RLS 隔离、越权查询他人数据返回空集、公共表只读、无写策略写入被拒、可创建项目并经原子 RPC 写版本快照。

### Preview 沙箱安全
- `lib/preview-sandbox.ts` 统一包裹 Preview HTML:iframe 使用 `sandbox` 白名单 + `srcdoc`,运行在 opaque origin,AI 产物无法触达宿主 DOM、`localStorage`/`sessionStorage`/Cookie 与宿主会话令牌。
- CSP 限制脚本/网络/表单外发;`window.open` 与顶层导航被守卫拦截,表单提交默认阻止;宿主页面完整性(令牌、DOM 结构)在沙箱产物运行前后一致。

### 部署溯源
- Vite 构建期注入 Git SHA / ref / 构建时间到 `window.__ATOMS_BUILD__`(由 `main.tsx` 挂载),线上可直接核对当前部署产物对应的提交。

## T32 失败回退与幂等加固

### 失败不生效(产物守卫)
- 生成产物在**落库与展示之前**先经产物校验:空内容、明显截断(未以 `</html>` 收尾)、非法内联脚本语法一律判定为无效产物。
- 无效产物**不进入 Preview、不写入源码查看器、不写入数据库**——不会留下半成品项目、空快照或错误版本号;对话区只保留失败卡与错误原因。

### 事务回滚与展示顺序
- 版本写入统一走原子 RPC `app_write_project_version`(迁移 009):取号、更新 `projects.app_html`、插入 `project_versions` 快照在同一事务内完成;任一步失败(含写入途中断连)整体回滚,项目内容与版本快照永远一致。
- 前端把「成功落库」作为唯一成功判据:**RPC 成功返回后**才切换 Preview、源码与当前项目状态;失败时项目、快照、版本号三者均不变化。
- 失败助手消息落库并标记 `failed` 状态,`metadata` 保存 `error`(错误原因)与 `prompt`(需求原文),刷新后仍可定位失败原因。

### 幂等重试
- `flowLockRef` 流级别互斥锁:同一轮生成在未结束前,重复点击「重新生成」不再发起第二次请求,避免重复消息、重复项目与重复版本号。
- 重试只追加一轮新的助手消息,不重复落库用户消息;`appPersisted` 轮次守卫保证同一轮次的重复 `app` 事件只落库一次。
- 队列续跑(生成中再次提交)沿用同一把锁与同一幂等落库路径,不会与进行中的轮次交叉写入。

### 刷新恢复与瞬时鉴权自愈
- 刷新后恢复:失败卡与失败原因、需求原文、重试入口,以及此前成功生成的版本列表与关联项目。
- 公开表(模板、社区应用)读取遇到瞬时 401 时,自动刷新会话并有限重试;瞬时鉴权抖动不影响数据链路(走查中实测自愈且未影响完成轮次)。

### 验收
- `t32-failure-rollback-walkthrough.mjs` 35/35 PASS:覆盖无效产物拦截、事务失败回滚、成功后才切换 Preview、失败消息 metadata、刷新恢复、连点重试幂等、队列续跑、公开表瞬时 401 自愈。
- 线上 RPC 核验(`app/backend/scripts/t32_rpc_probe.sql`):函数唯一无重载、签名与前端调用键一致、`authenticated` 具备 EXECUTE、半写项目 0、版本跳号 0、孤儿快照 0、空快照 0。
- 评审账号 `t31.reviewer@atoms-demo.dev` 已按回收脚本彻底删除(级联清理资料/工作区/项目/版本),脚本可重复执行且幂等。

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
│   │   └── t*-*.mjs          # 浏览器回归走查脚本(T7/T8/T9/T10/T13/T22/T23/T25/T26/T27/T28/T29/T31/T32)
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
| `t28-loop-repro.mjs` | Agent 死循环专项(Mock SSE 驱动真实 agent.ts):产物交付后截断/缺 done 不重跑、确定性错误不重试、未交付重试封顶 4 次 | 11/11 PASS |
| `t29-real-chain-walkthrough.mjs` | 真实 AI 全链路最终复测:停止生成上游调用≤1、两轮真实增量(T29R1MARK/T29R2MARK 特征保持)、版本链 v1→v4、Preview/源码/导出一致、刷新回放(消息/计划卡/真实生成徽标/4 版本/关联项目)、产物 iframe 无语法错误 | 32/32 PASS(总耗时 49.5s) |
| `t31-transaction-injection.mjs` | 原子版本 RPC:并发取号唯一、无半写状态、RLS 隔离、中断注入后一致性 | 20/20 PASS |
| `t31-real-model-matrix.mjs` | 真实模型连续生成矩阵:计算器/贪吃蛇/待办清单 首轮 + 增量、SSE 事件完整性、版本链与产物校验 | 44/44 PASS |
| `t31-sandbox-security.mjs` | Preview 沙箱:iframe sandbox/opaque origin、CSP、DOM/存储/Cookie 隔离、弹窗与导航守卫、宿主完整性 | 24/24 PASS |
| `t31-auth-walkthrough.mjs` | 认证与状态恢复 A1–A21:注册/默认工作区/刷新恢复/退出清理/重登/清空存储/令牌刷新/无痕上下文 | 21/21 PASS |
| `t32-failure-rollback-walkthrough.mjs` | 失败回退与幂等:无效/截断/语法错误产物不落库不入 Preview、RPC 失败整体回滚、成功后才切换展示、失败消息 metadata、刷新恢复失败卡与版本、连点重试幂等、队列续跑、公开表瞬时 401 自愈 | 35/35 PASS(约 34.3s) |
| `t35-dual-account-isolation.mjs` | 双账号隔离与全新会话恢复:无痕未登录 → 账号 A 数据完整恢复 → 刷新恢复 → 退出无残留 → 账号 B 前端不可见 + REST/RLS 空集 + 越权写入被拒 + 临时数据回收 | 25/25 PASS |

后端验证脚本(`app/backend/scripts/`):`e2e_verify.py`(认证/资料/工作区/项目/RLS 隔离/越权拦截)、`test_agent_e2e.py`(登录态 AI SSE E2E)、`test_t9_baseline.py`(5 类生成质量门槛)、`test_transcribe.py`(语音转写)、`deploy_function.py`(Edge Function 部署)。

## 部署

详见 [docs/deployment.md](docs/deployment.md)。要点:

- 平台发布:在 App Viewer 点击 Publish 获得发布链接;已发布站点是发布当时的构建快照,**修改代码后需重新 Publish 才会更新**。
- 部署溯源:`window.__ATOMS_BUILD__` 注入本次构建提交的 SHA/ref/时间。三方对照口径为「远端 `main` SHA = 本地同提交构建注入 SHA = 已发布站点实测 SHA」;受控实验已证实注入值严格等于构建时所在提交(按 `dd347f9` 构建注入 `dd347f9`、按 `ac5c3bd` 构建注入 `ac5c3bd`)。
- SHA 漂移归因(T36):平台构建读取**工作区仓库** HEAD(工作区 `.git` 为只读挂载,不可改写),GitHub `main` 是另一条历史;两者不是同一提交时注入 SHA 必然与 `main` 不等,这与发布动作无关。发布后未重新 Publish 则会让线上值进一步滞后。当前 GitHub `main` 已推进至 `a547bd0`(509 文件、LFS 15 个、敏感文件 0)。
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

- **平台 AI 网关账户余额不足(HTTP 402)——已解除(2026-09-20 复测)**:此前上游主备模型通道均返回 402「AI 账户余额不足,请充值后重试」(早期表现为 403「error code: 1010」,定位为账户余额问题),属外部服务问题、非本项目缺陷。余额恢复后 `test_agent_e2e.py` 与 `t9-agent-quality-regression.mjs`(14/14)真实 AI 全链路复测通过。故障期间的处置能力保留:瞬时故障时服务端三级降级(同模型重试 → 备用通道 gpt-5.4 → gemini-3.1-pro-preview → 全部失败返回 HTTP 502);402 为确定性错误直接透出专属文案不降级;前端仅对未产出产物的瞬时故障做指数退避重试(T28 终止守卫)。
- **演示模式兜底(显式)**:失败卡出现后,用户可点击「使用演示模式生成」以本地演示智能体完成本次生成——仅由用户主动触发,绝不静默回退;消息带【演示模式】标识、查看器显示演示徽标、项目描述含标记,刷新后可回放。会话与用户消息落库不受网关故障影响。T23/T25/T27 走查已改用路由拦截稳定模拟 402,不再依赖外部故障窗口。
- community_apps 401 探针与模板自带 `/api/config` 500 为预期负路径,不影响功能。
