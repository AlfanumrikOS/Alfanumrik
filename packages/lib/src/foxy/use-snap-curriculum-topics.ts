'use client';

/**
 * useSnapCurriculumTopics — client read backing screen 10 "Snap a doubt"'s
 * REAL topic-matching step.
 *
 * Reuses the EXISTING `GET /api/v2/learn/curriculum` route byte-for-byte —
 * no new query, no new endpoint. That route already wraps the shared cached
 * taxonomy fetcher (`apps/host/src/lib/curriculum/cached-taxonomy.ts`,
 * ADR-007 Hard Rule 6) behind the student's plan/grade/stream gating
 * (`study_plan.view`). This hook only flattens the subject → chapter → topic
 * tree that route already returns into the flat list `matchTopicFromText()`
 * (see `./snap-topic-match.ts`) scores against.
 *
 * 404 (no student profile found for this account) resolves to an empty list,
 * matching the `useTodayQueue` / `useExamSchedule` "404 → null-ish" contract
 * used elsewhere in Wave B.
 */

import useSWR from 'swr';
import { authHeader } from '@alfanumrik/lib/api/auth-header';
import type { SnapCurriculumTopic } from './snap-topic-match';

interface CurriculumChapterRow {
  chapter_number: number | null;
  title: string | null;
  title_hi: string | null;
  topics: Array<{ id: string; title: string | null; title_hi: string | null }>;
}

interface CurriculumSubjectRow {
  code: string;
  name: string;
  name_hi: string | null;
  is_locked: boolean;
  chapters: CurriculumChapterRow[];
}

interface CurriculumResponse {
  schemaVersion: 1;
  grade: string;
  subjects: CurriculumSubjectRow[];
}

/** Flattens the curriculum-tree response into the shape the matcher scores. Exported for tests. */
export function flattenCurriculumTopics(data: CurriculumResponse | null): SnapCurriculumTopic[] {
  if (!data) return [];
  const flat: SnapCurriculumTopic[] = [];
  for (const subject of data.subjects ?? []) {
    // Only match against subjects the student can actually act on — a locked
    // (plan/stream-gated) subject shouldn't win a match that routes into
    // Foxy for content the student can't otherwise reach.
    if (subject.is_locked) continue;
    for (const chapter of subject.chapters ?? []) {
      for (const topic of chapter.topics ?? []) {
        if (!topic.title) continue;
        flat.push({
          id: topic.id,
          title: topic.title,
          titleHi: topic.title_hi ?? null,
          chapterNumber: chapter.chapter_number,
          subjectCode: subject.code,
          subjectName: subject.name,
        });
      }
    }
  }
  return flat;
}

async function fetchCurriculum(): Promise<CurriculumResponse | null> {
  const res = await fetch('/api/v2/learn/curriculum', {
    credentials: 'same-origin',
    headers: { ...(await authHeader()) },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error('snap.curriculum_fetch_failed') as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return (body.data ?? body) as CurriculumResponse;
}

export function useSnapCurriculumTopics(enabled: boolean) {
  const swr = useSWR<CurriculumResponse | null>(
    enabled ? 'v2/learn/curriculum/snap' : null,
    fetchCurriculum,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );

  return {
    topics: flattenCurriculumTopics(swr.data ?? null),
    isLoading: swr.isLoading,
    error: !!swr.error,
    mutate: swr.mutate,
  };
}
