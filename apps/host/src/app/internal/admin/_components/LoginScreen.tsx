'use client';

/**
 * Internal admin LoginScreen
 *
 * Extracted from src/app/internal/admin/page.tsx as part of the Plan 5
 * decomposition. Behaviour preserved verbatim:
 *  - Hits GET /api/internal/admin/stats with the x-admin-secret header to
 *    validate the secret before accepting.
 *  - On success, persists the secret via setAdminSecretInSession() (writes
 *    sessionStorage key 'alfa_admin_secret') and then calls onLogin(secret).
 *  - Input placeholder text is "Admin secret key" — load-bearing for the
 *    page-snapshot regression test (getByPlaceholderText(/admin secret/i)).
 *  - Submit button reads "Access Console" / "Verifying..." — also load-bearing
 *    for the snapshot test (getByRole('button', { name: /access console/i })).
 *
 * Visual styling rewritten in Tailwind tokens (drops the legacy `S.*` /
 * `C.*` style objects). Operator-only screen; English-only by design.
 */

import { useState } from 'react';
import { setAdminSecretInSession } from '@alfanumrik/lib/admin-session';

export interface LoginScreenProps {
  onLogin: (secret: string) => void;
}

export default function LoginScreen({ onLogin }: LoginScreenProps) {
  const [val, setVal] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const tryLogin = async () => {
    const trimmed = val.trim();
    if (!trimmed) return;
    setLoading(true);
    setErr('');
    try {
      const res = await fetch('/api/internal/admin/stats', {
        headers: { 'x-admin-secret': trimmed },
      });
      if (res.ok) {
        setAdminSecretInSession(trimmed);
        onLogin(trimmed);
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
        <label htmlFor="admin-secret" className="sr-only">
          Admin secret key
        </label>
        <input
          id="admin-secret"
          type="password"
          placeholder="Admin secret key"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoComplete="current-password"
          autoFocus
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none focus:ring-1 focus:ring-orange-500"
        />
        {err && (
          <div className="mb-2.5 text-[11px] text-red-400" role="alert">
            {err}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !val.trim()}
          className="w-full rounded-md bg-orange-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-orange-600 disabled:opacity-50"
        >
          {loading ? 'Verifying...' : 'Access Console'}
        </button>
        <div className="mt-3.5 text-center text-[10px] text-neutral-500">
          Secret is stored in sessionStorage only — cleared on tab close.
        </div>
      </form>
    </div>
  );
}
