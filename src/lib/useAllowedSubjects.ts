// src/lib/useAllowedSubjects.ts
'use client';
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
  return {
    subjects: data?.subjects ?? [],
    unlocked: (data?.subjects ?? []).filter((s) => !s.isLocked),
    locked:   (data?.subjects ?? []).filter((s) =>  s.isLocked),
    isLoading,
    error: error ?? null,
    refresh: () => mutate(),
  };
}
