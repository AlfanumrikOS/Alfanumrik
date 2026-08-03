'use client';

/**
 * Internal admin LoginScreen — SESSION-ONLY (P2-1 PR-4).
 *
 * ONE credential: the super_admin SESSION. Email + password are POSTed to
 * /api/super-admin/login with credentials:'same-origin'. On 200 the server
 * sets an httpOnly sb-* session cookie; there is NOTHING to store client-side
 * (the response body carries no tokens by design). We deliberately do NOT call
 * supabase.auth.setSession / supabase.auth.signInWithPassword here — that would
 * recreate the dual-refresh split-brain and bypass the route's per-IP /
 * per-email throttle. The cookie is the single session source and the sole
 * credential the panel and its handlers require. On 200 → onLogin().
 *
 * The former shared admin secret (and its sessionStorage persistence) was
 * removed end-to-end: the middleware now requires a super_admin session for
 * /internal/admin and the handlers no longer accept a secret.
 *
 * Load-bearing string preserved for the page-snapshot / login-screen tests:
 *  - submit button "Access Console" / "Verifying..."
 *
 * Visual styling in Tailwind tokens. Operator-only screen; English-only by
 * design (internal admin tool — no i18n).
 */

import { useState } from 'react';

export interface LoginScreenProps {
  onLogin: () => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const canSubmit = !!email.trim() && !!password;

  const tryLogin = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) return;
    setLoading(true);
    setErr('');
    try {
      // Establish the super_admin session (httpOnly sb-* cookie). The 200 body
      // carries no tokens — nothing to persist client-side; the cookie is set
      // by the server. NO supabase.auth.setSession, NO Bearer.
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
      onLogin();
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
          Sign in with your administrator email and password. Your session is
          held in a secure httpOnly cookie — no secret to enter.
        </div>
      </form>
    </div>
  );
}
