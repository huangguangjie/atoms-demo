import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';

/** Supabase OAuth/邮箱确认回调页:完成会话交换后跳转首页 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handle = async () => {
      try {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
          window.location.href,
        );
        if (exchangeError) throw exchangeError;
        navigate('/', { replace: true });
      } catch {
        // 部分流程(hash 链接/已登录)无需 exchange,探测一次会话
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          navigate('/', { replace: true });
        } else {
          setError('登录信息无效或已过期,请重新登录');
        }
      }
    };
    void handle();
  }, [navigate]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      {error ? (
        <p className="text-sm text-rose-600">{error}</p>
      ) : (
        <>
          <div className="h-10 w-10 animate-spin rounded-full border-b-2 border-violet-600" />
          <p className="text-sm text-muted-foreground">正在完成登录…</p>
        </>
      )}
    </div>
  );
}
