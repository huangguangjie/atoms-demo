import { useState } from 'react';
import { Code2, Eye, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { DemoApp } from '@/lib/demo-apps';

interface AppPreviewProps {
  app: DemoApp;
  onClose: () => void;
}

/** 生成应用的可视化预览面板:iframe 实时运行 + 源码查看,可刷新 */
export default function AppPreview({ app, onClose }: AppPreviewProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [frameKey, setFrameKey] = useState(0);
  const file = app.files[0];

  return (
    <div className="flex h-full min-w-0 flex-col border-l bg-muted/30">
      {/* 工具栏 */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium">{app.title}</span>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            生成应用
          </span>
        </div>
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
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} title="关闭预览">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 内容区 */}
      {tab === 'preview' ? (
        <iframe
          key={frameKey}
          title={`${app.title} 预览`}
          srcDoc={file.content}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
          className="h-full w-full flex-1 bg-white"
        />
      ) : (
        <pre className="flex-1 overflow-auto bg-white p-4 text-[12px] leading-relaxed text-slate-800">
          <code>{file.content}</code>
        </pre>
      )}

      {/* 状态栏 */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-t bg-background px-3 text-[11px] text-muted-foreground">
        <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{file.name}</span>
        <span>单文件应用 · 可直接运行</span>
      </div>
    </div>
  );
}
