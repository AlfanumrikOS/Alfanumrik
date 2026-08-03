'use client';

import { useCallback } from 'react';
import {
  adminHeaders,
  getAdminSecretFromSession,
  setAdminSecretInSession,
  clearAdminSession,
} from '@alfanumrik/lib/admin-session';

/**
 * Returns a typed fetch function that automatically attaches the
 * `x-admin-secret` header (and `Content-Type: application/json`) used by
 * every `/api/internal/admin/*` endpoint.
 *
 * During P2-1 PR-2 the panel sends BOTH credentials on every request:
 *  - the `x-admin-secret` header (handlers still require it), and
 *  - the httpOnly sb-* session cookie, carried automatically by same-origin
 *    fetch. We set `credentials: 'same-origin'` explicitly (the default for
 *    same-origin requests) so the middleware session-or-secret bridge always
 *    sees the cookie. NO `Authorization: Bearer` header — the client never
 *    holds the token (it lives only in the httpOnly cookie).
 *
 * Throws `Error('Admin API <status>: <body>')` on non-2xx responses.
 *
 * Wraps `adminHeaders()` from `@alfanumrik/lib/admin-session` — do NOT reimplement
 * header generation or the sessionStorage key here.
 */
export function useAdminFetch(secret: string | null) {
  return useCallback(
    async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(path, {
        ...init,
        credentials: init?.credentials ?? 'same-origin',
        headers: {
          ...adminHeaders(secret ?? ''),
          ...(init?.headers || {}),
        },
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => 'unknown');
        throw new Error(`Admin API ${res.status}: ${txt}`);
      }
      return (await res.json()) as T;
    },
    [secret],
  );
}

/**
 * Re-exports of the canonical sessionStorage helpers from
 * `@alfanumrik/lib/admin-session`, aliased to the `loadAdminSecret` / `saveAdminSecret`
 * / `clearAdminSecret` names referenced by the Plan 5 refactor so that
 * downstream tab components only need to import from this hook module.
 *
 * The underlying sessionStorage key is `'alfa_admin_secret'`.
 */
export {
  getAdminSecretFromSession as loadAdminSecret,
  setAdminSecretInSession as saveAdminSecret,
  clearAdminSession as clearAdminSecret,
} from '@alfanumrik/lib/admin-session';

// Also re-export `adminHeaders` for callers that need to build headers
// outside of the hook (e.g. one-shot fetches in event handlers).
export { adminHeaders } from '@alfanumrik/lib/admin-session';
