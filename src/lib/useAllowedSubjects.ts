// src/lib/useAllowedSubjects.ts
'use client';
import useSWR from 'swr';
import type { Subject } from './subjects.types';

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error('subjects.fetch_failed');
  return r.json() as Promise<{ subjects: Subject[] }>;
});

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
