/**
 * Alfanumrik — Prerequisite gating check (Foxy North-Star Phase 3, E5/D12).
 *
 * Given a student about to start a chapter quiz, answer ONE question:
 * "is there a prerequisite topic this student is demonstrably weak on?"
 *
 * SUGGESTION, NOT A BLOCK. The product rule (assessment-owned) is that
 * prerequisite gating NEVER prevents a student from taking the quiz they
 * chose — it surfaces a fail-open "strengthen this first?" suggestion in the
 * quiz-setup UI. Correspondingly EVERY error path in this module returns
 * `{ suggestion: null }`: missing subject row, no curriculum topics, RPC
 * failure, mastery-read failure, thrown exceptions — all fail OPEN (quiz
 * proceeds silently). A logging-only warn is emitted for observability.
 *
 * Graph walk: curriculum_topics for (subject, grade, chapter) →
 * `traverse_prerequisites(topic_id, 2)` (unified concept_edges graph,
 * depth ≤ 2, cycle-safe — migration 20260702000400) → join concept_mastery.
 *
 * ── MASTERY_FLOOR_DEFAULT = 0.6 (assessment-owned constant) ────────────────
 * A prerequisite counts as "weak" only when the student HAS a concept_mastery
 * row for it AND mastery_probability < masteryFloor. 0.6 matches the mastery
 * threshold used by `get_adaptive_questions` for weak-concept targeting, so
 * quiz selection and prereq suggestions agree on what "weak" means. A topic
 * with NO mastery row is UNKNOWN, not weak — we never nag students about
 * material we have zero evidence on (fail-open toward proceeding).
 * Changing the floor requires assessment sign-off (keep in lock-step with
 * get_adaptive_questions).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../logger';

export const MASTERY_FLOOR_DEFAULT = 0.6;

/** Max chapter topics whose prerequisite chains we walk (bounds RPC fan-out). */
const MAX_CHAPTER_TOPICS = 8;
const TRAVERSE_DEPTH = 2;

export interface PrereqCheckInput {
  studentId: string;
  /** subjects.code, e.g. 'math' — valid for the student's grade. */
  subject: string;
  /** Grade STRING "6".."12" (P5). */
  grade: string;
  chapterNumber: number;
  /** Override only in experiments; default matches get_adaptive_questions. */
  masteryFloor?: number;
}

export interface PrereqSuggestion {
  prereqTopicId: string;
  prereqTitle: string;
  prereqTitleHi: string | null;
  chapterNumber: number | null;
  masteryProbability: number;
  reason: string;
  reasonHi: string;
}

export interface PrereqCheckResult {
  suggestion: PrereqSuggestion | null;
}

const FAIL_OPEN: PrereqCheckResult = { suggestion: null };

export async function checkPrereqs(
  client: SupabaseClient,
  input: PrereqCheckInput,
): Promise<PrereqCheckResult> {
  try {
    const masteryFloor = input.masteryFloor ?? MASTERY_FLOOR_DEFAULT;

    // 1. subjects.code → subject_id (curriculum_topics is keyed by subject_id).
    const { data: subjectRow, error: subjErr } = await client
      .from('subjects')
      .select('id')
      .eq('code', input.subject)
      .maybeSingle();
    if (subjErr || !subjectRow) return FAIL_OPEN;

    // 2. This chapter's topics.
    const { data: chapterTopics, error: topicsErr } = await client
      .from('curriculum_chapters_v')
      .select('id')
      .eq('subject_id', (subjectRow as { id: string }).id)
      .eq('grade', input.grade)
      .eq('chapter_number', input.chapterNumber)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .limit(MAX_CHAPTER_TOPICS);
    if (topicsErr || !chapterTopics || chapterTopics.length === 0) return FAIL_OPEN;

    const chapterTopicIds = new Set(
      (chapterTopics as Array<{ id: string }>).map((t) => t.id),
    );

    // 3. Prerequisite chains (depth ≤ 2) for each chapter topic.
    const prereqIds = new Set<string>();
    const traversals = await Promise.all(
      [...chapterTopicIds].map((topicId) =>
        client.rpc('traverse_prerequisites', {
          p_topic_id: topicId,
          p_max_depth: TRAVERSE_DEPTH,
        }),
      ),
    );
    for (const { data, error } of traversals) {
      if (error || !data) continue; // one bad chain must not sink the check
      for (const row of data as Array<{ prerequisite_topic_id: string }>) {
        if (!chapterTopicIds.has(row.prerequisite_topic_id)) {
          prereqIds.add(row.prerequisite_topic_id);
        }
      }
    }
    if (prereqIds.size === 0) return FAIL_OPEN;

    // 4. Known-weak prerequisites: mastery row exists AND below the floor.
    const { data: masteryRows, error: masteryErr } = await client
      .from('concept_mastery')
      .select('topic_id, mastery_probability')
      .eq('student_id', input.studentId)
      .in('topic_id', [...prereqIds])
      .lt('mastery_probability', masteryFloor)
      .order('mastery_probability', { ascending: true })
      .limit(1);
    if (masteryErr || !masteryRows || masteryRows.length === 0) return FAIL_OPEN;

    const weakest = masteryRows[0] as {
      topic_id: string;
      mastery_probability: number | null;
    };
    const masteryProbability = weakest.mastery_probability ?? 0;

    // 5. Resolve the prereq topic's display fields. concept_edges endpoints
    // span three id namespaces — a non-curriculum_topics id simply misses
    // here and we fail open (we cannot present a suggestion we cannot title).
    const { data: prereqTopic, error: titleErr } = await client
      .from('curriculum_chapters_v')
      .select('id, title, title_hi, chapter_number')
      .eq('id', weakest.topic_id)
      .maybeSingle();
    if (titleErr || !prereqTopic) return FAIL_OPEN;

    const t = prereqTopic as {
      id: string;
      title: string;
      title_hi: string | null;
      chapter_number: number | null;
    };
    const pct = Math.round(masteryProbability * 100);

    return {
      suggestion: {
        prereqTopicId: t.id,
        prereqTitle: t.title,
        prereqTitleHi: t.title_hi,
        chapterNumber: t.chapter_number,
        masteryProbability,
        reason: `A quick revision of "${t.title}" first will make this chapter easier — your mastery there is ${pct}%.`,
        reasonHi: `पहले "${t.title_hi ?? t.title}" का एक छोटा रिवीज़न इस अध्याय को आसान बना देगा — वहाँ आपकी महारत ${pct}% है।`,
      },
    };
  } catch (err) {
    logger.warn('checkPrereqs failed open', {
      subject: input.subject,
      grade: input.grade,
      chapterNumber: input.chapterNumber,
      error: err instanceof Error ? err.message : 'unknown',
    });
    return FAIL_OPEN;
  }
}
