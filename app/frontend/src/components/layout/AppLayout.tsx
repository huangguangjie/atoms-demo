import { useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import Sidebar from './Sidebar';

/**
 * 应用主框架:左侧可折叠侧边栏 + 右侧内容路由容器。
 * 侧边栏支持拖拽调整宽度,折叠/展开由 Sidebar 顶部图标控制。
 */
export default function AppLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);

  useEffect(() => {
    sidebarPanelRef.current?.resize(collapsed ? 3 : 18);
  }, [collapsed]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-background">
      <ResizablePanelGroup direction="horizontal" className="h-full">
        <ResizablePanel
          ref={sidebarPanelRef}
          defaultSize={18}
          minSize={3}
          maxSize={28}
          className="h-full"
        >
          <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        </ResizablePanel>
        <ResizableHandle className="w-px bg-transparent transition-colors hover:bg-border data-[resize-handle-state=drag]:bg-border" />
        <ResizablePanel defaultSize={82} minSize={50} className="h-full min-w-0">
          <main className="h-full overflow-y-auto">
            <Outlet />
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  );
}
