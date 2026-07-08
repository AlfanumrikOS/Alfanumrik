import { useCallback, useRef } from 'react';
import { supabase } from './supabase';

interface PortalFetchOptions extends Omit<RequestInit, 'body'> {
  body?: Record<string, unknown> | null;
  timeoutMs?: number;
}

/**
 * A unified fetch hook for calling Supabase Edge Functions in the Teacher and Parent portals.
 * - Automatically attaches the current user's session token.
 * - Enforces a configurable timeout (default 10s) to prevent infinite loading.
 * - Parses JSON automatically and throws errors on non-200 responses.
 */
export function usePortalFetch() {
  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchPortal = useCallback(async <T>(
    endpoint: '/functions/v1/teacher-dashboard' | '/functions/v1/parent-portal',
    options: PortalFetchOptions = {}
  ): Promise<T> => {
    const { body, timeoutMs = 10000, headers: customHeaders, ...rest } = options;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(customHeaders as Record<string, string> || {}),
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

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
        throw new Error('Request timed out. Please try again.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }, []);

  return fetchPortal;
}
