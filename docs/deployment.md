# 部署说明

## 1. 环境变量

前端运行时可选配置(未配置即演示模式):

| 变量 | 位置 | 说明 |
|------|------|------|
| `VITE_SUPABASE_URL` | `app/frontend/.env.local` | Supabase 项目 URL |
| `VITE_SUPABASE_ANON_KEY` | `app/frontend/.env.local` | Supabase anon key |

> 注意:anon key 仅授予受 RLS 保护的客户端访问,不含 service role 密钥;服务端密钥只存在于后端运行时,前端不持有。

## 2. Atoms 平台内发布(推荐)

1. 预览确认:在 App Viewer 中走查首页(对话生成 + 预览)、资源页、我的项目页、侧边栏交互。
2. 点击右上角 **Publish**,在下拉中可自定义发布链接(子路径),确认后发布。
3. 发布完成后获得可访问的发布链接,用它做最终走查:首页生成流程、资源页、项目页、侧边栏折叠/导航。

> 说明:平台发布由 App Viewer 的 Publish 操作完成;发布与访问验证是交付前的固定走查项。

## 3. 自行构建与静态托管

```bash
cd app/frontend
pnpm install
pnpm run build     # 产物输出 dist/(含 sitemap 与 / 预渲染)
```

- 产物为纯静态文件,可部署至任意静态托管(Nginx、Vercel、Netlify、Cloudflare Pages 等)。
- SPA 路由:将所有路径回退到 `index.html`(托管平台开启 SPA rewrite;Nginx 用 `try_files $uri /index.html;`)。
- 预渲染已生成 `/`(及 `/blog/`)的静态 HTML,首屏与 SEO 更友好;动态路由(``/resources` 等)仍走 SPA 回退。

### Nginx 示例

```nginx
server {
  listen 80;
  root /var/www/atoms-demo;
  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

## 4. 后端接入(Supabase 关联后)

1. 在平台 UI 关联 Supabase 项目(当前状态:未关联,前端自动演示模式)。
2. 执行建表与 RLS:见 `docs/data-model.md` 第 3、5 节(profiles、spaces、projects、conversations、messages、community_apps、templates)。T26 归档状态迁移:`app/backend/migrations/007_conversation_archive_status.sql` 为 `conversations` 增加 `status`(默认 `active`,支持 `archived`),仅隐藏不删除;一次性归档脚本 `app/backend/scripts/t26_archive_conversations.sql` 按「本人账号 + 保留最近 5 条 + 收藏豁免」规则置 `archived`,侦查脚本 `t26_probe.sql` 用于核对账号与会话分布。
3. 写入公共表种子数据(社区应用、模板)。
4. 智能体后端:部署 Edge Function `app_atoms_agent_generate`(仓库内 `app/backend/functions/`,可用 `app/backend/scripts/deploy_function.py` 部署),并经 Management API 写入 Secrets `APP_AI_KEY`/`APP_AI_BASE_URL`(参考 `app/backend/scripts/set_secrets.py`);服务端调用平台 AI(主模型 `deepseek-v4-flash [gentxt]`,备用通道 `gpt-5.4 [gentxt]`、`gemini-3.1-pro-preview [gentxt]` 按序降级——单模型瞬时错误先同模型重试,再切换下一通道;全部通道失败返回 HTTP 502 `平台 AI 网关故障,请稍后重试`,不做静默兜底;`max_tokens:9000` + 250 行代码预算约束生成时长),以 SSE 返回与演示模式一致的事件流;内置 140s 软超时:超时/流中断/HTML 不完整时主动发送 `error` + `done` 收尾,不静默截断;前端 `src/lib/agent.ts` 优先调用该函数并透传服务端错误详情,流结束未收到 `done` 时抛出连接中断错误;瞬时故障(5xx/429/网络)自动重试 3 次,指数退避 1.2s→2.4s→4.8s;Supabase 已配置时失败会向对话流透出 `error` 事件(不静默回退演示智能体),错误信息如实落库到助手消息,仅未配置 Supabase 时使用本地演示智能体。T23 显式演示模式:失败卡出现后用户可主动点击「使用演示模式生成」——仅该次请求使用本地演示智能体(消息带【演示模式】标识、查看器显示「演示模式」徽标、项目描述标记「演示模式生成的」),绝不作为自动静默回退触发。T25 增量修改协议:请求体新增 `previousHtml`(前端透传当前版本完整 HTML),服务端检测到有效 HTML(含 `</html>`)即进入增量模式——跳过规划小调用,以「在原文基础上修改,除本次修改点外保持原样」约束生成,避免整页重生成丢失既有功能。确定性错误归类:`HTTP 402「AI 账户余额不足,请充值后重试」`属账户态问题,重试与切换备用模型均无效,直接透出专属文案不降级。已部署并实测通过:`https://pofchtyjqwevchiiqags.supabase.co/functions/v1/app_atoms_agent_generate`(端到端验证脚本 `app/backend/scripts/test_agent_e2e.py`,历史窗口内复杂提示词 22.3s 完整产出)。**当前已知外部阻塞(2026-09-19 复测)**:上游主备通道均返回 HTTP 402「AI 账户余额不足,请充值后重试」(早期表现为 403「error code: 1010」,已定位为账户余额问题),真实生成链路待充值后以 `test_agent_e2e.py` 复测。
5. 语音转写:部署 Edge Function `app_atoms_transcribe_audio`(复用 Secrets `APP_AI_KEY`/`APP_AI_BASE_URL`,模型 `scribe_v2`;仅接受登录用户,音频 ≤10MB/≤60s,密钥仅在服务端);前端 `isTranscribeAvailable` 判断可用性,失败自动回退浏览器原生识别。已部署并实测通过:`https://pofchtyjqwevchiiqags.supabase.co/functions/v1/app_atoms_transcribe_audio`(验证脚本 `app/backend/scripts/test_transcribe.py`)。
6. 回归验证:注册/登录 → 生成应用 → 项目/会话持久化 → 模板占位填写生成 → 语音转写 → 刷新后仍在。验证脚本:`app/backend/scripts/e2e_verify.py`(认证/资料/空间/克隆/模板/收藏/RLS 隔离/越权拦截)、`test_agent_e2e.py`(登录态 AI 生成 SSE)、`test_t9_baseline.py`(T9 多类型生成质量门槛:游戏/工具/数据/内容/复合分区,断言纯 HTML 文档、Flex/Grid 布局、@media 响应式、plan 含布局与视觉规范、SSE 事件完整)、`test_transcribe.py`(语音转写)、`debug_conversation.py`(创建对话问题复现与排查);浏览器全链路:`app/frontend/t9-agent-quality-regression.mjs`(注册 → 复合三分区生成 → 计划卡布局规划 → iframe 质量/画布/无 Markdown 断言 → 会话/消息/项目落库 201 → 刷新回放 → 项目页落库)、`app/frontend/t23-demo-mode-walkthrough.mjs`(AI 网关故障路径:无静默回退竞速判定 → 失败卡指引文案 → 「使用演示模式生成」→【演示模式】消息与查看器徽标 → 演示项目落库标记 → 刷新回放与 T16 关联项目恢复)、`app/frontend/t25-versioning-walkthrough.mjs`(T25 增量与版本链路:402 失败卡 → 显式演示基座 → 两轮增量生成 v1/v2(第二轮含第一轮特征)→ 历史版本面板/切换预览不落库 → 回滚新建 v3 不改写历史 → 在线编辑保存 v4 → HTML 导出一致性 → 刷新恢复消息/metadata/计划卡/徽标与 v1–v4 版本列表 → REST 核验 project_versions 快照)、`app/frontend/t26-archive-walkthrough.mjs`(T26 归档过滤:独立测试账号构造 7 条会话(最近 5 条 + 收藏豁免最旧 1 条 + `archived` 1 条)→ 侧边栏与详情页历史下拉隐藏归档会话 → 活跃会话直达不被误判 → 归档会话直达提示「该会话已归档」并回落首页 → `status=eq.active` 过滤恰为 6 条 → 归档会话行与消息完整保留不删除)。

### 回归结果(2026-09-20 全量复跑)

| 脚本 | 结果 | 说明 |
|------|------|------|
| `pnpm run lint` | 0 错误 | eslint --quiet ./src |
| `pnpm run build` | 成功 | 预渲染 `/` 与 `/blog/` |
| t7-workspace-regression.mjs | 15/15 | 工作区与会话隔离 |
| t8-input-regression.mjs | 22/22 | 输入区(含 T15/T17/T18 断言) |
| t10-sidebar-actions-regression.mjs | 20/20 | 收藏/重命名/删除/级联 |
| t13-chat-detail-regression.mjs | 17/17 | 详情页链路;应用查看器与项目落库在 402 窗口按脚本优雅降级 |
| t22-theme-icon-walkthrough.mjs | 16/16 | 主题图标与故障续跑 |
| t23-demo-mode-walkthrough.mjs | 14/14 | 演示模式全链路 |
| t25-versioning-walkthrough.mjs | 26/26 | 增量修改、版本快照/切换/回滚/在线编辑/导出、刷新恢复 |
| t26-archive-walkthrough.mjs | 14/14 | 会话归档过滤(收藏豁免、直达守卫、归档不删除数据) |
| test_agent_e2e.py(真实 AI) | 阻塞 | Edge Function HTTP 402「AI 账户余额不足,请充值后重试」;充值后需复测,并同步重跑 t9 与 T13 落库/查看器断言 |

## 5. 发布后验证清单

- [ ] 首页欢迎视图渲染(公告条、输入区、MCP 连接区、快捷卡片)
- [ ] 输入提示词 → 分步计划 → 流式代码 → 右侧 iframe 预览可交互
- [ ] 生成中「停止」可用;预览可切换代码/刷新/关闭
- [ ] MCP 面板可添加服务并显示已连接徽标
- [ ] 生成应用自动出现在「我的项目」与侧边栏最近对话,点击可回放
- [ ] 资源页发现/模板切换与分类过滤正常
- [ ] 侧边栏折叠/拖拽、导航、登录入口正常
- [ ] 模板卡片(首页快捷区/资源页)弹出占位填写弹窗,填写生成后占位内容已替换、项目落库且可回放
- [ ] 语音按钮录音 → 转写文本填入输入框;转写服务不可用或浏览器不支持时回退原生识别
- [ ] 未登录发起对话/克隆/模板生成时先弹出登录框,不执行云端写入
- [ ] 登录后完整链路:创建对话 → 用户消息 → AI 生成 → 助手消息落库,刷新后侧边栏最近对话可回放
- [ ] 云端模式下失败(断网/Edge Function 异常)显示真实错误提示,不静默回退演示内容
- [ ] AI 网关故障(502)时失败卡展示指引文案,并提供「重新生成」与「使用演示模式生成」双入口;点击演示模式后消息带【演示模式】标识、查看器显示演示徽标、刷新后可回放
