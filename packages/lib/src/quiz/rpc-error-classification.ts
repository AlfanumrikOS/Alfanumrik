/**
 * PERMANENT vs TRANSIENT classification for `submit_quiz_results_v2` failures.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Both quiz-submit routes (`/api/quiz/submit` and `/api/v2/quiz/submit`) used
 * to funnel EVERY non-P0001, non-unique-violation RPC error into one catch-all
 * that answered `503 RPC_FAILED` with "Temporary scoring failure — retry with
 * same Idempotency-Key". That is a lie for a whole class of errors.
 *
 * The 2026-08-12 P0 made the cost concrete: every Bearer (mobile) caller
 * reached PostgREST as role `anon`, `submit_quiz_results_v2` is granted only to
 * `authenticated, service_role`, so Postgres raised SQLSTATE 42501 (permission
 * denied) on EVERY mobile submission. The route reported that as transient, so
 * the Flutter offline drain queue (`mobile/lib/data/repositories/
 * offline_drain_service.dart`, which classifies `5xx → retain`) kept the
 * attempt and retried it forever. A retry with the same Idempotency-Key could
 * never have succeeded — the grant was missing, not the database busy.
 *
 * The three SQLSTATEs below are structural: the same request replayed with the
 * same key will fail identically until a human changes a grant, a function
 * signature, or the data being written.
 *
 *   42501  insufficient_privilege  — missing EXECUTE/SELECT grant or an RLS
 *                                    deny. Fixed by a migration, not a retry.
 *   42883  undefined_function      — the RPC (or an overload with these exact
 *                                    argument types) does not exist. Fixed by a
 *                                    deploy, not a retry.
 *   23514  check_violation         — a CHECK constraint rejected the payload.
 *                                    The same payload always violates it.
 *
 * Everything else (deadlock 40P01, serialization failure 40001, connection
 * loss, statement timeout, PostgREST 5xx, an undecodable transport error) stays
 * TRANSIENT and keeps the existing `503` + retry-with-the-same-key contract.
 * Fail-OPEN toward "transient" is deliberate: misclassifying a genuine
 * transient as permanent would make the mobile drain DISCARD a student's real
 * quiz data, which is strictly worse than one wasted retry.
 *
 * ── CONTRACT ─────────────────────────────────────────────────────────────────
 * Permanent → HTTP 500, code `RPC_PERMANENT`, body carries `retryable: false`.
 * Transient → HTTP 503, code `RPC_FAILED`,   body carries `retryable: true`.
 *
 * This module ALSO owns one non-5xx classification — the SECURITY DEFINER
 * ownership-guard denial, which shares SQLSTATE P0001 with the routine
 * `session_not_started` refusal and so cannot be told apart by code alone. See
 * `isOwnershipGuardDenial` at the bottom of this file.
 *   Ownership denial → HTTP 403, code `STUDENT_OWNERSHIP_DENIED`, no
 *   `retryable` field (a 403 is already unambiguous to the mobile drain).
 *
 * The boolean `retryable` field is the machine-readable half of that contract
 * and is what the Flutter drain branches on. It exists BECAUSE the drain's
 * status-code matrix (`5xx → retain`, `4xx → discard`) has no correct answer
 * for a permanent server-side failure: a 4xx would make mobile throw away the
 * student's attempt, and a bare 5xx makes it retry forever. Neither status code
 * can express "stop retrying, but the data is fine" — the explicit field can.
 *
 * This module is a single source shared by BOTH submit routes so their error
 * translation can never drift (same rationale as `submit-side-effects.ts`).
 *
 * Owner: backend. Review: mobile (drain classification), testing, architect.
 */

/** Minimal shape both routes already capture from a Supabase RPC failure. */
export interface RpcErrorLike {
  message?: string | null;
  code?: string | null;
}

/**
 * SQLSTATEs that can NEVER be resolved by replaying the same request with the
 * same Idempotency-Key. Keep this set small and structural — anything
 * load/contention/connectivity related belongs on the transient side.
 */
