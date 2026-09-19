import { useEffect, useRef, useState } from 'react';
import {
  ArrowUp,
  AudioLines,
  Bot,
  Cable,
  Check,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  FolderOpen,
  KeyRound,
  Palette,
  Paperclip,
  Plus,
  Search,
  Settings2,
  Square,
  Telescope,
  Users,
  Video,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { isTranscribeAvailable, transcribeAudio } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// T12 应用主题定义:名称、四色块、生成色板与中文主题描述(首页与详情页共用)
// ---------------------------------------------------------------------------

export interface AppThemeDef {
  id: string;
  name: string;
  swatches: [string, string, string, string];
  palette: { primary: string; accent: string; bg: string; card: string; text: string };
  promptHint: string;
}

export const APP_THEMES: AppThemeDef[] = [
  { id: 'zen', name: 'Zen', swatches: ['#d9d9d9', '#f5f5f5', '#a3a3a3', '#171717'], palette: { primary: '#171717', accent: '#525252', bg: '#fafafa', card: '#ffffff', text: '#171717' }, promptHint: '禅意极简黑白灰配色、大量留白、克制细节' },
  { id: 'terracotta', name: 'Terracotta & Clay', swatches: ['#c2542d', '#e07850', '#f3d5bd', '#5b2f1a'], palette: { primary: '#c2542d', accent: '#e07850', bg: '#fdf6f0', card: '#ffffff', text: '#3d2317' }, promptHint: '赤陶土橙棕暖色配色、圆润卡片、陶土质感' },
  { id: 'notion', name: 'Notion', swatches: ['#37352f', '#ffffff', '#f1f1ef', '#787774'], palette: { primary: '#37352f', accent: '#787774', bg: '#ffffff', card: '#f7f7f5', text: '#37352f' }, promptHint: 'Notion 风格白底黑字、细边框、简洁文档排版' },
  { id: 'material-you', name: 'Material You', swatches: ['#6750a4', '#e8def8', '#7d5260', '#fffbfe'], palette: { primary: '#6750a4', accent: '#7d5260', bg: '#fffbfe', card: '#f3edf7', text: '#1d1b20' }, promptHint: 'Material You 大圆角、动态色紫罗兰主色、柔和浅色表面' },
  { id: 'golden-honey', name: 'Golden Honey', swatches: ['#eab308', '#fdf6e3', '#f5e6c8', '#b45309'], palette: { primary: '#ca8a04', accent: '#b45309', bg: '#fdf6e3', card: '#ffffff', text: '#422006' }, promptHint: '金黄蜂蜜暖色配色、奶油色背景、温暖明亮' },
  { id: 'nordic-moss', name: 'Nordic Moss & Stone', swatches: ['#5f7161', '#eef1ee', '#8fa08f', '#3f4a40'], palette: { primary: '#5f7161', accent: '#8fa08f', bg: '#f4f6f3', card: '#ffffff', text: '#2f3a30' }, promptHint: '北欧苔藓绿与岩石灰配色、自然低饱和、安静沉稳' },
  { id: 'white-beach', name: 'White Beach', swatches: ['#0ea5e9', '#ffffff', '#e0f2fe', '#0369a1'], palette: { primary: '#0ea5e9', accent: '#0369a1', bg: '#f8fdff', card: '#ffffff', text: '#0c4a6e' }, promptHint: '白色海滩风天蓝与纯白配色、清爽通透、浅色阴影' },
];

/** T15:未选择主题时的中性预览卡(仅用于菜单右侧预览,不进入主题列表与生成链路) */
const NEUTRAL_THEME: AppThemeDef = {
  id: 'default',
  name: '默认',
  swatches: ['#64748b', '#f1f5f9', '#cbd5e1', '#0f172a'],
  palette: { primary: '#334155', accent: '#64748b', bg: '#f8fafc', card: '#ffffff', text: '#0f172a' },
  promptHint: '',
};

const BUILD_MODES = [
  { key: 'build', label: '构建', desc: '逐步生成并预览应用' },
  { key: 'goal', label: '目标', desc: '按目标自动规划执行' },
] as const;

export type ComposerMode = 'build' | 'goal';

// ---------------------------------------------------------------------------
// T17 输入框内 # 引用菜单:上传 / AI / 密钥 / 项目
// ---------------------------------------------------------------------------

type RefKindKey = 'upload' | 'ai' | 'secret' | 'project';

interface RefKind {
  key: RefKindKey;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const REF_KINDS: RefKind[] = [
  { key: 'upload', label: '上传', desc: '上传本地文件作为附件', icon: Paperclip },
  { key: 'ai', label: 'AI', desc: '插入 AI 引用快捷指令', icon: Bot },
  { key: 'secret', label: '密钥', desc: '密钥由服务端安全托管', icon: KeyRound },
  { key: 'project', label: '项目', desc: '引用已有项目进入生成链路', icon: FolderOpen },
];

type RefRow =
  | { type: 'kind'; key: RefKindKey; label: string; desc: string; icon: LucideIcon }
  | { type: 'project'; id: string; name: string };

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

/** T12:主题预览卡片——以主题色板渲染迷你应用界面示意,悬停/选中即联动 */
function ThemePreviewCard({ def }: { def: AppThemeDef }) {
  const { primary, accent, bg, card, text } = def.palette;
  return (
    <div className="flex h-full flex-col">
      <p className="mb-2 text-[11px] font-medium text-muted-foreground">{def.name}</p>
      <div className="flex-1 overflow-hidden rounded-xl border border-border/60 shadow-sm" style={{ backgroundColor: bg, color: text }}>
        <div className="flex items-center gap-1.5 px-2.5 py-2" style={{ backgroundColor: card, borderBottom: `1px solid ${text}1f` }}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: primary }} />
          <span className="h-1.5 w-10 rounded-full" style={{ backgroundColor: accent, opacity: 0.8 }} />
          <span className="ml-auto h-1.5 w-6 rounded-full" style={{ backgroundColor: text, opacity: 0.25 }} />
        </div>
        <div className="space-y-1.5 p-2.5">
          <div className="h-2 w-3/4 rounded-full" style={{ backgroundColor: text, opacity: 0.8 }} />
          <div className="h-1.5 w-1/2 rounded-full" style={{ backgroundColor: text, opacity: 0.28 }} />
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            <div className="flex h-10 items-end rounded-lg p-1.5" style={{ backgroundColor: card, border: `1px solid ${text}1f` }}>
              <span className="h-1.5 w-6 rounded-full" style={{ backgroundColor: primary }} />
            </div>
            <div className="flex h-10 items-end rounded-lg p-1.5" style={{ backgroundColor: primary }}>
              <span className="h-1.5 w-6 rounded-full bg-white/85" />
            </div>
          </div>
          <div className="mt-1 h-6 rounded-lg" style={{ backgroundColor: primary }} />
          <div className="h-1.5 w-2/3 rounded-full" style={{ backgroundColor: accent, opacity: 0.75 }} />
        </div>
      </div>
    </div>
  );
}

