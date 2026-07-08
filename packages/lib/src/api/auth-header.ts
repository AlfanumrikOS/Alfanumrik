/**
 * authHeader — fetches the current Supabase access token from the browser
 * client and returns it as an `Authorization: Bearer …` header, or an empty
 * object if no session is present.
 *
 * Why this exists (2026-05-18):
 *   This app's client-side auth state lives in localStorage (the Next.js
 *   proxy doesn't sync it to cookies). Server routes that call
 *   `authorizeRequest()` therefore can't reliably fall back to the cookie
 *   path on the first hop — the Authorization header is the working path.
 *
 *   Several client components were issuing plain `fetch('/api/student/…',
 *   { method: 'PATCH' })` without the header and getting 401 'Unauthorized'
 *   the moment the user clicked anything. Stream picker, nudge dismiss,
 *   selected-subjects save all tripped on this. Use this helper for any
 *   fetch from a client component to an `/api/…` route that requires auth.
 *
 *   The pattern matches `useAllowedSubjects.fetcher` (kept inline there to
 *   avoid an import cycle with the SWR hook).
 */

import { supabase } from '@alfanumrik/lib/supabase-client';

export async function authHeader(): Promise<Record<string, string>> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
  } catch {
    // No session / supabase not initialized — caller's request will 401 and
    // surface the error in the UI rather than failing silently here.
  }
  return {};
}