export const PERMANENT_RPC_SQLSTATES: ReadonlySet<string> = new Set([
  '42501', // insufficient_privilege — missing grant / RLS deny
  '42883', // undefined_function — RPC or overload does not exist
  '23514', // check_violation — payload violates a CHECK constraint
]);

/**
 * PostgREST-level codes that mean the same thing as the SQLSTATEs above but
 * never surface as a raw SQLSTATE. PostgREST answers a missing function from
 * its schema cache with `PGRST202` (HTTP 404) rather than 42883, so a
 * SQLSTATE-only check would misfile a genuinely undeployed RPC as transient.
 */
const PERMANENT_POSTGREST_CODES: ReadonlySet<string> = new Set([
  'PGRST202', // Could not find the function ... in the schema cache
  'PGRST203', // Could not choose the best candidate function (ambiguous overload)
]);

/**
 * Message fallbacks for transports that drop the structured code. Deliberately
 * narrow + anchored to Postgres' own wording so a student-authored string can
 * never trip them (the message here is server-generated, never user input).
 */
const PERMANENT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /permission denied for (?:function|table|relation|schema)/i, // 42501
  /violates check constraint/i, // 23514
  /could not find the function/i, // PGRST202
];

/**
 * True when the RPC failure is structurally un-retryable.
 *
 * Fail-open: anything not positively identified as permanent is treated as
 * transient, because the cost of a wrong "permanent" verdict (mobile discards
 * a real attempt) far exceeds the cost of a wrong "transient" verdict (one
 * extra idempotent retry that the RPC short-circuits anyway).
 */
export function isPermanentRpcFailure(err: RpcErrorLike | null | undefined): boolean {
  if (!err) return false;

  const code = (err.code ?? '').trim();
  if (code) {
    if (PERMANENT_RPC_SQLSTATES.has(code)) return true;
    if (PERMANENT_POSTGREST_CODES.has(code.toUpperCase())) return true;
  }

  const message = err.message ?? '';
  if (!message) return false;
  return PERMANENT_MESSAGE_PATTERNS.some((re) => re.test(message));
}

/** Public error code returned for a permanent (never-retry) scoring failure. */
export const RPC_PERMANENT_CODE = 'RPC_PERMANENT' as const;

/** Public error code returned for a transient (retry-with-same-key) failure. */
export const RPC_TRANSIENT_CODE = 'RPC_FAILED' as const;

/**
 * Client-facing message for a permanent failure. Deliberately does NOT tell the
 * caller to retry (the whole point of the branch) and carries no internal
 * detail — the SQLSTATE and RPC message go to the server-side log + ops event
 * only (P13).
 */
export const RPC_PERMANENT_MESSAGE =
  'Scoring failed permanently for this submission. Do not retry — this has been reported to support.';

/** Client-facing message for a genuine transient failure (unchanged wording). */
export const RPC_TRANSIENT_MESSAGE =
  'Temporary scoring failure — retry with same Idempotency-Key';

// ─── Ownership-guard denial (SQLSTATE P0001, but NOT session_not_started) ─────
//
// ── WHY THIS IS SEPARATE FROM `session_not_started` ──────────────────────────
// `submit_quiz_results_v2` (and its siblings `start_quiz_session`,
// `atomic_quiz_profile_update`, …) open with the SAME SECURITY DEFINER guard:
//
//     IF auth.uid() IS NOT NULL AND NOT EXISTS (
//       SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
//     ) THEN
//       RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
//     END IF;
//
// A bare `RAISE EXCEPTION` in PL/pgSQL is SQLSTATE **P0001** — the exact same
// SQLSTATE as the RPC's `session_not_started` refusal. Both submit routes
// branched on `rpcErr.code === 'P0001'` alone, so a genuine CROSS-STUDENT
// submission attempt was answered `409 session_not_started` with
// `hint: 'restart_quiz'` — i.e. the platform told an attacker "your session
// expired, start again" and told ops nothing at all. The single most
// security-relevant outcome the RPC can produce was indistinguishable from the
// most routine one.
//
// This is not theoretical bookkeeping: it is the ONLY signal that the
// route-layer `STUDENT_ID_MISMATCH` 403 was bypassed or is out of sync with the
// database's own view of who owns the student row. It must be loud.
//
// Discrimination is by MESSAGE, because the SQLSTATE cannot discriminate. The
// pattern is anchored to Postgres' own server-generated wording; no part of it
// is client-controlled, so a student cannot craft a payload that trips it.

