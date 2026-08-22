// src/lib/useAllowedSubjects.ts
'use client';
import { useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { supabase } from './supabase-client';
import type { SubjectsListResponse } from './subjects.types';

const fetcher = async (url: string) => {
  // Auth tokens live in localStorage (no middleware to sync to cookies).
  // Send the access token as Bearer header so server routes can authenticate.
  const headers: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch { /* proceed without — server will return 401 */ }

  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error('subjects.fetch_failed');
  return r.json() as Promise<SubjectsListResponse>;
};

/**
 * The student's subject list, partitioned into unlocked / locked.
 *
 * `degraded` is the honest-failure signal every consumer must branch on
 * BEFORE it renders an upgrade prompt. See `SubjectsListResponse` for the
 * full rationale; the short version is that a locked subject means two
 * completely different things depending on whether the gating source
 * answered, and only the producer knows which happened.
 *
 * It is deliberately NOT derived from `unlocked.length === 0`: a free-tier
 * student legitimately has few (or, mid-grade-change, zero) unlocked
 * subjects, and telling them "we couldn't load your subjects" would be its
 * own lie. Two sources only:
 *   1. the fetch itself failed (non-2xx / network) — `subjects` is then [];
 *   2. the response explicitly said it came from the fail-closed fallback.
 */
export function useAllowedSubjects() {
  const { data, error, isLoading, mutate } = useSWR('/api/student/subjects', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  // Memoize derived values so identity is stable across renders when SWR
  // `data` is unchanged. ~24 consumers put these in effect/memo/callback
  // dependency arrays; unstable references caused render loops / flicker.
  const subjects = useMemo(() => data?.subjects ?? [], [data]);
  const unlocked = useMemo(() => subjects.filter((s) => !s.isLocked), [subjects]);
  const locked = useMemo(() => subjects.filter((s) => s.isLocked), [subjects]);
  const refresh = useCallback(() => { mutate(); }, [mutate]);
  const degraded = error != null || data?.degraded === true;
  return {
    subjects,
    unlocked,
    locked,
    isLoading,
    error: error ?? null,
    /** True when this list is NOT an authoritative answer. See doc above. */
    degraded,
    refresh,
  };
}
