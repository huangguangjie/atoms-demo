# Atoms Demo — 类 Atoms 平台前端演示

一个还原 [Atoms](https://atoms.dev) 产品形态的智能体应用平台演示项目:用户在首页输入应用创意,智能体产出分步计划、流式生成代码,并在右侧分栏实时预览可运行的应用;配套资源发现页与我的项目页。数据层使用 Supabase(Auth + Postgres + RLS),在 Supabase 未关联时自动降级为演示模式(浏览器内存数据),保证端到端可预览。

## 功能清单

### 全局框架
- 左右分栏布局:左侧边栏可折叠、可拖拽调宽(react-resizable-panels)
- 侧边栏:Logo、空间选择器、首页/资源/我的项目导航、最近对话、社区/积分卡片、用户/设置/通知入口
- 认证:Supabase Auth(邮箱注册/登录/登出),OAuth/邮箱确认回调与错误页;演示模式身份兜底

### 首页 · 智能体对话
- 欢迎视图:公告条、头像组、欢迎语、示例提示词
- 提示词输入区:附件、主题选择、构建/目标模式、`#` 引用、语音输入、发送/停止
- MCP 连接区:添加远程 MCP 服务(名称 + URL),连接状态在对话区展示
- 智能体生成:分步执行计划 → 流式代码生成(进度实时显示)→ 产出可运行应用
- 应用预览:右侧可拖拽分栏 iframe 实时运行,支持预览/代码标签切换、刷新、关闭
- 会话联动:生成应用自动落入「我的项目」;侧边栏最近对话点击可回放

### 资源页
- 发现(社区应用)/ 模板双 Tab,分类过滤,应用卡片带体验/克隆/魔改入口

### 我的项目页
- 全部 / 已收藏切换,收藏与取消收藏,项目卡片展示与打开

## 目录结构

```
/workspace
├── README.md                # 本文件
├── docs/                    # 研发文档
│   ├── system-design.md     # 系统设计
│   ├── data-model.md        # 数据模型(含待建表说明)
│   ├── deployment.md        # 部署说明
│   └── usage.md             # 使用说明
├── app/
│   ├── frontend/            # React 18 + Vite + Tailwind + shadcn/ui
│   │   └── src/             # 页面、组件、数据层、智能体运行器
│   └── backend/             # Supabase 配置与平台后端说明(建表待执行)
└── uploads/                 # 需求截图等参考资料
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

### 环境变量(可选)

在 `app/frontend` 下创建 `.env.local`:

```
VITE_SUPABASE_URL=<你的 Supabase 项目 URL>
VITE_SUPABASE_ANON_KEY=<你的 Supabase anon key>
```

- 未配置时应用自动进入**演示模式**:数据保存在浏览器内存,刷新即失,智能体使用内置生成管线(分步计划 + 流式代码 + 单文件应用预览)。
- 配置后自动连接 Supabase:认证、项目、对话与消息持久化;建表脚本见 `docs/data-model.md`(表创建待 Supabase 项目在平台 UI 关联后执行)。

## 部署

详见 [docs/deployment.md](docs/deployment.md)。要点:

- 平台发布:在 App Viewer 点击 Publish,获得可访问的发布链接。
- 静态托管:执行 `pnpm run build` 后部署 `dist/` 产物(任意静态托管平台均可)。

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/system-design.md](docs/system-design.md) | 系统架构、模块设计、数据流与智能体管线 |
| [docs/data-model.md](docs/data-model.md) | 实体与数据模型、待建表及 RLS 策略 |
| [docs/deployment.md](docs/deployment.md) | 平台发布与环境变量、构建部署流程 |
| [docs/usage.md](docs/usage.md) | 功能走查与使用说明、演示模式说明 |

## 已知边界

- 真实数据打通(建表 + 资源页/项目页接 Supabase)待用户在平台 UI 关联 Supabase 后执行。
- 语音输入当前为浏览器原生识别,后端转写能力待后端连接后评估接入。
- 复杂 Node.js 项目的沙箱运行计划接入 WebContainer,当前预览覆盖单文件 HTML 应用。
