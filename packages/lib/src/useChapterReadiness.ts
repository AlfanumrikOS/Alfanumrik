// src/lib/useChapterReadiness.ts
//
// SWR hook for the per-chapter exam-readiness signal (Exam-Ready 360°
// Phase 1 RPC). Backed by GET /api/v1/chapter-readiness — see
// src/app/api/v1/chapter-readiness/route.ts.
//
// Used by `/learn/[subject]/[chapter]` to render the ChapterReadinessCard
// banner above the practice/read content. Cache is conservative because the
// underlying RPC reads BKT mastery + recent quizzes which only change on
// user action (every quiz submit invalidates the cache via mutate()).

'use client';
import useSWR from 'swr';
import { supabase } from './supabase-client';

export type ChapterReadinessLevel = 'not_yet' | 'building' | 'almost' | 'ready';

export interface ChapterReadiness {
  level: ChapterReadinessLevel;
  score: number;             // 0..100 composite
  mastery_avg: number;
  concepts_total: number;
  concepts_mastered: number;
  recent_quiz_avg: number;
  recent_quiz_count: number;
  spaced_reviews: number;
  rag_ready: boolean;
  next_action: string;       // mock_exam | spaced_review | take_quiz | introduce_concept | review_concept
  message_en: string;
  message_hi: string;
  grade: string;
  subject: string;
  chapter: number;
}

const fetcher = async (url: string): Promise<ChapterReadiness> => {
  const headers: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // Proceed without — server returns 401 which the caller handles.
  }

  const r = await fetch(url, { headers });
  if (!r.ok) {
    throw new Error(`chapter-readiness.fetch_failed:${r.status}`);
  }
  const body = (await r.json()) as { success: boolean; data?: ChapterReadiness };
  if (!body.success || !body.data) {
    throw new Error('chapter-readiness.invalid_body');
  }
  return body.data;
};

/**
 * Fetch the readiness signal for a (subject, chapter) pair the student is
 * currently studying. Returns `null` for `readiness` until the first response
 * lands so the calling UI can render a skeleton without flicker.
 *
 * Cache policy:
 *   - dedupingInterval 30s — chapter readiness changes after each quiz submit
 *     and the chapter page already calls `mutate()` then.
 *   - revalidateOnFocus on — students often switch tabs to look something up
 *     and come back; pulling fresh state on return is the right tradeoff.
 */
export function useChapterReadiness(
  subjectCode: string | null | undefined,
  chapterNumber: number | null | undefined,
) {
  const hasArgs =
    typeof subjectCode === 'string' &&
    subjectCode.length > 0 &&
    typeof chapterNumber === 'number' &&
    Number.isInteger(chapterNumber) &&
    chapterNumber > 0;
  const key = hasArgs
    ? `/api/v1/chapter-readiness?subject=${encodeURIComponent(subjectCode!)}&chapter=${chapterNumber}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 30_000,
    // Don't surface transient 401/500 to the UI — the card handles missing
    // data by hiding itself rather than rendering an error state.
    shouldRetryOnError: false,
  });

  return {
    readiness: data ?? null,
    isLoading: !!key && isLoading,
    error: error ?? null,
    refresh: () => mutate(),
  };
}
