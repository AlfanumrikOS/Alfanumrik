/**
 * REG-391 — PERMANENT vs TRANSIENT classification of `submit_quiz_results_v2`
 * failures (`packages/lib/src/quiz/rpc-error-classification.ts`).
 *
 * ── WHY THIS SUITE EXISTS ────────────────────────────────────────────────────
 * On 2026-08-12 a production E2E run (411 requests) found that BOTH quiz-submit
 * routes answered `503 RPC_FAILED` — "Temporary scoring failure, retry with the
 * same Idempotency-Key" — for every `Authorization: Bearer` caller. The failure
 * was SQLSTATE 42501 (`submit_quiz_results_v2` is granted only to
 * `authenticated, service_role`, and the cookie-only client made Bearer callers
 * arrive as `anon`). No retry could ever have fixed a missing grant, so the
 * Flutter drain queue (`5xx → retain`) retried forever. The classifier is the
 * module that stops that.
 *
 * ── WHAT IS PINNED (properties, not implementation) ──────────────────────────
 *   1. The three structural SQLSTATEs (42501 / 42883 / 23514) and the two
 *      PostgREST schema-cache codes (PGRST202 / PGRST203) classify PERMANENT.
 *   2. FAIL-OPEN TOWARD TRANSIENT. Anything not positively identified as
 *      permanent is transient. This DIRECTION is the safety property: a wrong
 *      "permanent" verdict stops a client retrying a recoverable failure, which
 *      is strictly worse than one wasted retry. Every unknown/undecodable shape
 *      is asserted to land on the transient side.
 *   3. The public wire constants: permanent → `RPC_PERMANENT`, transient →
 *      `RPC_FAILED`, and the permanent message NEVER instructs a retry (the
 *      whole point of the branch) while the transient one does.
 *
 * The route-level half of this contract (status codes + the top-level
 * `retryable` boolean on the wire) is pinned in
 * `src/__tests__/api/quiz-submit-bearer-transport.test.ts`.
 *
 * Invariants: P4 (atomic quiz submission — a permanent failure must not be
 * reported as a retryable one), P13 (no internal detail in the client message).
 */
import { describe, it, expect } from 'vitest';
import {
  authTransportLabel,
  isPermanentRpcFailure,
  isOwnershipGuardDenial,
  OWNERSHIP_DENIED_CODE,
  OWNERSHIP_DENIED_MESSAGE,
  OWNERSHIP_DENIED_OPS_CATEGORY,
  OWNERSHIP_DENIED_OPS_MESSAGE,
  PERMANENT_RPC_SQLSTATES,
  RPC_PERMANENT_CODE,
  RPC_TRANSIENT_CODE,
  RPC_PERMANENT_MESSAGE,
  RPC_TRANSIENT_MESSAGE,
} from '@alfanumrik/lib/quiz/rpc-error-classification';

describe('isPermanentRpcFailure — structural SQLSTATEs are PERMANENT (REG-391)', () => {
  it('classifies 42501 insufficient_privilege as permanent (THE 2026-08-12 P0)', () => {
    expect(
      isPermanentRpcFailure({
        code: '42501',
        message: 'permission denied for function submit_quiz_results_v2',
      }),
    ).toBe(true);
  });

  it('classifies 42883 undefined_function as permanent', () => {
    expect(
      isPermanentRpcFailure({
        code: '42883',
        message: 'function submit_quiz_results_v2(unknown) does not exist',
      }),
    ).toBe(true);
  });

  it('classifies 23514 check_violation as permanent', () => {
    expect(
      isPermanentRpcFailure({
        code: '23514',
        message: 'new row violates check constraint "quiz_sessions_grade_check"',
      }),
    ).toBe(true);
  });

  it('exports exactly the three structural SQLSTATEs (set is deliberately small)', () => {
    // A widened set is how a transient error silently becomes "permanent" and
    // the client stops retrying something that would have recovered. Any
    // addition must be a deliberate, reviewed change to this assertion.
    expect([...PERMANENT_RPC_SQLSTATES].sort()).toEqual(['23514', '42501', '42883']);
  });
});

