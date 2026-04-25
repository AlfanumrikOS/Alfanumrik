/**
 * Practice / Review / Spaced-Repetition Domain (B8) — typed read APIs for
 * spaced_repetition_cards and read-access for concept_mastery / topic_mastery.
 *
 * CONTRACT:
 *   - Reads only in this phase (0e). Card writes (SM-2 ease/interval updates)
 *     stay in src/app/review/page.tsx for now and move in Phase 0f together
 *     with the cognitive-engine extraction.
 *   - SM-2 algorithm logic does NOT live here. This domain is the *data*
 *     boundary; cognitive-engine.ts / feedback-engine.ts own the *math*.
 *   - All functions return ServiceResult<T>. Callers must check `ok` before
 *     accessing `data`.
 *   - Server-only: every function uses supabaseAdmin (service role). The
 *     ESLint `no-restricted-imports` rule on `@/lib/supabase-admin` allows
 *     `src/lib/domains/**` so these helpers can run from API routes only.
 *   - Single-row lookups return `T | null` (null = not found, not an error).
 *     List endpoints return `T[]` (an empty array is ok).
 *   - Never `select('*')`. Map snake_case rows to camelCase domain types here.
 *
 * MICROSERVICE EXTRACTION PATH:
 *   B8 becomes a "review service" that owns SM-2 scheduling. Wrap these reads
 *   in HTTP handlers; add JWT validation; cognitive engine calls via HTTP.
 *
 * SCOPE GUARD (Phase 0e):
 *   - Do NOT touch atomic_quiz_profile_update RPC (P4)
 *   - Do NOT touch xp-rules.ts constants (P2)
 *   - Do NOT touch RLS / migrations / RBAC
 *   - Do NOT add any write helpers — that's Phase 0f
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  type ServiceResult,
  type ReviewCard,
  type ReviewDue,
  type ConceptMasterySlice,
} from './types';

// ── spaced_repetition_cards ──────────────────────────────────────────────────

type CardRow = {
  id: string;
  student_id: string;
  card_type: string | null;
  subject: string | null;
  grade: string | number | null;
  chapter_number: number | null;
  chapter_title: string | null;
  topic: string | null;
  front_text: string;
  back_text: string;
  hint: string | null;
  source: string | null;
  source_id: string | null;
  ease_factor: number | null;
  interval_days: number | null;
  repetition_count: number | null;
  next_review_date: string | null;
  last_review_date: string | null;
  last_quality: number | null;
  total_reviews: number | null;
  correct_reviews: number | null;
  streak: number | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

function mapCard(row: CardRow): ReviewCard {
  return {
    id: row.id,
    studentId: row.student_id,
    cardType: row.card_type,
    subject: row.subject,
    // Invariant P5: grades are strings everywhere. Coerce defensively.
    grade: row.grade == null ? null : String(row.grade),
    chapterNumber: row.chapter_number,
    chapterTitle: row.chapter_title,
    topic: row.topic,
    frontText: row.front_text,
    backText: row.back_text,
    hint: row.hint,
    source: row.source,
    sourceId: row.source_id,
    // SM-2 default ease factor is 2.5 — used when DB row predates that column
    easeFactor: row.ease_factor ?? 2.5,
    intervalDays: row.interval_days ?? 1,
    repetitionCount: row.repetition_count ?? 0,
    nextReviewDate: row.next_review_date,
    lastReviewDate: row.last_review_date,
    lastQuality: row.last_quality,
    totalReviews: row.total_reviews ?? 0,
    correctReviews: row.correct_reviews ?? 0,
    streak: row.streak ?? 0,
    isActive: row.is_active ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const CARD_COLUMNS =
  'id, student_id, card_type, subject, grade, chapter_number, chapter_title, ' +
  'topic, front_text, back_text, hint, source, source_id, ease_factor, ' +
  'interval_days, repetition_count, next_review_date, last_review_date, ' +
  'last_quality, total_reviews, correct_reviews, streak, is_active, ' +
  'created_at, updated_at';

/**
 * List spaced-repetition cards that are due for review (next_review_date <=
 * today) for a student, ordered by earliest due first.
 *
 * Filters:
 *   - `subject`: limit to a single subject code (e.g. "math")
 *   - `limit`:   default 20, hard cap 100 to keep payloads bounded
 *
 * This does NOT enforce ownership. Callers MUST resolve studentId from the
 * authenticated session (via authorizeRequest) before calling — never pass
 * a client-supplied studentId.
 */
