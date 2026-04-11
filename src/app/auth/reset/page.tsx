'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { validatePassword, PASSWORD_MIN_LENGTH } from '@/lib/sanitize';
import { Button, Input, Card, LoadingFoxy } from '@/components/ui';

export default function ResetPasswordPage() {
  const router = useRouter();
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
    const checkSession = async () => {
      // Method 1: Check if client SDK already has a session (from localStorage)
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setHasSession(true);
        setChecking(false);
        return;
      }

      // Method 2: Try to get user via network call (authenticates using token if available)
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setHasSession(true);
          setChecking(false);
          return;
        }
      } catch {
        // getUser failed — no session available via this method
      }

      // No session found yet — wait briefly for onAuthStateChange to fire
      // (detectSessionInUrl processes the URL hash asynchronously)
      setTimeout(() => {
        setChecking(false);
      }, 2000);
    };

    // Listen for auth state change — INITIAL_SESSION fires when detectSessionInUrl
    // processes the hash tokens, PASSWORD_RECOVERY and SIGNED_IN cover other paths
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (session) {
          setHasSession(true);
          setChecking(false);
        }
      }
    });

    checkSession();
    return () => subscription.unsubscribe();
  }, []);

  const resetPassword = async () => {
    if (!password) { setError('Enter a new password'); return; }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) { setError(pwCheck.error); return; }
    if (password !== confirmPassword) { setError('Passwords do not match'); return; }

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

  if (checking) return <LoadingFoxy />;

  return (
    <div className="mesh-bg min-h-dvh flex items-center justify-center p-5">
      <Card className="w-full max-w-sm animate-slide-up !p-8">
        {!hasSession && !success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔗</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, marginBottom: 8 }}>
              Invalid or Expired Link
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 20 }}>
              This password reset link has expired or is invalid. Please request a new one.
            </p>
            <Button fullWidth onClick={() => router.replace('/login')}>
              Go to Login &rarr;
            </Button>
          </div>
        ) : success ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, marginBottom: 8 }}>
              Password Updated!
            </h2>
            <p style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.6, marginBottom: 20 }}>
              Your password has been changed successfully. You can now log in with your new password.
            </p>
            <Button fullWidth onClick={() => router.replace('/login')}>
              Log In &rarr;
            </Button>
          </div>
        ) : (
          <>
            <div style={{ textAlign: 'center', marginBottom: 24 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🔐</div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22 }}>
                Set New Password
              </h2>
              <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                Choose a strong password for your account
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ position: 'relative' }}>
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder={`New password (min ${PASSWORD_MIN_LENGTH} chars, A-z, 0-9)`}
                  aria-label="New password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-3)' }}
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
              <Input
                type={showPassword ? 'text' : 'password'}
                placeholder="Confirm new password"
                aria-label="Confirm new password"
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
                    {password.length < PASSWORD_MIN_LENGTH ? 'Too short' : validatePassword(password).valid ? 'Strong' : 'Needs more variety'}
                  </span>
                </div>
              )}

              {error && <p style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
              <Button fullWidth onClick={resetPassword} disabled={loading || !password || !confirmPassword}>
                {loading ? 'Updating...' : 'Update Password →'}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