describe('isPermanentRpcFailure — PostgREST schema-cache codes are PERMANENT (REG-391)', () => {
  it('classifies PGRST202 (function not in schema cache) as permanent', () => {
    // PostgREST answers a missing function with PGRST202/HTTP 404, never a raw
    // 42883 — a SQLSTATE-only check would misfile an undeployed RPC as transient.
    expect(
      isPermanentRpcFailure({
        code: 'PGRST202',
        message: 'Could not find the function public.submit_quiz_results_v2',
      }),
    ).toBe(true);
  });

  it('classifies PGRST203 (ambiguous overload) as permanent', () => {
    expect(
      isPermanentRpcFailure({
        code: 'PGRST203',
        message: 'Could not choose the best candidate function',
      }),
    ).toBe(true);
  });

  it('matches the PostgREST codes case-insensitively', () => {
    expect(isPermanentRpcFailure({ code: 'pgrst202', message: '' })).toBe(true);
  });
});

describe('isPermanentRpcFailure — message fallback when the code is dropped (REG-391)', () => {
  it('recognises a permission-denied message with NO structured code', () => {
    expect(
      isPermanentRpcFailure({ message: 'permission denied for function foo' }),
    ).toBe(true);
  });

  it('recognises a check-constraint message with NO structured code', () => {
    expect(
      isPermanentRpcFailure({ message: 'new row violates check constraint "x"' }),
    ).toBe(true);
  });

  it('does NOT trip on prose that merely mentions permissions', () => {
    // The patterns are anchored to Postgres' own wording so an unrelated
    // server string can never flip a transient failure into a permanent one.
    expect(
      isPermanentRpcFailure({
        code: '08006',
        message: 'connection reset while checking permission cache',
      }),
    ).toBe(false);
  });
});

describe('isPermanentRpcFailure — FAIL-OPEN toward TRANSIENT (REG-391)', () => {
  // This is the direction that matters. A wrong "permanent" verdict tells the
  // client to stop retrying a recoverable failure (and, on mobile, quarantines
  // a real completed quiz). A wrong "transient" verdict costs one idempotent
  // retry the RPC short-circuits anyway. So EVERY unrecognised shape below must
  // classify transient.
  const transientCases: Array<[string, unknown]> = [
    ['deadlock 40P01', { code: '40P01', message: 'deadlock detected' }],
    ['serialization failure 40001', { code: '40001', message: 'could not serialize access' }],
    ['connection failure 08006', { code: '08006', message: 'connection reset by peer' }],
    ['statement timeout 57014', { code: '57014', message: 'canceling statement due to statement timeout' }],
    ['unique violation 23505 (handled upstream as a replay)', { code: '23505', message: 'duplicate key value' }],
    ['raise_exception P0001', { code: 'P0001', message: 'session_not_started' }],
    ['an entirely unknown SQLSTATE', { code: 'ZZ999', message: 'who knows' }],
    ['an unknown code with an unknown message', { code: 'XX000', message: 'internal error' }],
    ['an empty error object', {}],
    ['a code-only error with no message', { code: '' }],
    ['a message-only error with empty text', { message: '' }],
    ['null code and null message', { code: null, message: null }],
    ['an undecodable transport error (null)', null],
    ['an undecodable transport error (undefined)', undefined],
  ];

  for (const [label, err] of transientCases) {
    it(`treats ${label} as TRANSIENT (never permanent)`, () => {
      expect(isPermanentRpcFailure(err as never)).toBe(false);
    });
  }

  it('is transient for a randomly-shaped error the module has never seen', () => {
    // Property form of the same rule: an arbitrary, non-Postgres-worded error
    // must not be positively identified as permanent.
    for (const noise of ['x', 'ECONNRESET', 'upstream timeout', '502 Bad Gateway', '{}']) {
      expect(isPermanentRpcFailure({ code: noise, message: noise })).toBe(false);
    }
  });
});

