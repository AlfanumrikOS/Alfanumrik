'use client';

import { useCallback } from 'react';
import {
  adminHeaders,
  getAdminSecretFromSession,
  setAdminSecretInSession,
  clearAdminSession,
} from '@/lib/admin-session';

/**
 * Returns a typed fetch function that automatically attaches the
 * `x-admin-secret` header (and `Content-Type: application/json`) used by
 * every `/api/internal/admin/*` endpoint.
 *
 * Throws `Error('Admin API <status>: <body>')` on non-2xx responses.
 *
 * Wraps `adminHeaders()` from `@/lib/admin-session` — do NOT reimplement
 * header generation or the sessionStorage key here.
 */
export function useAdminFetch(secret: string | null) {
  return useCallback(
    async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(path, {
        ...init,
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
 * `@/lib/admin-session`, aliased to the `loadAdminSecret` / `saveAdminSecret`
 * / `clearAdminSecret` names referenced by the Plan 5 refactor so that
 * downstream tab components only need to import from this hook module.
 *
 * The underlying sessionStorage key is `'alfa_admin_secret'`.
 */
export {
  getAdminSecretFromSession as loadAdminSecret,
  setAdminSecretInSession as saveAdminSecret,
  clearAdminSession as clearAdminSecret,
} from '@/lib/admin-session';

// Also re-export `adminHeaders` for callers that need to build headers
// outside of the hook (e.g. one-shot fetches in event handlers).
export { adminHeaders } from '@/lib/admin-session';
