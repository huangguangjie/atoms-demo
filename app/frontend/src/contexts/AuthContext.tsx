import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import {
  demoProfile,
  demoSpace,
  ensureProfileAndSpace,
  isSupabaseConfigured,
  supabase,
  type Profile,
  type Space,
} from '@/lib/supabase';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  spaces: Space[];
  currentSpace: Space | null;
  loading: boolean;
  /** Supabase 未配置时的演示模式:自动以演示身份进入应用 */
  demoMode: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  setCurrentSpace: (space: Space) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function displayNameOf(user: User): string {
  const meta = user.user_metadata as Record<string, string | undefined>;
  if (meta?.full_name) return meta.full_name;
  if (meta?.name) return meta.name;
  const email = user.email ?? 'developer';
  return email.split('@')[0];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [currentSpace, setCurrentSpaceState] = useState<Space | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  const loadUserData = useCallback(async (user: User) => {
    try {
      const { data: existing, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();
      if (profileError) {
        throw new Error(`读取用户资料失败:${profileError.message}`);
      }
      setProfile((existing as Profile) ?? null);

      const displayName = displayNameOf(user);
      const userSpaces = await ensureProfileAndSpace(user.id, user.email ?? '', displayName);
      setSpaces(userSpaces);
      setCurrentSpaceState((prev) => {
        if (prev && userSpaces.some((s) => s.id === prev.id)) return prev;
        return userSpaces.find((s) => s.is_default) ?? userSpaces[0] ?? null;
      });
    } catch (error) {
      // 资料初始化失败必须暴露真实报错,避免静默导致后续建对话/建项目连锁失败
      console.error('[auth] 加载用户数据失败:', error);
      toast.error(error instanceof Error ? error.message : '用户数据加载失败,请刷新重试');
    }
  }, []);

  useEffect(() => {
    // 演示模式:未配置 Supabase,直接以演示身份进入
    if (!isSupabaseConfigured) {
      setProfile(demoProfile);
      setSpaces([demoSpace]);
      setCurrentSpaceState(demoSpace);
      setLoading(false);
      return;
    }

    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession } }) => {
        setSession(initialSession);
        if (initialSession?.user) {
          void loadUserData(initialSession.user);
        }
      })
      .catch((error) => {
        console.error('[auth] 获取会话失败:', error);
      })
      .finally(() => setLoading(false));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) {
        void loadUserData(nextSession.user);
      } else {
        setProfile(null);
        setSpaces([]);
        setCurrentSpaceState(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [loadUserData]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(error.message);
  }, []);

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    await supabase.auth.signOut();
  }, []);

  const setCurrentSpace = useCallback((space: Space) => {
    setCurrentSpaceState(space);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      spaces,
      currentSpace,
      loading,
      demoMode: !isSupabaseConfigured,
      signIn,
      signUp,
      signOut,
      setCurrentSpace,
    }),
    [session, profile, spaces, currentSpace, loading, signIn, signUp, signOut, setCurrentSpace],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
