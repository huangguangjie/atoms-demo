import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AppWindow,
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  CloudUpload,
  Code2,
  Download,
  Eye,
  FileText,
  FlaskConical,
  FolderOpen,
  History,
  LineChart,
  Loader2,
  MessagesSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Share2,
  Square,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import ChatMessage, { type ChatMessageData } from '@/components/chat/ChatMessage';
import ChatComposer, {
  APP_THEMES,
  type AppThemeDef,
  type ComposerMode,
} from '@/components/chat/ChatComposer';
import { runAgent, type AgentPlanStep } from '@/lib/agent';
import { DEMO_KIND_META, type DemoApp } from '@/lib/demo-apps';
import {
  createProject,
  fetchConversation,
  fetchConversationMessages,
  fetchConversationProject,
  fetchProjectVersions,
  fetchProjects,
  fetchRecentConversations,
  insertMessage,
  insertProjectVersion,
  PROJECT_VERSION_SOURCE_LABEL,
  updateProjectAppHtml,
  type Conversation,
  type Project,
  type ProjectVersion,
  type ProjectVersionSource,
} from '@/lib/supabase';

type CenterTab = 'overview' | 'editor' | 'cloud' | 'files' | 'growth';

const CENTER_TABS: { key: CenterTab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'editor', label: '编辑器' },
  { key: 'cloud', label: 'Atoms 云' },
  { key: 'files', label: '文件' },
  { key: 'growth', label: '增长' },
];

/** 占位页签空态(T13:概览/编辑器优先实现,其余页签提供真实空态入口) */
function TabEmptyState({
  icon: Icon,
  title,
  desc,
}: {
  icon: typeof Cloud;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </span>
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-sm text-xs leading-5 text-muted-foreground">{desc}</p>
    </div>
  );
}

/** T21:错误文案指引——区分限流/上游网关故障/网络波动,给出可操作的重试指引而非裸状态码 */
function friendlyErrorMessage(raw: string): string {
  if (/429/.test(raw)) {
    return `${raw}。请求触发限流,请稍候片刻再点击「重新生成」。`;
  }
  // T25:上游 AI 账户余额不足(402,确定性业务错误)——重试无意义,明确告知原因与出路
  if (/余额不足|402/.test(raw)) {
    return `${raw}。平台 AI 账户额度已耗尽(确定性错误,重试无效);可点击下方「使用演示模式生成」先用本地演示应用体验完整流程,待账户充值恢复后再点「重新生成」。`;
  }
  // T23:平台 AI 网关整体故障(主/备模型均失败)——显式指引演示模式入口,由用户主动选择
  if (/平台 AI 网关故障/.test(raw)) {
    return `${raw}。AI 上游服务持续不可用;可点击下方「使用演示模式生成」先用本地演示应用体验完整流程,稍后再点「重新生成」重试真实 AI。`;
  }
  if (/响应异常[:：]\s*5\d{2}|AI 服务响应异常/.test(raw)) {
    return `${raw}。AI 服务暂时不可用(上游网关波动),请稍后点击「重新生成」重试;若持续失败请等几分钟再试。`;
  }
  if (/连接中断|Failed to fetch|NetworkError/i.test(raw)) {
    return `${raw}。网络波动导致连接中断,请点击「重新生成」重试。`;
  }
  return `${raw}。请点击「重新生成」重试,或调整需求描述后再试。`;
}

