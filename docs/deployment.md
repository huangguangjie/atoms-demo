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
2. 执行建表与 RLS:见 `docs/data-model.md` 第 3、5 节(profiles、spaces、projects、conversations、messages、community_apps、templates)。
3. 写入公共表种子数据(社区应用、模板)。
4. 智能体后端:部署 Edge Function `app_atoms_agent_generate`(仓库内 `app/backend/functions/`,可用 `app/backend/scripts/deploy_function.py` 部署),并经 Management API 写入 Secrets `APP_AI_KEY`/`APP_AI_BASE_URL`(参考 `app/backend/scripts/set_secrets.py`);服务端调用平台 AI(模型 `deepseek-v4-flash [gentxt]`,速度快以满足平台约 150s wall-clock 时限;`max_tokens:9000` + 250 行代码预算约束生成时长),以 SSE 返回与演示模式一致的事件流;内置 140s 软超时:超时/流中断/HTML 不完整时主动发送 `error` + `done` 收尾,不静默截断;前端 `src/lib/agent.ts` 优先调用该函数,流结束未收到 `done` 时抛出连接中断错误;Supabase 已配置时失败会向对话流透出 `error` 事件(不静默回退演示智能体),错误信息如实落库到助手消息,仅未配置 Supabase 时使用本地演示智能体。已部署并实测通过:`https://pofchtyjqwevchiiqags.supabase.co/functions/v1/app_atoms_agent_generate`(端到端验证脚本 `app/backend/scripts/test_agent_e2e.py`,复杂提示词 22.3s 完整产出)。
5. 语音转写:部署 Edge Function `app_atoms_transcribe_audio`(复用 Secrets `APP_AI_KEY`/`APP_AI_BASE_URL`,模型 `scribe_v2`;仅接受登录用户,音频 ≤10MB/≤60s,密钥仅在服务端);前端 `isTranscribeAvailable` 判断可用性,失败自动回退浏览器原生识别。已部署并实测通过:`https://pofchtyjqwevchiiqags.supabase.co/functions/v1/app_atoms_transcribe_audio`(验证脚本 `app/backend/scripts/test_transcribe.py`)。
6. 回归验证:注册/登录 → 生成应用 → 项目/会话持久化 → 模板占位填写生成 → 语音转写 → 刷新后仍在。验证脚本:`app/backend/scripts/e2e_verify.py`(认证/资料/空间/克隆/模板/收藏/RLS 隔离/越权拦截)、`test_agent_e2e.py`(登录态 AI 生成 SSE)、`test_transcribe.py`(语音转写)、`debug_conversation.py`(创建对话问题复现与排查)。

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