export interface ChatComposerProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  generating: boolean;
  /** 详情页队列态:生成中点发送不是停止,而是加入队列(T13) */
  queueMode?: boolean;
  onSend: () => void;
  onQueueSend?: () => void;
  onStop: () => void;
  /** 详情页左栏紧凑样式(T13 深色窄栏) */
  compact?: boolean;
  /** T15:主题可为空——未选择时不高亮、不注入主题提示、生成走中性默认色板 */
  theme: AppThemeDef | null;
  onThemeChange: (theme: AppThemeDef | null) => void;
  /** 受控构建/目标模式(可选):首页需要把所选模式带入详情页 */
  mode?: ComposerMode;
  onModeChange?: (mode: ComposerMode) => void;
  /** T17:# 引用菜单可选的已有项目(选中后以 #项目:名称 注入提示词并进入生成链路) */
  referenceProjects?: { id: string; name: string }[];
}

/**
 * 对话输入区(首页欢迎页与 T13 详情页共用):
 * 大圆角卡片 + 文本域(# 触发引用菜单:上传/AI/密钥/项目)
 * + 加号面板(团队/附件/连接器/视频/深度研究/竞赛)
 * + 主题面板(搜索/色块/预览,T15 默认无选中)+ 构建/目标模式(T18 对勾右移)
 * + 语音 + 发送/停止/入队。
 */
