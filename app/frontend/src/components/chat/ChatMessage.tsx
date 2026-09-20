import { Check, Code2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AgentPlanStep } from '@/lib/agent';

export interface ChatMessageData {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps?: AgentPlanStep[];
  codeProgress?: number;
  streaming?: boolean;
  /** T25:演示模式产物标记(实时与历史回放统一展示,来源为消息 metadata) */
  isDemo?: boolean;
}

/** 对话消息气泡:用户消息右侧,智能体消息(含计划卡与代码进度)左侧 */
export default function ChatMessage({ message }: { message: ChatMessageData }) {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 text-xs font-bold text-white">
        A
      </div>
      <div className="min-w-0 flex-1 space-y-2.5">
        {/* T25:演示模式元数据徽标——历史回放与实时生成展示一致 */}
        {message.isDemo && (
          <span className="inline-flex w-fit items-center rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-medium text-amber-500">
            演示模式
          </span>
        )}
        {message.content && (
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
            {message.streaming && !message.steps && (
              <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse bg-violet-500 align-middle" />
            )}
          </div>
        )}

        {message.steps && (
          <div className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-violet-500" />
              执行计划
            </div>
            <ol className="space-y-1.5">
              {message.steps.map((step, index) => (
                <li key={index} className="flex items-center gap-2 text-sm">
                  {step.status === 'done' ? (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-50">
                      <Check className="h-2.5 w-2.5 text-emerald-600" />
                    </span>
                  ) : step.status === 'running' ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" />
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-full border border-border" />
                  )}
                  <span className={cn(step.status === 'pending' && 'text-muted-foreground')}>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {typeof message.codeProgress === 'number' && (
          <div className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 text-xs text-muted-foreground">
            {message.codeProgress >= 100 ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" />
                <span>代码生成完成</span>
              </>
            ) : (
              <>
                <Code2 className="h-3.5 w-3.5 text-violet-500" />
                <span>正在生成代码 · {Math.round(message.codeProgress)}%</span>
                <Loader2 className="h-3 w-3 animate-spin" />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
