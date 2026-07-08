'use client';

import { useState } from 'react';
import { supabase } from '@alfanumrik/lib/supabase';

const colors = {
  bg: 'var(--surface-1)', surface: 'var(--surface-2)', border: 'var(--border)', borderStrong: 'var(--border-strong)',
  text1: 'var(--text-1)', text2: 'var(--text-2)', text3: 'var(--text-3)', danger: 'var(--danger)', dangerLight: 'color-mix(in srgb, var(--danger) 8%, transparent)',
};

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [suggestedLoginUrl, setSuggestedLoginUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuggestedLoginUrl('');
    setLoading(true);

    try {
      // Phase G.7 (2026-05-17): route through /api/super-admin/login which
      // adds per-IP rate limit + per-email lockout BEFORE delegating to
      // Supabase Auth. The previous direct supabase.auth.signInWithPassword
      // call bypassed every protection in the proxy.
      const loginRes = await fetch('/api/super-admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const loginPayload = await loginRes.json().catch(() => ({}));

      if (!loginRes.ok) {
        const code = loginPayload?.code;
        let message = loginPayload?.error || 'Login failed';
        if (code === 'EMAIL_LOCKED' && loginPayload?.retry_after_seconds) {
          const min = Math.ceil(loginPayload.retry_after_seconds / 60);
          message = `Too many failed attempts. Try again in ~${min} min.`;
        } else if (code === 'IP_RATE_LIMITED') {
          message = 'Too many login attempts from this network. Wait a few minutes.';
        } else if (code === 'USE_STANDARD_LOGIN' && loginPayload?.suggested_login_url) {
          // Backend already provided a human-readable message; expose the
          // suggested URL as a clickable link below. No auto-redirect.
          setSuggestedLoginUrl(loginPayload.suggested_login_url);
        }
        setError(message);
        setLoading(false);
        return;
      }

      // Hydrate the supabase-js client with the server-issued session so
      // existing code (AdminShell, apiFetch) keeps working unchanged.
      if (loginPayload?.session?.access_token && loginPayload?.session?.refresh_token) {
        await supabase.auth.setSession({
          access_token: loginPayload.session.access_token,
          refresh_token: loginPayload.session.refresh_token,
        });
      }

      window.location.href = '/super-admin';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: colors.bg, color: colors.text1,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
      colorScheme: 'light',
    }}>
      <div style={{
        width: '100%', maxWidth: 400, padding: 36,
        background: colors.bg, borderRadius: 12,
        border: `1px solid ${colors.border}`,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: colors.text1, letterSpacing: 1 }}>ALFANUMRIK</div>
          <div style={{
            fontSize: 10, color: colors.text3, letterSpacing: 2.5,
            textTransform: 'uppercase', marginTop: 4,
          }}>
            Super Admin Console
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: colors.dangerLight, border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)',
            color: colors.danger, fontSize: 12, whiteSpace: 'pre-wrap' as const,
            maxHeight: 200, overflowY: 'auto' as const, wordBreak: 'break-word' as const,
          }}>
            {error}
            {suggestedLoginUrl && (
              <a
                href={suggestedLoginUrl}
                style={{ color: 'var(--info)', fontWeight: 600, marginTop: 8, display: 'inline-block' }}
              >
                {`→ Go to ${suggestedLoginUrl}`}
              </a>
            )}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: colors.text2, display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Email
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${colors.border}`, background: colors.bg,
                color: colors.text1, fontSize: 14, outline: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.currentTarget.style.borderColor = colors.text1}
              onBlur={e => e.currentTarget.style.borderColor = colors.border}
              placeholder="admin@alfanumrik.com"
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ fontSize: 12, color: colors.text2, display: 'block', marginBottom: 6, fontWeight: 600 }}>
              Password
            </label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${colors.border}`, background: colors.bg,
                color: colors.text1, fontSize: 14, outline: 'none', boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
              onFocus={e => e.currentTarget.style.borderColor = colors.text1}
              onBlur={e => e.currentTarget.style.borderColor = colors.border}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit" disabled={loading}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 8,
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? colors.borderStrong : colors.text1,
              color: colors.bg, fontSize: 14, fontWeight: 700,
              letterSpacing: 0.5, fontFamily: 'inherit',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Verifying...' : 'Sign In'}
          </button>
        </form>

        <div style={{
          marginTop: 24, textAlign: 'center', fontSize: 11, color: colors.text3, lineHeight: 1.5,
        }}>
          Only authorized administrators can access this console.
          <br />Contact your system admin if you need access.
        </div>
      </div>
    </div>
  );
}
