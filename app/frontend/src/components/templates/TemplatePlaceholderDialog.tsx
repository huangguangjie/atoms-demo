import { useEffect, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Template } from '@/lib/supabase';

interface TemplatePlaceholderDialogProps {
  template: Template | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 确认生成:携带用户填写的占位值(键值对,空值表示保留默认) */
  onConfirm: (values: Record<string, string>) => void;
  submitting?: boolean;
}

/** 模板占位替换弹窗:展示模板占位字段,填写后一键生成自己的应用 */
export default function TemplatePlaceholderDialog({
  template,
  open,
  onOpenChange,
  onConfirm,
  submitting = false,
}: TemplatePlaceholderDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  // 打开弹窗或切换模板时,用占位默认值初始化表单
  useEffect(() => {
    if (!open || !template) return;
    const defaults: Record<string, string> = {};
    (template.placeholders ?? []).forEach((p) => {
      defaults[p.key] = p.default_value ?? '';
    });
    setValues(defaults);
  }, [open, template]);

  const placeholders = template?.placeholders ?? [];

  const setValue = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = () => {
    if (submitting) return;
    onConfirm(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            使用模板「{template?.title}」
          </DialogTitle>
          <DialogDescription>
            {placeholders.length > 0
              ? '替换下方占位内容后一键生成你的应用,替换值会真实体现在生成结果中。'
              : '该模板无需替换占位内容,可直接生成应用。'}
          </DialogDescription>
        </DialogHeader>

        {placeholders.length > 0 && (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
            {placeholders.map((p) => (
              <div key={p.key} className="space-y-1.5">
                <Label htmlFor={`ph-${p.key}`} className="text-sm font-medium">
                  {p.label}
                </Label>
                {(p.default_value ?? '').length > 24 ? (
                  <Textarea
                    id={`ph-${p.key}`}
                    value={values[p.key] ?? ''}
                    onChange={(e) => setValue(p.key, e.target.value)}
                    rows={2}
                    className="resize-none"
                  />
                ) : (
                  <Input
                    id={`ph-${p.key}`}
                    value={values[p.key] ?? ''}
                    onChange={(e) => setValue(p.key, e.target.value)}
                  />
                )}
                {p.description && (
                  <p className="text-xs text-muted-foreground">{p.description}</p>
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            <Wand2 className="h-4 w-4" />
            {submitting ? '正在创建…' : '生成我的应用'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
