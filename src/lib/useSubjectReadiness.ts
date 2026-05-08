// src/lib/useSubjectReadiness.ts
//
// SWR hook for batch per-chapter readiness across a subject (Exam-Ready 360°
// Phase 3). Backed by GET /api/v1/subject-readiness.
//
// Used by the /learn chapter-list page to render readiness badges next to
// every chapter and a summary banner. Single round-trip vs N per-chapter
// calls.

'use client';
import useSWR from 'swr';
import { supabase } from './supabase-client';
import type { ChapterReadinessLevel } from './useChapterReadiness';

export interface ChapterReadinessSummaryRow {
  chapter_number: number;
  level: ChapterReadinessLevel;
  score: number;
  concepts_total: number;
  concepts_mastered: number;
  recent_quiz_count: number;
  rag_ready: boolean;
}

export interface SubjectReadiness {
  grade: string;
  subject: string;
  chapters: ChapterReadinessSummaryRow[];
  summary: {
    ready: number;
    almost: number;
    building: number;
    not_yet: number;
  };
}

const fetcher = async (url: string): Promise<SubjectReadiness> => {
  const headers: Record<string, string> = {};
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  } catch {
    // Proceed without — server returns 401.
  }
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error(`subject-readiness.fetch_failed:${r.status}`);
  const body = (await r.json()) as { success: boolean; data?: SubjectReadiness };
  if (!body.success || !body.data) {
    throw new Error('subject-readiness.invalid_body');
  }
  return body.data;
};

export function useSubjectReadiness(subjectCode: string | null | undefined) {
  const hasArg = typeof subjectCode === 'string' && subjectCode.length > 0;
  const key = hasArg
    ? `/api/v1/subject-readiness?subject=${encodeURIComponent(subjectCode!)}`
    : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: true,
    dedupingInterval: 60_000,
    shouldRetryOnError: false,
  });

  return {
    readiness: data ?? null,
    isLoading: !!key && isLoading,
    error: error ?? null,
    refresh: () => mutate(),
  };
}
