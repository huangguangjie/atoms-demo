import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import ChatComposer, {
  type AppThemeDef,
  type ComposerMode,
} from '@/components/chat/ChatComposer';
import AppPreview from '@/components/preview/AppPreview';
import TemplatePlaceholderDialog from '@/components/templates/TemplatePlaceholderDialog';
import AuthDialog from '@/components/auth/AuthDialog';
import { DEMO_KIND_META, buildDemoApp, TEMPLATE_CATEGORY_KIND, type DemoApp } from '@/lib/demo-apps';
import {
  createConversation,
  createProject,
  fetchCommunityApps,
  fetchProjects,
  fetchTemplates,
  insertMessage,
  type CommunityApp,
  type Project,
  type Template,
} from '@/lib/supabase';

const WELCOME_AVATARS = [
  { emoji: '🧑\u200d💻', gradient: 'from-violet-500 to-fuchsia-500' },
  { emoji: '👩\u200d🎨', gradient: 'from-blue-500 to-cyan-400' },
  { emoji: '🧙', gradient: 'from-emerald-500 to-teal-400' },
  { emoji: '🦸', gradient: 'from-amber-500 to-orange-500' },
  { emoji: '🤖', gradient: 'from-rose-500 to-pink-500' },
  { emoji: '👨\u200d🚀', gradient: 'from-indigo-500 to-sky-400' },
  { emoji: '🕵️', gradient: 'from-lime-500 to-green-400' },
  { emoji: '🧛', gradient: 'from-purple-500 to-violet-400' },
];

type QuickTab = 'discover' | 'projects' | 'templates';

/**
 * 首页(T13 后):仅保留欢迎视图 + 输入区 + 快捷区。
 * 提交后创建会话并立即跳转 /chat/:conversationId 详情页,
 * 消息流、流式生成、应用查看器与队列全部在详情页完成。
 */
