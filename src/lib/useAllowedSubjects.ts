// src/lib/useAllowedSubjects.ts
'use client';
import { useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { supabase } from './supabase-client';
import type { Subject } from './subjects.types';

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
  return r.json() as Promise<{ subjects: Subject[] }>;
};

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
  return {
    subjects,
    unlocked,
    locked,
    isLoading,
    error: error ?? null,
    refresh,
  };
}
