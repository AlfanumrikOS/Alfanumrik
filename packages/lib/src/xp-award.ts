/**
 * awardXpCapped — thin, never-throwing wrapper around the service-role-only
 * `award_xp_capped` SQL RPC (Foxy North-Star Phase 3, architect contract):
 *
 *   award_xp_capped(p_student_id, p_source, p_amount, p_daily_cap,
 *                   p_daily_category, p_reference_id, p_metadata)
 *     → jsonb { success, requested_xp, effective_xp, xp_capped,
 *               idempotent_replay, today_earned, remaining_today }
 *     (migration 20260809000300 — effective_xp is 0 when the IST daily cap
 *      is exhausted or the reference_id was already awarded; the RPC owns
 *      idempotency + capping).
 *
 * INVARIANTS (P2):
 *   - Amounts and caps come from XP_RULES (@alfanumrik/lib/xp-config) at the
 *     CALL SITE — this helper never defines an XP number.
 *   - Callers treat the award as fire-and-forget observability of learning
 *     behaviour: an award failure must NEVER break the host flow. This
 *     helper therefore never throws and never rejects; failures resolve to
 *     null and are warn-logged (counts-only metadata, P13).
 *
 * P13: `metadata` must carry UUIDs / numbers / short enum strings only —
 * never names, emails, phones, or free text. The caller is responsible for
 * that shape; this helper logs only source + referenceId on failure.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

export interface AwardXpCappedOptions {
  /** students.id (NOT auth_user_id). */
  studentId: string;
  /** xp source code, e.g. 'review_graded' | 'remediation_recovered' | 'thoughtful_question'. */
  source: string;
  /** XP amount — MUST be an XP_RULES constant, never a literal. */
  amount: number;
  /** Per-day cap for the daily category — MUST be an XP_RULES constant. */
  dailyCap: number;
  /** Daily cap bucket the RPC clamps within (e.g. 'retention'). */
  dailyCategory: string;
  /** Idempotency anchor, e.g. `review_${cardId}_${totalReviews}`. */
  referenceId: string;
  /** Counts-only metadata (P13: UUIDs + numbers + short enums only). */
  metadata?: Record<string, unknown>;
}

/**
 * Invoke the `award_xp_capped` RPC. Resolves to the effective awarded amount,
 * or null on any failure (RPC error, thrown error, malformed return).
 * NEVER throws / rejects — safe to call fire-and-forget with `void`.
 */
export async function awardXpCapped(
  client: SupabaseClient,
  opts: AwardXpCappedOptions,
): Promise<number | null> {
  try {
    const { data, error } = await client.rpc('award_xp_capped', {
      p_student_id: opts.studentId,
      p_source: opts.source,
      p_amount: opts.amount,
      p_daily_cap: opts.dailyCap,
      p_daily_category: opts.dailyCategory,
      p_reference_id: opts.referenceId,
      p_metadata: opts.metadata ?? {},
    });
    if (error) {
      logger.warn('award_xp_capped failed', {
        source: opts.source,
        referenceId: opts.referenceId,
        error: error.message,
      });
      return null;
    }
    // jsonb return per 20260809000300 — read effective_xp; tolerate a bare
    // numeric return defensively (a future RETURNS integer variant).
    const effective =
      typeof data === 'number'
        ? data
        : data && typeof data === 'object' && typeof (data as { effective_xp?: unknown }).effective_xp === 'number'
          ? ((data as { effective_xp: number }).effective_xp)
          : Number.NaN;
    return Number.isFinite(effective) ? effective : null;
  } catch (err) {
    logger.warn('award_xp_capped threw', {
      source: opts.source,
      referenceId: opts.referenceId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
