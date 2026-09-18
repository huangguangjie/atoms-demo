import { useCallback, useEffect, useState } from 'react';
import { Database, Heart, PlayCircle, Sparkles } from 'lucide-react';
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
import AppPreview from '@/components/preview/AppPreview';
import type { DemoApp } from '@/lib/demo-apps';
import { fetchProjects, toggleProjectFavorite, type Project } from '@/lib/supabase';

const SOURCE_LABEL: Record<Project['source'], string> = {
  created: '自主创建',
  cloned: '克隆',
  template: '模板',
};

/** 项目卡片点击后的预览回放应用 */
function projectToDemoApp(project: Project): DemoApp {
  const html = project.app_html || '<!doctype html><html><body style="font-family:system-ui;padding:40px;color:#333"><h1>该项目尚未生成应用内容</h1><p>回到首页输入需求,让智能体生成应用后会自动保存到这里。</p></body></html>';
  return {
    title: project.name,
    kind: 'notes',
    files: [{ name: 'index.html', content: html, language: 'html' }],
  };
}

export default function ProjectsPage() {
  const { user, loading, demoMode } = useAuth();
  const [tab, setTab] = useState<'all' | 'favorites'>('all');
  const [projects, setProjects] = useState<Project[]>([]);
  const [fetching, setFetching] = useState(true);
  const [previewing, setPreviewing] = useState<Project | null>(null);

  const userId = user?.id ?? (demoMode ? 'demo-user' : '');

  const load = useCallback(async () => {
    if (!userId) return;
    setFetching(true);
    fetchProjects(userId, tab === 'favorites')
      .then(setProjects)
      .catch(() => setProjects([]))
      .finally(() => setFetching(false));
  }, [userId, tab]);

  useEffect(() => {
    if (!loading) void load();
  }, [loading, load]);

  // 首页智能体生成应用后自动刷新项目列表
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener('atoms:projects-updated', handler);
    return () => window.removeEventListener('atoms:projects-updated', handler);
  }, [load]);

  const handleFavorite = async (project: Project) => {
    await toggleProjectFavorite(project);
    toast.success(project.favorite ? '已取消收藏' : '已收藏');
    void load();
  };

  const handleOpen = (project: Project) => {
    if (project.app_html) {
      setPreviewing(project);
    } else {
      toast.info(`「${project.name}」暂无应用内容,回到首页生成后会自动保存到这里`);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">我的项目</h1>
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
        onValueChange={(v) => setTab(v as 'all' | 'favorites')}
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="all">全部</TabsTrigger>
          <TabsTrigger value="favorites">已收藏</TabsTrigger>
        </TabsList>
      </Tabs>

      {fetching || loading ? (
        <div className="mt-8 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <div className="aspect-[4/3] animate-pulse rounded-xl bg-muted" />
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="mt-24 flex flex-col items-center gap-3 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
            <Database className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {tab === 'favorites' ? '还没有收藏的项目' : '还没有项目'}
          </p>
          <p className="text-xs text-muted-foreground">回到首页,输入你的第一个应用创意开始。</p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {projects.map((project) => (
            <div
              key={project.id}
              className="group overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md"
            >
              <button
                type="button"
                onClick={() => handleOpen(project)}
                className={cn(
                  'relative flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br text-5xl',
                  project.cover_gradient,
                )}
              >
                {project.cover_emoji}
                {project.app_html && (
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-[10px] text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                    <PlayCircle className="h-3 w-3" />
                    预览
                  </span>
                )}
                <span
                  role="button"
                  aria-label={project.favorite ? '取消收藏' : '收藏'}
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleFavorite(project);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.stopPropagation();
                      void handleFavorite(project);
                    }
                  }}
                  className={cn(
                    'absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 shadow-sm transition-transform hover:scale-110',
                    project.favorite ? 'text-rose-500' : 'text-muted-foreground',
                  )}
                >
                  <Heart className={cn('h-3.5 w-3.5', project.favorite && 'fill-current')} />
                </span>
              </button>
              <div className="space-y-1.5 p-3">
                <div className="truncate text-sm font-medium">{project.name}</div>
                {project.description && (
                  <div className="line-clamp-1 text-xs text-muted-foreground">
                    {project.description}
                  </div>
                )}
                <div className="flex items-center justify-between pt-0.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Sparkles className="h-3 w-3" />
                    {SOURCE_LABEL[project.source]}
                  </span>
                  <span>{project.views} 次浏览</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 项目预览回放:点击有应用内容的项目卡片时打开 */}
      <Dialog open={Boolean(previewing)} onOpenChange={(v) => !v && setPreviewing(null)}>
        <DialogContent className="h-[85vh] max-w-4xl overflow-hidden p-0 sm:max-w-4xl">
          <DialogHeader className="sr-only">
            <DialogTitle>{previewing?.name} 预览</DialogTitle>
            <DialogDescription>项目应用的实时预览与源码查看</DialogDescription>
          </DialogHeader>
          {previewing && <AppPreview app={projectToDemoApp(previewing)} onClose={() => setPreviewing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