/** T25:导出 HTML——Blob 下载最新产物或指定版本快照 */
function downloadAppHtml(app: DemoApp, html: string, suffix?: string) {
  const safeName = app.title.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40) || 'app';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = suffix ? `${safeName}-${suffix}.html` : `${safeName}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

interface AppViewerProps {
  app: DemoApp;
  /** 关联项目(为空时版本/回滚能力不可用) */
  project: Project | null;
  /** 版本历史(版本号倒序) */
  versions: ProjectVersion[];
  /** 正在查看的历史版本 id(null=最新) */
  viewingVersionId: string | null;
  onViewVersion: (id: string | null) => void;
  onRollback: (version: ProjectVersion) => void;
  rollingBack: boolean;
  /** T25:打开历史版本面板时重新拉取,兜底刷新恢复阶段请求挂起导致的空列表 */
  onPanelOpen?: () => void;
  /** T25:版本历史加载中(恢复期请求超时重试时,面板显示加载态而非「暂无版本记录」) */
  versionsLoading?: boolean;
}

/** 应用查看器:iframe 实时预览 + 源码查看 + 刷新 + 历史版本面板(查看/回滚/导出,T25) */
function AppViewer({
  app,
  project,
  versions,
  viewingVersionId,
  onViewVersion,
  onRollback,
  rollingBack,
  onPanelOpen,
  versionsLoading,
}: AppViewerProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [frameKey, setFrameKey] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [rollbackConfirmId, setRollbackConfirmId] = useState<string | null>(null);
  const file = app.files[0];
  const viewed = viewingVersionId
    ? versions.find((version) => version.id === viewingVersionId) ?? null
    : null;
  const displayHtml = viewed ? viewed.app_html : file.content;

  // 关闭面板时清掉未确认的回滚态
  useEffect(() => {
    if (!panelOpen) setRollbackConfirmId(null);
  }, [panelOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3">
        <span className="min-w-0 truncate text-sm font-medium">{app.title}</span>
        {/* T23:演示模式产物显式标注,与真实 AI 生成区分 */}
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px]',
            app.isDemo ? 'bg-amber-400/20 text-amber-300' : 'bg-muted text-muted-foreground',
          )}
        >
          {app.isDemo ? '演示模式' : '生成应用'}
        </span>
        <div className="relative ml-auto flex items-center gap-1">
          <div className="flex items-center rounded-lg bg-muted p-0.5">
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                tab === 'preview'
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              预览
            </button>
            <button
              type="button"
              onClick={() => setTab('code')}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors',
                tab === 'code'
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Code2 className="h-3.5 w-3.5" />
              代码
            </button>
          </div>
          {/* T25:历史版本入口(数量徽标;查看历史时高亮) */}
          <Button
            variant={viewed ? 'secondary' : 'ghost'}
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            title="历史版本"
            onClick={() => {
              const next = !panelOpen;
              setPanelOpen(next);
              // T25:每次打开面板都重新拉取,避免恢复期请求挂起后停留在空态
              if (next) onPanelOpen?.();
            }}
          >
            <History className="h-3.5 w-3.5" />
            历史版本
            {versions.length > 0 && (
              <span className="rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-500">
                {versions.length}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setFrameKey((key) => key + 1)}
            title="刷新预览"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          {panelOpen && (
            <div className="absolute right-0 top-9 z-30 w-80 rounded-xl border bg-popover p-1.5 shadow-xl">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">历史版本</span>
                {viewed && (
                  <button
                    type="button"
                    onClick={() => onViewVersion(null)}
                    className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-violet-500 hover:bg-violet-500/10"
                  >
                    返回最新
                  </button>
                )}
              </div>
              {versions.length === 0 ? (
                <p className="px-2 pb-3 pt-1 text-[11px] leading-relaxed text-muted-foreground">
                  {versionsLoading
                    ? '正在读取版本历史…'
                    : '暂无版本记录;首次生成、增量修改、在线编辑保存与回滚都会自动记录版本。'}
                </p>
              ) : (
                <div className="max-h-72 overflow-auto">
                  {versions.map((version) => {
                    const isActive = version.id === viewed?.id;
                    return (
                      <div
                        key={version.id}
                        className={cn(
                          'group rounded-lg px-2 py-1.5 transition-colors',
                          isActive ? 'bg-violet-500/10' : 'hover:bg-muted/70',
                        )}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              onViewVersion(version.id);
                              setPanelOpen(false);
                            }}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-medium">
                              v{version.version_number}
                              <span className="rounded bg-muted px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                                {PROJECT_VERSION_SOURCE_LABEL[version.source]}
                              </span>
                              {isActive && (
                                <span className="text-[10px] font-normal text-violet-500">查看中</span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {version.label || '未命名变更'}
                            </p>
                            <p className="text-[10px] text-muted-foreground/70">
                              {new Date(version.created_at).toLocaleString()} ·{' '}
                              {(version.app_html.length / 1024).toFixed(1)} KB
                            </p>
                          </button>
                          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title={`下载 v${version.version_number} HTML`}
                              onClick={() =>
                                downloadAppHtml(app, version.app_html, `v${version.version_number}`)
                              }
                            >
                              <Download className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              title={`回滚到 v${version.version_number}`}
                              disabled={rollingBack || !project}
                              onClick={() => setRollbackConfirmId(version.id)}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {rollbackConfirmId === version.id && (
                          <div className="mt-1.5 flex items-center gap-2 rounded-md bg-amber-400/10 px-2 py-1.5 text-[11px] text-amber-600">
                            <span className="min-w-0 flex-1 leading-snug">
                              回滚会创建新版本,不覆盖此快照。确认回滚到 v{version.version_number}?
                            </span>
                            <Button
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              disabled={rollingBack}
                              onClick={() => {
                                onRollback(version);
                                setRollbackConfirmId(null);
                              }}
                            >
                              {rollingBack ? <Loader2 className="h-3 w-3 animate-spin" /> : '确认'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={() => setRollbackConfirmId(null)}
                            >
                              取消
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      {/* T25:查看历史版本时的醒目提示条 */}
      {viewed && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b bg-amber-400/10 px-3 text-xs text-amber-600">
          <History className="h-3.5 w-3.5" />
          正在查看历史版本 v{viewed.version_number} · {PROJECT_VERSION_SOURCE_LABEL[viewed.source]}
          <button
            type="button"
            onClick={() => onViewVersion(null)}
            className="ml-auto rounded px-1.5 py-0.5 font-medium hover:bg-amber-400/20"
          >
            返回最新
          </button>
        </div>
      )}
      {tab === 'preview' ? (
        <iframe
          key={frameKey}
          title={`${app.title} 预览`}
          srcDoc={displayHtml}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          className="h-full w-full flex-1 bg-white"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto bg-[#0d1117] p-4 text-[12px] leading-relaxed text-[#c9d1d9]">
          <code>{displayHtml}</code>
        </pre>
      )}
      <div className="flex h-8 shrink-0 items-center gap-2 border-t bg-background px-3 text-[11px] text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{file.name}</span>
        <span>
          {viewed ? `历史快照 v${viewed.version_number}` : '最新版本 · 单文件应用 · 可直接运行'}
        </span>
        <button
          type="button"
          onClick={() =>
            downloadAppHtml(app, displayHtml, viewed ? `v${viewed.version_number}` : undefined)
          }
          className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
        >
          <Download className="h-3 w-3" />
          导出 HTML
        </button>
      </div>
    </div>
  );
}

/**
 * T13 历史对话详情页(/chat/:conversationId):
 * 顶栏左中右三段(Logo+会话+历史+折叠 | 工具图标组+更多菜单 | 跟随智能体+头像+分享+更新);
 * 左侧深色对话栏(消息流、队列、输入区,支持折叠);中部应用查看器页签
 * (概览=iframe 预览+源码,编辑器=只读源码,Atoms 云/文件/增长=空态)。
 */
export default function ChatDetailPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, currentSpace, demoMode } = useAuth();
  const uid = user?.id ?? 'demo-user';

  // 首页提交时携带的选择(仅首次挂载读取)
  const navState = location.state as
    | { initialPrompt?: string; themeName?: string; mode?: ComposerMode }
    | null;

  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [messagesLoaded, setMessagesLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  // T15:主题可为空——首页未选择主题时进入详情页同样保持无选中态
  const [theme, setTheme] = useState<AppThemeDef | null>(
    () => APP_THEMES.find((t) => t.name === navState?.themeName) ?? null,
  );
  const [mode, setMode] = useState<ComposerMode>(navState?.mode === 'build' ? 'build' : 'goal');
  const [app, setApp] = useState<DemoApp | null>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>('overview');
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [following, setFollowing] = useState(true);
  // T16:顶栏历史下拉(最近会话切换)与 # 引用菜单的项目列表
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyList, setHistoryList] = useState<Conversation[]>([]);
  const [refProjects, setRefProjects] = useState<Project[]>([]);
  // T21:生成失败后的「重新生成」入口(保留用户输入与会话上下文,不重复落库用户消息)
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);
  const [lastErrorMessage, setLastErrorMessage] = useState('');
  // T25:当前会话关联项目与版本历史(增量修改/在线编辑/回滚/导出的数据基础)
  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editHtml, setEditHtml] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<string[]>([]);
  const runFlowRef = useRef<(text: string, opts?: { userInserted?: boolean; explicitDemo?: boolean }) => Promise<void>>(
    async () => undefined,
  );
  const bootstrappedRef = useRef(false);

  // 会话与消息加载(切换会话参数时重新拉取,支持 Sidebar 历史回放)
  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    setMessagesLoaded(false);
    setMessages([]);
    setApp(null);
    setCenterTab('overview');
    // T25:切换会话时同步清理项目/版本/编辑态,避免串会话
    setProject(null);
    setVersions([]);
    setViewingVersionId(null);
    setEditing(false);
    // T26:归档会话对前端不可见(fetchConversation 过滤 status='active')。
    // 直达旧链接时先重试一次,排除瞬时 RLS/JWT 抖动,确认不可见再提示并返回首页。
    const loadConversation = (retry: boolean): Promise<Conversation | null> =>
      fetchConversation(conversationId).catch(() => null).then((conv) => {
        if (conv || !retry) return conv;
        return new Promise<Conversation | null>((resolve) => {
          setTimeout(() => {
            void fetchConversation(conversationId)
              .catch(() => null)
              .then(resolve);
          }, 800);
        });
      });
    loadConversation(true)
      .then((conv) => {
        if (cancelled) return;
        setConversation(conv);
        if (!conv) {
          toast.error('该会话已归档,不再展示于最近对话');
          navigate('/', { replace: true });
        }
      })
      .catch(() => undefined);
    fetchConversationMessages(conversationId)
      .then((rows) => {
        if (cancelled) return;
        // T25:历史回放携带消息级演示元数据,徽标与实时生成一致
        const history = rows.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          isDemo: m.metadata?.isDemo === true,
          // T25:回放恢复计划卡(落库时为最终状态,统一标记已完成)
          steps: m.metadata?.plan?.map((label) => ({ label, status: 'done' as const })),
        }));
        // T20:历史消息与本地消息合并而非整体覆盖——快速提交/生成中切换会话时,
        // 避免拉取完成把本地已渲染的消息(含流式中的助手气泡)冲掉
        setMessages((prev) => {
          if (prev.length === 0) return history;
          const seen = new Set(prev.map((m) => `${m.role}:${m.content}`));
          const missing = history.filter((m) => !seen.has(`${m.role}:${m.content}`));
          return [...missing, ...prev];
        });
        setMessagesLoaded(true);
      })
      .catch((error) => {
        toast.error(error instanceof Error ? error.message : '读取对话消息失败');
        navigate('/', { replace: true });
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, navigate]);

  // T16:# 引用菜单项目列表(登录态就绪后加载;演示模式 demo-user 直接可用)
  useEffect(() => {
    if (!demoMode && !user) return;
    fetchProjects(uid, false)
      .then(setRefProjects)
      .catch(() => setRefProjects([]));
  }, [uid, demoMode, user]);

  // T16:刷新后恢复会话关联的生成应用(项目 app_html 回放到应用查看器,不覆盖新生成的应用)
  useEffect(() => {
    if (!conversationId) return;
    if (!demoMode && !user) return;
    let cancelled = false;
    fetchConversationProject(conversationId, uid)
      .then((restored) => {
        if (cancelled) return;
        // T25:恢复关联项目本体,增量修改/在线编辑/版本历史才能继续工作
        setProject(restored);
        const html = restored?.app_html;
        if (!html) return;
        setApp((prev) => prev ?? {
          title: restored?.name ?? '生成应用',
          kind: 'landing',
          // T25:恢复项目 is_demo 标记,查看器演示徽标与项目页一致
          isDemo: restored?.is_demo === true,
          files: [{ name: 'index.html', content: html, language: 'html' }],
        });
      })
      .catch((error) => console.error('[chat] 恢复关联项目失败:', error));
    return () => {
      cancelled = true;
    };
  }, [conversationId, uid, demoMode, user]);

  const projectId = useMemo(() => project?.id ?? null, [project]);

  // T25:项目就绪后加载版本历史(刷新恢复等场景无写入动作,需主动拉取)
  useEffect(() => {
    if (!projectId) {
      setVersions([]);
      return;
    }
    let cancelled = false;
    setVersionsLoading(true);
    fetchProjectVersions(projectId)
      .then((list) => {
        if (!cancelled) setVersions(list);
      })
      .catch((error) => {
        console.error('[chat] 版本历史加载失败:', error);
        if (!cancelled) setVersions([]);
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // 消息流自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  /** 生成完成后把应用落成项目(与首页行为一致,进入「我的项目」) */
  /** T25:写入版本快照(版本号=最新+1,写入后刷新本地版本列表);失败真实透出,不静默吞错 */
  const recordVersion = async (
    projectId: string,
    source: ProjectVersionSource,
    label: string,
    appHtml: string,
  ): Promise<number | null> => {
    try {
      const existing = await fetchProjectVersions(projectId);
      const nextNumber = (existing[0]?.version_number ?? 0) + 1;
      await insertProjectVersion({
        projectId,
        userId: uid,
        versionNumber: nextNumber,
        source,
        label,
        appHtml,
      });
      setVersions(await fetchProjectVersions(projectId));
      return nextNumber;
    } catch (error) {
      console.error('[chat] 版本写入失败:', error);
      toast.error(error instanceof Error ? error.message : '版本记录写入失败');
      return null;
    }
  };

  /**
   * T25:生成完成后落库项目与版本——
   * 首次生成:创建项目(isDemo 透传)并写「首次生成」版本;
   * 增量修改:更新项目 app_html 并追加 generation 版本(标签=本次修改摘要)。
   */
  const handleAppCreated = async (
    created: DemoApp,
    opts?: { incremental?: boolean; changeSummary?: string },
  ) => {
    const html = created.files[0].content;
    const meta = DEMO_KIND_META[created.kind];
    try {
      if (opts?.incremental && project) {
        await updateProjectAppHtml(project.id, html, created.isDemo);
        setProject((prev) => (prev ? { ...prev, app_html: html } : prev));
        const nextNumber = await recordVersion(
          project.id,
          'generation',
          `增量修改:${(opts.changeSummary ?? '').slice(0, 40)}`,
          html,
        );
        toast.success(nextNumber ? `应用已更新,已记录版本 v${nextNumber}` : '应用已更新');
      } else {
        const createdProject = await createProject({
          userId: uid,
          spaceId: currentSpace?.id ?? null,
          name: created.title,
          // T23:演示模式产物在项目描述中明确标注,落库后项目页可辨识
          description: created.isDemo ? `演示模式生成的${meta.label}` : `智能体生成的${meta.label}`,
          source: 'created',
          coverGradient: meta.gradient,
          coverEmoji: meta.emoji,
          appHtml: html,
          conversationId: conversationId ?? null,
          // T25:演示产物标记落库,刷新恢复后查看器徽标与项目页一致
          isDemo: created.isDemo,
        });
        if (createdProject) {
          setProject(createdProject);
          await recordVersion(createdProject.id, 'generation', '首次生成', html);
          toast.success(`项目「${created.title}」已保存到我的项目`);
          window.dispatchEvent(new Event('atoms:projects-updated'));
        }
      }
      setViewingVersionId(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '项目保存失败,请重试');
    }
  };

  /** 完整生成流程:写入用户消息 → SSE 流式渲染 → 助手消息落库 → 队列续跑 */
  const runFlow = async (text: string, opts?: { userInserted?: boolean; explicitDemo?: boolean }) => {
    const convId = conversationId;
    if (!convId || !text.trim() || generating) return;
    if (!demoMode && !user) {
      toast.error('登录状态已失效,请重新登录后再继续对话');
      return;
    }
    const assistantId = `assistant-${Date.now()}`;
    // T25:增量修改——项目已有产物时携带上一版 HTML,服务端按修改模式生成;无项目(首轮)为空走首次生成
    const previousHtml = project?.app_html ?? '';
    // 首页跳转场景(userInserted)用户消息已落库并由历史加载渲染,本地只追加助手气泡,避免重复;
    // 后续提交(含队列续跑)的用户消息必须真实落库,否则刷新后历史回放缺条目
    if (!opts?.userInserted) {
      try {
        await insertMessage(convId, 'user', text);
      } catch (error) {
        console.error('[chat] 用户消息写入失败:', error);
        toast.error(error instanceof Error ? error.message : '消息写入失败,请重试');
      }
    }
    setMessages((prev) => [
      ...prev,
      ...(opts?.userInserted
        ? []
        : [{ id: `user-${Date.now()}`, role: 'user' as const, content: text }]),
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    setPrompt('');
    setFailedPrompt(null);
    setGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let firstMessage = '';
    let finalMessage = '';
    let errorMessage = '';
    let planSteps: string[] = [];

    try {
      // 主题真实生效:所选主题名传入生成链路;T15 未选择主题时传「默认」且不注入主题指令
      await runAgent({
        prompt: theme ? `${text}\n界面主题:${theme.promptHint}` : text,
        theme: theme?.name ?? '默认',
        mode,
        signal: controller.signal,
        // T23:显式演示模式由失败卡按钮触发,仅本次请求生效,不作为静默回退
        explicitDemo: opts?.explicitDemo === true,
        // T25:增量修改——已有项目产物时传入上一版 HTML,服务端进入修改模式
        ...(previousHtml ? { previousHtml } : {}),
        onEvent: (event) => {
          if (event.type === 'app') {
            setApp(event.app);
            setCenterTab('overview');
            void handleAppCreated(event.app, {
              incremental: Boolean(previousHtml),
              changeSummary: text,
            });
            return;
          }
          if (event.type === 'error') errorMessage = event.message;
          setMessages((prevMsgs) =>
            prevMsgs.map((m): ChatMessageData => {
              if (m.id !== assistantId) return m;
              switch (event.type) {
                case 'message': {
                  if (!firstMessage) firstMessage = event.content;
                  else finalMessage = event.content;
                  return { ...m, content: m.content ? `${m.content}\n\n${event.content}` : event.content };
                }
                case 'plan':
                  planSteps = event.steps;
                  return {
                    ...m,
                    steps: event.steps.map(
                      (label): AgentPlanStep => ({ label, status: 'pending' }),
                    ),
                  };
                case 'step-start':
                  return {
                    ...m,
                    steps: m.steps?.map((s, i) => (i === event.index ? { ...s, status: 'running' } : s)),
                  };
                case 'step-done':
                  return {
                    ...m,
                    steps: m.steps?.map((s, i) => (i === event.index ? { ...s, status: 'done' } : s)),
                  };
                case 'code-start':
                  return { ...m, codeProgress: 0 };
                case 'code-delta':
                  return { ...m, codeProgress: event.percent ?? m.codeProgress };
                case 'done':
                  return {
                    ...m,
                    streaming: false,
                    codeProgress: m.codeProgress !== undefined ? 100 : undefined,
                    content: event.stopped ? `${m.content}\n\n(已停止生成,可继续补充需求)` : m.content,
                  };
                case 'error':
                  // T21:记录失败需求与友好指引,消息流底部展示「重新生成」入口
                  setFailedPrompt(text);
                  setLastErrorMessage(friendlyErrorMessage(event.message));
                  return { ...m, streaming: false, content: `${m.content}\n\n生成出现问题:${event.message}` };
                default:
                  return m;
              }
            }),
          );
        },
      });
    } finally {
      setGenerating(false);
      abortRef.current = null;
      const parts = [firstMessage, finalMessage].filter(Boolean);
      // T20:计划步骤序列化落库——计划卡为实时结构化数据,历史回放以文本形式完整回显执行计划
      const planText = planSteps.length > 0
        ? `【执行计划】\n${planSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
        : '';
      // 错误同样如实落库:历史回放能看到失败的真实原因
      const bodyText = errorMessage
        ? `${parts.length > 0 ? `${parts.join('\n\n')}\n\n` : ''}生成出现问题:${errorMessage}`
        : parts.join('\n\n') || '生成已结束';
      const persisted = planText ? `${planText}\n\n${bodyText}` : bodyText;
      try {
        // T25:助手消息携带元数据(isDemo=演示产物;plan=执行计划),刷新回放恢复徽标与计划卡
        await insertMessage(convId, 'assistant', persisted, {
          ...(opts?.explicitDemo ? { isDemo: true } : {}),
          ...(planSteps.length > 0 ? { plan: planSteps } : {}),
        });
      } catch (error) {
        console.error('[chat] 助手消息写入失败:', error);
      }
      // T13 队列:当前生成结束后自动执行下一条排队需求
      if (queueRef.current.length > 0) {
        const next = queueRef.current[0];
        queueRef.current = queueRef.current.slice(1);
        setQueue(queueRef.current);
        setTimeout(() => void runFlowRef.current(next), 500);
      }
    }
  };

  useEffect(() => {
    runFlowRef.current = runFlow;
  });

  // 首页提交跳转而来:立即开始生成(用户消息已在首页写入,不重复落库)
  useEffect(() => {
    if (bootstrappedRef.current || !messagesLoaded) return;
    if (navState?.initialPrompt) {
      bootstrappedRef.current = true;
      window.history.replaceState({}, '');
      void runFlow(navState.initialPrompt, { userInserted: true });
    }
  }, [messagesLoaded, navState, runFlow]);

  /** 生成中提交:加入队列,当前生成结束后自动执行 */
  const enqueue = (text: string) => {
    if (!text.trim()) {
      toast.error('请先输入内容');
      return;
    }
    queueRef.current = [...queueRef.current, text.trim()];
    setQueue(queueRef.current);
    setPrompt('');
    toast.info('已加入队列,当前生成结束后自动执行');
  };

  const submit = () => {
    const text = prompt.trim();
    if (!text) {
      toast.error('请先输入你要构建的应用描述');
      return;
    }
    if (generating) {
      enqueue(text);
      return;
    }
    void runFlow(text);
  };

  const handleStop = () => {
    abortRef.current?.abort();
    toast.info('已停止生成');
  };

  /** T21:失败后重新生成——用户消息已在上次请求时落库,不重复写入,直接续跑生成 */
  const handleRegenerate = () => {
    if (!failedPrompt || generating) return;
    const text = failedPrompt;
    setFailedPrompt(null);
    void runFlow(text, { userInserted: true });
  };

  /** T23:失败后显式使用演示模式——用户主动触发的本地演示生成,非静默回退 */
  const handleDemoGenerate = () => {
    if (!failedPrompt || generating) return;
    const text = failedPrompt;
    setFailedPrompt(null);
    void runFlow(text, { userInserted: true, explicitDemo: true });
  };

  /** T25:打开历史版本面板时重新拉取(恢复阶段首轮请求可能超时,面板打开即补救) */
  const handleOpenVersions = async () => {
    if (!project) return;
    // 已有数据时静默补拉(不闪加载态);空列表时显示加载态,避免误判「暂无版本记录」
    if (versions.length === 0) setVersionsLoading(true);
    try {
      const list = await fetchProjectVersions(project.id);
      setVersions(list);
    } catch (error) {
      console.error('[chat] 版本历史刷新失败:', error);
      toast.error(error instanceof Error ? error.message : '版本历史刷新失败');
    } finally {
      setVersionsLoading(false);
    }
  };

  /** T25:切换历史版本查看——仅切换预览不落库;退出编辑态避免在旧快照上编辑 */
  const handleViewVersion = (id: string | null) => {
    setViewingVersionId(id);
    setEditing(false);
  };

  /** T25:一键回滚——以目标版本内容更新项目并新建 rollback 版本,绝不覆盖旧快照 */
  const handleRollback = async (version: ProjectVersion) => {
    if (rollingBack || !project) return;
    setRollingBack(true);
    try {
      await updateProjectAppHtml(project.id, version.app_html, app?.isDemo);
      setProject((prev) => (prev ? { ...prev, app_html: version.app_html } : prev));
      const nextNumber = await recordVersion(
        project.id,
        'rollback',
        `回滚至 v${version.version_number}`,
        version.app_html,
      );
      setApp((prev) =>
        prev ? { ...prev, files: [{ ...prev.files[0], content: version.app_html }] } : prev,
      );
      setViewingVersionId(null);
      toast.success(
        nextNumber
          ? `已回滚到 v${version.version_number},当前为 v${nextNumber}`
          : '已回滚到目标版本',
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '回滚失败,请重试');
    } finally {
      setRollingBack(false);
    }
  };

  /** T25:在线编辑——进入编辑态(查看历史版本时禁止编辑) */
  const startEdit = () => {
    if (!app) return;
    setEditHtml(app.files[0].content);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  /** T25:保存在线编辑——更新项目 app_html、写入 edit 版本并同步查看器与预览 */
  const saveEdit = async () => {
    if (savingEdit) return;
    const html = editHtml;
    if (!html.trim()) {
      toast.error('编辑内容不能为空');
      return;
    }
    if (!project) {
      toast.error('项目尚未落库,无法保存编辑,请重新生成后再试');
      return;
    }
    setSavingEdit(true);
    try {
      await updateProjectAppHtml(project.id, html, app?.isDemo);
      setProject((prev) => (prev ? { ...prev, app_html: html } : prev));
      const nextNumber = await recordVersion(project.id, 'edit', '在线编辑', html);
      setApp((prev) =>
        prev ? { ...prev, files: [{ ...prev.files[0], content: html }] } : prev,
      );
      setEditing(false);
      setViewingVersionId(null);
      setCenterTab('overview');
      toast.success(nextNumber ? `编辑已保存,已记录版本 v${nextNumber}` : '编辑已保存');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败,请重试');
    } finally {
      setSavingEdit(false);
    }
  };

  /** T16:打开顶栏历史下拉时拉取最近会话(与 Sidebar 同口径:当前工作区过滤) */
  const loadHistory = (open: boolean) => {
    setHistoryOpen(open);
    if (!open) return;
    fetchRecentConversations(uid, currentSpace?.id ?? undefined)
      .then(setHistoryList)
      .catch(() => setHistoryList([]));
  };

  const handleShare = () => {
    const link = window.location.href;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(link)
        .then(() => toast.success('分享链接已复制'))
        .catch(() => toast.info(link));
    } else {
      toast.info(link);
    }
  };

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* 顶栏:左中右三段 */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
        {/* 左段:返回首页 + Logo + 会话名历史下拉(T16) + 对话栏折叠 */}
        <div className="flex min-w-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            title="返回首页"
            onClick={() => navigate('/')}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
            A
          </span>
          <DropdownMenu open={historyOpen} onOpenChange={loadHistory}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title="历史会话"
                className="flex min-w-0 items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-muted"
              >
                <span className="max-w-[200px] truncate text-sm font-medium">
                  {conversation?.title ?? '对话'}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              {historyList.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">暂无最近会话</p>
              )}
              {historyList.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  className="gap-2"
                  onClick={() => {
                    if (item.id !== conversationId) navigate(`/chat/${item.id}`);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.id === conversationId && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title={chatPanelOpen ? '收起对话栏' : '展开对话栏'}
            onClick={() => setChatPanelOpen((v) => !v)}
          >
            {chatPanelOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          </Button>
        </div>

        {/* 中段:工具图标组(应用查看器/搜索/云同步/文件/增长 + 更多菜单收纳终端等) */}
        <div className="mx-auto hidden items-center gap-0.5 lg:flex">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="应用查看器" onClick={() => setCenterTab('overview')}>
            <AppWindow className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="搜索" onClick={() => toast.info('全局搜索即将上线')}>
            <Search className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="同步到 Atoms 云" onClick={() => toast.success('已同步到 Atoms 云')}>
            <CloudUpload className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="文件" onClick={() => setCenterTab('files')}>
            <FileText className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="增长" onClick={() => setCenterTab('growth')}>
            <LineChart className="h-4 w-4" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="更多工具">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem onClick={() => toast.info('终端即将上线')}>终端</DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info('计划器即将上线')}>计划器</DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info('浏览器即将上线')}>浏览器</DropdownMenuItem>
              <DropdownMenuItem onClick={() => toast.info('记事本即将上线')}>记事本</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* 右段:跟随智能体 / 头像 / 分享 / 更新 */}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            className={cn(
              'h-8 gap-1.5 rounded-full text-xs',
              following
                ? 'bg-blue-600 text-white hover:bg-blue-700'
                : 'bg-muted text-foreground hover:bg-muted',
            )}
            onClick={() => setFollowing((v) => !v)}
          >
            {following && <Check className="h-3.5 w-3.5" />}
            跟随智能体
          </Button>
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500 text-xs font-bold text-white">
            {uid.charAt(0).toUpperCase()}
          </span>
          <Button variant="ghost" size="icon" className="h-8 w-8" title="分享" onClick={handleShare}>
            <Share2 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-full bg-blue-600 px-3 text-xs text-white hover:bg-blue-700"
            onClick={() => toast.success('当前已是最新版本')}
          >
            更新
          </Button>
        </div>
      </div>

      {/* 主体:左深色对话栏 + 中部应用查看器(窄屏纵向堆叠,保证对话区始终可用) */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {chatPanelOpen && (
          <div className="flex h-[46%] w-full shrink-0 flex-col bg-zinc-950 text-zinc-100 md:h-auto md:w-[340px]">
            {/* 对话栏头部:会话状态 + 停止生成 */}
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/10 px-3">
              <MessagesSquare className="h-4 w-4 shrink-0 text-zinc-400" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-300">
                {conversation?.title ?? '对话'}
              </span>
              {generating ? (
                <>
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    生成中
                  </span>
                  <Button
                    size="icon"
                    className="h-7 w-7 shrink-0 rounded-full bg-rose-500 text-white hover:bg-rose-600"
                    onClick={handleStop}
                    title="停止生成"
                  >
                    <Square className="h-3 w-3" />
                  </Button>
                </>
              ) : (
                <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-zinc-400">
                  空闲
                </span>
              )}
            </div>

            {/* 消息流(历史回放与流式渲染共用) */}
            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="space-y-3">
                {messages.map((message) => (
                  <ChatMessage key={message.id} message={message} />
                ))}
                {messagesLoaded && messages.length === 0 && (
                  <p className="rounded-xl border border-white/10 bg-zinc-900 p-3 text-xs leading-5 text-zinc-400">
                    暂无消息,在下方输入需求开始与智能体对话。
                  </p>
                )}
                {/* T21:生成失败错误卡——保留需求原文与会话上下文,提供明确的重试入口 */}
                {failedPrompt && !generating && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3">
                    <p className="text-xs font-medium text-rose-200">生成失败</p>
                    <p className="mt-1 break-words text-[11px] leading-5 text-rose-200/80">
                      {lastErrorMessage}
                    </p>
                    <p className="mt-1.5 break-all text-[11px] leading-5 text-rose-200/60">
                      需求已保留:「{failedPrompt}」,会话上下文未丢失,可直接重试。
                    </p>
                    <Button
                      size="sm"
                      className="mt-2 h-7 gap-1.5 rounded-full bg-rose-500 px-3 text-xs text-white hover:bg-rose-600"
                      onClick={handleRegenerate}
                    >
                      <RefreshCw className="h-3 w-3" />
                      重新生成
                    </Button>
                    {/* T23:AI 网关故障时的显式演示模式入口——用户主动触发,仅本地生成真实可交互应用 */}
                    <Button
                      size="sm"
                      className="mt-2 ml-2 h-7 gap-1.5 rounded-full border border-amber-400/50 bg-amber-400/10 px-3 text-xs text-amber-200 hover:bg-amber-400/20"
                      onClick={handleDemoGenerate}
                    >
                      <FlaskConical className="h-3 w-3" />
                      使用演示模式生成
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* 队列面板:生成中提交的需求在此排队 */}
            {queue.length > 0 && (
              <div className="mx-3 mb-2 rounded-xl border border-white/10 bg-zinc-900 p-2.5">
                <p className="mb-1.5 text-xs font-medium text-zinc-300">队列 ({queue.length})</p>
                <div className="space-y-1">
                  {queue.map((item, index) => (
                    <p key={`${index}-${item.slice(0, 8)}`} className="truncate text-xs text-zinc-500">
                      · {item}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* 输入区(队列模式:生成中提交自动排队,停止在上方状态栏) */}
            <div className="shrink-0 p-3">
              <ChatComposer
                compact
                queueMode
                prompt={prompt}
                onPromptChange={setPrompt}
                generating={generating}
                onSend={submit}
                onQueueSend={() => enqueue(prompt)}
                onStop={handleStop}
                theme={theme}
                onThemeChange={setTheme}
                mode={mode}
                onModeChange={setMode}
                referenceProjects={refProjects.map((p) => ({ id: p.id, name: p.name }))}
              />
            </div>
          </div>
        )}

        {/* 中部:页签 + 应用查看器 */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-3">
            {CENTER_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setCenterTab(tab.key)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs transition-colors',
                  centerTab === tab.key
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1">
            {centerTab === 'overview' &&
              (app ? (
                <AppViewer
                  app={app}
                  project={project}
                  versions={versions}
                  viewingVersionId={viewingVersionId}
                  onViewVersion={handleViewVersion}
                  onRollback={handleRollback}
                  rollingBack={rollingBack}
                  onPanelOpen={handleOpenVersions}
                  versionsLoading={versionsLoading}
                />
              ) : (
                <TabEmptyState
                  icon={AppWindow}
                  title="应用查看器"
                  desc="智能体生成应用后会在这里实时预览,支持源码查看与刷新;若当时生成失败未产出应用,重新发送需求即可再次生成。"
                />
              ))}
            {centerTab === 'editor' &&
              (app ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/40 px-3 text-xs text-muted-foreground">
                    <Code2 className="h-3.5 w-3.5" />
                    {editing
                      ? '正在编辑 index.html(保存后自动记录版本)'
                      : 'index.html · 只读源码,点击右上角「编辑」在线修改'}
                    <div className="ml-auto flex items-center gap-1.5">
                      {editing ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            disabled={savingEdit}
                            onClick={cancelEdit}
                          >
                            取消
                          </Button>
                          <Button
                            size="sm"
                            className="h-7 gap-1 px-2.5 text-xs"
                            disabled={savingEdit}
                            onClick={() => void saveEdit()}
                          >
                            {savingEdit ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Save className="h-3.5 w-3.5" />
                            )}
                            保存并记录版本
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 gap-1 px-2.5 text-xs"
                          disabled={!project || viewingVersionId !== null}
                          title={
                            viewingVersionId
                              ? '正在查看历史版本,返回最新后再编辑'
                              : !project
                                ? '项目尚未落库,生成应用后可编辑'
                                : '编辑 HTML'
                          }
                          onClick={startEdit}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          编辑
                        </Button>
                      )}
                    </div>
                  </div>
                  {editing ? (
                    <textarea
                      value={editHtml}
                      onChange={(event) => setEditHtml(event.target.value)}
                      aria-label="HTML 源码编辑器"
                      spellCheck={false}
                      className="min-h-0 flex-1 resize-none bg-[#0d1117] p-4 font-mono text-[12px] leading-relaxed text-[#c9d1d9] outline-none"
                    />
                  ) : (
                    <pre className="min-h-0 flex-1 overflow-auto bg-[#0d1117] p-4 text-[12px] leading-relaxed text-[#c9d1d9]">
                      <code>{app.files[0].content}</code>
                    </pre>
                  )}
                </div>
              ) : (
                <TabEmptyState
                  icon={Code2}
                  title="编辑器"
                  desc="应用生成后可在此在线编辑 HTML;保存会自动记录 edit 版本并同步预览。"
                />
              ))}
            {centerTab === 'cloud' && (
              <TabEmptyState
                icon={Cloud}
                title="Atoms 云"
                desc="数据库、存储与云端资源管理即将开放,生成应用的数据将展示在这里。"
              />
            )}
            {centerTab === 'files' && (
              <TabEmptyState icon={FolderOpen} title="文件" desc="对话附件与项目文件管理即将开放。" />
            )}
            {centerTab === 'growth' && (
              <TabEmptyState icon={TrendingUp} title="增长" desc="应用访问与增长分析即将开放。" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
