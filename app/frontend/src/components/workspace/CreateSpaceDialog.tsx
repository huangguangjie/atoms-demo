import { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { useAuth } from '@/contexts/AuthContext';

interface CreateSpaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 新建工作区弹窗:云端落库 spaces(非默认),创建后自动切换为当前工作区 */
export default function CreateSpaceDialog({ open, onOpenChange }: CreateSpaceDialogProps) {
  const { createSpace } = useAuth();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (creating || !name.trim()) return;
    setCreating(true);
    try {
      await createSpace(name);
      toast.success(`工作区「${name.trim()}」已创建`);
      setName('');
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '创建工作区失败,请重试');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>新建工作区</DialogTitle>
          <DialogDescription>
            工作区是会话的容器,用于归类你的对话与项目;可在侧边栏随时切换。
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleCreate();
          }}
          placeholder="例如:产品探索、个人实验"
          autoFocus
        />
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            取消
          </Button>
          <Button
            onClick={() => void handleCreate()}
            disabled={creating || !name.trim()}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            {creating ? '创建中…' : '创建工作区'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
