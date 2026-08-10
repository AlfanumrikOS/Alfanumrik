/**
 * E4 — SRS single read adapter (Foxy North-Star Phase 3).
 *
 * ONE place that answers "what SM-2 flashcards are due for this student?"
 * so the predicate can never drift between readers again. Before this
 * adapter existed three predicates coexisted:
 *
 *   - `get_review_cards` SQL RPC:      student_id = ? AND is_active = true
 *                                      AND next_review_date <= CURRENT_DATE
 *   - resolve-next-action inline count: same, WITH is_active
 *   - domains/practice listDueCards /
 *     countDueByStudent:               MISSING is_active (design-flagged live
 *                                      bug — counted soft-deleted cards)
 *
 * The fix: `is_active = true` was added to both domains/practice functions,
 * and all lib-side readers go through THIS adapter. The parity test
 * (apps/host/src/__tests__/lib/learn/srs-source.test.ts) pins the adapter's
 * underlying predicate against the RPC's byte-for-byte in intent.
 *
 * NOTE (wave 3b handoff): `getReviewCards` in packages/lib/src/supabase.ts
 * (ai-engineer-owned this wave) and the packages/ui dashboard read paths
 * are NOT re-pointed here yet; they move in wave 3b. Of the two original
 * frontend read paths only QuickRecallSection
 * (packages/ui/src/refresh/QuickRecallSection.tsx) still exists —
 * DailyRhythmQueue was deleted in the 2026-08 orphan consolidation.
 *
 * Server-only: delegates to domains/practice.ts which uses the service-role
 * client. Callers MUST resolve studentId from the authenticated session —
 * never pass a client-supplied studentId.
 */

import {
  listDueCards,
  countDueByStudent,
} from '../domains/practice';
import type { ServiceResult, ReviewCard, ReviewDue } from '../domains/types';

export interface GetDueItemsOptions {
  /** Default 20, hard cap 100 (enforced by domains/practice). */
  limit?: number;
  /** Limit to a single subject code (e.g. "math"). */
  subject?: string;
}

/**
 * List due, ACTIVE spaced-repetition cards for a student, earliest due
 * first. Single source of the due predicate for lib-side readers.
 */
export async function getDueItems(
  studentId: string,
  opts: GetDueItemsOptions = {},
): Promise<ServiceResult<ReviewCard[]>> {
  return listDueCards(studentId, opts);
}

/**
 * Count due, ACTIVE cards for a student (total + per-subject breakdown).
 * Callers needing a bare number read `.data.total` after checking `.ok`.
 */
export async function getDueCount(
  studentId: string,
): Promise<ServiceResult<ReviewDue>> {
  return countDueByStudent(studentId);
}
