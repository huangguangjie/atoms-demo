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
4. 智能体后端(可选):部署 Edge Function `app_atoms_agent_generate`,服务端调用平台 AI(模型 `claude-opus-5 [gentxt]`),以 SSE 返回 `plan`/`step`/`code-delta`/`done`/`error` 事件;前端 `src/lib/agent.ts` 已预留调用分支,配置后零改动切换。
5. 回归验证:注册/登录 → 生成应用 → 项目/会话持久化 → 刷新后仍在。

## 5. 发布后验证清单

- [ ] 首页欢迎视图渲染(公告条、输入区、MCP 连接区、快捷卡片)
- [ ] 输入提示词 → 分步计划 → 流式代码 → 右侧 iframe 预览可交互
- [ ] 生成中「停止」可用;预览可切换代码/刷新/关闭
- [ ] MCP 面板可添加服务并显示已连接徽标
- [ ] 生成应用自动出现在「我的项目」与侧边栏最近对话,点击可回放
- [ ] 资源页发现/模板切换与分类过滤正常
- [ ] 侧边栏折叠/拖拽、导航、登录入口正常
