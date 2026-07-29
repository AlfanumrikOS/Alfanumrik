/**
 * Unified Student Memory — DPDP erasure-pending guard (GenAI architecture Phase 2).
 *
 * The ONE genuinely new behavior gated by `ff_unified_memory_v1`. Before any
 * learner-state sub-read runs, `getStudentMemory` asks this guard whether the
 * student has an IN-FLIGHT data-erasure request
 * (`data_erasure_requests.status IN ('pending','purging')`). During that window
 * the learner-state rows still physically exist (erasure is destructive via a
 * two-stage cron cascade — migration 20260527000006), so without this guard the
 * rows would leak into an AI prompt for a student who is mid-erasure.
 *
 * CRITICAL (architect note): this check MUST run on the service-role admin
 * client. `data_erasure_requests` has NO student-facing SELECT RLS policy, so an
 * RLS-scoped read would silently return zero rows and FAIL OPEN. The default
 * client here is `supabaseAdmin`; tests may inject a fake.
 *
 * FAIL-CLOSED: any error querying the table is treated as "guard tripped"
 * (erasure pending) → the caller returns fully-empty memory. A privacy guard
 * must never fail open. This is the deliberate asymmetry vs. the sub-reads
 * (which fail SOFT to empty) — both directions land on "empty", so the safe
 * outcome is the same.
 *
 * `cancelled` / `completed` / `failed` do NOT trip the guard:
 *   - cancelled: the student is active again.
 *   - completed: the rows are already gone; sub-reads return empty naturally.
 *   - failed: ops-handled; out of scope for this read guard.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '../supabase-admin';
import { logger } from '../logger';

/** Statuses that mean "erasure is in flight — stop surfacing this learner's history." */
export const ERASURE_IN_FLIGHT_STATUSES = ['pending', 'purging'] as const;

/**
 * Returns true when the student has an in-flight erasure request, OR when the
 * check itself errors (FAIL-CLOSED). MUST be called with a service-role client
 * (defaults to `supabaseAdmin`) — see the file header for why an RLS-scoped read
 * would fail open.
 *
 * @param studentId students.id
 * @param sb        service-role client (default: supabaseAdmin). Injectable for tests.
 */
export async function isErasurePending(
  studentId: string,
  sb: SupabaseClient = supabaseAdmin,
): Promise<boolean> {
  try {
    const { data, error } = await sb
      .from('data_erasure_requests')
      .select('id')
      .eq('student_id', studentId)
      .in('status', [...ERASURE_IN_FLIGHT_STATUSES])
      .limit(1);
    if (error) {
      // FAIL-CLOSED: an errored privacy check trips the guard.
      logger.warn('unified_memory_erasure_check_failed', {
        // P13: no studentId — flags/counts only.
        error: error.message,
      });
      return true;
    }
    return (data?.length ?? 0) > 0;
  } catch (err) {
    // FAIL-CLOSED.
    logger.warn('unified_memory_erasure_check_threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return true;
  }
}
