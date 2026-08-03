'use client';

/**
 * Internal admin LoginScreen
 *
 * TWO credentials, BOTH required before the console opens (P2-1 PR-2):
 *
 *  1. super_admin SESSION — email + password POSTed to /api/super-admin/login
 *     with credentials:'same-origin'. On 200 the server sets an httpOnly sb-*
 *     session cookie; there is NOTHING to store client-side (the response body
 *     carries no tokens by design). We deliberately do NOT call
 *     supabase.auth.setSession / supabase.auth.signInWithPassword here — that
 *     would recreate the dual-refresh split-brain and bypass the route's
 *     per-IP / per-email throttle. The cookie is the single session source and
 *     is a prerequisite for PR-3 (which drops the secret handler-side).
 *
 *  2. shared admin SECRET — validated (unchanged) via GET /api/internal/admin/stats
 *     with the x-admin-secret header. On success the secret is persisted via
 *     setAdminSecretInSession() (sessionStorage key 'alfa_admin_secret') and
 *     then onLogin(secret) is called. During PR-2 the handlers STILL require
 *     the secret, so the panel keeps sending it alongside the session cookie.
 *
 * Both steps must succeed before onLogin() fires.
 *
 * Load-bearing strings preserved for the page-snapshot / login-screen tests:
 *  - secret input placeholder "Admin secret key"
 *  - submit button "Access Console" / "Verifying..."
 *
 * Visual styling in Tailwind tokens. Operator-only screen; English-only by
 * design (internal admin tool — no i18n).
 */

import { useState } from 'react';
import { setAdminSecretInSession } from '@alfanumrik/lib/admin-session';

export interface LoginScreenProps {
  onLogin: (secret: string) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = !!email.trim() && !!password && !!val.trim();

  const tryLogin = async () => {
    const trimmedEmail = email.trim();
    const trimmedSecret = val.trim();
    if (!trimmedEmail || !password || !trimmedSecret) return;
    setLoading(true);
    setErr('');
    try {
      // ── 1. Establish the super_admin session (httpOnly sb-* cookie). ──
      // The 200 body carries no tokens — nothing to persist client-side; the
      // cookie is set by the server. NO supabase.auth.setSession, NO Bearer.
      const loginRes = await fetch('/api/super-admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      if (!loginRes.ok) {
        const data = await loginRes.json().catch(() => ({}));
        setErr(
          typeof data?.error === 'string' && data.error
            ? data.error
            : 'Invalid administrator credentials. Access denied.',
        );
        setLoading(false);
        return;
      }

      // ── 2. Validate the shared admin secret (handlers still require it). ──
      const secretRes = await fetch('/api/internal/admin/stats', {
        headers: { 'x-admin-secret': trimmedSecret },
        credentials: 'same-origin',
      });
      if (secretRes.ok) {
        setAdminSecretInSession(trimmedSecret);
        onLogin(trimmedSecret);
      } else {
        setErr('Invalid secret. Access denied.');
      }
    } catch {
      setErr('Network error. Please retry.');
    }
    setLoading(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void tryLogin();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 px-5">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-6 shadow-lg"
      >
        <div className="mb-6 text-center">
          <div className="mb-1.5 text-3xl">🦊</div>
          <div className="text-base font-extrabold text-orange-500">ALFANUMRIK</div>
          <div className="mt-0.5 text-[10px] tracking-[0.2em] text-neutral-500">
            SUPER ADMIN CONSOLE
          </div>
        </div>

        <label htmlFor="admin-email" className="sr-only">
          Administrator email
        </label>
        <input
          id="admin-email"
          type="email"
          placeholder="Administrator email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoFocus
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />

        <label htmlFor="admin-password" className="sr-only">
          Administrator password
        </label>
        <input
          id="admin-password"
          type="password"
          placeholder="Administrator password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />

        <label htmlFor="admin-secret" className="sr-only">
          Admin secret key
        </label>
        <input
          id="admin-secret"
          type="password"
          placeholder="Admin secret key"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoComplete="one-time-code"
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />

        {err && (
          <div className="mb-2.5 text-[11px] text-red-400" role="alert">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !canSubmit}
          className="w-full rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Access Console'}
        </button>
        <div className="mt-3.5 text-center text-[10px] text-neutral-500">
          Both an administrator sign-in and the console secret are required. The
          secret is stored in sessionStorage only — cleared on tab close.
        </div>
      </form>
    </div>
  );
}
