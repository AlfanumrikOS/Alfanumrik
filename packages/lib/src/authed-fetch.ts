/**
 * authed-fetch.ts — Bearer-token forwarding helper for client-side fetchers.
 *
 * WHY this exists:
 *   The browser Supabase client (`src/lib/supabase-client.ts`) persists the session
 *   in localStorage, NOT in a cookie (it uses plain `createClient`, not
 *   `createBrowserClient`). Server routes — `authorizeRequest` / `authorizeSchoolAdmin`
 *   — authenticate via `Authorization: Bearer <access_token>` FIRST, then fall back to
 *   cookies. A client fetch that relies on `credentials: 'same-origin'` alone sends no
 *   cookie that carries the session, so the server sees no user and returns 401.
 *
 *   The established app pattern (see `src/app/school-admin/reports/page.tsx` getToken
 *   helper) is to read the access token from the live session and forward it as a
 *   Bearer header. This module is that pattern, factored once.
 *
 * NEUTRAL PATH: this helper is generic (not school-admin-specific). It lives at
 *   `@alfanumrik/lib/authed-fetch` so any client fetcher (student dashboard widgets,
 *   parent, teacher, school-admin) can import it cleanly. The historical path
 *   `@alfanumrik/lib/school-admin/authed-fetch` is kept as a thin re-export so the
 *   ~16 existing school-admin importers (and their test) keep working unchanged.
 *
 * Tiny + dependency-free by design.
 */

import { supabase } from '@alfanumrik/lib/supabase-client';

/**
 * Read the current access token from the live Supabase session.
 * Returns null when there is no session (the caller still fires the request;
 * the server returns 401 and existing error handling shows a retry).
 */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * A thin `fetch` wrapper that injects `Authorization: Bearer <token>` into the
 * request headers while preserving every caller-provided header, method, and body.
 * Keeps `credentials: 'same-origin'` so the cookie path remains as a fallback.
 *
 * Any caller-set `Authorization` header is preserved (only added when absent).
 * If no token is available, the request is still sent (no header) so the
 * server-side 401 → existing retry UX path remains intact.
 */
export async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();

  // Merge headers without clobbering caller-provided ones (e.g. Content-Type).
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers,
  });
}
