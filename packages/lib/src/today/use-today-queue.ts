'use client';

/**
 * src/lib/today/use-today-queue.ts — shared SWR hook for /api/v2/today.
 *
 * Used by both /today/page.tsx and TodaysMission (dashboard) so SWR's
 * deduplication ensures a single network request when both mount simultaneously.
 * The key includes the studentId so different students on the same device get
 * separate cache entries (P13).
 */

import useSWR from 'swr';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import type { TodayResponse } from './types';

async function fetchTodayQueue(): Promise<TodayResponse | null> {
  const res = await fetch('/api/v2/today', {
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
    fetchTodayQueue,
    { revalidateOnFocus: false, dedupingInterval: 30_000 },
  );
}
