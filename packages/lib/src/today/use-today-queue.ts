'use client';

/**
 * src/lib/today/use-today-queue.ts — shared SWR hook for /api/v2/today.
 *
 * Used by both /today/page.tsx and TodaysMission (dashboard) so SWR's
 * deduplication ensures a single network request when both mount simultaneously.
 *
 * P13 contract: the SWR key AND the request URL both carry the studentId, so
 * different students on the same device (shared/borrowed phone, parent portal,
 * view-as) get separate cache entries AND separate server reads — the key can
 * never serve student A's queue to student B, and the URL can never fetch
 * student A's session-scoped data under student B's key.
 */

import useSWR from 'swr';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import type { TodayResponse } from './types';

async function fetchTodayQueue(studentId: string | null | undefined): Promise<TodayResponse | null> {
  const url = studentId
    ? `/api/v2/today?studentId=${encodeURIComponent(studentId)}`
    : '/api/v2/today';
  const res = await fetch(url, {
    credentials: 'same-origin',
    headers: { ...(await authHeader()) },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error('today.fetch_failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<TodayResponse>;
}

/**
 * Fetches the learner-loop today queue for the given student.
 * Returns { data, error, isLoading, mutate } like any SWR hook.
 * Key: null when studentId is absent (suspends the fetch).
 */
export function useTodayQueue(studentId: string | null | undefined) {
  return useSWR<TodayResponse | null>(
    studentId ? `v2/today/${studentId}` : null,
    () => fetchTodayQueue(studentId),
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
}
