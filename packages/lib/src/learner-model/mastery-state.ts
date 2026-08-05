/**
 * Learner-model facade — getMasteryState: the canonical mastery read.
 *
 * Reads `concept_mastery` (the ONLY mastery store the atomic submit chain
 * writes — design E1/E3) through an INJECTED client (house pattern of
 * pulse-server / build-rhythm-queue: the caller has already authorized and
 * chooses RLS-scoped vs service-role, so P8 is preserved — this module never
 * imports supabase-admin).
 *
 * Fail-soft: any DB error logs a warn and returns [] — mastery display is an
 * enhancement, never a reason to 500 a reader (matches the pre-facade
 * behavior of every migrated reader, e.g. /api/v2/student/progress silently
 * mapped a failed read to an empty list).
 */

import { logger } from '@alfanumrik/lib/logger';
import type { LearnerModelClient, MasteryState } from './types';

export interface GetMasteryStateOptions {
  /**
   * Narrow to one subject (curriculum_topics.subject_id). Applied
   * CLIENT-SIDE after the FK join — PostgREST nested-alias filters are
   * unreliable (same defense as loadCognitiveContext), so we over-fetch by
   * `limit` and filter.
   */
  subjectId?: string | null;
  /** Narrow to specific curriculum_topics ids. */
  topicIds?: string[];
  /** Row cap (default 200). */
  limit?: number;
  /**
   * Sort order. 'mastery_asc' (default — weakest first, the facade
   * canonical) or 'updated_desc' (most recently practiced first — the
   * /api/v2/student/progress wire order).
   */
  orderBy?: 'mastery_asc' | 'updated_desc';
  /** Only rows with mastery_probability strictly below this value (SQL-side). */
  masteryBelow?: number;
}

const DEFAULT_LIMIT = 200;

const SELECT_COLUMNS =
  'topic_id, mastery_probability, mastery_level, attempts, correct_attempts, ' +
  'hints_used, ease_factor, review_interval_days, next_review_at, ' +
  'last_attempted_at, retention_half_life, current_retention, streak_current, ' +
  'consecutive_wrong, consecutive_correct, updated_at, ' +
  'curriculum_topics(title, subject_id)';

interface RawRow {
  topic_id: string | null;
  mastery_probability: number | null;
  mastery_level: string | null;
  attempts: number | null;
  correct_attempts: number | null;
  hints_used: number | null;
  ease_factor: number | null;
  review_interval_days: number | null;
  next_review_at: string | null;
  last_attempted_at: string | null;
  retention_half_life: number | null;
  current_retention: number | null;
  streak_current: number | null;
  consecutive_wrong: number | null;
  consecutive_correct: number | null;
  updated_at: string | null;
  curriculum_topics:
    | { title: string | null; subject_id: string | null }
    | Array<{ title: string | null; subject_id: string | null }>
    | null;
}

/**
 * Read a student's per-topic mastery state. `studentId` is the surrogate
 * `students.id` (concept_mastery FKs it), not the auth uid.
 */
export async function getMasteryState(
  sb: LearnerModelClient,
  studentId: string,
  options: GetMasteryStateOptions = {},
): Promise<MasteryState[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  try {
    let query = sb
      .from('concept_mastery')
      .select(SELECT_COLUMNS)
      .eq('student_id', studentId);
    if (options.topicIds && options.topicIds.length > 0) {
      query = query.in('topic_id', options.topicIds);
    }
    if (typeof options.masteryBelow === 'number') {
      query = query.lt('mastery_probability', options.masteryBelow);
    }
    query =
      options.orderBy === 'updated_desc'
        ? query.order('updated_at', { ascending: false })
        : query.order('mastery_probability', { ascending: true });
    const { data, error } = await query.limit(limit);
    if (error) {
      logger.warn('learner_model_mastery_state_failed', {
        studentId,
        error: error.message,
      });
      return [];
    }

    const rows = (data ?? []) as unknown as RawRow[];
    const states: MasteryState[] = [];
    for (const r of rows) {
      const topicId = String(r.topic_id ?? '');
      if (!topicId) continue;
      // PostgREST returns the FK join as object OR single-element array
      // depending on relationship inference — normalize both shapes.
      const ct = Array.isArray(r.curriculum_topics)
        ? (r.curriculum_topics[0] ?? null)
        : r.curriculum_topics;
      const subjectId = ct?.subject_id ?? null;
      if (options.subjectId && subjectId !== options.subjectId) continue;
      states.push({
        topicId,
        title: ct?.title ?? null,
        subjectId,
        masteryProbability:
          typeof r.mastery_probability === 'number' ? r.mastery_probability : null,
        masteryLevel: r.mastery_level ?? null,
        attempts: r.attempts ?? 0,
        correctAttempts: r.correct_attempts ?? 0,
        hintsUsed: typeof r.hints_used === 'number' ? r.hints_used : null,
        easeFactor: typeof r.ease_factor === 'number' ? r.ease_factor : null,
        reviewIntervalDays:
          typeof r.review_interval_days === 'number' ? r.review_interval_days : null,
        nextReviewAt: r.next_review_at ?? null,
        lastAttemptedAt: r.last_attempted_at ?? null,
        retentionHalfLife:
          typeof r.retention_half_life === 'number' ? r.retention_half_life : null,
        currentRetention:
          typeof r.current_retention === 'number' ? r.current_retention : null,
        streakCurrent: typeof r.streak_current === 'number' ? r.streak_current : null,
        consecutiveWrong:
          typeof r.consecutive_wrong === 'number' ? r.consecutive_wrong : null,
        consecutiveCorrect:
          typeof r.consecutive_correct === 'number' ? r.consecutive_correct : null,
        updatedAt: r.updated_at ?? null,
      });
    }
    return states;
  } catch (err) {
    logger.warn('learner_model_mastery_state_failed', {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}
