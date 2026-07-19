'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { validatePassword, PASSWORD_MIN_LENGTH } from '@alfanumrik/lib/sanitize';
import { Button, Input, Card, LoadingFoxy } from '@alfanumrik/ui/ui';
import { useAuth } from '@alfanumrik/lib/AuthContext';

export default function ResetPasswordPage() {
  const router = useRouter();
  const { isHi } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    // The session may arrive via multiple paths:
    // 1. URL hash tokens (set by /auth/confirm or /auth/callback) — detectSessionInUrl picks these up
    // 2. localStorage (if SDK already stored a session)
    // 3. Network call to Supabase (if cookies are set by middleware)
    //
    // On slow Indian 4G (2-5 Mbps, per P10), the Supabase SDK's detectSessionInUrl
    // may take several seconds to process the URL hash. We poll every 500ms for up
    // to 8s to give it sufficient headroom.
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let resolved = false;

    const resolve = () => {
      if (resolved) return;
      resolved = true;
      if (pollTimer) clearInterval(pollTimer);
      setHasSession(true);
      setChecking(false);
    };

    const checkSession = async () => {
      // Method 1: Check if client SDK already has a session (from localStorage)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { resolve(); return; }

      // Method 2: Try to get user via network call (authenticates using token if available)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) { resolve(); return; }
      } catch {
        // getUser failed — no session available via this method
      }

      // No session found yet — poll every 500ms for up to 8s while
      // detectSessionInUrl processes the URL hash asynchronously.
      const MAX_WAIT_MS = 8000;
      const POLL_INTERVAL_MS = 500;
      let elapsed = 0;
      pollTimer = setInterval(async () => {
        if (resolved) return;
        elapsed += POLL_INTERVAL_MS;
        try {
          const { data: { session: s } } = await supabase.auth.getSession();
          if (s) { resolve(); return; }
        } catch { /* ignore — keep polling */ }
        if (elapsed >= MAX_WAIT_MS) {
          if (pollTimer) clearInterval(pollTimer);
          if (!resolved) setChecking(false); // Shows "Invalid or Expired Link"
        }
      }, POLL_INTERVAL_MS);
    };

    // Listen for auth state change — INITIAL_SESSION fires when detectSessionInUrl
    // processes the hash tokens, PASSWORD_RECOVERY and SIGNED_IN cover other paths
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (session) resolve();
      }
    });

    checkSession();
    return () => {
      resolved = true;
      if (pollTimer) clearInterval(pollTimer);
      subscription.unsubscribe();
    };
  }, []);

  const resetPassword = async () => {
    if (!password) {
      setError(isHi ? 'नया पासवर्ड दर्ज करें' : 'Enter a new password');
      return;
    }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      // Supabase-side validation error — keep server string as-is (may be localized upstream)
      setError(pwCheck.error);
      return;
    }
    if (password !== confirmPassword) {
      setError(isHi ? 'पासवर्ड मेल नहीं खा रहे' : 'Passwords do not match');
      return;
    }

    setLoading(true); setError('');
    const { error: e } = await supabase.auth.updateUser({ password });
    if (e) {
      setError(e.message);
    } else {
      // Audit log: record password change for security compliance
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('audit_logs').insert({
            user_id: user.id,
            action: 'password_reset',
            resource_type: 'auth',
            details: { method: 'email_link' },
            status: 'success',
          });
        }
      } catch { /* audit is best-effort — don't block the success flow */ }
      setSuccess(true);
      // Sign out so they can log in fresh with new password
      await supabase.auth.signOut();
    }
    setLoading(false);
  };

  /* Auto-redirect to login after success */
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => router.replace('/login'), 3000);
      return () => clearTimeout(timer);
    }
  }, [success, router]);

  if (checking) return <LoadingFoxy />;

  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
      <Card className="w-full max-w-sm animate-slide-up !p-8">
        {!hasSession && !success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }} aria-hidden="true">🔗</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, marginBottom: 8 }}>
              {isHi ? 'अमान्य या समाप्त लिंक' : 'Invalid or Expired Link'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 20 }}>
              {isHi
                ? 'यह पासवर्ड रीसेट लिंक समाप्त हो चुका है या अमान्य है। कृपया नया अनुरोध करें।'
                : 'This password reset link has expired or is invalid. Please request a new one.'}
            </p>
            <Button fullWidth onClick={() => router.replace('/login')}>
              {isHi ? 'लॉगिन पर जाएँ' : 'Go to Login'} &rarr;
            </Button>
          </div>
        ) : success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }} aria-hidden="true">✅</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, marginBottom: 8 }}>
              {isHi ? 'पासवर्ड अपडेट हो गया!' : 'Password Updated!'}
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 20 }}>
              {isHi
                ? 'आपका पासवर्ड सफलतापूर्वक बदल दिया गया है। 3 सेकंड में लॉगिन पर जा रहे हैं...'
                : 'Your password has been changed successfully. Redirecting to login in 3 seconds...'}
            </p>
            <Button fullWidth onClick={() => router.replace('/login')}>
              {isHi ? 'लॉगिन करें' : 'Log In'} &rarr;
            </Button>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }} aria-hidden="true">🔐</div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>
                {isHi ? 'नया पासवर्ड सेट करें' : 'Set New Password'}
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                {isHi
                  ? 'अपने खाते के लिए एक मज़बूत पासवर्ड चुनें'
                  : 'Choose a strong password for your account'}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={isHi
                    ? `नया पासवर्ड (कम से कम ${PASSWORD_MIN_LENGTH} अक्षर, A-z, 0-9)`
                    : `New password (min ${PASSWORD_MIN_LENGTH} chars, A-z, 0-9)`}
                  aria-label={isHi ? 'नया पासवर्ड' : 'New password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword
                    ? (isHi ? 'पासवर्ड छिपाएँ' : 'Hide password')
                    : (isHi ? 'पासवर्ड दिखाएँ' : 'Show password')}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-3)' }}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder={isHi ? 'नया पासवर्ड पुष्टि करें' : 'Confirm new password'}
                aria-label={isHi ? 'नया पासवर्ड पुष्टि करें' : 'Confirm new password'}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && resetPassword()}
              />

              {/* Password strength indicator */}
              {password && (
                <div style={{ display: 'flex', gap: 4 }}>
                  {[1, 2, 3, 4].map(i => {
                    const hasLower = /[a-z]/.test(password);
                    const hasUpper = /[A-Z]/.test(password);
                    const hasDigit = /\d/.test(password);
                    const score = (password.length >= PASSWORD_MIN_LENGTH ? 1 : 0) + (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0);
                    return (
                      <div
                        key={i}
                        style={{
                          flex: 1, height: 4, borderRadius: 2,
                          background: i <= score
                            ? score === 4 ? '#16A34A' : score >= 3 ? '#F5A623' : '#DC2626'
                            : 'var(--surface-2)',
                          transition: 'background 0.3s',
                        }}
                      />
                    );
                  })}
                  <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 4, whiteSpace: 'nowrap' }}>
                    {password.length < PASSWORD_MIN_LENGTH
                      ? (isHi ? 'बहुत छोटा' : 'Too short')
                      : validatePassword(password).valid
                        ? (isHi ? 'मज़बूत' : 'Strong')
                        : (isHi ? 'अधिक विविधता चाहिए' : 'Needs more variety')}
                  </span>
                </div>
              )}

              {error && <p style={{ color: 'var(--red)', fontSize: 13 }} role="alert">{error}</p>}
              <Button fullWidth onClick={resetPassword} disabled={loading || !password || !confirmPassword}>
                {loading
                  ? (isHi ? 'अपडेट हो रहा है…' : 'Updating…')
                  : (isHi ? 'पासवर्ड अपडेट करें →' : 'Update Password →')}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
