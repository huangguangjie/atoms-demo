import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronsUpDown,
  ChevronRight,
  Compass,
  Database,
  Gift,
  Home,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import AuthDialog from '@/components/auth/AuthDialog';
import {
  demoProfile,
  fetchRecentConversations,
  type Conversation,
} from '@/lib/supabase';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const MENU_ITEMS = [
  { key: 'home', label: '首页', icon: Home, to: '/' },
  { key: 'resources', label: '资源', icon: Compass, to: '/resources' },
  { key: 'projects', label: '我的项目', icon: Database, to: '/projects' },
] as const;

/** 品牌图标:渐变圆角方块 */
function LogoMark({ size = 'md' }: { size?: 'md' | 'sm' }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 font-bold text-white shadow-sm',
        size === 'md' ? 'h-7 w-7 text-sm' : 'h-8 w-8 text-base',
      )}
    >
      A
    </div>
  );
}

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, profile, spaces, currentSpace, setCurrentSpace, signOut, loading, demoMode } =
    useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [authOpen, setAuthOpen] = useState(false);

  const isSignedIn = Boolean(user) || demoMode;

  useEffect(() => {
    if (loading || !isSignedIn) return;
    const uid = user?.id ?? demoProfile.id;
    const load = () =>
      fetchRecentConversations(uid)
        .then(setConversations)
        .catch((error) => {
          console.error('[sidebar] 读取最近对话失败:', error);
          setConversations([]);
        });
    load();
    // 首页新建/更新对话后自动刷新最近列表
    window.addEventListener('atoms:conversations-updated', load);
    return () => window.removeEventListener('atoms:conversations-updated', load);
  }, [loading, isSignedIn, user, location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    toast.success('已退出登录');
  };

  const profileName = profile?.display_name ?? demoProfile.display_name;
  const avatarColor = profile?.avatar_color ?? demoProfile.avatar_color;
  const initial = profileName.charAt(0).toUpperCase();
  const activeSpaceName = currentSpace?.name ?? '选择空间';

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r bg-sidebar text-sidebar-foreground transition-all',
        collapsed ? 'w-[60px]' : 'w-full',
      )}
    >
      {/* 顶部:Logo 区 + 展开/收起图标 */}
      {collapsed ? (
        <div className="group relative flex h-14 shrink-0 items-center justify-center">
          <LogoMark />
          <button
            type="button"
            aria-label="展开侧边栏"
            onClick={onToggle}
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-transparent opacity-0 transition-opacity group-hover:opacity-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-background/95 shadow-sm ring-1 ring-border">
              <PanelLeftOpen className="h-4 w-4" />
            </span>
          </button>
        </div>
      ) : (
        <div className="flex h-14 shrink-0 items-center justify-between pl-4 pr-2">
          <div className="flex items-center gap-2">
            <LogoMark />
            <span className="text-base font-semibold tracking-tight">Atoms</span>
          </div>
          <button
            type="button"
            aria-label="收起侧边栏"
            onClick={onToggle}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <PanelLeftClose className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* 空间选择器(默认当前用户的默认空间) */}
      <div className={cn('shrink-0 px-3', collapsed && 'flex justify-center px-0')}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size={collapsed ? 'icon' : 'default'}
              className={cn(
                'w-full justify-start gap-2 rounded-xl border-border/70 bg-background font-normal',
                collapsed && 'w-9 justify-center px-0',
              )}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-violet-500 text-xs font-bold text-white">
                {activeSpaceName.charAt(0).toUpperCase()}
              </span>
              {!collapsed && (
                <>
                  <span className="truncate text-sm">{activeSpaceName}</span>
                  <ChevronsUpDown className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-xs text-muted-foreground">空间</DropdownMenuLabel>
            {spaces.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">暂无空间</div>
            )}
            {spaces.map((space) => (
              <DropdownMenuItem key={space.id} onClick={() => setCurrentSpace(space)}>
                <span className="flex h-5 w-5 items-center justify-center rounded bg-violet-500 text-[10px] font-bold text-white">
                  {space.name.charAt(0).toUpperCase()}
                </span>
                <span className="truncate">{space.name}</span>
                {space.is_default && (
                  <span className="ml-auto text-xs text-muted-foreground">默认</span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => toast.info('新建空间即将开放')}>
              <Plus className="h-4 w-4" />
              新建空间
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 菜单区 */}
      <nav className={cn('mt-3 shrink-0 space-y-1', collapsed ? 'px-2' : 'px-3')}>
        {MENU_ITEMS.map((item) => {
          const active = location.pathname === item.to;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => navigate(item.to)}
              title={collapsed ? item.label : undefined}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                active
                  ? 'bg-sidebar-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground',
                collapsed && 'justify-center px-0',
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* 最近对话列表 */}
      {collapsed ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            title="最近对话"
            onClick={() => navigate('/')}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-5 min-h-0 flex-1 overflow-y-auto px-3">
          <div className="px-2.5 pb-1.5 text-xs font-medium text-muted-foreground">最近</div>
          {conversations.length === 0 ? (
            <div className="px-2.5 py-3 text-xs leading-5 text-muted-foreground">
              还没有项目
              <br />
              点击「首页」开始。
            </div>
          ) : (
            <div className="space-y-0.5">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => navigate('/', { state: { conversationId: conversation.id } })}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-foreground"
                >
                  <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{conversation.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 附加链接块 */}
      {!collapsed && (
        <div className="shrink-0 space-y-2 px-3 pb-2 pt-2">
          <button
            type="button"
            onClick={() => toast.info('社区入口即将开放')}
            className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent/60"
          >
            <Users className="h-4 w-4 shrink-0 text-violet-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">加入我们的社区</span>
              <span className="block truncate text-xs text-muted-foreground">
                最多可赚取 25 积分
              </span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
          <button
            type="button"
            onClick={() => toast.info('免费积分领取即将开放')}
            className="flex w-full items-center gap-2.5 rounded-xl border border-border/70 bg-background px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent/60"
          >
            <Gift className="h-4 w-4 shrink-0 text-amber-500" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">获取免费积分</span>
              <span className="block truncate text-xs text-muted-foreground">每人获得10积分</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </div>
      )}

      {/* 底部:用户信息 / 设置 / 通知 */}
      <Separator className="bg-border/60" />
      {collapsed ? (
        <div className="flex flex-col items-center gap-1 py-2.5">
          <button
            type="button"
            title={isSignedIn ? profileName : '登录'}
            onClick={() => (isSignedIn ? undefined : setAuthOpen(true))}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white',
              avatarColor,
            )}
          >
            {initial}
          </button>
          <button
            type="button"
            title="设置"
            onClick={() => toast.info('设置即将开放')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="通知"
            onClick={() => toast.info('暂无新通知')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <Bell className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-3 py-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white transition-transform hover:scale-105',
                  avatarColor,
                )}
                onClick={() => {
                  if (!isSignedIn) {
                    setAuthOpen(true);
                  }
                }}
              >
                {initial}
              </button>
            </DropdownMenuTrigger>
            {isSignedIn && (
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel className="flex flex-col">
                  <span className="text-sm">{profileName}</span>
                  {profile?.email && (
                    <span className="text-xs font-normal text-muted-foreground">
                      {profile.email}
                    </span>
                  )}
                  {demoMode && (
                    <span className="mt-1 text-[11px] font-normal text-amber-600">
                      演示模式 · 数据仅保存在本浏览器
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => toast.info('个人主页即将开放')}>
                  我的个人主页
                </DropdownMenuItem>
                {!demoMode && (
                  <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="h-4 w-4" />
                    退出登录
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            )}
          </DropdownMenu>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              title="设置"
              onClick={() => toast.info('设置即将开放')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              type="button"
              title="通知"
              onClick={() => toast.info('暂无新通知')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
            >
              <Bell className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} />
    </aside>
  );
}