/**
 * The ownership-guard `RAISE EXCEPTION` wording, as emitted by every quiz RPC.
 * Two variants exist in the migration chain and both are matched:
 *   'Access denied: caller does not own student %'       (by students.id)
 *   'Access denied: caller does not own student auth %'  (by auth_user_id)
 */
const OWNERSHIP_DENIAL_PATTERN = /access denied:\s*caller does not own student\b/i;

/**
 * True when a P0001 failure is the SECURITY DEFINER ownership-guard denial
 * rather than the routine `session_not_started` refusal.
 *
 * Fail-CLOSED in the opposite direction to `isPermanentRpcFailure`: only a
 * positive match on the guard's own wording is treated as a denial, so an
 * unrecognised P0001 keeps its existing `409 session_not_started` handling and
 * the legitimate-client path is untouched.
 */
export function isOwnershipGuardDenial(err: RpcErrorLike | null | undefined): boolean {
  if (!err) return false;
  return OWNERSHIP_DENIAL_PATTERN.test(err.message ?? '');
}

/** Public error code for an ownership-guard denial. */
export const OWNERSHIP_DENIED_CODE = 'STUDENT_OWNERSHIP_DENIED' as const;

/**
 * Client-facing message for an ownership-guard denial.
 *
 * P13: deliberately carries NO student identifier and NOT the raw SQL message
 * (which interpolates `p_student_id` — a probe would otherwise get the target
 * UUID echoed back, confirming existence). It is also intentionally identical
 * in shape to the route-layer `STUDENT_ID_MISMATCH` refusal so the two are not
 * distinguishable from outside: an attacker learns only "denied", never which
 * layer denied them or what the server knows about the id they supplied.
 */
export const OWNERSHIP_DENIED_MESSAGE = 'Access denied for this student';

/**
 * `ops_events.message` for the denial. Distinct string (not a `context` flag) so
 * an alert rule can key on it directly, the same way
 * `submit_quiz_results_v2_failed_permanent` is keyed.
 */
export const OWNERSHIP_DENIED_OPS_MESSAGE = 'submit_quiz_results_v2_ownership_denied';

/**
 * `ops_events.category` for the denial. NOT `'quiz'` — this is an authorization
 * event that happens to originate in the quiz funnel, and it must be routable to
 * security triage without pulling in every scoring failure.
 */
export const OWNERSHIP_DENIED_OPS_CATEGORY = 'security';

/**
 * Which transport a denied caller used, for the ops event's `transport` field.
 *
 * This MIRRORS the Bearer test in `createSupabaseRouteClient`
 * (`packages/lib/src/supabase-route.ts`): a header must start with `Bearer ` to
 * be a Bearer caller. An `Authorization: Basic …` request takes the COOKIE path
 * there, so labelling it "bearer" here would point a forensic investigation at
 * the wrong client. Lives in this shared module — rather than being inlined in
 * each route — so the two submit routes cannot drift apart on it.
 *
 * Deliberately duplicates rather than imports the auth helper's predicate: this
 * is a logging label, and a quiz module must not reach into auth-infra to
 * produce one. The mirroring is asserted by test, not by a shared reference.
 */
export function authTransportLabel(request: {
  headers: { get(name: string): string | null };
}): 'bearer' | 'cookie' {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? 'bearer' : 'cookie';
}
