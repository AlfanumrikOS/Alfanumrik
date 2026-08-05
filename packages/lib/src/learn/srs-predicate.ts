/**
 * SRS-due predicate — the single source for the "due quiz-wrong-answer cards"
 * query shape used by BOTH the client-side quiz deep-link consumer and the
 * server-side /api/learner/srs/due route.
 *
 * Extracted from packages/lib/src/learn/srs-quiz-review.ts (E4 wave 3b) so
 * the exact same predicate can be applied against ANY supabase-js compatible
 * client (RLS-scoped browser client, RLS-scoped server client, or the
 * service-role client for cron paths). Prevents predicate drift the way the
 * srs-source adapter did for the wider review lane.
 *
 * The predicate:
 *   student_id = <caller-resolved>
 *   AND is_active = true
 *   AND source = 'quiz_wrong_answer'
 *   AND source_id IS NOT NULL      (must resolve to a question_bank row)
 *   AND next_review_date <= today  (yyyy-mm-dd)
 *   ORDER BY next_review_date ASC
 *   LIMIT <caller-bounded>
 *
 * Client-safe: no supabase-admin import. Callers MUST resolve studentId from
 * the authenticated session — never pass a client-supplied value.
 */

/** Minimal structural view of the supabase-js client used here. */
export type SrsQueryClient = {
  from: (table: string) => any;
};

/**
 * Descriptor for the SRS-due predicate. Exported so tests + docs can pin the
 * exact query shape without re-running SQL. Any change here is a
 * defense-in-depth signal for the whole SRS lane.
 */
export const SRS_DUE_PREDICATE_DESCRIPTOR = {
  table: 'spaced_repetition_cards',
  filters: {
    is_active: true,
    source: 'quiz_wrong_answer',
    source_id_not_null: true,
  },
  dateFilter: { column: 'next_review_date', op: 'lte', value: 'today_yyyy_mm_dd' },
  order: { column: 'next_review_date', ascending: true },
  defaultLimit: 50,
  hardLimit: 100,
} as const;

export interface SrsDuePredicateOptions {
  /** Default 50, hard cap 100. */
  limit?: number;
  /** Restrict to a single subject code (e.g. "math"). */
  subject?: string | null;
  /** Column projection (defaults to id, source_id, subject). */
  columns?: string;
}

/**
 * Build (and return) the query for due SRS quiz-wrong-answer cards against
 * the given client. The result is a supabase-js query builder that resolves
 * to `{ data, error }` when awaited — callers own await + error handling.
 */
export function buildSrsDueQuery(
  client: SrsQueryClient,
  studentId: string,
  opts: SrsDuePredicateOptions = {},
) {
  const columns = opts.columns ?? 'id, source_id, subject';
  const limit = Math.min(
    Math.max(1, opts.limit ?? SRS_DUE_PREDICATE_DESCRIPTOR.defaultLimit),
    SRS_DUE_PREDICATE_DESCRIPTOR.hardLimit,
  );
  const todayIso = new Date().toISOString().slice(0, 10);

  let query = client
    .from(SRS_DUE_PREDICATE_DESCRIPTOR.table)
    .select(columns)
    .eq('student_id', studentId)
    .eq('is_active', true)
    .eq('source', 'quiz_wrong_answer')
    .not('source_id', 'is', null)
    .lte('next_review_date', todayIso)
    .order('next_review_date', { ascending: true })
    .limit(limit);

  if (opts.subject) query = query.eq('subject', opts.subject);
  return query;
}
