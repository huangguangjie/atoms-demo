import { useEffect, useState } from 'react';
import { Eye, Link2, PlayCircle, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  COMMUNITY_CATEGORIES,
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

export default function ResourcesPage() {
  const [tab, setTab] = useState<'discover' | 'templates'>('discover');
  const [category, setCategory] = useState('全部');
  const [apps, setApps] = useState<CommunityApp[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);

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
                      onClick={() => toast.info(`「${app.title}」在线体验即将开放`)}
                    >
                      <PlayCircle className="h-3 w-3" />
                      体验
                    </button>
                    <button
                      type="button"
                      className="flex flex-1 items-center justify-center gap-1 rounded-md bg-muted px-2 py-1.5 text-[11px] font-medium"
                      onClick={() => toast.info(`「${app.title}」克隆后可在我的项目中魔改`)}
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
          {templates.map((template) => (
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
                <button
                  type="button"
                  className="w-full rounded-md bg-foreground px-2 py-1.5 text-[11px] font-medium text-background"
                  onClick={() => toast.info('使用模板创建项目:请到首页输入区描述你的定制需求')}
                >
                  使用模板
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 底部说明 */}
      <p className="mt-10 text-center text-xs text-muted-foreground">
        {tab === 'discover'
          ? '发现:来自社区分享的应用,可体验、克隆魔改或自行部署。'
          : '模板:现成的开发方案,在占位处替换内容即可作为你的应用基础。'}
        {COMMUNITY_CATEGORIES.length > 0 ? '' : ''}
      </p>
    </div>
  );
}
