'use client';

import { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

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
      const { error: authError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (authError) {
        setError(authError.message);
        setLoading(false);
        return;
      }

      // Verify the user is an admin by calling the admin API
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setError('Session not created. Please try again.');
        setLoading(false);
        return;
      }

      const res = await fetch('/api/super-admin/stats', {
        headers: { 'Authorization': `Bearer ${session.access_token}` },
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (res.status === 403 || res.status === 401) {
          await supabase.auth.signOut();
        }
        setError(detail.error || 'Verification failed. Please try again.');
        setLoading(false);
        return;
      }

      // Success — redirect to admin dashboard
      window.location.href = '/super-admin';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', background: '#000', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
    }}>
      <div style={{
        width: '100%', maxWidth: 380, padding: 32,
        background: '#0a0a0a', borderRadius: 16, border: '1px solid #222',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🦊</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>ALFANUMRIK</div>
          <div style={{
            fontSize: 10, color: '#555', letterSpacing: 2.5,
            textTransform: 'uppercase', marginTop: 4,
          }}>
            Super Admin Console
          </div>
        </div>

        {error && (
          <div style={{
            padding: '10px 14px', borderRadius: 8, marginBottom: 16,
            background: '#1a0000', border: '1px solid #333',
            color: '#EF4444', fontSize: 11, whiteSpace: 'pre-wrap' as const,
            maxHeight: 300, overflowY: 'auto' as const, wordBreak: 'break-word' as const,
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleLogin}>
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: '1px solid #333', background: '#000',
                color: '#fff', fontSize: 14, outline: 'none',
                boxSizing: 'border-box',
              }}
              placeholder="admin@alfanumrik.com"
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                width: '100%', padding: '10px 14px', borderRadius: 8,
                border: '1px solid #333', background: '#000',
                color: '#fff', fontSize: 14, outline: 'none',
                boxSizing: 'border-box',
              }}
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px 0', borderRadius: 8,
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              background: loading ? '#333' : '#fff',
              color: '#000', fontSize: 14, fontWeight: 700,
              letterSpacing: 0.5,
            }}
          >
            {loading ? 'Verifying...' : 'Sign In'}
          </button>
        </form>

        <div style={{
          marginTop: 20, textAlign: 'center', fontSize: 10, color: '#444',
        }}>
          Only authorized administrators can access this console.
          <br />Contact your system admin if you need access.
        </div>
      </div>
    </div>
  );
}
