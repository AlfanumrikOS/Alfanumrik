'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const colors = {
  bg: '#FFFFFF', surface: '#F9FAFB', border: '#E5E7EB', borderStrong: '#D1D5DB',
  text1: '#111827', text2: '#6B7280', text3: '#9CA3AF', danger: '#DC2626', dangerLight: '#FEF2F2',
};

export default function AdminLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [supabase] = useState(() =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '')
  );

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) { setError(authError.message); setLoading(false); return; }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setError('Session not created. Please try again.'); setLoading(false); return; }

      const res = await fetch('/api/super-admin/stats', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (res.status === 403 || res.status === 401) await supabase.auth.signOut();
        setError(detail.error || 'Verification failed. Please try again.');
        setLoading(false);
        return;
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
        boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.04)',
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
            background: colors.dangerLight, border: '1px solid #FECACA',
            color: colors.danger, fontSize: 12, whiteSpace: 'pre-wrap' as const,
            maxHeight: 200, overflowY: 'auto' as const, wordBreak: 'break-word' as const,
          }}>
            {error}
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