export default function ChatComposer({
  prompt,
  onPromptChange,
  generating,
  queueMode = false,
  onSend,
  onQueueSend,
  onStop,
  compact = false,
  theme,
  onThemeChange,
  mode: modeProp,
  onModeChange,
  referenceProjects = [],
}: ChatComposerProps) {
  const [attachments, setAttachments] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServer[]>(loadMcpServers);
  const [mcpName, setMcpName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const connectedCount = mcpServers.filter((s) => s.connected).length;

  // T11 加号展开面板:团队模式/深度研究开关与竞赛模式提示(仅本地状态,不影响生成链路)
  const [plusOpen, setPlusOpen] = useState(false);
  const [teamMode, setTeamMode] = useState(true);
  const [deepResearch, setDeepResearch] = useState(false);
  const [videoDot, setVideoDot] = useState(true);

  // T17 # 引用菜单:输入 # 触发,实时过滤,Esc/外点/删除 # 关闭,兼容中文输入法
  const [refMenuOpen, setRefMenuOpen] = useState(false);
  const [refShowProjects, setRefShowProjects] = useState(false);
  const [refQuery, setRefQuery] = useState('');
  const [refRange, setRefRange] = useState({ start: 0, end: 0 });
  const [refHighlight, setRefHighlight] = useState(0);
  const composingRef = useRef(false);

  // T12 主题面板(T15:theme 可为空,未选择时中性文案、无高亮项)
  const [themeSearch, setThemeSearch] = useState('');
  const [themeOpen, setThemeOpen] = useState(false);
  const [previewTheme, setPreviewTheme] = useState<AppThemeDef | null>(theme);
  const filteredThemes = APP_THEMES.filter((item) => item.name.toLowerCase().includes(themeSearch.trim().toLowerCase()));

  const [internalMode, setInternalMode] = useState<ComposerMode>('goal');
  const mode = modeProp ?? internalMode;
  const setMode = (next: ComposerMode) => {
    setInternalMode(next);
    onModeChange?.(next);
  };

  // # 引用菜单当前展示行:项目二级列表或四个引用类别,均按 refQuery 实时过滤
  const refRows: RefRow[] = refShowProjects
    ? referenceProjects
        .filter((p) => !refQuery || p.name.toLowerCase().includes(refQuery.toLowerCase()))
        .map((p) => ({ type: 'project' as const, id: p.id, name: p.name }))
    : REF_KINDS.filter(
        (k) => !refQuery || `${k.label}${k.desc}`.toLowerCase().includes(refQuery.toLowerCase()),
      ).map((k) => ({ type: 'kind' as const, key: k.key, label: k.label, desc: k.desc, icon: k.icon }));

  const closeRefMenu = () => {
    setRefMenuOpen(false);
    setRefShowProjects(false);
    setRefQuery('');
    setRefHighlight(0);
  };

  // 提示词被外部清空(如发送后)时收起引用菜单,避免残留过期选区
  useEffect(() => {
    if (!prompt && refMenuOpen) {
      setRefMenuOpen(false);
      setRefShowProjects(false);
      setRefQuery('');
    }
  }, [prompt, refMenuOpen]);

  /** 根据光标前的 # 片段决定是否展开引用菜单(空格/换行/删除 # 均关闭) */
  const maybeOpenRefMenu = (value: string, caret: number) => {
    if (composingRef.current) return;
    const before = value.slice(0, caret);
    const hashIdx = before.lastIndexOf('#');
    const fragment = hashIdx === -1 ? '' : before.slice(hashIdx + 1);
    if (hashIdx === -1 || /[\s\n]/.test(fragment)) {
      if (refMenuOpen) closeRefMenu();
      return;
    }
    setRefRange({ start: hashIdx, end: caret });
    setRefQuery(fragment);
    setRefHighlight(0);
    setRefMenuOpen(true);
  };

  /** 用 token 替换 # 触发片段(空 token 即仅删除触发文本) */
  const applyRefToken = (token: string) => {
    const next = prompt.slice(0, refRange.start) + token + prompt.slice(refRange.end);
    onPromptChange(next);
    closeRefMenu();
  };

  const selectRefRow = (row: RefRow) => {
    if (row.type === 'project') {
      applyRefToken(`#项目:${row.name} `);
      toast.success(`已引用项目:${row.name}`);
      return;
    }
    switch (row.key) {
      case 'upload':
        // 上传复用既有文件选择器,触发文本不留在提示词中
        applyRefToken('');
        setTimeout(() => fileInputRef.current?.click(), 50);
        break;
      case 'ai':
        // AI:插入引用快捷指令
        applyRefToken('#AI ');
        break;
      case 'secret':
        // 密钥:仅提供安全提示,不注入任何敏感值
        applyRefToken('');
        toast.info('密钥属于敏感信息:平台密钥统一存放在服务端 Secrets,不会注入提示词,也不会暴露给前端。');
        break;
      case 'project':
        // 项目:展开二级列表选择具体项目
        setRefShowProjects(true);
        setRefHighlight(0);
        break;
    }
  };

  const handleAttach = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setAttachments((prev) => [...prev, ...Array.from(files).map((f) => f.name)]);
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
      onPromptChange(prompt ? `${prompt} ${transcript}` : transcript);
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
            const result = await transcribeAudio(new File([blob], `voice.${ext}`, { type }));
            const text = result.text.trim();
            if (text) {
              onPromptChange(prompt ? `${prompt} ${text}` : text);
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
    setMcpServers((prev) => prev.map((s) => (s.id === id ? { ...s, connected: !s.connected } : s)));
  };

  const removeMcpServer = (id: string) => {
    setMcpServers((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div
      className={cn(
        'relative rounded-3xl border border-border/70 bg-card/90 shadow-xl shadow-black/5 backdrop-blur focus-within:border-ring',
        compact && 'rounded-2xl shadow-md',
      )}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
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
        onChange={(e) => {
          onPromptChange(e.target.value);
          maybeOpenRefMenu(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          // 中文输入法组词结束后再检测 # 触发,避免组词过程中的中间态误开菜单
          composingRef.current = false;
          const el = e.currentTarget;
          maybeOpenRefMenu(el.value, el.selectionStart ?? el.value.length);
        }}
        onKeyDown={(e) => {
          // 输入法组词期间的按键(如确认拼音的 Enter)不触发菜单导航与发送
          if (e.nativeEvent.isComposing) return;
          if (refMenuOpen) {
            if (e.key === 'Escape') {
              e.preventDefault();
              closeRefMenu();
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setRefHighlight((h) => Math.min(h + 1, refRows.length - 1));
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setRefHighlight((h) => Math.max(h - 1, 0));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const row = refRows[refHighlight];
              if (row) selectRefRow(row);
              return;
            }
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder="@David 进行数据开发。"
        rows={compact ? 2 : 3}
        className="w-full resize-none bg-transparent px-5 pt-4 text-sm outline-none placeholder:text-muted-foreground"
      />

      {/* T17 # 引用菜单:紧随输入框定位,支持实时过滤/键盘导航/外点与 Esc 关闭 */}
      {refMenuOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={closeRefMenu} />
          <div
            role="listbox"
            aria-label="引用菜单"
            className="absolute bottom-[52px] left-4 z-50 w-72 overflow-hidden rounded-xl border border-white/10 bg-zinc-900 p-1.5 text-zinc-100 shadow-2xl shadow-black/40"
          >
            <div className="flex items-center gap-1 px-2 pb-1 pt-0.5 text-[10px] text-zinc-500">
              {refShowProjects && (
                <button
                  type="button"
                  className="rounded px-1 text-zinc-400 hover:text-zinc-200"
                  onClick={() => {
                    setRefShowProjects(false);
                    setRefHighlight(0);
                  }}
                >
                  返回
                </button>
              )}
              <span>{refShowProjects ? '选择要引用的项目' : '引用到提示词'}</span>
              {refQuery && <span className="ml-auto truncate">「{refQuery}」</span>}
            </div>
            {refRows.length === 0 && (
              <p className="px-2.5 py-3 text-xs text-zinc-500">
                {refShowProjects ? '暂无匹配项目,可先在「我的项目」页创建' : '没有匹配的引用项'}
              </p>
            )}
            {refRows.map((row, idx) => (
              <button
                key={row.type === 'kind' ? row.key : row.id}
                type="button"
                role="option"
                aria-selected={idx === refHighlight}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-zinc-200 hover:bg-white/5',
                  idx === refHighlight && 'bg-white/10',
                )}
                onMouseEnter={() => setRefHighlight(idx)}
                onClick={() => selectRefRow(row)}
              >
                {row.type === 'kind' ? (
                  <>
                    <row.icon className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="shrink-0">{row.label}</span>
                    <span className="ml-auto truncate text-[11px] text-zinc-500">{row.desc}</span>
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-4 w-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate">{row.name}</span>
                    <span className="shrink-0 text-[11px] text-zinc-500">引用</span>
                  </>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      <div className={cn('flex items-center gap-2 px-3 pb-3 pt-1', compact && 'gap-1.5 px-2')}>
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
        {/* T11 加号展开面板:展开/收起旋转 45 度,深色面板按参考图分组收纳既有功能 */}
        <Popover open={plusOpen} onOpenChange={setPlusOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full border border-border/80 text-foreground/80 hover:bg-muted"
              title="添加附件、引用与工具"
            >
              <Plus className={cn('h-4 w-4 transition-transform duration-200', plusOpen && 'rotate-45')} />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            className="w-[272px] rounded-2xl border-white/10 bg-zinc-900 p-1.5 text-zinc-100 shadow-2xl shadow-black/40"
          >
            <div className="flex flex-col">
              {/* 第一组:团队模式开关(div 代替 button,避免 Switch 嵌套 button 的 DOM 警告) */}
              <div
                role="button"
                tabIndex={0}
                className="flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-white/30"
                onClick={() => setTeamMode((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setTeamMode((v) => !v); }}
              >
                <Users className="h-4 w-4 text-zinc-300" />
                团队模式
                <Switch
                  checked={teamMode}
                  onCheckedChange={setTeamMode}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-600"
                />
              </div>

              <div className="my-1 h-px bg-white/10" />

              {/* 第二组:附件 / 连接器(附件保留原功能;引用已改为输入框内 # 触发,T17) */}
              <button
                type="button"
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] hover:bg-white/5"
                onClick={() => {
                  fileInputRef.current?.click();
                  setPlusOpen(false);
                }}
              >
                <Paperclip className="h-4 w-4 text-zinc-300" />
                附件
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-zinc-500" />
              </button>
              <button
                type="button"
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] hover:bg-white/5"
                onClick={() => {
                  setPlusOpen(false);
                  setMcpOpen(true);
                }}
              >
                <Cable className="h-4 w-4 text-zinc-300" />
                连接器
                {connectedCount > 0 ? (
                  <span className="ml-auto rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                    已连 {connectedCount}
                  </span>
                ) : (
                  <ChevronRight className="ml-auto h-3.5 w-3.5 text-zinc-500" />
                )}
              </button>

              <div className="my-1 h-px bg-white/10" />

              {/* 第三组:视频 / 深度研究 / 竞赛模式 */}
              <button
                type="button"
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] hover:bg-white/5"
                onClick={() => setVideoDot(false)}
              >
                <Video className="h-4 w-4 text-zinc-300" />
                视频
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="rounded-md bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">
                    Seedance 2.5
                  </span>
                  {videoDot && <span className="h-2 w-2 rounded-full bg-red-500" />}
                </span>
              </button>
              <div
                role="button"
                tabIndex={0}
                className="flex cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] outline-none hover:bg-white/5 focus-visible:ring-1 focus-visible:ring-white/30"
                onClick={() => setDeepResearch((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setDeepResearch((v) => !v); }}
              >
                <Telescope className="h-4 w-4 text-zinc-300" />
                深度研究
                <Switch
                  checked={deepResearch}
                  onCheckedChange={setDeepResearch}
                  onClick={(e) => e.stopPropagation()}
                  className="ml-auto data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-zinc-600"
                />
              </div>
              <button
                type="button"
                className="flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-[13px] hover:bg-white/5"
                onClick={() => {
                  setPlusOpen(false);
                  toast.info('竞赛模式:同一需求由多个智能体并行竞标,生成后择优采用(即将上线)');
                }}
              >
                <FlaskConical className="h-4 w-4 text-zinc-300" />
                竞赛模式
                <ChevronRight className="ml-auto h-3.5 w-3.5 text-zinc-500" />
              </button>
            </div>
          </PopoverContent>
        </Popover>

        {/* 主题切换:T12 面板 + T15 默认无选中——触发按钮中性文案,列表不预高亮 */}
        <Popover
          open={themeOpen}
          onOpenChange={(open) => {
            setThemeOpen(open);
            if (open) setPreviewTheme(theme);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label="主题"
              className={cn(
                'h-9 gap-1.5 rounded-xl border border-border/80 px-3 text-foreground/80 hover:bg-muted',
                compact && 'px-2',
              )}
            >
              {/* T22:恢复主题触发按钮的图标(Palette),与输入区其他控件视觉一致;构建/目标框保持纯文字不变 */}
              <Palette className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="max-w-[120px] truncate text-xs">{theme?.name ?? '主题'}</span>
              <ChevronDown className={cn('h-3 w-3 text-muted-foreground transition-transform', themeOpen && 'rotate-180')} />
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="start" className="w-[452px] rounded-2xl p-0 shadow-2xl">
            <div className="flex">
              {/* 左列:搜索 + 主题列表 */}
              <div className="w-[236px] shrink-0 p-2">
                <div className="relative mb-1.5">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={themeSearch}
                    onChange={(e) => setThemeSearch(e.target.value)}
                    placeholder="搜索主题"
                    className="h-8 rounded-lg border-border/70 bg-muted/40 pl-8 text-xs"
                  />
                </div>
                <div className="max-h-[236px] space-y-0.5 overflow-y-auto py-0.5">
                  {filteredThemes.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseEnter={() => setPreviewTheme(item)}
                      onFocus={() => setPreviewTheme(item)}
                      onClick={() => {
                        onThemeChange(item);
                        setThemeOpen(false);
                        setThemeSearch('');
                        toast.success(`已选择主题:${item.name}`);
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-foreground/90 hover:bg-muted',
                        theme?.id === item.id && 'bg-muted font-medium',
                      )}
                    >
                      <span className="flex shrink-0 -space-x-1.5">
                        {item.swatches.map((color) => (
                          <span
                            key={color}
                            className="h-3.5 w-3.5 rounded-full border border-background"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </span>
                      <span className="truncate">{item.name}</span>
                      {theme?.id === item.id && <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-violet-500" />}
                    </button>
                  ))}
                  {filteredThemes.length === 0 && (
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground">没有匹配「{themeSearch.trim()}」的主题</p>
                  )}
                </div>
                <div className="mt-1 border-t border-border/60 pt-1.5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground/80 hover:bg-muted"
                    onClick={() => toast.info('新建主题:自定义色板编辑器即将上线')}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    新建主题
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-foreground/80 hover:bg-muted"
                    onClick={() => toast.info('主题设置:默认主题与团队主题管理即将上线')}
                  >
                    <Settings2 className="h-3.5 w-3.5" />
                    设置
                  </button>
                </div>
              </div>
              {/* 右列:当前悬停/所选主题的迷你预览卡片(T15 未选择时显示中性预览) */}
              <div className="min-w-0 flex-1 border-l border-border/60 p-3">
                <ThemePreviewCard def={previewTheme ?? NEUTRAL_THEME} />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <div className="ml-auto flex items-center gap-2">
          {/* 构建/目标模式切换:仅显示文本名称,T18 选中对勾移至行最右侧且不保留行首占位 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 rounded-xl border border-border/80 px-3 text-foreground/80 hover:bg-muted"
              >
                <span className="text-xs">{BUILD_MODES.find((m) => m.key === mode)?.label}</span>
                <ChevronDown className="h-3 w-3 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              {BUILD_MODES.map((item) => (
                <DropdownMenuItem
                  key={item.key}
                  onClick={() => setMode(item.key)}
                  className="justify-between gap-3"
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span>{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.desc}</span>
                  </span>
                  {mode === item.key && <Check className="h-3.5 w-3.5 shrink-0 text-violet-500" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-9 w-9 rounded-full',
              listening
                ? 'animate-pulse bg-rose-500 text-white hover:bg-rose-600'
                : 'bg-muted text-foreground/80 hover:bg-muted',
            )}
            onClick={() => (listening ? stopVoice() : void startVoice())}
            disabled={transcribing}
            title={transcribing ? '正在转写语音…' : '语音输入'}
          >
            <AudioLines className="h-4 w-4" />
          </Button>
          {generating ? (
            queueMode ? (
              /* T13 详情页队列态:生成中可继续提交,自动排队等待当前生成结束后执行 */
              <Button
                size="icon"
                className="h-9 w-9 rounded-full bg-violet-500 text-white hover:bg-violet-600"
                onClick={onQueueSend}
                title="加入队列"
              >
                <Plus className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                className="h-9 w-9 rounded-full bg-rose-500 text-white hover:bg-rose-600"
                onClick={onStop}
                title="停止生成"
              >
                <Square className="h-3.5 w-3.5" />
              </Button>
            )
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 rounded-full bg-foreground text-background hover:bg-foreground/90"
              disabled={!prompt.trim()}
              onClick={onSend}
              title="发送"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

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
                      <X className="h-3.5 w-3.5" />
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
