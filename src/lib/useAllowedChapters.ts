// src/lib/useAllowedChapters.ts
//
// Hook for the governed chapter list. Backed by
// GET /api/student/chapters?subject=<code> → available_chapters_for_student_subject RPC.
// Returns only chapters the student is allowed to access. Empty list for
// subjects the student isn't entitled to (no leak).
//
// Replaces direct `getChaptersForSubject(subject, grade)` calls. Use this in
// any UI that lets the student pick a chapter.

'use client';
import useSWR from 'swr';

export interface AllowedChapter {
  chapter_number: number;
  title: string;
  title_hi: string | null;
  ncert_page_start: number | null;
  ncert_page_end: number | null;
  total_questions: number;
  has_concepts: boolean;
}

// Auth tokens live in localStorage (no middleware to sync to cookies).
// Send the access token as Bearer header so server routes can authenticate.
import { supabase } from './supabase-client';

const fetcher = async (url: string): Promise<{ chapters: AllowedChapter[] }> => {
  const headers: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch { /* proceed without — server will return 401 */ }

  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`chapters.fetch_failed:${r.status}`);
  return r.json();
};

export function useAllowedChapters(subjectCode: string | null | undefined) {
  const key = subjectCode ? `/api/student/chapters?subject=${encodeURIComponent(subjectCode)}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
  return {
    chapters: data?.chapters ?? [],
    isLoading: !!key && isLoading,
    error: error ?? null,
    refresh: () => mutate(),
  };
}
