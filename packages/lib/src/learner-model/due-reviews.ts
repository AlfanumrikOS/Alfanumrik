/**
 * Learner-model facade — getDueReviews: the canonical due-review read.
 *
 * Wraps the `get_due_reviews` RPC (SECURITY DEFINER, scoped by p_student_id;
 * RETURNS TABLE frozen at 6 columns) PLUS the F7 additive SM-2 merge: the
 * RPC does not surface `ease_factor` / `next_review_at`, so we batch-fetch
 * those two fields from `concept_mastery` for exactly the due topics and
 * merge them onto the rows. This block previously lived inline in
 * `packages/lib/src/learn/build-rhythm-queue.ts` — it now lives here behind
 * the facade so every due-review reader (rhythm queue, dive state/start,
 * WhatsApp bot) gets the same rows.
 *
 * REUSES `@alfanumrik/lib/learn/due-reviews-adapter` (imported, not
 * rewritten): the returned rows structurally extend the adapter's
 * `DueReviewRow`, so callers pass them straight to `dueReviewsToCards`.
 *
 * Client is INJECTED (P8 house pattern): the routes pass the RLS-scoped
 * server client; cron/bots pass service-role. Fail-soft: RPC error → warn +
 * []; the SM-2 merge is non-fatal (fields stay absent → adapter defaults:
 * easeFactor 2.5, nextReviewAt null).
 */

import { logger } from '@alfanumrik/lib/logger';
import type { DueReviewRow, LearnerModelClient } from './types';

/** Default row cap — the rhythm queue's historical p_limit. */
const DEFAULT_LIMIT = 20;

/**
 * Read a student's due-for-review topics, weakest-mastery ordering per the
 * RPC. `studentId` is the surrogate `students.id` (the RPC and
 * concept_mastery both key on it), not the auth uid.
 */
export async function getDueReviews(
  sb: LearnerModelClient,
  studentId: string,
  subjectCode: string | null = null,
  limit: number = DEFAULT_LIMIT,
): Promise<DueReviewRow[]> {
  let raw: Record<string, unknown>[] = [];
  try {
    const { data, error } = await sb.rpc('get_due_reviews', {
      p_student_id: studentId,
      p_subject_code: subjectCode,
      p_limit: limit,
    });
    if (error) {
      logger.warn('learner_model_due_reviews_rpc_failed', {
        studentId,
        error: error.message,
      });
      return [];
    }
    raw = (data ?? []) as Record<string, unknown>[];
  } catch (err) {
    logger.warn('learner_model_due_reviews_rpc_failed', {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  let rows: DueReviewRow[] = raw
    .map((r) => ({
      topic_id: String(r.topic_id ?? ''),
      title: typeof r.title === 'string' ? r.title : null,
      title_hi: typeof r.title_hi === 'string' ? r.title_hi : null,
      subject_code:
        typeof r.subject_code === 'string' && r.subject_code.length > 0
          ? r.subject_code
          : null,
      subject:
        typeof r.subject === 'string' && r.subject.length > 0 ? r.subject : null,
      mastery_probability:
        typeof r.mastery_probability === 'number' ? r.mastery_probability : null,
      last_attempted_at:
        typeof r.last_attempted_at === 'string' ? r.last_attempted_at : null,
      review_interval_days:
        typeof r.review_interval_days === 'number' ? r.review_interval_days : 0,
    }))
    .filter((r) => r.topic_id.length > 0);

  // ── F7 (additive SM-2 merge) — NON-FATAL ─────────────────────────────────
  const dueTopicIds = rows.map((r) => r.topic_id);
  if (dueTopicIds.length > 0) {
    try {
      const { data: sm2Rows, error: sm2Err } = await sb
        .from('concept_mastery')
        .select('topic_id, ease_factor, next_review_at')
        .eq('student_id', studentId)
        .in('topic_id', dueTopicIds);
      // Explicitly NON-FATAL (see the section header): the SM-2 merge is
      // additive, so an empty result just leaves the base rows unenriched. The
      // enclosing catch could never see this because supabase-js resolves.
      if (sm2Err) {
        console.warn(
          '[due-reviews] SM-2 merge read failed:',
          sm2Err.code,
          sm2Err.message,
        );
      }
      const sm2ByTopic = new Map<
        string,
        { ease_factor: number | null; next_review_at: string | null }
      >();
      for (const r of sm2Rows ?? []) {
        const row = r as {
          topic_id?: string;
          ease_factor?: number | null;
          next_review_at?: string | null;
        };
        const tid = String(row.topic_id ?? '');
        if (tid) {
          sm2ByTopic.set(tid, {
            ease_factor: typeof row.ease_factor === 'number' ? row.ease_factor : null,
            next_review_at:
              typeof row.next_review_at === 'string' ? row.next_review_at : null,
          });
        }
      }
      rows = rows.map((r) => {
        const sm2 = sm2ByTopic.get(r.topic_id);
        return sm2
          ? { ...r, ease_factor: sm2.ease_factor, next_review_at: sm2.next_review_at }
          : r;
      });
    } catch (err) {
      logger.warn('learner_model_due_reviews_sm2_merge_failed', {
        studentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return rows;
}
