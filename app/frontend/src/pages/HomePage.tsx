import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ArrowUp,
  ChevronRight,
  Database,
  Figma,
  Globe,
  Hammer,
  Hash,
  MessageSquarePlus,
  Mic,
  Plus,
  Sparkles,
  Square,
  Target,
  Terminal,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import ChatMessage, { type ChatMessageData } from '@/components/chat/ChatMessage';
import AppPreview from '@/components/preview/AppPreview';
import TemplatePlaceholderDialog from '@/components/templates/TemplatePlaceholderDialog';
import AuthDialog from '@/components/auth/AuthDialog';
import { DEMO_KIND_META, buildDemoApp, TEMPLATE_CATEGORY_KIND, type DemoApp } from '@/lib/demo-apps';
import { runAgent, type AgentPlanStep } from '@/lib/agent';
import {
  createConversation,
  createProject,
  fetchCommunityApps,
  fetchConversationMessages,
  fetchProjects,
  fetchTemplates,
  insertMessage,
  isTranscribeAvailable,
  transcribeAudio,
  type CommunityApp,
  type Conversation,
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

const THEME_OPTIONS = ['默认', 'Aurora', '紫罗兰', '森林', '海洋', '暗夜'];
const BUILD_MODES = [
  { key: 'build', label: '构建', icon: Hammer, desc: '逐步生成并预览应用' },
  { key: 'goal', label: '目标', icon: Target, desc: '按目标自动规划执行' },
] as const;
const HASH_OPTIONS = ['文件', '位置', '关键信息'];

type QuickTab = 'discover' | 'projects' | 'templates';

interface McpServer {
  id: string;
  name: string;
  url: string;
  connected: boolean;
}

const MCP_STORAGE_KEY = 'atoms_mcp_servers';

function loadMcpServers(): McpServer[] {
  try {
    const raw = JSON.parse(localStorage.getItem(MCP_STORAGE_KEY) ?? '[]') as McpServer[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export default function HomePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, currentSpace, user, loading, demoMode } = useAuth();

  // 输入区状态
  const [prompt, setPrompt] = useState('');
  const [theme, setTheme] = useState(THEME_OPTIONS[0]);
  const [mode, setMode] = useState<'build' | 'goal'>('goal');
  const [attachments, setAttachments] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // MCP 连接状态(localStorage 持久化)
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>(loadMcpServers);
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [showConnectStrip, setShowConnectStrip] = useState(true);
  const connectedCount = mcpServers.filter((s) => s.connected).length;

  // 底部快捷区
  const [quickTab, setQuickTab] = useState<QuickTab>('discover');
  const [apps, setApps] = useState<CommunityApp[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);

  // 对话与生成状态
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessageData[]>([]);
  const [generating, setGenerating] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 生成应用预览
  const [previewApp, setPreviewApp] = useState<DemoApp | null>(null);

  // 模板占位填写:首页模板快捷区点击模板后先填写占位内容再生成
  const [placeholderTemplate, setPlaceholderTemplate] = useState<Template | null>(null);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);

  const displayName = profile?.display_name ?? '开发者';
  const uid = user?.id ?? 'demo-user';

  useEffect(() => {
    fetchCommunityApps('全部').then(setApps).catch(() => setApps([]));
    fetchTemplates('全部').then(setTemplates).catch(() => setTemplates([]));
  }, []);

  useEffect(() => {
    if (loading) return;
    fetchProjects(uid, false).then(setProjects).catch(() => setProjects([]));
  }, [loading, uid]);

  // 侧边栏点击最近对话:载入对应会话消息
  useEffect(() => {
    const state = location.state as { conversationId?: string } | null;
    if (!state?.conversationId) return;
    const conversationId = state.conversationId;
    setConversation({ id: conversationId, user_id: uid, space_id: currentSpace?.id ?? null, title: '历史对话' });
    fetchConversationMessages(conversationId)
      .then((rows) =>
        setMessages(
          rows.map((m) => ({ id: m.id, role: m.role, content: m.content })),
        ),
      )
      .catch(() => setMessages([]));
    window.history.replaceState({}, '');
  }, [location.state, uid, currentSpace?.id]);

  // 侧边栏「新会话」入口:清空当前会话,回到当前工作区的空白对话视图
  useEffect(() => {
    const state = location.state as { newChat?: boolean } | null;
    if (!state?.newChat) return;
    abortRef.current?.abort();
    setConversation(null);
    setMessages([]);
    setPreviewApp(null);
    setPrompt('');
    window.history.replaceState({}, '');
  }, [location.state]);

  // 消息流自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const startNewChat = () => {
    abortRef.current?.abort();
    setConversation(null);
    setMessages([]);
    setPreviewApp(null);
    setPrompt('');
  };

  /** 生成完成后把应用落成项目(含应用 HTML),进入「我的项目」与侧边栏联动 */
  const handleAppCreated = async (app: DemoApp) => {
    const meta = DEMO_KIND_META[app.kind];
    try {
      const project = await createProject({
        userId: uid,
        spaceId: currentSpace?.id ?? null,
        name: app.title,
        description: `智能体生成的${meta.label}`,
        source: 'created',
        coverGradient: meta.gradient,
        coverEmoji: meta.emoji,
        appHtml: app.files[0].content,
      });
      if (project) {
        toast.success(`项目「${app.title}」已保存到我的项目`);
        fetchProjects(uid, false).then(setProjects).catch(() => undefined);
        window.dispatchEvent(new Event('atoms:projects-updated'));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '项目保存失败,请重试');
    }
  };

  const handleSend = async () => {
    const text = prompt.trim();
    if (!text) {
      toast.error('请先输入你要构建的应用描述');
      return;
    }
    if (generating) return;

    // 未登录(Supabase 已配置)时先弹登录,避免伪造身份触发 RLS/外键报错
    if (!demoMode && !user) {
      setAuthOpen(true);
      toast.info('请先登录后再发起对话');
      return;
    }

    // 工作区守卫:会话归属当前工作区;已登录但暂无工作区时先引导创建,避免 space_id 落空
    if (!demoMode && user && !currentSpace && !loading) {
      toast.error('当前账号暂无工作区,请点击侧边栏空间选择器中的「新建工作区」后再发起对话');
      return;
    }

    // 复用当前对话或创建新对话;Supabase 报错原样透出,便于定位真实原因
    let conv = conversation;
    if (!conv) {
      const title = text.length > 24 ? `${text.slice(0, 24)}…` : text;
      try {
        conv = await createConversation(uid, currentSpace?.id ?? null, title);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : '创建对话失败,请重试');
        return;
      }
      setConversation(conv);
      window.dispatchEvent(new Event('atoms:conversations-updated'));
    }

    try {
      await insertMessage(conv.id, 'user', text);
    } catch (error) {
      console.error('[chat] 用户消息写入失败:', error);
      toast.warning(error instanceof Error ? error.message : '消息写入失败,对话内容可能不会保存');
    }
    const assistantId = `assistant-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: 'user', content: text },
      { id: assistantId, role: 'assistant', content: '', streaming: true },
    ]);
    setPrompt('');
    setAttachments([]);
    setGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;
    let firstMessage = '';
    let finalMessage = '';
    let errorMessage = '';

    try {
      await runAgent({
        prompt: text,
        theme,
        mode,
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'app') {
            setPreviewApp(event.app);
            void handleAppCreated(event.app);
            return;
          }
          if (event.type === 'error') errorMessage = event.message;
          setMessages((prev) =>
            prev.map((m): ChatMessageData => {
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
      // 错误同样要如实落库:历史回放能看到失败的真实原因,而不是「假成功」
      const persisted = errorMessage
        ? `${parts.length > 0 ? `${parts.join('\n\n')}\n\n` : ''}生成出现问题:${errorMessage}`
        : parts.join('\n\n') || '生成已结束';
      try {
        await insertMessage(conv.id, 'assistant', persisted);
      } catch (error) {
        console.error('[chat] 助手消息写入失败:', error);
      }
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    toast.info('已停止生成');
  };

  const handleAttach = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachments((prev) => [...prev, ...Array.from(files).map((f) => f.name)]);
  };

  /** 模板占位填写完成:占位值真实注入 HTML,落库并打开预览(首页模板快捷区共用) */
  const generateFromTemplate = async (tpl: Template, values: Record<string, string>) => {
    setCreatingTemplate(true);
    try {
      const kind = TEMPLATE_CATEGORY_KIND[tpl.category] ?? 'landing';
      const generated = buildDemoApp(`${tpl.title} ${tpl.category}`, '默认', {
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

  // 语音输入:优先平台 scribe_v2 转写(Edge Function);失败/不支持/服务不可用时回退浏览器原生识别
  const startBrowserRecognition = () => {
    const w = window as unknown as {
      webkitSpeechRecognition?: unknown;
      SpeechRecognition?: unknown;
    };
    const SpeechRecognition = w.webkitSpeechRecognition ?? w.SpeechRecognition;
    if (!SpeechRecognition) {
      toast.error('当前浏览器不支持语音识别,请使用 Chrome');
      return;
    }
    type SRInstance = {
      lang: string;
      interimResults: boolean;
      onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    const recognition = new (SpeechRecognition as unknown as new () => SRInstance)();
    recognition.lang = 'zh-CN';
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join('');
      setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    recognitionRef.current = recognition;
    setListening(true);
    toast.info('正在聆听,再次点击停止');
  };

  const startVoice = async () => {
    const mediaSupported =
      Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== 'undefined';
    if (isTranscribeAvailable() && mediaSupported) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordChunksRef.current = [];
        const mimeType = MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : MediaRecorder.isTypeSupported('audio/ogg')
            ? 'audio/ogg'
            : '';
        const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordChunksRef.current.push(e.data);
        };
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          recorderRef.current = null;
          setListening(false);
          const type = mimeType || 'audio/webm';
          const blob = new Blob(recordChunksRef.current, { type });
          recordChunksRef.current = [];
          if (blob.size < 2048) {
            toast.error('录音太短,请说完一段话后再停止');
            return;
          }
          setTranscribing(true);
          toast.info('正在转写录音…');
          try {
            const ext = type.includes('webm')
              ? 'webm'
              : type.includes('ogg')
                ? 'ogg'
                : type.includes('mp4')
                  ? 'm4a'
                  : 'webm';
            const result = await transcribeAudio(
              new File([blob], `voice.${ext}`, { type }),
            );
            const text = result.text.trim();
            if (text) {
              setPrompt((prev) => (prev ? `${prev} ${text}` : text));
              toast.success(`语音转写完成(${(result.cost_ms / 1000).toFixed(1)}s)`);
            } else {
              toast.error('未识别到语音内容,请靠近麦克风重试');
            }
          } catch (error) {
            toast.warning(`平台转写失败,已切换浏览器识别:${(error as Error).message}`);
            startBrowserRecognition();
          } finally {
            setTranscribing(false);
          }
        };
        recorder.start();
        recorderRef.current = recorder;
        setListening(true);
        toast.info('正在聆听,再次点击停止并转写');
        return;
      } catch {
        toast.warning('麦克风不可用,已切换浏览器识别');
      }
    }
    startBrowserRecognition();
  };

  const stopVoice = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      return;
    }
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  };

  const addMcpServer = () => {
    if (!mcpName.trim()) {
      toast.error('请填写服务名称');
      return;
    }
    if (!mcpUrl.trim().startsWith('http')) {
      toast.error('请输入有效的 MCP 服务器地址(http/https)');
      return;
    }
    setMcpServers((prev) => [
      ...prev,
      { id: `mcp-${Date.now()}`, name: mcpName.trim(), url: mcpUrl.trim(), connected: true },
    ]);
    setMcpName('');
    setMcpUrl('');
    toast.success(`已连接 MCP:${mcpName.trim()}`);
  };

  const toggleMcpServer = (id: string) => {
    setMcpServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, connected: !s.connected } : s)),
    );
  };

  const removeMcpServer = (id: string) => {
    setMcpServers((prev) => prev.filter((s) => s.id !== id));
  };

  const navigateByTab = (tab: QuickTab) => {
    if (tab === 'discover' || tab === 'templates') {
      navigate('/resources');
    } else {
      navigate('/projects');
    }
  };

  // -------------------------------------------------------------------------
  // 输入区(欢迎页与对话页共用)
  // -------------------------------------------------------------------------
  const inputCard = (
    <div className="rounded-2xl border bg-card shadow-sm">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b px-3 pt-3">
          {attachments.map((name, index) => (
            <span
              key={`${name}-${index}`}
              className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
            >
              {name}
              <button
                type="button"
                aria-label={`移除附件 ${name}`}
                onClick={() => setAttachments((prev) => prev.filter((_, i) => i !== index))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
          }
        }}
        placeholder="描述你想要构建的应用,例如:做一个记录阅读进度的小站…"
        rows={3}
        className="w-full resize-none bg-transparent px-4 pt-4 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-1.5 px-3 pb-3 pt-1">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            handleAttach(e.target.files);
            e.target.value = '';
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 rounded-full text-muted-foreground"
          onClick={() => fileInputRef.current?.click()}
          title="添加附件"
        >
          <Plus className="h-4 w-4" />
        </Button>

        {/* 主题切换 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full px-2.5 text-muted-foreground">
              <Globe className="h-3.5 w-3.5" />
              <span className="text-xs">{theme}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">生成应用主题</DropdownMenuLabel>
            {THEME_OPTIONS.map((option) => (
              <DropdownMenuItem key={option} onClick={() => setTheme(option)}>
                {option}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 构建/目标模式切换 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 rounded-full px-2.5 text-muted-foreground">
              {mode === 'build' ? <Hammer className="h-3.5 w-3.5" /> : <Target className="h-3.5 w-3.5" />}
              <span className="text-xs">{BUILD_MODES.find((m) => m.key === mode)?.label}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {BUILD_MODES.map((item) => (
              <DropdownMenuItem key={item.key} onClick={() => setMode(item.key)}>
                <item.icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
                <span className="ml-2 text-xs text-muted-foreground">{item.desc}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* # 引用功能 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground"
              title="引用文件/位置/关键信息"
            >
              <Hash className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel className="text-xs text-muted-foreground">引用到提示词</DropdownMenuLabel>
            {HASH_OPTIONS.map((option) => (
              <DropdownMenuItem key={option} onClick={() => setPrompt((prev) => `${prev}#${option} `)}>
                <Hash className="h-3.5 w-3.5" />
                {option}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8 rounded-full',
              listening ? 'bg-rose-100 text-rose-600' : 'text-muted-foreground',
            )}
            onClick={() => (listening ? stopVoice() : void startVoice())}
            disabled={transcribing}
            title={transcribing ? '正在转写语音…' : '语音输入'}
          >
            <Mic className="h-4 w-4" />
          </Button>
          {generating ? (
            <Button
              size="icon"
              className="h-8 w-8 rounded-full bg-rose-500 text-white hover:bg-rose-600"
              onClick={handleStop}
              title="停止生成"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-8 w-8 rounded-full bg-foreground text-background hover:bg-foreground/90"
              onClick={() => void handleSend()}
              title="发送"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // -------------------------------------------------------------------------
  // MCP 连接条(对话页与欢迎页共用)
  // -------------------------------------------------------------------------
  const mcpStrip = showConnectStrip && (
    <div className="mt-3 flex items-center justify-between rounded-xl border bg-muted/40 px-3 py-2">
      <button
        type="button"
        className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
        onClick={() => setMcpOpen(true)}
      >
        <Terminal className="h-3.5 w-3.5" />
        将你的工具连接到 Atoms
        {connectedCount > 0 && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
            已连接 {connectedCount} 个服务
          </span>
        )}
      </button>
      <div className="flex items-center gap-2 text-muted-foreground">
        <Database className="h-3.5 w-3.5" />
        <Figma className="h-3.5 w-3.5" />
        <Globe className="h-3.5 w-3.5" />
        <button
          type="button"
          aria-label="关闭连接提示"
          onClick={() => setShowConnectStrip(false)}
          className="rounded p-0.5 hover:bg-background"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );

  // -------------------------------------------------------------------------
  // 欢迎视图(未开始对话)
  // -------------------------------------------------------------------------
  const welcomeView = (
    <div className="flex min-h-full flex-col">
      <div className="flex justify-center pt-4">
        <div className="flex items-center gap-2 rounded-full bg-muted px-4 py-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-violet-500" />
          Atoms 更新:智能体分步计划、实时预览与全新首页
        </div>
      </div>

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
        <div className="mt-8 w-full max-w-2xl">
          {inputCard}
          {mcpStrip}
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

  // -------------------------------------------------------------------------
  // 对话视图(消息流 + 底部输入区)
  // -------------------------------------------------------------------------
  const chatView = (
    <div className="flex h-full min-h-0 flex-col">
      {/* 对话头部 */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-4">
        <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{conversation?.title ?? '对话'}</span>
        {demoMode && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">演示模式</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-8 gap-1.5 rounded-full text-xs text-muted-foreground"
          onClick={startNewChat}
        >
          <Plus className="h-3.5 w-3.5" />
          新对话
        </Button>
      </div>

      {/* 消息流 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-2xl space-y-4">
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
        </div>
      </div>

      {/* 底部输入区 */}
      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto max-w-2xl">
          {inputCard}
          {mcpStrip}
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
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel defaultSize={previewApp ? 55 : 100} minSize={35} className="h-full min-w-0">
          <main className="h-full overflow-y-auto">
            {conversation ? chatView : welcomeView}
          </main>
        </ResizablePanel>
        {previewApp && (
          <>
            <ResizableHandle className="w-px bg-transparent transition-colors hover:bg-border data-[resize-handle-state=drag]:bg-border" />
            <ResizablePanel defaultSize={45} minSize={25} className="h-full min-w-0">
              <AppPreview app={previewApp} onClose={() => setPreviewApp(null)} />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>

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

      {/* MCP 连接面板:配置远程 MCP 服务,localStorage 持久化 */}
      <Dialog open={mcpOpen} onOpenChange={setMcpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>连接远程 MCP</DialogTitle>
            <DialogDescription>
              添加远程 MCP 服务器地址,将外部工具接入 Atoms 智能体。配置会保存在本地。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2.5">
            <div className="flex gap-2">
              <Input
                placeholder="服务名称,如:GitHub"
                value={mcpName}
                onChange={(e) => setMcpName(e.target.value)}
              />
              <Input
                placeholder="https://mcp.example.com/sse"
                value={mcpUrl}
                onChange={(e) => setMcpUrl(e.target.value)}
              />
            </div>
            <Button
              className="w-full bg-foreground text-background hover:bg-foreground/90"
              onClick={addMcpServer}
            >
              连接服务
            </Button>
            {mcpServers.length > 0 && (
              <div className="space-y-1.5 rounded-lg border p-2">
                {mcpServers.map((server) => (
                  <div key={server.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm">
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full',
                        server.connected ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {server.name}
                      <span className="ml-2 text-xs text-muted-foreground">{server.url}</span>
                    </span>
                    <button
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => toggleMcpServer(server.id)}
                    >
                      {server.connected ? '断开' : '连接'}
                    </button>
                    <button
                      type="button"
                      aria-label={`删除 ${server.name}`}
                      className="text-muted-foreground hover:text-red-500"
                      onClick={() => removeMcpServer(server.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="sm:justify-start">
            <span className="text-xs text-muted-foreground">
              已连接服务会显示在对话区顶部状态中。
            </span>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
