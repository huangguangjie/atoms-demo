import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import {
  createSpace as supabaseCreateSpace,
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
  /** 新建工作区(云端落库 spaces)并切换为当前工作区 */
  createSpace: (name: string) => Promise<void>;
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

  // 同一用户的资料/空间初始化可能被 getSession 与 onAuthStateChange 双路并发触发,
  // 这里按用户 id 去重保证并发只执行一次,避免重复初始化引发主键冲突误报
  const inflightLoadRef = useRef<{ userId: string; promise: Promise<void> } | null>(null);

  const loadUserData = useCallback(
    (user: User): Promise<void> => {
      const inflight = inflightLoadRef.current;
      if (inflight && inflight.userId === user.id) return inflight.promise;
      const promise = (async () => {
        // 新登录刚签发的 JWT 可能因服务端时钟偏移被判定为「签发于未来」,首次资料读取
        // 会命中一次瞬时 401;这里做有限次重试以吸收瞬时错误,重试耗尽后仍原样透出,
        // 避免登录初期就需要手动刷新才能恢复资料与默认空间。
        const maxAttempts = 3;
        try {
          for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
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
              return;
            } catch (error) {
              // 资料初始化失败必须暴露真实报错,避免静默导致后续建对话/建项目连锁失败
              if (attempt < maxAttempts) {
                console.warn(`[auth] 用户数据加载第 ${attempt} 次失败,3 秒后重试:`, error);
                await new Promise((resolve) => setTimeout(resolve, 3000));
              } else {
                console.error('[auth] 加载用户数据失败:', error);
                toast.error(error instanceof Error ? error.message : '用户数据加载失败,请刷新重试');
              }
            }
          }
        } finally {
          if (inflightLoadRef.current?.promise === promise) {
            inflightLoadRef.current = null;
          }
        }
      })();
      inflightLoadRef.current = { userId: user.id, promise };
      return promise;
    },
    [],
  );

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

  const createSpace = useCallback(
    async (name: string) => {
      const owner = session?.user?.id ?? (isSupabaseConfigured ? null : demoProfile.id);
      if (!owner) throw new Error('请先登录后再创建工作区');
      const space = await supabaseCreateSpace(owner, name);
      setSpaces((prev) => [...prev, space]);
      setCurrentSpaceState(space);
    },
    [session],
  );

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
      createSpace,
    }),
    [
      session,
      profile,
      spaces,
      currentSpace,
      loading,
      signIn,
      signUp,
      signOut,
      setCurrentSpace,
      createSpace,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth 必须在 AuthProvider 内使用');
  return ctx;
}
