import { useEffect, useState } from 'react';
import { Eye, Link2, PlayCircle, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import AuthDialog from '@/components/auth/AuthDialog';
import AppPreview from '@/components/preview/AppPreview';
import TemplatePlaceholderDialog from '@/components/templates/TemplatePlaceholderDialog';
import { buildDemoApp, pickAppTitle, TEMPLATE_CATEGORY_KIND, type DemoApp } from '@/lib/demo-apps';
import {
  COMMUNITY_CATEGORIES,
  createProject,
  fetchCommunityApps,
  fetchTemplates,
  type CommunityApp,
  type Template,
} from '@/lib/supabase';

const FILTER_TABS = [
  '全部',
  'Website',
  'Game',
  'E-commerce',
  'Productivity',
  'Prototype',
  'Data Analysis',
  'Blog',
  'Business Card',
];

/** 社区应用点击「体验」后打开的演示应用 */
function appToDemoApp(app: CommunityApp): DemoApp {
  const generated = buildDemoApp(`${app.title} ${app.category}`, '默认');
  return { ...generated, title: app.title };
}

/**
 * 模板 + 占位值 → 演示应用:按模板分类选择对应应用类型,
 * 用户填写的占位值会真实注入生成的 HTML。
 */
function templateToDemoApp(template: Template, values: Record<string, string>): DemoApp {
  const kind = TEMPLATE_CATEGORY_KIND[template.category] ?? 'landing';
  return buildDemoApp(`${template.title} ${template.category}`, '默认', {
    kind,
    title: template.title,
    values,
  });
}

export default function ResourcesPage() {
  const { user, currentSpace, demoMode } = useAuth();
  const [tab, setTab] = useState<'discover' | 'templates'>('discover');
  const [category, setCategory] = useState('全部');
  const [apps, setApps] = useState<CommunityApp[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [previewApp, setPreviewApp] = useState<DemoApp | null>(null);
  const [placeholderTemplate, setPlaceholderTemplate] = useState<Template | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);

  useEffect(() => {
    setLoading(true);
    if (tab === 'discover') {
      fetchCommunityApps(category)
        .then(setApps)
        .catch(() => setApps([]))
        .finally(() => setLoading(false));
    } else {
      fetchTemplates(category)
        .then(setTemplates)
        .catch(() => setTemplates([]))
        .finally(() => setLoading(false));
    }
  }, [tab, category]);

  /** 需要登录的操作:未登录时先弹登录框 */
  const requireAuth = (): string | null => {
    const uid = user?.id ?? (demoMode ? 'demo-user' : '');
    if (!uid) {
      setAuthOpen(true);
      toast.info('请先登录后再执行该操作');
      return null;
    }
    return uid;
  };

  /** 体验:打开真实可运行的应用预览 */
  const handleTry = (app: CommunityApp) => {
    setPreviewApp(appToDemoApp(app));
  };

  /** 克隆:把社区应用落成 source=cloned 的项目(含应用 HTML) */
  const handleClone = async (app: CommunityApp) => {
    const uid = requireAuth();
    if (!uid) return;
    const generated = appToDemoApp(app);
    try {
      const project = await createProject({
        userId: uid,
        spaceId: currentSpace?.id ?? null,
        name: `${pickAppTitle(app.title)} 克隆`,
        description: `从社区克隆的应用(原作者:${app.author_name})`,
        source: 'cloned',
        coverGradient: app.cover_gradient,
        coverEmoji: app.cover_emoji,
        appHtml: generated.files[0].content,
      });
      if (project) {
        toast.success(`已克隆「${app.title}」到我的项目,可打开预览并魔改`);
        window.dispatchEvent(new Event('atoms:projects-updated'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '克隆失败,请重试');
    }
  };

  /** 使用模板:打开占位填写弹窗(未登录先弹登录) */
  const handleUseTemplate = (template: Template) => {
    if (!requireAuth()) return;
    setPlaceholderTemplate(template);
  };

  /** 占位填写完成后一键生成:占位值真实注入 HTML,落库并直接打开预览 */
  const handleGenerateFromTemplate = async (
    template: Template,
    values: Record<string, string>,
  ) => {
    const uid = requireAuth();
    if (!uid) return;
    setCreatingTemplate(true);
    try {
      const generated = templateToDemoApp(template, values);
      const project = await createProject({
        userId: uid,
        spaceId: currentSpace?.id ?? null,
        name: `${template.title} 实例`,
        description: `基于模板 ${template.title} 创建(已替换占位内容)`,
        source: 'template',
        coverGradient: template.cover_gradient,
        coverEmoji: template.cover_emoji,
        appHtml: generated.files[0].content,
      });
      if (project) {
        toast.success(`已基于「${template.title}」创建项目,占位内容已替换`);
        window.dispatchEvent(new Event('atoms:projects-updated'));
        setPlaceholderTemplate(null);
        setPreviewApp(generated);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建项目失败,请重试');
    } finally {
      setCreatingTemplate(false);
    }
  };

  const cardGradient =
    'flex aspect-[4/3] items-center justify-center rounded-t-xl bg-gradient-to-br text-5xl';

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">资源</h1>
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => toast.info('个人主页即将开放')}
        >
          我的个人主页
        </button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as 'discover' | 'templates');
          setCategory('全部');
        }}
        className="mt-4"
      >
        <TabsList className="rounded-full">
          <TabsTrigger value="discover" className="rounded-full px-5">
            发现
          </TabsTrigger>
          <TabsTrigger value="templates" className="rounded-full px-5">
            模板
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* 分类过滤 */}
      <div className="mt-4 flex flex-wrap gap-2">
        {FILTER_TABS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs transition-colors',
              category === item
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground hover:text-foreground',
            )}
          >
            {item}
          </button>
        ))}
      </div>

      {/* 内容网格 */}
      {loading ? (
        <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="aspect-[4/3] animate-pulse rounded-xl bg-muted" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : tab === 'discover' ? (
        apps.length === 0 ? (
          <div className="mt-16 text-center text-sm text-muted-foreground">
            该分类下暂无社区应用
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
            {apps.map((app) => (
              <div
                key={app.id}
                className="group overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                <div className={cn(cardGradient, app.cover_gradient)}>{app.cover_emoji}</div>
                <div className="space-y-2 p-3">
                  <div className="truncate text-sm font-medium">{app.title}</div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <UserRound className="h-3 w-3" />
                      {app.author_name}
                    </span>
                    <span className="flex items-center gap-1">
                      <Eye className="h-3 w-3" />
                      {app.views}
                    </span>
                  </div>
                  <div className="flex gap-1.5 pt-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-foreground px-2 py-1.5 text-[11px] font-medium text-background"
                      onClick={() => handleTry(app)}
                    >
                      <PlayCircle className="h-3 w-3" />
                      体验
                    </button>
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-muted px-2 py-1.5 text-[11px] font-medium"
                      onClick={() => void handleClone(app)}
                    >
                      <Link2 className="h-3 w-3" />
                      克隆
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : templates.length === 0 ? (
        <div className="mt-16 text-center text-sm text-muted-foreground">该分类下暂无模板</div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {templates.map((template) => {
            const placeholders = template.placeholders ?? [];
            return (
              <div
                key={template.id}
                className="group overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
              >
                <div className={cn(cardGradient, template.cover_gradient)}>
                  {template.cover_emoji}
                </div>
                <div className="space-y-2 p-3">
                  <div className="truncate text-sm font-medium">{template.title}</div>
                  <div className="line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground">
                    {template.description}
                  </div>
                  {placeholders.length > 0 && (
                    <div className="rounded-md bg-muted/60 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
                      <span className="font-medium text-foreground">
                        占位字段({placeholders.length}):
                      </span>
                      {placeholders.map((p) => p.label).join('、')}
                    </div>
                  )}
                  <button
                    type="button"
                    className="w-full rounded-md bg-foreground px-2 py-1.5 text-[11px] font-medium text-background"
                    onClick={() => handleUseTemplate(template)}
                  >
                    使用模板
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 底部说明 */}
      <p className="mt-10 text-center text-xs text-muted-foreground">
        {tab === 'discover'
          ? '发现:来自社区分享的应用,可体验、克隆魔改或自行部署。'
          : '模板:点击「使用模板」填写占位内容,一键生成属于你的应用。'}
        {COMMUNITY_CATEGORIES.length > 0 ? '' : ''}
      </p>

      {/* 应用体验预览 */}
      <Dialog open={Boolean(previewApp)} onOpenChange={(v) => !v && setPreviewApp(null)}>
        <DialogContent className="h-[85vh] max-w-4xl overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{previewApp?.title} 在线体验</DialogTitle>
            <DialogDescription>社区应用的实时预览</DialogDescription>
          </DialogHeader>
          {previewApp && <AppPreview app={previewApp} onClose={() => setPreviewApp(null)} />}
        </DialogContent>
      </Dialog>

      {/* 模板占位填写弹窗:确认后真实注入占位值并创建项目 */}
      <TemplatePlaceholderDialog
        template={placeholderTemplate}
        open={Boolean(placeholderTemplate)}
        onOpenChange={(v) => !v && setPlaceholderTemplate(null)}
        onConfirm={(values) => {
          if (placeholderTemplate) void handleGenerateFromTemplate(placeholderTemplate, values);
        }}
        submitting={creatingTemplate}
      />

      {/* 登录弹窗:克隆/使用模板前需要身份 */}
      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </div>
  );
}
