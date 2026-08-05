/**
 * Foxy page topic-mastery read (Foxy North-Star Phase 2 re-point).
 *
 * Previously this selected `* from topic_mastery`, a WRITERLESS table —
 * always empty, so every chapter chip rendered 'not_started'. Re-pointed to
 * the `public.topic_mastery_rollup` view (fixed contract) with an explicit
 * column list. Extracted from page.tsx into `_lib/` so it is unit-testable
 * (Next.js page files may only export the default component + route config).
 */
import { supabase } from '@alfanumrik/lib/supabase';

/** Fixed view contract — explicit columns, never `*`. */
export const TOPIC_MASTERY_ROLLUP_COLUMNS =
  'student_id, subject, grade, topic_tag, chapter_number, mastery_percent, mastery_level, mastery_probability, next_review_at';

export interface TopicMasteryRollupRow {
  student_id: string;
  subject: string;
  grade: string;
  topic_tag: string;
  chapter_number: number;
  mastery_percent: number;
  mastery_level: string;
  mastery_probability: number;
  next_review_at: string | null;
}

/**
 * Fetch the student's per-topic mastery rollup for one subject.
 * Best-effort: any error yields [] (chapter chips fall back to 'not_started').
 * Ordered by chapter_number so downstream `.find()` matching is stable
 * (the view has no updated_at column — the old ordering does not apply).
 */
export async function fetchMastery(studentId: string, subject: string): Promise<TopicMasteryRollupRow[]> {
  const { data } = await supabase
    .from('topic_mastery_rollup')
    .select(TOPIC_MASTERY_ROLLUP_COLUMNS)
    .eq('student_id', studentId)
    .eq('subject', subject)
    .order('chapter_number', { ascending: true })
    .limit(50);
  return (data as TopicMasteryRollupRow[] | null) ?? [];
}
