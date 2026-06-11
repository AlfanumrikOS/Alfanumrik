'use client';

/**
 * useUpcomingExams — client read of the student's active exam_configs (with
 * their exam_chapters) for the Alfa OS pre-test briefing hub (ff_test_os_v1,
 * Tier 1 / presentation-only).
 *
 * This is the SAME RLS-scoped read the existing /exams page performs
 * (src/app/exams/page.tsx:81-87) — exam_configs joined with exam_chapters,
 * filtered to is_active, ordered by exam_date. We re-read it here (rather than
 * import the page) so the briefing hub is self-contained and the legacy /exams
 * surface is never touched. RLS on exam_configs already scopes rows to the
 * authenticated student, so no extra filter beyond student_id is needed.
 *
 * No schema/scoring/XP/exam-timing change — this is a presentation-only read.
 */

import useSWR from 'swr';
import { supabase } from '@/lib/supabase-client';

export interface ExamChapterRow {
  id: string;
  chapter_number: number;
  chapter_title: string;
  weightage_marks: number;
  mastery_percent: number;
}

export interface UpcomingExam {
  id: string;
  student_id: string;
  exam_name: string;
  exam_type: string;
  subject: string;
  exam_date: string;
  total_marks: number;
  duration_minutes: number;
  is_active: boolean;
  created_at: string;
  exam_chapters: ExamChapterRow[];
}

const fetcher = async (studentId: string): Promise<UpcomingExam[]> => {
  const { data, error } = await supabase
    .from('exam_configs')
    .select('*, exam_chapters(*)')
    .eq('student_id', studentId)
    .eq('is_active', true)
    .order('exam_date');
  if (error) throw new Error(`exam-briefing.exams_fetch_failed:${error.code}`);
  return (data ?? []) as UpcomingExam[];
};

export function useUpcomingExams(studentId: string | undefined) {
  const key = studentId ? ['exam-briefing/upcoming-exams', studentId] : null;
  const { data, error, isLoading, mutate } = useSWR(
    key,
    ([, id]) => fetcher(id as string),
    {
      revalidateOnFocus: true,
      dedupingInterval: 60_000,
      shouldRetryOnError: false,
    }
  );

  return {
    exams: data ?? null,
    isLoading: !!key && isLoading,
    error: error ?? null,
    refresh: () => mutate(),
  };
}