describe('public wire constants (REG-391)', () => {
  it('uses RPC_PERMANENT for permanent and RPC_FAILED for transient', () => {
    // RPC_FAILED is the PRE-EXISTING transient code — it must not change, or
    // every already-shipped client that branches on it breaks.
    expect(RPC_PERMANENT_CODE).toBe('RPC_PERMANENT');
    expect(RPC_TRANSIENT_CODE).toBe('RPC_FAILED');
  });

  it('the PERMANENT message never tells the client to retry', () => {
    expect(RPC_PERMANENT_MESSAGE).not.toMatch(/retry with same/i);
    expect(RPC_PERMANENT_MESSAGE).toMatch(/do not retry/i);
  });

  it('the TRANSIENT message keeps the historical retry-with-same-key wording', () => {
    expect(RPC_TRANSIENT_MESSAGE).toBe(
      'Temporary scoring failure — retry with same Idempotency-Key',
    );
  });

  it('neither client-facing message leaks a SQLSTATE or internal detail (P13)', () => {
    for (const msg of [RPC_PERMANENT_MESSAGE, RPC_TRANSIENT_MESSAGE]) {
      expect(msg).not.toMatch(/42501|42883|23514|PGRST/);
      expect(msg).not.toMatch(/submit_quiz_results_v2/);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// REG-394 — the ownership-guard denial must be distinguishable from
// `session_not_started`, which shares its SQLSTATE.
// ════════════════════════════════════════════════════════════════════════════
//
// Every quiz RPC opens with the SAME SECURITY DEFINER guard:
//   IF auth.uid() IS NOT NULL AND NOT EXISTS (SELECT 1 FROM students
//      WHERE id = p_student_id AND auth_user_id = auth.uid()) THEN
//     RAISE EXCEPTION 'Access denied: caller does not own student %', p_student_id;
// A bare PL/pgSQL `RAISE EXCEPTION` is SQLSTATE **P0001** — the identical code
// the RPC uses for `session_not_started`. Both submit routes branched on
// `code === 'P0001'` alone, so a genuine cross-student attempt was answered
// `409 session_not_started` + `hint: 'restart_quiz'` and produced no security
// signal. Only the MESSAGE can tell them apart; this suite pins that.
describe('isOwnershipGuardDenial — P0001 disambiguation (REG-394)', () => {
  const STUDENT = '11111111-1111-4111-8111-111111111111';

  it('detects the guard denial raised by submit_quiz_results_v2 / start_quiz_session', () => {
    expect(
      isOwnershipGuardDenial({
        code: 'P0001',
        message: `Access denied: caller does not own student ${STUDENT}`,
      }),
    ).toBe(true);
  });

  it('detects the auth_user_id variant of the same guard', () => {
    // migration 20260814000000 raises 'caller does not own student auth %'.
    expect(
      isOwnershipGuardDenial({
        code: 'P0001',
        message: `Access denied: caller does not own student auth ${STUDENT}`,
      }),
    ).toBe(true);
  });

  it('detects it WITHOUT a code (transports that drop the SQLSTATE)', () => {
    expect(
      isOwnershipGuardDenial({ message: `Access denied: caller does not own student ${STUDENT}` }),
    ).toBe(true);
  });

  it('is case-insensitive and tolerates extra whitespace after the colon', () => {
    expect(
      isOwnershipGuardDenial({ code: 'P0001', message: 'ACCESS DENIED:  CALLER DOES NOT OWN STUDENT x' }),
    ).toBe(true);
  });

  // ── THE OTHER HALF: session_not_started must stay untouched ────────────────
  // The legitimate case is a NORMAL, EXPECTED client state (the student's quiz
  // session expired). If it ever fell into the denial branch, every such student
  // would get a hard 403 instead of "restart the quiz".
  it('does NOT match session_not_started — the SAME SQLSTATE, different meaning', () => {
    expect(isOwnershipGuardDenial({ code: 'P0001', message: 'session_not_started' })).toBe(false);
    expect(
      isOwnershipGuardDenial({ code: 'P0001', message: `session_not_started: ${STUDENT}` }),
    ).toBe(false);
  });

  it('does NOT match any other P0001, or a null/undefined error', () => {
    for (const message of [
      'some other RAISE EXCEPTION from a trigger',
      'permission denied for function submit_quiz_results_v2', // 42501 — permanent, not a denial
      'Access denied', // the bare template form: NOT the ownership guard's wording
      '',
    ]) {
      expect(isOwnershipGuardDenial({ code: 'P0001', message })).toBe(false);
    }
    expect(isOwnershipGuardDenial(null)).toBe(false);
    expect(isOwnershipGuardDenial(undefined)).toBe(false);
  });

  it('the two classifiers are DISJOINT on their own inputs', () => {
    // The denial is not a "permanent RPC failure" (it must not become a 500 +
    // retryable:false), and a permanent failure is not a denial (it must not
    // become a 403). Overlap either way would silently reroute one class.
    const denial = { code: 'P0001', message: `Access denied: caller does not own student ${STUDENT}` };
    const permanent = { code: '42501', message: 'permission denied for function x' };
    expect(isOwnershipGuardDenial(denial)).toBe(true);
    expect(isPermanentRpcFailure(denial)).toBe(false);
    expect(isOwnershipGuardDenial(permanent)).toBe(false);
    expect(isPermanentRpcFailure(permanent)).toBe(true);
  });
});

describe('ownership-denial wire + ops constants (REG-394)', () => {
  it('uses a distinct public code — never SESSION_NOT_STARTED', () => {
    expect(OWNERSHIP_DENIED_CODE).toBe('STUDENT_OWNERSHIP_DENIED');
    expect(OWNERSHIP_DENIED_CODE).not.toBe('SESSION_NOT_STARTED');
  });

  it('the client-facing message leaks NO student id and NO SQL text (P13)', () => {
    // The raw guard message interpolates p_student_id. Echoing it back would
    // confirm the existence of the probed id to an attacker.
    expect(OWNERSHIP_DENIED_MESSAGE).not.toMatch(/caller does not own/i);
    expect(OWNERSHIP_DENIED_MESSAGE).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(OWNERSHIP_DENIED_MESSAGE).not.toMatch(/P0001|submit_quiz_results_v2|students/);
    // …and it must NOT tell the caller to restart the quiz, which is what the
    // old 409 said.
    expect(OWNERSHIP_DENIED_MESSAGE).not.toMatch(/restart|session_not_started/i);
  });

  it('routes to security triage at its own ops message, not the quiz bucket', () => {
    expect(OWNERSHIP_DENIED_OPS_CATEGORY).toBe('security');
    expect(OWNERSHIP_DENIED_OPS_MESSAGE).toBe('submit_quiz_results_v2_ownership_denied');
  });
});

describe('authTransportLabel — the ops event must not misname the transport (REG-394)', () => {
  const req = (auth?: string) => ({
    headers: { get: (n: string) => (n === 'authorization' && auth ? auth : null) },
  });

  it('labels a Bearer caller `bearer`', () => {
    expect(authTransportLabel(req('Bearer abc.def.ghi'))).toBe('bearer');
  });

  it('labels a caller with NO Authorization header `cookie`', () => {
    expect(authTransportLabel(req())).toBe('cookie');
  });

  it('labels `Authorization: Basic …` as COOKIE, not bearer', () => {
    // MIRRORS createSupabaseRouteClient, which only takes the Bearer path on a
    // `Bearer ` prefix — a Basic header falls through to the cookie client. A
    // truthiness check on the header (the obvious shortcut) would label this
    // "bearer" and point a forensic investigation at the wrong client.
    expect(authTransportLabel(req('Basic dXNlcjpwYXNz'))).toBe('cookie');
  });

  it('is prefix-exact: `Bearertoken` and a lowercase `bearer ` are NOT bearer', () => {
    expect(authTransportLabel(req('Bearertoken'))).toBe('cookie');
    expect(authTransportLabel(req('bearer abc'))).toBe('cookie');
  });
});
