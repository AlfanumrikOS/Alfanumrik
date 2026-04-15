// src/lib/useTeacherAllowedSubjects.ts
//
// Teacher-scoped subjects hook. Mirrors useAllowedSubjects() (student-scoped)
// but hits /api/teacher/subjects — backed by the teacher's profile
// (subjects_taught / grades_taught) rather than a single student's
// grade/stream/plan. Same return shape so callers can swap freely.
'use client';
import useSWR from 'swr';
import type { Subject } from './subjects.types';

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error('teacher_subjects.fetch_failed');
  return r.json() as Promise<{ subjects: Subject[] }>;
});

export function useTeacherAllowedSubjects() {
  const { data, error, isLoading, mutate } = useSWR('/api/teacher/subjects', fetcher, {
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