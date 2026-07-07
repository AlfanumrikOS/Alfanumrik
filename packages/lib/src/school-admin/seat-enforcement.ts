/**
 * Phase 3B — Wave B: seat-enforcement wiring helpers (backend-owned).
 *
 * ─── PAYMENT-ADJACENT (P11) ──────────────────────────────────────────────────
 * Every active student on a school roster is a billable seat. This module is the
 * thin TypeScript layer over the race-safe SQL primitives shipped in migration
 * 20260614000001 (architect-built). It NEVER re-implements the policy math — the
 * SQL is the single source of truth (grace_ceiling = floor(seats*1.10), 14-day
 * window). We only:
 *   1. gate the whole feature on `ff_school_provisioning` (OFF = byte-identical),
 *   2. parse the structured P3B01 verdict out of the RPC error and map it to a
 *      stable 409 `seat_cap_violation` body (never leak SQL — P13),
 *   3. raise the `grace_warn` soft-allow flag to the school admin + super-admin
 *      via the existing `notifications` table mechanism, and
 *   4. expose the deactivation-refresh call.
 *
 * The two mutating RPCs (enroll_students_with_seat_check / refresh_school_seat_usage)
 * are service_role-only, so callers MUST invoke them through `supabase-admin`.
 * `evaluate_seat_policy` is the read-only preview; it is scope-guarded on
 * auth.uid() and EXECUTE-able by `authenticated`, but the school-admin routes
 * already proved school membership via `authorizeSchoolAdmin`, so calling it via
 * the admin client (no auth.uid()) would raise 42501. For the preview we instead
 * compute remaining capacity from the same admin-client primitives indirectly:
 * the enrollment RPC is the authoritative check, and the bulk path uses
 * `evaluateSeatPolicyAdmin` (below) which calls the underlying count + policy via
 * a dedicated read so it works under the service role too. See `previewSeatPolicy`.
 */

import { NextResponse } from 'next/server';
import { isFeatureEnabled, SCHOOL_PROVISIONING_FLAGS } from '@alfanumrik/lib/feature-flags';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

/** Custom SQLSTATE raised by enroll_students_with_seat_check on a hard block. */
export const SEAT_POLICY_BLOCK_SQLSTATE = 'P3B01';

export type SeatPolicyStatus =
  | 'within_plan'
  | 'grace_warn'
  | 'grace_expired'
  | 'over_ceiling';

/** Shape of the verdict jsonb returned by the SQL policy evaluator. */
export interface SeatVerdict {
  allowed: boolean;
  status: SeatPolicyStatus;
  seats_purchased: number;
  grace_ceiling: number;
  current_active: number;
  projected: number;
  grace_started_at: string | null;
  grace_expires_at: string | null;
}

/** A `{student_id, class_id}` roster pair, the enroll RPC payload element. */
export interface EnrollPair {
  student_id: string;
  class_id: string;
}

/**
 * Master gate. Enforcement runs ONLY when this returns true. When false, callers
 * MUST fall through to their existing (legacy) behavior unchanged.
 */
export async function isSeatEnforcementEnabled(): Promise<boolean> {
  return isFeatureEnabled(SCHOOL_PROVISIONING_FLAGS.V1, {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });
}

/**
 * Read-only seat-policy preview under the SERVICE ROLE (bulk path capacity math).
 *
 * `evaluate_seat_policy` is scope-guarded on auth.uid() and therefore unusable
 * from the admin client. The canonical count + pure-policy helpers
 * (_count_active_school_students / _eval_seat_policy_unchecked) are granted to
 * service_role, so we reproduce the evaluator's read here without the auth.uid()
 * guard (the caller already proved school membership via authorizeSchoolAdmin).
 * This is read-only and never mutates the grace clock — identical semantics to
 * evaluate_seat_policy, just over the service-role credential.
 */
