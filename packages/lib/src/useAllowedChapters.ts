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
  // Optional — v2 RPC exposes verified_question_count; legacy RPC exposes
  // ncert_page_start/end/total_questions/has_concepts. Kept optional so the
  // hook works against either shape.
  //
  // BADGE GUIDANCE (Decision A option 3, tiered verification, 2026-08-14):
  //   verified_question_count — "an agent proved this against NCERT". This is
  //     a READINESS signal, not a servability one, and badging with it is what
  //     made the picker advertise questions the quiz could not deliver. Kept
  //     for back-compat; do not use it for a student-facing count.
  //   practice_ready_count — questions the practice/daily-quiz path can
  //     actually serve. USE THIS for the chapter badge.
  //   exam_ready_count — additionally cleared by a human SME; what the
  //     mock-test path can draw on. Use on exam/mock surfaces only.
  // All three may be undefined against a database predating migration
  // 20260814000014. Treat undefined as "unknown" and fall back to the previous
  // rendering — never render undefined as 0.
  verified_question_count?: number;
  practice_ready_count?: number;
  exam_ready_count?: number;
  ncert_page_start?: number | null;
  ncert_page_end?: number | null;
  total_questions?: number;
  has_concepts?: boolean;
}

// Auth tokens live in localStorage (no middleware to sync to cookies).
// Send the access token as Bearer header so server routes can authenticate.
import { supabase } from './supabase-client';

// The API v2 returns `chapter_title`/`chapter_title_hi` (cbse_syllabus SSoT).
// Legacy callers expect `title`/`title_hi`. Normalize at the fetcher boundary
// so every consumer of this hook sees the same shape regardless of which
// server revision is live.
interface RawChapterRow {
  chapter_number: number;
  chapter_title?: string;
  chapter_title_hi?: string | null;
  title?: string;
  title_hi?: string | null;
  verified_question_count?: number;
  practice_ready_count?: number;
  exam_ready_count?: number;
  ncert_page_start?: number | null;
  ncert_page_end?: number | null;
  total_questions?: number;
  has_concepts?: boolean;
}

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
  const body = (await r.json()) as { chapters?: RawChapterRow[] };
  const chapters: AllowedChapter[] = (body.chapters ?? []).map((c) => ({
    chapter_number: c.chapter_number,
    title: c.chapter_title ?? c.title ?? `Chapter ${c.chapter_number}`,
    title_hi: c.chapter_title_hi ?? c.title_hi ?? null,
    verified_question_count: c.verified_question_count,
    practice_ready_count: c.practice_ready_count,
    exam_ready_count: c.exam_ready_count,
    ncert_page_start: c.ncert_page_start ?? null,
    ncert_page_end: c.ncert_page_end ?? null,
    total_questions: c.total_questions,
    has_concepts: c.has_concepts,
  }));
  return { chapters };
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
