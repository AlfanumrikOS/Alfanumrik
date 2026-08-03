import { useCallback, useRef } from 'react';
import { supabase } from './supabase';

/** Edge Functions the portal pages call through this helper. */
type PortalEndpoint =
  | '/functions/v1/teacher-dashboard'
  | '/functions/v1/parent-portal'
  | '/functions/v1/nep-compliance';

interface PortalFetchOptions extends Omit<RequestInit, 'body'> {
  body?: Record<string, unknown> | null;
  timeoutMs?: number;
  /** User-facing copy thrown when the request times out — pass language-appropriate text (P7). */
  timeoutMessage?: string;
}

/** Bilingual timeout copy (P7) — single source for every portal surface. */
export const PORTAL_TIMEOUT_MESSAGE_EN = 'Request timed out. Please try again.';
export const PORTAL_TIMEOUT_MESSAGE_HI = 'अनुरोध का समय समाप्त हो गया। कृपया पुनः प्रयास करें।';

/**
 * A unified fetch hook for calling Supabase Edge Functions in the Teacher and
 * Parent portals (and student-facing nep-compliance).
 * - Always sends the anon `apikey` header (matches every legacy hand-rolled helper).
 * - Automatically attaches the current user's session token; fails soft when no
 *   session can be read (the Edge Function rejects the request instead — P13).
 * - Enforces a configurable timeout (default 10s) to prevent infinite loading.
 * - Parses JSON automatically and throws `API error <status>: <text>` on non-2xx.
 */
export function usePortalFetch() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchPortal = useCallback(async <T>(
    endpoint: PortalEndpoint,
    options: PortalFetchOptions = {}
  ): Promise<T> => {
    const { body, timeoutMs = 10000, timeoutMessage, headers: customHeaders, ...rest } = options;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
        ...(customHeaders as Record<string, string> || {}),
      };

      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }
      } catch { /* no session — request will be rejected by the Edge Function */ }

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL || ''}${endpoint}`;

      const res = await fetch(url, {
        ...rest,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: abortController.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`API error ${res.status}: ${errorText}`);
      }

      return res.json() as Promise<T>;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(timeoutMessage || PORTAL_TIMEOUT_MESSAGE_EN);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  return fetchPortal;
}

/**
 * Action-style wrapper matching the legacy per-page `api(action, params)` helpers:
 * POSTs `{ action, ...params }` to the given Edge Function with the default 10s
 * timeout (override via `timeoutMs`); an abort surfaces as a friendly bilingual
 * message chosen by `isHi` at call time (P7).
 *
 * The returned function is referentially stable across renders (including
 * language toggles), so it is safe to list in `useCallback`/`useEffect`
 * dependency arrays without re-triggering fetches.
 */
export function usePortalAction(endpoint: PortalEndpoint, isHi: boolean, timeoutMs?: number) {
  const fetchPortal = usePortalFetch();
  const isHiRef = useRef(isHi);
  isHiRef.current = isHi;
  return useCallback(
    (action: string, params: Record<string, unknown> = {}): Promise<any> =>
      fetchPortal<any>(endpoint, {
        method: 'POST',
        body: { action, ...params },
        timeoutMs,
        timeoutMessage: isHiRef.current ? PORTAL_TIMEOUT_MESSAGE_HI : PORTAL_TIMEOUT_MESSAGE_EN,
      }),
    [fetchPortal, endpoint, timeoutMs],
  );
}