export async function previewSeatPolicy(
  schoolId: string,
  addCount: number,
): Promise<{ ok: true; verdict: SeatVerdict } | { ok: false }> {
  const supabase = getSupabaseAdmin();

  // current canonical active roster count
  const { data: countData, error: countErr } = await supabase.rpc(
    '_count_active_school_students',
    { p_school_id: schoolId },
  );
  if (countErr) {
    logger.error('seat_preview_count_failed', {
      error: new Error(countErr.message),
      route: 'seat-enforcement.previewSeatPolicy',
    });
    return { ok: false };
  }

  // active subscription seats + grace clock (deterministic active row, mirrors SQL)
  const { data: sub, error: subErr } = await supabase
    .from('school_subscriptions')
    .select('seats_purchased, seat_grace_started_at, status, created_at')
    .eq('school_id', schoolId)
    .in('status', ['active', 'trial'])
    .order('seats_purchased', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (subErr) {
    logger.error('seat_preview_sub_failed', {
      error: new Error(subErr.message),
      route: 'seat-enforcement.previewSeatPolicy',
    });
    return { ok: false };
  }

  const seats = (sub?.seats_purchased as number | null) ?? 0;
  const grace = (sub?.seat_grace_started_at as string | null) ?? null;
  const current = (countData as number | null) ?? 0;

  const { data: verdictData, error: vErr } = await supabase.rpc(
    '_eval_seat_policy_unchecked',
    {
      p_seats_purchased: seats,
      p_current_active: current,
      p_add_count: Math.max(addCount, 1),
      p_grace_started_at: grace,
    },
  );
  if (vErr || !verdictData) {
    logger.error('seat_preview_eval_failed', {
      error: new Error(vErr?.message ?? 'eval returned null'),
      route: 'seat-enforcement.previewSeatPolicy',
    });
    return { ok: false };
  }

  return { ok: true, verdict: verdictData as SeatVerdict };
}

/**
 * Remaining seat capacity (within the grace ceiling) for the bulk import math.
 * = grace_ceiling - current_active, clamped to >= 0. Returns null if the preview
 * fails (caller should treat null as "could not determine — fall back / 503").
 */
export async function remainingCapacity(schoolId: string): Promise<number | null> {
  const preview = await previewSeatPolicy(schoolId, 1);
  if (!preview.ok) return null;
  const { grace_ceiling, current_active } = preview.verdict;
  return Math.max(grace_ceiling - current_active, 0);
}

/**
 * Result of a seat-checked enrollment attempt.
 *  - blocked: hard block (grace_expired | over_ceiling) — caller returns 409.
 *  - allowed: success; `verdict.status === 'grace_warn'` means soft-allow (flag).
 */
export type EnrollResult =
  | { kind: 'allowed'; enrolled: number; requested: number; verdict: SeatVerdict; usage: unknown }
  | { kind: 'blocked'; verdict: SeatVerdict | null; status: SeatPolicyStatus | null }
  | { kind: 'error'; message: string };

/**
 * Parse the verdict jsonb out of a Postgres error raised with SQLSTATE P3B01.
 * Supabase surfaces the error in `{ code, message, details }`; the RPC put the
 * verdict jsonb in DETAIL. Returns null if it can't be parsed (defensive).
 */
function parseBlockVerdict(err: {
  code?: string;
  message?: string;
  details?: string | null;
}): SeatVerdict | null {
  const detail = err.details ?? null;
  if (detail) {
    try {
      return JSON.parse(detail) as SeatVerdict;
    } catch {
      // fall through to status-only extraction below
    }
  }
  return null;
}

/**
 * Extract the policy status from the P3B01 message `seat_policy_block: <status>`
 * as a last resort when DETAIL parsing fails.
 */
function parseBlockStatus(message?: string): SeatPolicyStatus | null {
  if (!message) return null;
  const m = message.match(/seat_policy_block:\s*(\w+)/);
  const s = m?.[1];
  if (s === 'grace_expired' || s === 'over_ceiling' || s === 'grace_warn' || s === 'within_plan') {
    return s;
  }
  return null;
}

/**
 * Run the ATOMIC, race-safe seat-checked enrollment RPC. Service-role-only.
 * The RPC owns the lock → re-check → roster insert → grace clock → snapshot in
 * one transaction. On a hard block it raises P3B01; we translate that to a
 * `blocked` result carrying the verdict so the route can build the 409 body.
 */
export async function enrollWithSeatCheck(
  schoolId: string,
  payload: EnrollPair[],
): Promise<EnrollResult> {
  if (payload.length === 0) {
    return { kind: 'error', message: 'empty payload' };
  }
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc('enroll_students_with_seat_check', {
    p_school_id: schoolId,
    p_payload: payload,
  });

  if (error) {
    const pgErr = error as { code?: string; message?: string; details?: string | null };
    if (pgErr.code === SEAT_POLICY_BLOCK_SQLSTATE) {
      const verdict = parseBlockVerdict(pgErr);
      return {
        kind: 'blocked',
        verdict,
        status: verdict?.status ?? parseBlockStatus(pgErr.message),
      };
    }
    // Don't leak SQL to the client (P13) — log server-side via redacting logger.
    logger.error('seat_enroll_rpc_failed', {
      error: new Error(pgErr.message ?? 'enroll RPC failed'),
      route: 'seat-enforcement.enrollWithSeatCheck',
    });
    return { kind: 'error', message: pgErr.message ?? 'enroll failed' };
  }

  const result = data as {
    success: boolean;
    enrolled: number;
    requested: number;
    verdict: SeatVerdict;
    usage: unknown;
  } | null;

  if (!result) {
    return { kind: 'error', message: 'enroll RPC returned null' };
  }

  return {
    kind: 'allowed',
    enrolled: result.enrolled,
    requested: result.requested,
    verdict: result.verdict,
    usage: result.usage,
  };
}

/**
 * Run the ATOMIC, race-safe seat-checked enrollment RPC for the CLASS_ENROLLMENTS
 * roster path (the /api/schools/enroll bulk-import PAGE writes class_enrollments,
 * not class_students). Service-role-only. Identical contract/discipline to
 * `enrollWithSeatCheck` — same per-school advisory-lock namespace (`school_seat:`),
 * same unified count, same re-evaluate-under-lock, same P3B01 hard-block contract —
 * the ONLY difference is the target roster table (class_enrollments). On a hard
 * block the RPC raises P3B01; we translate that to a `blocked` result carrying the
 * verdict so the route can build the 409 body. All-or-nothing per call: a P3B01
 * raise rolls the whole RPC transaction back, so the route can never observe a
 * partial roster placement for the accepted batch.
 */
export async function enrollSectionWithSeatCheck(
  schoolId: string,
  payload: EnrollPair[],
): Promise<EnrollResult> {
  if (payload.length === 0) {
    return { kind: 'error', message: 'empty payload' };
  }
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase.rpc(
    'enroll_section_students_with_seat_check',
    {
      p_school_id: schoolId,
      p_payload: payload,
    },
  );

  if (error) {
    const pgErr = error as { code?: string; message?: string; details?: string | null };
    if (pgErr.code === SEAT_POLICY_BLOCK_SQLSTATE) {
      const verdict = parseBlockVerdict(pgErr);
      return {
        kind: 'blocked',
        verdict,
        status: verdict?.status ?? parseBlockStatus(pgErr.message),
      };
    }
    // Don't leak SQL to the client (P13) — log server-side via redacting logger.
    logger.error('seat_enroll_section_rpc_failed', {
      error: new Error(pgErr.message ?? 'enroll section RPC failed'),
      route: 'seat-enforcement.enrollSectionWithSeatCheck',
    });
    return { kind: 'error', message: pgErr.message ?? 'enroll failed' };
  }

  const result = data as {
    success: boolean;
    enrolled: number;
    requested: number;
    verdict: SeatVerdict;
    usage: unknown;
  } | null;

  if (!result) {
    return { kind: 'error', message: 'enroll section RPC returned null' };
  }

  return {
    kind: 'allowed',
    enrolled: result.enrolled,
    requested: result.requested,
    verdict: result.verdict,
    usage: result.usage,
  };
}

/**
 * Refresh the seat snapshot + grace clock after a deactivation (PATCH
 * is_active=false). Idempotent (derived from live counts). Service-role-only.
 * Fire-and-forget safe — failure is logged but never breaks the deactivation.
 */
export async function refreshSeatUsage(schoolId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc('refresh_school_seat_usage', {
    p_school_id: schoolId,
  });
  if (error) {
    logger.error('seat_refresh_failed', {
      error: new Error(error.message),
      route: 'seat-enforcement.refreshSeatUsage',
    });
  }
}

/**
 * Build the stable 409 `seat_cap_violation` body for a hard block. Never leaks
 * SQL. `grace_expires_at` is only included when the verdict carries it (it is
 * null for over_ceiling-from-fresh, present for grace_expired).
 */
export function seatCapViolationResponse(
  verdict: SeatVerdict | null,
  status: SeatPolicyStatus | null,
): NextResponse {
  const body: Record<string, unknown> = {
    success: false,
    error: 'seat_cap_violation',
    status: verdict?.status ?? status ?? 'over_ceiling',
    projected: verdict?.projected ?? null,
    grace_ceiling: verdict?.grace_ceiling ?? null,
    seats_purchased: verdict?.seats_purchased ?? null,
  };
  if (verdict?.grace_expires_at) {
    body.grace_expires_at = verdict.grace_expires_at;
  }
  return NextResponse.json(body, { status: 409 });
}

/**
 * grace_warn flagging (soft allow): notify the school admin AND super-admin via
 * the existing `notifications` table (same recipient-keyed mechanism as the cron
 * seat-alert path in src/app/api/cron/school-operations/route.ts). Bilingual
 * (P7). No PII (P13) — only ids + counts + the grace expiry timestamp.
 *
 * Schema contract (baseline `notifications` table):
 *   - `message text NOT NULL` (no default, no backfill trigger) → EVERY insert
 *     MUST set `message`. We mirror the known-good daily-cron parent-digest
 *     insert (`supabase/functions/daily-cron/index.ts`: `{...,message:b,body:b}`)
 *     and set `message` to the English body text. `body`/`body_hi` carry the
 *     bilingual copy for rendering.
 *   - `recipient_id uuid NOT NULL` → a string like 'super_admin' is an invalid
 *     uuid and raises 22P02. Super-admins are real users in `admin_users`
 *     (admin_level >= super_admin, keyed by auth_user_id — see
 *     `authorizeAdmin` in src/lib/admin-auth.ts). We resolve their auth_user_id
 *     uuids and insert ONE notification row per super-admin. The school row uses
 *     the schools.id uuid (already a valid uuid).
 *
 * Idempotency: at most one grace_warn flag per school per UTC day, keyed on the
 * `seat_grace_warn` type + created_at >= today, so repeated enrollments inside
 * the same grace window don't spam the admin. The school-facing row is the
 * de-dupe sentinel; the super-admin fan-out is gated on the same check.
 */
export async function flagGraceWarn(
  schoolId: string,
  verdict: SeatVerdict,
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const TYPE = 'seat_grace_warn';
  const nowIso = new Date().toISOString();
  const todayStartIso = `${nowIso.slice(0, 10)}T00:00:00.000Z`;

  try {
    // De-dupe: skip if a school-facing grace_warn flag already exists today.
    // This row is the per-school/per-day sentinel for the whole fan-out.
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('recipient_id', schoolId)
      .eq('recipient_type', 'school')
      .eq('type', TYPE)
      .gte('created_at', todayStartIso)
      .limit(1);

    if (existing && existing.length > 0) return;

    const expires = verdict.grace_expires_at
      ? verdict.grace_expires_at.slice(0, 10)
      : 'soon';

    const bodyEn =
      `Your school now uses ${verdict.current_active} of ${verdict.seats_purchased} seats — ` +
      `above your plan. New students are still allowed under a 14-day grace period ` +
      `(up to ${verdict.grace_ceiling} seats) ending ${expires}. ` +
      `Upgrade your subscription before then to avoid blocking new enrollments.`;
    const bodyHi =
      `आपका स्कूल अब ${verdict.seats_purchased} में से ${verdict.current_active} सीटों का उपयोग कर रहा है — ` +
      `आपकी योजना से अधिक। 14-दिन की छूट अवधि के तहत नए छात्र अभी भी जोड़े जा सकते हैं ` +
      `(${verdict.grace_ceiling} सीटों तक), जो ${expires} को समाप्त होती है। ` +
      `नए नामांकन रुकने से बचने के लिए उससे पहले अपनी सदस्यता अपग्रेड करें।`;

    const data = {
      school_id: schoolId,
      current_active: verdict.current_active,
      seats_purchased: verdict.seats_purchased,
      grace_ceiling: verdict.grace_ceiling,
      grace_started_at: verdict.grace_started_at,
      grace_expires_at: verdict.grace_expires_at,
      trigger: 'seat_grace_warn',
    };

    // School admin flag. recipient_id = schools.id (a real uuid). `message` is
    // the NOT NULL column (English body); `body`/`body_hi` carry bilingual copy.
    await supabase.from('notifications').insert({
      recipient_id: schoolId,
      recipient_type: 'school',
      type: TYPE,
      title: 'Seat grace period started',
      message: bodyEn,
      body: bodyEn,
      body_hi: bodyHi,
      data,
      is_read: false,
      created_at: nowIso,
    });

    // Super-admin flag (B2B visibility). `recipient_id` is uuid NOT NULL — there
    // is no sentinel "super_admin" user, so we resolve the REAL super-admin user
    // ids from `admin_users` (the same table `authorizeAdmin` checks) and insert
    // one row per super-admin. No PII in the payload (P13) — only the school id +
    // counts. If there are no super-admins (or the lookup fails), we simply skip
    // the super-admin fan-out; the school-facing flag still persisted above.
    const superBody =
      `School ${schoolId} entered seat grace: ${verdict.current_active}/${verdict.seats_purchased} ` +
      `seats (ceiling ${verdict.grace_ceiling}), grace ends ${expires}.`;

    const { data: superAdmins, error: superErr } = await supabase
      .from('admin_users')
      .select('auth_user_id')
      .eq('admin_level', 'super_admin')
      .eq('is_active', true)
      .not('auth_user_id', 'is', null);

    if (superErr) {
      // Non-fatal: the school-facing flag already persisted. Log and return.
      logger.warn('seat_grace_warn_super_admin_lookup_failed', {
        error: new Error(superErr.message),
        route: 'seat-enforcement.flagGraceWarn',
      });
      return;
    }

    const superRows = (superAdmins ?? [])
      .map((a) => (a as { auth_user_id: string | null }).auth_user_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .map((authUserId) => ({
        recipient_id: authUserId,
        recipient_type: 'super_admin',
        type: TYPE,
        title: '[B2B Alert] Seat grace period started',
        message: superBody,
        body: superBody,
        data: { ...data, trigger: 'seat_grace_warn_super_admin' },
        is_read: false,
        created_at: nowIso,
      }));

    if (superRows.length > 0) {
      await supabase.from('notifications').insert(superRows);
    }
  } catch (err) {
    // Flagging must never break the (successful) soft-allow enrollment.
    logger.error('seat_grace_warn_flag_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: 'seat-enforcement.flagGraceWarn',
    });
  }
}
