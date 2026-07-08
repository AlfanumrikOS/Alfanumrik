'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@alfanumrik/lib/supabase';
import { validatePassword, PASSWORD_MIN_LENGTH } from '@alfanumrik/lib/sanitize';
import { LoadingFoxy } from '@alfanumrik/ui/ui';
import {
  Button,
  Input,
  Field,
  Card,
  Alert,
  EmptyState,
  IconButton,
} from '@alfanumrik/ui/ui/primitives';
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

  if (checking) return <LoadingFoxy />;

  return (
    <div className="mesh-bg flex min-h-dvh items-center justify-center p-5">
      <Card variant="elevated" className="w-full max-w-sm animate-slide-up">
        <div className="p-8">
          {!hasSession && !success ? (
            <EmptyState
              icon="🔗"
              title={isHi ? 'अमान्य या समाप्त लिंक' : 'Invalid or Expired Link'}
              description={isHi
                ? 'यह पासवर्ड रीसेट लिंक समाप्त हो चुका है या अमान्य है। कृपया नया अनुरोध करें।'
                : 'This password reset link has expired or is invalid. Please request a new one.'}
              action={
                <Button variant="primary" fullWidth onClick={() => router.replace('/login')}>
                  {isHi ? 'लॉगिन पर जाएँ' : 'Go to Login'} &rarr;
                </Button>
              }
            />
          ) : success ? (
            <EmptyState
              icon="✅"
              title={isHi ? 'पासवर्ड अपडेट हो गया!' : 'Password Updated!'}
              description={isHi
                ? 'आपका पासवर्ड सफलतापूर्वक बदल दिया गया है। अब आप नए पासवर्ड से लॉगिन कर सकते हैं।'
                : 'Your password has been changed successfully. You can now log in with your new password.'}
              action={
                <Button variant="primary" fullWidth onClick={() => router.replace('/login')}>
                  {isHi ? 'लॉगिन करें' : 'Log In'} &rarr;
                </Button>
              }
            />
          ) : (
            <>
              <div className="mb-6 text-center">
                <div className="mb-2 text-5xl" aria-hidden="true">🔐</div>
                <h2
                  className="text-fluid-2xl font-extrabold text-foreground"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {isHi ? 'नया पासवर्ड सेट करें' : 'Set New Password'}
                </h2>
                <p className="mt-1 text-fluid-xs text-muted-foreground">
                  {isHi
                    ? 'अपने खाते के लिए एक मज़बूत पासवर्ड चुनें'
                    : 'Choose a strong password for your account'}
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {/* New password */}
                <Field
                  htmlFor="reset-new-password"
                  label={isHi ? 'नया पासवर्ड' : 'New password'}
                  required
                  requiredText={isHi ? 'आवश्यक' : 'required'}
                >
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder={isHi
                        ? `कम से कम ${PASSWORD_MIN_LENGTH} अक्षर, A-z, 0-9`
                        : `Min ${PASSWORD_MIN_LENGTH} chars, A-z, 0-9`}
                      autoComplete="new-password"
                      minLength={PASSWORD_MIN_LENGTH}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      className="pr-12"
                    />
                    <IconButton
                      variant="ghost"
                      size="sm"
                      label={showPassword
                        ? (isHi ? 'पासवर्ड छिपाएँ' : 'Hide password')
                        : (isHi ? 'पासवर्ड दिखाएँ' : 'Show password')}
                      icon={<span aria-hidden="true">{showPassword ? '🙈' : '👁️'}</span>}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-1 top-1/2 -translate-y-1/2"
                    />
                  </div>
                </Field>

                {/* Confirm password */}
                <Field
                  htmlFor="reset-confirm-password"
                  label={isHi ? 'नया पासवर्ड पुष्टि करें' : 'Confirm new password'}
                  required
                  requiredText={isHi ? 'आवश्यक' : 'required'}
                >
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={isHi ? 'नया पासवर्ड पुष्टि करें' : 'Confirm new password'}
                    autoComplete="new-password"
                    minLength={PASSWORD_MIN_LENGTH}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && resetPassword()}
                  />
                </Field>

                {/* Password strength indicator */}
                {password && (
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4].map(i => {
                      const hasLower = /[a-z]/.test(password);
                      const hasUpper = /[A-Z]/.test(password);
                      const hasDigit = /\d/.test(password);
                      const score = (password.length >= PASSWORD_MIN_LENGTH ? 1 : 0) + (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0);
                      return (
                        <div
                          key={i}
                          className="h-1 flex-1 rounded-full"
                          style={{
                            background: i <= score
                              ? score === 4 ? 'var(--success)' : score >= 3 ? 'var(--warning)' : 'var(--danger)'
                              : 'var(--surface-2)',
                            transition: 'background 0.3s',
                          }}
                        />
                      );
                    })}
                    <span className="ml-1 whitespace-nowrap text-fluid-xs text-muted-foreground">
                      {password.length < PASSWORD_MIN_LENGTH
                        ? (isHi ? 'बहुत छोटा' : 'Too short')
                        : validatePassword(password).valid
                          ? (isHi ? 'मज़बूत' : 'Strong')
                          : (isHi ? 'अधिक विविधता चाहिए' : 'Needs more variety')}
                    </span>
                  </div>
                )}

                {error && <Alert tone="danger">{error}</Alert>}

                <Button
                  variant="primary"
                  fullWidth
                  onClick={resetPassword}
                  loading={loading}
                  disabled={loading || !password || !confirmPassword}
                >
                  {isHi ? 'पासवर्ड अपडेट करें →' : 'Update Password →'}
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
