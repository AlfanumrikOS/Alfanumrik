'use client';

import { useCallback } from 'react';

/**
 * Returns a typed fetch function for the `/api/internal/admin/*` endpoints.
 *
 * The internal-admin console is SESSION-ONLY (P2-1): the sole credential is the
 * httpOnly sb-* session cookie set by POST /api/super-admin/login, carried
 * automatically on same-origin fetches. We set `credentials: 'same-origin'`
 * explicitly so the middleware always sees the cookie, and send only
 * `Content-Type: application/json` plus any caller-supplied headers. There is
 * NO `x-admin-secret` header and NO `Authorization: Bearer` — the token lives
 * only in the httpOnly cookie.
 *
 * Throws `Error('Admin API <status>: <body>')` on non-2xx responses.
 */
export function useAdminFetch() {
  return useCallback(
    async <T = unknown>(path: string, init?: RequestInit): Promise<T> => {
      const res = await fetch(path, {
        ...init,
        credentials: init?.credentials ?? 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(init?.headers || {}),
        },
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => 'unknown');
        throw new Error(`Admin API ${res.status}: ${txt}`);
      }
      return (await res.json()) as T;
    },
    [],
  );
}