export async function listDueCards(
  studentId: string,
  opts: { limit?: number; subject?: string } = {}
): Promise<ServiceResult<ReviewCard[]>> {
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const limit = Math.min(Math.max(1, opts.limit ?? 20), 100);
  const today = new Date().toISOString().split('T')[0];

  let query = supabaseAdmin
    .from('spaced_repetition_cards')
    .select(CARD_COLUMNS)
    .eq('student_id', studentId)
    .lte('next_review_date', today)
    .order('next_review_date', { ascending: true })
    .limit(limit);

  if (opts.subject) {
    query = query.eq('subject', opts.subject);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('practice_list_due_cards_failed', {
      error: new Error(error.message),
      studentId,
      subject: opts.subject ?? null,
    });
    return fail(`Due cards lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapCard(r as unknown as CardRow)));
}

/**
 * Look up a single card by id. Verifies ownership inline — returns null
 * (not an error) if the card is not found OR belongs to a different student.
 * The same null return prevents enumeration attacks.
 *
 * Callers needing 404 semantics should check `data === null`.
 */
export async function getCardById(
  cardId: string,
  studentId: string
): Promise<ServiceResult<ReviewCard | null>> {
  if (!cardId) return fail('cardId is required', 'INVALID_INPUT');
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .select(CARD_COLUMNS)
    .eq('id', cardId)
    .eq('student_id', studentId) // ownership check — prevents IDOR
    .maybeSingle();

  if (error) {
    logger.error('practice_get_card_by_id_failed', {
      error: new Error(error.message),
      cardId,
      studentId,
    });
    return fail(`Card lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapCard(data as unknown as CardRow) : null);
}

/**
 * Count cards currently due for a student, returning the total and a per-
 * subject breakdown. Used by dashboards (FocusDashboard) and the daily
 * digest cron.
 *
 * Implementation: one row-level fetch over a narrow projection, aggregated
 * in memory. Cheap because due counts are bounded by user activity (rarely
 * over a few hundred).
 */
export async function countDueByStudent(
  studentId: string
): Promise<ServiceResult<ReviewDue>> {
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabaseAdmin
    .from('spaced_repetition_cards')
    .select('subject')
    .eq('student_id', studentId)
    .lte('next_review_date', today);

  if (error) {
    logger.error('practice_count_due_by_student_failed', {
      error: new Error(error.message),
      studentId,
    });
    return fail(`Due count lookup failed: ${error.message}`, 'DB_ERROR');
  }

  const rows = (data ?? []) as Array<{ subject: string | null }>;
  const bySubject: Record<string, number> = {};
  for (const r of rows) {
    const key = r.subject ?? 'unknown';
    bySubject[key] = (bySubject[key] ?? 0) + 1;
  }

  return ok({ total: rows.length, bySubject });
}

// ── concept_mastery (read-only access for practice/review surfaces) ──────────

type ConceptMasteryRow = {
  topic_id: string;
  mastery_probability: number | null;
  consecutive_correct: number | null;
  next_review_at: string | null;
  updated_at: string | null;
};

function mapConceptMastery(row: ConceptMasteryRow): ConceptMasterySlice {
  return {
    topicId: row.topic_id,
    masteryProbability: row.mastery_probability,
    consecutiveCorrect: row.consecutive_correct,
    nextReviewAt: row.next_review_at,
    updatedAt: row.updated_at,
  };
}

const CONCEPT_MASTERY_COLUMNS =
  'topic_id, mastery_probability, consecutive_correct, next_review_at, updated_at';

/**
 * Read the per-topic mastery rows for a student, narrow projection.
 *
 * Used by:
 *   - GET /api/v1/performance         — student / linked-adult performance view
 *   - GET /api/v1/child/[id]/progress — parent-portal child progress view
 *
 * Both routes accept an explicit limit and order by `updated_at desc` to
 * surface the most recently practiced topics first.
 *
 * `limit` defaults to 200 and is hard-capped at 500.
 *
 * NOTE: This is a deliberately narrow read. The full concept_mastery row
 * (BKT/IRT params: p_know, p_learn, p_guess, slip, etc) belongs to the
 * cognitive engine and is not exposed here.
 */
export async function listConceptMasteryByStudent(
  studentId: string,
  opts: { limit?: number } = {}
): Promise<ServiceResult<ConceptMasterySlice[]>> {
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const limit = Math.min(Math.max(1, opts.limit ?? 200), 500);

  const { data, error } = await supabaseAdmin
    .from('concept_mastery')
    .select(CONCEPT_MASTERY_COLUMNS)
    .eq('student_id', studentId)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('practice_list_concept_mastery_failed', {
      error: new Error(error.message),
      studentId,
    });
    return fail(`Concept mastery lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapConceptMastery(r as ConceptMasteryRow)));
}