export default function HomePage() {
  const navigate = useNavigate();
  const { profile, currentSpace, user, loading, demoMode } = useAuth();

  // 输入区状态(由 ChatComposer 承载交互,这里保存提交所需的值)
  const [prompt, setPrompt] = useState('');
  // T15:主题默认无选中(AppThemeDef | null),未选择时不高亮、不注入主题提示
  const [theme, setTheme] = useState<AppThemeDef | null>(null);
  const [mode, setMode] = useState<ComposerMode>('goal');

  // 底部快捷区
  const [quickTab, setQuickTab] = useState<QuickTab>('discover');
  const [apps, setApps] = useState<CommunityApp[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  // 模板占位填写:首页模板快捷区点击模板后先填写占位内容再生成
  const [placeholderTemplate, setPlaceholderTemplate] = useState<Template | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  // 模板生成结果预览(对话生成的预览在详情页查看器中)
  const [previewApp, setPreviewApp] = useState<DemoApp | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(true);

  const displayName = profile?.display_name ?? '开发者';
  const uid = user?.id ?? 'demo-user';

  useEffect(() => {
    fetchCommunityApps('全部').then(setApps).catch(() => setApps([]));
    fetchTemplates('全部').then(setTemplates).catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    // 云端模式未登录时不发起查询:uid 回退 'demo-user' 不是合法 uuid,REST 必返 400 噪声
    if (loading || (!user && !demoMode)) return;
    fetchProjects(uid, false).then(setProjects).catch(() => setProjects([]));
  }, [loading, uid, user, demoMode]);

  /** T13:提交即建会话并跳转详情页,生成/流式/预览全部在详情页完成 */
  const handleSend = async () => {
    const text = prompt.trim();
    if (!text) {
      toast.error('请先输入你要构建的应用描述');
      return;
    }

    // 未登录(Supabase 已配置)时先弹登录,避免伪造身份触发 RLS/外键报错
    if (!demoMode && !user) {
      setAuthOpen(true);
      toast.info('请先登录后再发起对话');
      return;
    }

    // 工作区守卫:会话归属当前工作区;已登录但暂无工作区时先引导创建
    if (!demoMode && user && !currentSpace && !loading) {
      toast.error('当前账号暂无工作区,请点击侧边栏空间选择器中的「新建工作区」后再发起对话');
      return;
    }

    const title = text.length > 24 ? `${text.slice(0, 24)}…` : text;
    let convId = '';
    try {
      const conv = await createConversation(uid, currentSpace?.id ?? null, title);
      convId = conv.id;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建对话失败,请重试');
      return;
    }
    try {
      await insertMessage(convId, 'user', text);
    } catch (error) {
      console.error('[chat] 用户消息写入失败:', error);
      toast.warning(error instanceof Error ? error.message : '消息写入失败,对话内容可能不会保存');
    }
    window.dispatchEvent(new Event('atoms:conversations-updated'));
    navigate(`/chat/${convId}`, { state: { initialPrompt: text, themeName: theme?.name, mode } });
  };

  /** 模板占位填写完成:占位值真实注入 HTML,落库并打开预览(首页模板快捷区共用) */
  const generateFromTemplate = async (tpl: Template, values: Record<string, string>) => {
    setCreatingTemplate(true);
    try {
      const kind = TEMPLATE_CATEGORY_KIND[tpl.category] ?? 'landing';
      const generated = buildDemoApp(`${tpl.title} ${tpl.category}`, theme?.name ?? '默认', {
        kind,
        title: tpl.title,
        values,
      });
      const project = await createProject({
        userId: uid,
        spaceId: currentSpace?.id ?? null,
        name: `${tpl.title} 实例`,
        description: `基于模板 ${tpl.title} 创建(已替换占位内容)`,
        source: 'template',
        coverGradient: tpl.cover_gradient,
        coverEmoji: tpl.cover_emoji,
        appHtml: generated.files[0].content,
      });
      if (project) {
        toast.success(`已基于「${tpl.title}」创建项目,占位内容已替换`);
        setPlaceholderTemplate(null);
        setPreviewApp(generated);
        fetchProjects(uid, false).then(setProjects).catch(() => undefined);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建项目失败,请重试');
    } finally {
      setCreatingTemplate(false);
    }
  };

  const navigateByTab = (tab: QuickTab) => {
    if (tab === 'discover' || tab === 'templates') {
      navigate('/resources');
    } else {
      navigate('/projects');
    }
  };

  // -------------------------------------------------------------------------
  // 欢迎视图(T13 后首页唯一主视图)
  // -------------------------------------------------------------------------
  const welcomeView = (
    <div className="flex min-h-full flex-col">
      {noticeOpen && (
        <div className="flex justify-center pt-4">
          <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-violet-500" />
            Atoms 更新:智能体分步计划、实时预览与全新首页
            <button
              type="button"
              aria-label="关闭公告"
              onClick={() => setNoticeOpen(false)}
              className="rounded-full p-0.5 hover:bg-background"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col items-center justify-center px-6 pt-10">
        <div className="mb-6 flex -space-x-2">
          {WELCOME_AVATARS.map((avatar, index) => (
            <div
              key={index}
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-lg ring-2 ring-background',
                avatar.gradient,
              )}
            >
              {avatar.emoji}
            </div>
          ))}
        </div>
        <h1 className="text-center text-3xl font-bold tracking-tight md:text-4xl">
          你的下一个产品从这里开始,{displayName}。
        </h1>
        <div className="mt-8 w-full max-w-3xl">
          <ChatComposer
            prompt={prompt}
            onPromptChange={setPrompt}
            generating={false}
            onSend={() => void handleSend()}
            onStop={() => undefined}
            theme={theme}
            onThemeChange={setTheme}
            mode={mode}
            onModeChange={setMode}
            referenceProjects={projects.map((p) => ({ id: p.id, name: p.name }))}
          />
        </div>
      </div>

      {/* 底部快捷区:发现/我的项目/模板 */}
      <div className="mt-10 w-full bg-muted/30 px-6 py-5">
        <div className="mx-auto max-w-4xl">
          <div className="flex items-center justify-between">
            <Tabs value={quickTab} onValueChange={(v) => setQuickTab(v as QuickTab)}>
              <TabsList className="rounded-full bg-background">
                <TabsTrigger value="discover" className="rounded-full px-4 text-xs">发现</TabsTrigger>
                <TabsTrigger value="projects" className="rounded-full px-4 text-xs">我的项目</TabsTrigger>
                <TabsTrigger value="templates" className="rounded-full px-4 text-xs">模板</TabsTrigger>
              </TabsList>
            </Tabs>
            <button
              type="button"
              className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => navigateByTab(quickTab)}
            >
              查看全部
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">{quickGrid()}</div>
        </div>
      </div>
    </div>
  );

  function quickGrid() {
    if (quickTab === 'discover') {
      return apps.slice(0, 4).map((app) => (
        <button key={app.id} type="button" className="group text-left"
          onClick={() => toast.info(`「${app.title}」的体验与克隆将在资源页开放`)}>
          <div className={cn(
            'flex h-28 items-center justify-center rounded-xl bg-gradient-to-br text-3xl shadow-sm transition-transform group-hover:scale-[1.02]',
            app.cover_gradient,
          )}>
            {app.cover_emoji}
          </div>
          <div className="mt-2 truncate text-sm font-medium">{app.title}</div>
          <div className="text-xs text-muted-foreground">{app.author_name}</div>
        </button>
      ));
    }
    if (quickTab === 'templates') {
      return templates.slice(0, 4).map((tpl) => (
        <button key={tpl.id} type="button" className="group text-left"
          onClick={() => {
            if (!demoMode && !user) {
              setAuthOpen(true);
              toast.info('请先登录后再使用模板');
              return;
            }
            setPlaceholderTemplate(tpl);
          }}
        >
          <div className={cn(
            'flex h-28 items-center justify-center rounded-xl bg-gradient-to-br text-3xl shadow-sm transition-transform group-hover:scale-[1.02]',
            tpl.cover_gradient,
          )}>
            {tpl.cover_emoji}
          </div>
          <div className="mt-2 truncate text-sm font-medium">{tpl.title}</div>
          <div className="text-xs text-muted-foreground">{tpl.category}</div>
        </button>
      ));
    }
    if (projects.length === 0) {
      return (
        <div className="col-span-4 rounded-xl border border-dashed py-8 text-center text-sm text-muted-foreground">
          还没有项目,输入上方提示词开始创建
        </div>
      );
    }
    return projects.slice(0, 4).map((project) => (
      <button key={project.id} type="button" className="group text-left"
        onClick={() => toast.info('项目工作区将在后续任务开放')}>
        <div className={cn(
          'flex h-28 items-center justify-center rounded-xl bg-gradient-to-br text-3xl shadow-sm transition-transform group-hover:scale-[1.02]',
          project.cover_gradient,
        )}>
          {project.cover_emoji}
        </div>
        <div className="mt-2 truncate text-sm font-medium">{project.name}</div>
        <div className="text-xs text-muted-foreground">
          {project.source === 'created' ? '创建' : project.source === 'cloned' ? '克隆' : '模板'}
        </div>
      </button>
    ));
  }

  return (
    <div className="h-full min-w-0">
      {welcomeView}

      {/* 模板生成结果预览:固定右侧面板,可关闭 */}
      {previewApp && (
        <div className="fixed inset-y-0 right-0 z-50 w-[45%] min-w-[420px] border-l shadow-2xl">
          <AppPreview app={previewApp} onClose={() => setPreviewApp(null)} />
        </div>
      )}

      {/* 模板占位填写弹窗:填写后一键生成,占位值真实注入应用 */}
      <TemplatePlaceholderDialog
        template={placeholderTemplate}
        open={Boolean(placeholderTemplate)}
        onOpenChange={(v) => !v && setPlaceholderTemplate(null)}
        onConfirm={(values) => {
          if (placeholderTemplate) void generateFromTemplate(placeholderTemplate, values);
        }}
        submitting={creatingTemplate}
      />

      {/* 登录弹窗:未登录发起对话/使用模板时弹出 */}
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
}
