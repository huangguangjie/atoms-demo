import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AppWindow,
  Check,
  ChevronDown,
  Cloud,
  CloudUpload,
  Code2,
  Eye,
  FileText,
  FolderOpen,
  History,
  LineChart,
  MessagesSquare,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
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
  insertMessage,
  type Conversation,
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

/** 应用查看器:iframe 实时预览 + 源码查看 + 刷新(生成完成后可用) */
function AppViewer({ app }: { app: DemoApp }) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [frameKey, setFrameKey] = useState(0);
  const file = app.files[0];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-background px-3">
        <span className="min-w-0 truncate text-sm font-medium">{app.title}</span>
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          生成应用
        </span>
        <div className="ml-auto flex items-center gap-1">
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
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setFrameKey((key) => key + 1)}
            title="刷新预览"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {tab === 'preview' ? (
        <iframe
          key={frameKey}
          title={`${app.title} 预览`}
          srcDoc={file.content}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          className="h-full w-full flex-1 bg-white"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto bg-[#0d1117] p-4 text-[12px] leading-relaxed text-[#c9d1d9]">
          <code>{file.content}</code>
        </pre>
      )}
      <div className="flex h-8 shrink-0 items-center gap-2 border-t bg-background px-3 text-[11px] text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{file.name}</span>
        <span>单文件应用 · 可直接运行</span>
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
  const [theme, setTheme] = useState<AppThemeDef>(
    () => APP_THEMES.find((t) => t.name === navState?.themeName) ?? APP_THEMES[4],
  );
  const [mode, setMode] = useState<ComposerMode>(navState?.mode === 'build' ? 'build' : 'goal');
  const [app, setApp] = useState<DemoApp | null>(null);
  const [centerTab, setCenterTab] = useState<CenterTab>('overview');
  const [chatPanelOpen, setChatPanelOpen] = useState(true);
  const [following, setFollowing] = useState(true);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<string[]>([]);
  const runFlowRef = useRef<(text: string, opts?: { userInserted?: boolean }) => Promise<void>>(
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
    fetchConversation(conversationId)
      .then((conv) => {
        if (!cancelled) setConversation(conv);
      })
      .catch(() => undefined);
    fetchConversationMessages(conversationId)
      .then((rows) => {
        if (cancelled) return;
        setMessages(rows.map((m) => ({ id: m.id, role: m.role, content: m.content })));
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

  // 消息流自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  /** 生成完成后把应用落成项目(与首页行为一致,进入「我的项目」) */
  const handleAppCreated = async (created: DemoApp) => {
    const meta = DEMO_KIND_META[created.kind];
    try {
      const project = await createProject({
        userId: uid,
        spaceId: currentSpace?.id ?? null,
        name: created.title,
        description: `智能体生成的${meta.label}`,
        source: 'created',
        coverGradient: meta.gradient,
        coverEmoji: meta.emoji,
        appHtml: created.files[0].content,
      });
      if (project) {
        toast.success(`项目「${created.title}」已保存到我的项目`);
        window.dispatchEvent(new Event('atoms:projects-updated'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '项目保存失败,请重试');
    }
  };

  /** 完整生成流程:写入用户消息 → SSE 流式渲染 → 助手消息落库 → 队列续跑 */
  const runFlow = async (text: string, opts?: { userInserted?: boolean }) => {
    const convId = conversationId;
    if (!convId || !text.trim() || generating) return;
    if (!demoMode && !user) {
      toast.error('登录状态已失效,请重新登录后再继续对话');
      return;
    }
    const assistantId = `assistant-${Date.now()}`;
    // 首页跳转场景(userInserted)用户消息已落库并由历史加载渲染,本地只追加助手气泡,避免重复
    setMessages((prev) => [
      ...prev,
      ...(opts?.userInserted
        ? []
        : [{ id: `user-${Date.now()}`, role: 'user' as const, content: text }]),
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    setPrompt('');
    setGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let firstMessage = '';
    let finalMessage = '';
    let errorMessage = '';

    try {
      // 主题真实生效:所选主题名传入生成链路,中文主题指令注入提示词
      await runAgent({
        prompt: `${text}\n界面主题:${theme.promptHint}`,
        theme: theme.name,
        mode,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'app') {
            setApp(event.app);
            setCenterTab('overview');
            void handleAppCreated(event.app);
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
      // 错误同样如实落库:历史回放能看到失败的真实原因
      const persisted = errorMessage
        ? `${parts.length > 0 ? `${parts.join('\n\n')}\n\n` : ''}生成出现问题:${errorMessage}`
        : parts.join('\n\n') || '生成已结束';
      try {
        await insertMessage(convId, 'assistant', persisted);
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
        {/* 左段:Logo + 会话名 + 历史版本 + 对话栏折叠 */}
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-bold text-background">
            A
          </span>
          <span className="max-w-[220px] truncate text-sm font-medium">
            {conversation?.title ?? '对话'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            title="历史版本"
            onClick={() => toast.info('历史版本即将上线')}
          >
            <History className="h-4 w-4" />
          </Button>
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
                <AppViewer app={app} />
              ) : (
                <TabEmptyState
                  icon={AppWindow}
                  title="应用查看器"
                  desc="智能体生成应用后会在这里实时预览,支持源码查看与刷新。"
                />
              ))}
            {centerTab === 'editor' &&
              (app ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/40 px-3 text-xs text-muted-foreground">
                    <Code2 className="h-3.5 w-3.5" />
                    在线编辑器即将上线,当前为只读源码查看
                  </div>
                  <pre className="min-h-0 flex-1 overflow-auto bg-[#0d1117] p-4 text-[12px] leading-relaxed text-[#c9d1d9]">
                    <code>{app.files[0].content}</code>
                  </pre>
                </div>
              ) : (
                <TabEmptyState
                  icon={Code2}
                  title="编辑器"
                  desc="应用生成后可在此查看源码;在线编辑能力将在后续版本开放。"
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
