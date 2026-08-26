'use client';

import { supabase } from '@alfanumrik/lib/supabase';

interface Props {
  isHi: boolean;
  loading: boolean;
  onError: (msg: string) => void;
  onLoading: (v: boolean) => void;
}

const t = (isHi: boolean, en: string, hi: string) => (isHi ? hi : en);

export function GoogleOAuthButton({ isHi, loading, onError, onLoading }: Props) {
  const handleGoogleAuth = async () => {
    onError('');
    onLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/auth/callback?type=login' },
      });
      if (error) { onError(error.message); onLoading(false); }
    } catch {
      onError(t(isHi, 'Connection error. Please try again.', 'कनेक्शन में समस्या। कृपया फिर से प्रयास करें।'));
      onLoading(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleGoogleAuth}
        disabled={loading}
        className="w-full py-3 rounded-xl text-sm font-bold bg-white border border-surface-3 text-foreground hover:bg-surface-2 transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
        </svg>
        {t(isHi, 'Continue with Google', 'Google से जारी रखें')}
      </button>
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-surface-3" />
        <span className="text-xs text-muted-foreground font-medium">{t(isHi, 'or', 'या')}</span>
        <div className="flex-1 h-px bg-surface-3" />
      </div>
    </>
  );
}
