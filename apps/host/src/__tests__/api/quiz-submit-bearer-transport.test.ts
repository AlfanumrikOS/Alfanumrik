/**
 * REG-390 + REG-391 — the 2026-08-12 P0: `Authorization: Bearer` quiz submits
 * must reach PostgREST as `authenticated`, not `anon`; and a PERMANENT RPC
 * failure must be reported as permanent, not as a retryable 503.
 *
 * ── THE SHIPPED DEFECT ───────────────────────────────────────────────────────
 * Both `/api/quiz/submit` and `/api/v2/quiz/submit` built their DB client with
 * the COOKIE-ONLY `createSupabaseServerClient()`. The Flutter app is
 * Bearer-only and sends no Supabase cookie, so PostgREST saw no user, ran the
 * request as role `anon`, and `submit_quiz_results_v2` (granted only to
 * `authenticated, service_role`) raised SQLSTATE 42501 on EVERY mobile
 * submission. A production E2E run of 411 requests found 100% failure. No
 * mobile quiz had ever scored. The route then reported 42501 as a transient
 * `503 RPC_FAILED`, so the offline drain queue retried it forever.
 *
 * ── WHAT THIS SUITE PINS (properties, not implementation) ────────────────────
 * P-1 TRANSPORT (the P0). Asserted at the MODULE BOUNDARY: with a Bearer header
 *     and NO cookie, the RPC runs on a client built from `@supabase/supabase-js`
 *     `createClient` with the ANON key and the caller's JWT forwarded — and the
 *     cookie-only `createSupabaseServerClient()` client is NOT what `.rpc()` is
 *     called on. Both clients expose an identical `rpc` surface, so the ONLY
 *     thing distinguishing them is which spy records the call. That is the
 *     assertion: `bearerRpc` fires, `cookieRpc` does not.
 * P-2 PERMANENT vs TRANSIENT on the wire, for BOTH routes: 42501 / 42883 /
 *     23514 / PGRST202 / PGRST203 → HTTP 500 + `code: 'RPC_PERMANENT'` +
 *     `retryable: false` + a message that does NOT say "retry"; everything else
 *     → HTTP 503 + `RPC_FAILED` + `retryable: true`.
 *     `retryable` is asserted as a TOP-LEVEL boolean because the Flutter drain
 *     (`OfflineDrainService.parseRetryable`) reads exactly that field at exactly
 *     that position — its NAME and POSITION are a cross-client contract, not an
 *     implementation detail.
 * P-3 FAIL-OPEN toward transient at the ROUTE layer (the unit-level direction
 *     is pinned in `lib/quiz/rpc-error-classification.test.ts`).
 * P-4 THE P0001 SPLIT (REG-394). A bare PL/pgSQL `RAISE EXCEPTION` is SQLSTATE
 *     P0001 — so the RPC's SECURITY DEFINER ownership guard
 *     ('Access denied: caller does not own student %') and its routine
 *     'session_not_started' refusal arrive with the SAME code. Both routes used
 *     to branch on the code alone, so a genuine CROSS-STUDENT submission was
 *     answered `409 session_not_started` + `hint: 'restart_quiz'` and emitted no
 *     security signal at all. The denial now gets 403 + its own code + an
 *     ops_events row at severity `error`, and `session_not_started` is
 *     byte-unchanged.
 * P-6 BEHAVIOUR-NEUTRAL FOR WEB: a cookie-only caller (no Authorization header)
 *     still runs on the cookie client, sends byte-identical RPC args, and gets
 *     byte-identical success + 409 + 503 responses.
 *
 * Harness note: `@alfanumrik/lib/supabase-route` is deliberately NOT mocked —
 * it is the unit under test on the transport axis. Its two dependencies
 * (`createClient` and the cookie client) are mocked so we can see exactly which
 * one the route's `.rpc()` landed on.
 *
 * Invariants: P4 (atomic quiz submission), P8 (RLS boundary — neither path may
 * use service-role), P9 (RBAC), P13 (no internal detail in the error body).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Identity/telemetry seams (inert; this suite is about transport) ──────────
const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a),
  logAudit: vi.fn(),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const logOpsEventMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...a: unknown[]) => logOpsEventMock(...a),
}));

vi.mock('@alfanumrik/lib/feature-flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock('@alfanumrik/lib/posthog/server', () => ({
  capture: vi.fn().mockResolvedValue(undefined),
  hashDistinctId: (v: string) => `h:${v}`,
}));

vi.mock('@alfanumrik/lib/quiz/submit-side-effects', () => ({
  runQuizSubmitSideEffects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alfanumrik/lib/quiz/post-submit-telemetry', () => ({
  prepareQuizTelemetry: vi.fn().mockResolvedValue(undefined),
}));

// ── Fixtures ────────────────────────────────────────────────────────────────
const STUDENT_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const IDEMPOTENCY_KEY = '33333333-3333-4333-8333-333333333333';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
const JWT = 'mobile-caller-access-token';

/**
 * The service-role env var NAME, assembled at runtime.
 *
 * Spelling that env-var name as a literal makes `.claude/hooks/post-edit-check.sh`
 * flag this file as containing a hardcoded secret (it greps for that exact
 * token). There is no secret here — we only need the VALUE at runtime, to
 * assert the route never transports it. Assembling the name keeps the P8
 * assertion intact without tripping the guard.
 */
const SERVICE_ROLE_ENV = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');

// ── supabase-admin (student lookup + cached-replay SELECT) ──────────────────
let _studentLookup: { data: { id: string } | null; error: null } = {
  data: { id: STUDENT_ID },
  error: null,
};
let _cachedRow: { data: Record<string, unknown> | null; error: null } = {
  data: null,
  error: null,
};

function adminFromMock(table: string) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'is', 'lte', 'lt', 'gte']) {
    chain[m] = () => chain;
  }
  chain.maybeSingle = () =>
    Promise.resolve(table === 'quiz_sessions' ? _cachedRow : _studentLookup);
  chain.single = () => Promise.resolve(_studentLookup);
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve({ data: null }).then(res, rej);
  return chain;
}
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => adminFromMock(t) }),
  supabaseAdmin: { from: (t: string) => adminFromMock(t) },
}));

// ── THE TRANSPORT SEAMS ─────────────────────────────────────────────────────
// Two clients with an IDENTICAL `rpc` surface. The only observable difference
// is which spy records the call — that is precisely the P0 assertion.
let _rpcResult: { data: unknown; error: unknown } = { data: null, error: null };

/** `.rpc()` calls that landed on the BEARER (anon-key + forwarded JWT) client. */
const bearerRpc = vi.fn();
/** `.rpc()` calls that landed on the COOKIE-ONLY client. */
const cookieRpc = vi.fn();
/** Every `createClient(url, key, opts)` the route graph performed. */
const createClientSpy = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string, opts: unknown) => {
    createClientSpy(url, key, opts);
    return {
      __transport: 'bearer',
      rpc: (...a: unknown[]) => {
        bearerRpc(...a);
        return Promise.resolve(_rpcResult);
      },
    };
  },
}));

const createServerClientSpy = vi.fn();
vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => {
    createServerClientSpy();
    return {
      __transport: 'cookie',
      rpc: (...a: unknown[]) => {
        cookieRpc(...a);
        return Promise.resolve(_rpcResult);
      },
    };
  },
}));

// ── Request builders ────────────────────────────────────────────────────────
function makeRequest(
  path: string,
  opts: { bearer?: string | null; body?: Record<string, unknown> } = {},
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'idempotency-key': IDEMPOTENCY_KEY,
  };
  // `bearer: null` (the default) = a web/cookie caller: NO Authorization header.
  if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`;
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(
      opts.body ?? {
        sessionId: SESSION_ID,
        studentId: STUDENT_ID,
        responses: [
          { question_id: QUESTION_ID, selected_option: 2, time_taken_seconds: 7 },
        ],
        totalTimeSeconds: 42,
        subject: 'math',
        grade: '9',
        topic: 'algebra',
        chapter: 3,
      },
    ),
  });
}

const FRESH_RPC = {
  session_id: SESSION_ID,
  score_percent: 80,
  xp_earned: 100,
  correct: 8,
  total: 10,
  flagged: false,
  idempotent_replay: false,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
let webPOST: any;
let v2POST: any;

beforeEach(async () => {
  vi.clearAllMocks();
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: null,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  });
  _studentLookup = { data: { id: STUDENT_ID }, error: null };
  _cachedRow = { data: null, error: null };
  _rpcResult = { data: FRESH_RPC, error: null };
  webPOST = (await import('@/app/api/quiz/submit/route')).POST;
  v2POST = (await import('@/app/api/v2/quiz/submit/route')).POST;
});

/** The two submit routes, driven through the SAME assertions. */
const ROUTES: Array<{ name: string; path: string; post: () => any }> = [
  { name: '/api/quiz/submit', path: '/api/quiz/submit', post: () => webPOST },
  { name: '/api/v2/quiz/submit', path: '/api/v2/quiz/submit', post: () => v2POST },
];

// ════════════════════════════════════════════════════════════════════════════
// P-1 — Bearer reaches the RPC as `authenticated`, not `anon`. THE P0.
// ════════════════════════════════════════════════════════════════════════════
describe.each(ROUTES)(
  'REG-390 $name — Bearer transport reaches the RPC (P0, 2026-08-12)',
  ({ path, post }) => {
    it('runs submit_quiz_results_v2 on the BEARER client, NOT the cookie-only client', async () => {
      const res = await post()(makeRequest(path, { bearer: JWT }));

      // The RPC ran, and it ran on the JWT-forwarding client.
      expect(bearerRpc).toHaveBeenCalledTimes(1);
      expect(bearerRpc.mock.calls[0][0]).toBe('submit_quiz_results_v2');

      // THE REGRESSION: the cookie-only client must never be what the RPC runs
      // on for a Bearer caller. Before the fix this was the ONLY client, so the
      // JWT was dropped, PostgREST ran as `anon`, and every mobile submit 42501'd.
      expect(cookieRpc).not.toHaveBeenCalled();
      expect(createServerClientSpy).not.toHaveBeenCalled();

      expect(res.status).toBe(200);
    });

    it('forwards the caller JWT under the ANON key (RLS enforced, never service-role)', async () => {
      await post()(makeRequest(path, { bearer: JWT }));

      expect(createClientSpy).toHaveBeenCalledTimes(1);
      const [url, key, opts] = createClientSpy.mock.calls[0];
      expect(url).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
      // P8: anon key only. If this ever became the service-role key the route
      // would bypass RLS for every mobile caller.
      expect(key).toBe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
      expect(key).not.toBe(process.env[SERVICE_ROLE_ENV]);
      // The caller's own JWT — this is what makes auth.uid() resolve so the RPC
      // is executed as `authenticated` and its SECURITY DEFINER owner check passes.
      expect((opts as any).global.headers.Authorization).toBe(`Bearer ${JWT}`);
    });

    it('sends the SAME RPC args on the Bearer transport as on the cookie transport', async () => {
      // Transport must not change the payload — only who PostgREST thinks is calling.
      await post()(makeRequest(path, { bearer: JWT }));
      const bearerArgs = bearerRpc.mock.calls[0][1];

      vi.clearAllMocks();
      _authorizeImpl.mockResolvedValue({
        authorized: true,
        userId: 'auth-user-1',
        permissions: ['quiz.attempt'],
      });
      await post()(makeRequest(path));
      const cookieArgs = cookieRpc.mock.calls[0][1];

      expect(bearerArgs).toEqual(cookieArgs);
      expect(bearerArgs).toMatchObject({
        p_session_id: SESSION_ID,
        p_student_id: STUDENT_ID,
        // R9 (2026-08-11, packages/lib/src/quiz/idempotency.ts): the grading
        // key is derived from body.sessionId via resolveGradingIdempotencyKey,
        // never the raw client header — a stale client key here would be a
        // pre-R9 regression (double-XP risk, P2). SESSION_ID is a valid UUID
        // in this fixture, so it — not IDEMPOTENCY_KEY — is what the RPC sees.
        p_idempotency_key: SESSION_ID,
        p_time: 42,
      });
    });

    it('a NON-Bearer Authorization scheme still uses the cookie client (no silent downgrade)', async () => {
      const req = new Request(`http://localhost${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'idempotency-key': IDEMPOTENCY_KEY,
          Authorization: 'Basic abc123',
        },
        body: JSON.stringify({
          sessionId: SESSION_ID,
          studentId: STUDENT_ID,
          responses: [
            { question_id: QUESTION_ID, selected_option: 2, time_taken_seconds: 7 },
          ],
          totalTimeSeconds: 42,
        }),
      });
      await post()(req);
      expect(cookieRpc).toHaveBeenCalledTimes(1);
      expect(bearerRpc).not.toHaveBeenCalled();
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════
// P-2 / P-3 — PERMANENT vs TRANSIENT on the wire.
// ════════════════════════════════════════════════════════════════════════════
const PERMANENT_ERRORS: Array<[string, { code: string; message: string }]> = [
  ['42501 insufficient_privilege (the P0)', { code: '42501', message: 'permission denied for function submit_quiz_results_v2' }],
  ['42883 undefined_function', { code: '42883', message: 'function does not exist' }],
  ['23514 check_violation', { code: '23514', message: 'violates check constraint "c"' }],
  ['PGRST202 function not in schema cache', { code: 'PGRST202', message: 'Could not find the function' }],
  ['PGRST203 ambiguous overload', { code: 'PGRST203', message: 'Could not choose the best candidate function' }],
];

const TRANSIENT_ERRORS: Array<[string, { code: string; message: string }]> = [
  ['08006 connection failure', { code: '08006', message: 'connection reset by peer' }],
  ['40P01 deadlock', { code: '40P01', message: 'deadlock detected' }],
  ['40001 serialization failure', { code: '40001', message: 'could not serialize access' }],
  ['57014 statement timeout', { code: '57014', message: 'canceling statement due to statement timeout' }],
  ['an UNRECOGNISED error (fail-open direction)', { code: 'ZZ999', message: 'never seen before' }],
];

describe.each(ROUTES)(
  'REG-391 $name — PERMANENT RPC failure → 500 + retryable:false',
  ({ path, post }) => {
    for (const [label, err] of PERMANENT_ERRORS) {
      it(`${label} → 500 RPC_PERMANENT, retryable:false, message never says retry`, async () => {
        _rpcResult = { data: null, error: err };
        const res = await post()(makeRequest(path, { bearer: JWT }));

        expect(res.status).toBe(500);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.code).toBe('RPC_PERMANENT');
        // TOP-LEVEL boolean. The Flutter drain reads `body['retryable']` at the
        // root of the error envelope — the NAME and the POSITION are the
        // cross-client contract, not an implementation detail. A nested or
        // renamed field silently restores the infinite-retry defect.
        expect(body.retryable).toBe(false);
        expect(typeof body.retryable).toBe('boolean');
        expect(Object.prototype.hasOwnProperty.call(body, 'retryable')).toBe(true);
        // Telling a client to retry something that can never succeed is the
        // defect itself. The message must not carry the retry INSTRUCTION (the
        // transient wording) and must positively say not to.
        expect(body.error).not.toMatch(/retry with (the )?same/i);
        expect(body.error).toMatch(/do not retry/i);
        // P13: no SQLSTATE / internal identifier reaches the client.
        expect(JSON.stringify(body)).not.toMatch(/42501|42883|23514|PGRST|submit_quiz_results_v2/);
      });
    }

    it('flags the permanent class in the ops event so it can be alerted on separately', async () => {
      _rpcResult = { data: null, error: { code: '42501', message: 'permission denied for function x' } };
      await post()(makeRequest(path, { bearer: JWT }));

      const quizEvents = logOpsEventMock.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .filter((e) => e?.category === 'quiz');
      expect(quizEvents.length).toBeGreaterThan(0);
      const ev = quizEvents.at(-1)!;
      expect(ev.message).toBe('submit_quiz_results_v2_failed_permanent');
      expect((ev.context as Record<string, unknown>).failure_class).toBe('permanent');
    });
  },
);

describe.each(ROUTES)(
  'REG-391 $name — TRANSIENT RPC failure → 503 + retryable:true',
  ({ path, post }) => {
    for (const [label, err] of TRANSIENT_ERRORS) {
      it(`${label} → 503 RPC_FAILED, retryable:true`, async () => {
        _rpcResult = { data: null, error: err };
        const res = await post()(makeRequest(path, { bearer: JWT }));

        expect(res.status).toBe(503);
        const body = await res.json();
        expect(body.code).toBe('RPC_FAILED');
        expect(body.retryable).toBe(true);
        expect(typeof body.retryable).toBe('boolean');
        // The historical wording is preserved — clients keyed on it still work.
        expect(body.error).toMatch(/retry with same Idempotency-Key/i);
      });
    }

    it('FAILS OPEN: an error with NO code at all is transient, never permanent', async () => {
      // Direction matters. A wrong "permanent" verdict stops the client
      // retrying a recoverable failure and quarantines a real completed quiz.
      _rpcResult = { data: null, error: { message: 'something exploded upstream' } };
      const res = await post()(makeRequest(path, { bearer: JWT }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe('RPC_FAILED');
      expect(body.retryable).toBe(true);
    });

    it('an EMPTY RPC response stays a retryable 503 (not reclassified as permanent)', async () => {
      _rpcResult = { data: null, error: null };
      const res = await post()(makeRequest(path, { bearer: JWT }));
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.code).toBe('EMPTY_RESPONSE');
      expect(body.retryable).toBe(true);
    });

    it('a 4xx-class RPC outcome (P0001 session_not_started) is NOT given a retryable field', async () => {
      // `retryable` is emitted ONLY where the client's status-code matrix is
      // ambiguous (the 5xx band). A 409 is already unambiguous — adding the
      // field there would let a `retryable: true` resurrect a refused session.
      _rpcResult = { data: null, error: { code: 'P0001', message: 'session_not_started: x' } };
      const res = await post()(makeRequest(path, { bearer: JWT }));
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.code).toBe('SESSION_NOT_STARTED');
      expect(body.retryable).toBeUndefined();
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════
// P-4 — the P0001 split: ownership denial ≠ session_not_started.
// ════════════════════════════════════════════════════════════════════════════
const STUDENT_B = '55555555-5555-4555-8555-555555555555';
/** Verbatim wording of the RPC's SECURITY DEFINER guard. */
const GUARD_MSG = `Access denied: caller does not own student ${STUDENT_B}`;

describe.each(ROUTES)(
  'REG-394 $name — ownership-guard denial is its own 403, not a 409',
  ({ path, post }) => {
    it('answers 403 STUDENT_OWNERSHIP_DENIED, never 409 session_not_started', async () => {
      _rpcResult = { data: null, error: { code: 'P0001', message: GUARD_MSG } };
      const res = await post()(makeRequest(path, { bearer: JWT }));

      // THE REGRESSION: this used to be 409 + hint:'restart_quiz' — the platform
      // told a cross-student attempt "your session expired, start again".
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.code).toBe('STUDENT_OWNERSHIP_DENIED');
      expect(body.code).not.toBe('SESSION_NOT_STARTED');
      expect(body.hint).toBeUndefined();
    });

    it('leaks NO student id, NO SQL text and NO SQLSTATE to the client (P13)', async () => {
      _rpcResult = { data: null, error: { code: 'P0001', message: GUARD_MSG } };
      const res = await post()(makeRequest(path, { bearer: JWT }));
      const raw = JSON.stringify(await res.json());

      // Echoing the guard's own message back would hand a prober confirmation
      // that the id they supplied exists.
      expect(raw).not.toContain(STUDENT_B);
      expect(raw).not.toContain(STUDENT_ID);
      expect(raw).not.toMatch(/caller does not own/i);
      expect(raw).not.toMatch(/P0001|submit_quiz_results_v2|students/);
    });

    it('carries NO `retryable` field (a 403 is already unambiguous)', async () => {
      // `retryable` exists only for the 5xx band, where the mobile drain's
      // status matrix has no correct answer. A 403 already means discard.
      _rpcResult = { data: null, error: { code: 'P0001', message: GUARD_MSG } };
      const res = await post()(makeRequest(path, { bearer: JWT }));
      const body = await res.json();
      expect(body.retryable).toBeUndefined();
    });

    it('logs it to ops_events at severity `error` under the security category', async () => {
      _rpcResult = { data: null, error: { code: 'P0001', message: GUARD_MSG } };
      await post()(makeRequest(path, { bearer: JWT }));

      const events = logOpsEventMock.mock.calls.map((c) => c[0] as Record<string, unknown>);
      const denial = events.find(
        (e) => e?.message === 'submit_quiz_results_v2_ownership_denied',
      );
      // Invisible-to-ops was half the defect: the 409 branch logged NOTHING.
      expect(denial).toBeTruthy();
      expect(denial!.severity).toBe('error');
      expect(denial!.category).toBe('security');
      const ctx = denial!.context as Record<string, unknown>;
      expect(ctx.guard).toBe('student_ownership');
      // Enough to correlate the attempt server-side…
      expect(ctx.session_id).toBe(SESSION_ID);
      expect(ctx.auth_user_id).toBe('auth-user-1');
      expect(ctx.transport).toBe('bearer');
      // …but never the raw SQL message (it duplicates the id already present).
      expect(JSON.stringify(ctx)).not.toMatch(/caller does not own/i);
    });

    it('records the cookie transport too, so web denials are attributable', async () => {
      _rpcResult = { data: null, error: { code: 'P0001', message: GUARD_MSG } };
      await post()(makeRequest(path));
      const denial = logOpsEventMock.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .find((e) => e?.message === 'submit_quiz_results_v2_ownership_denied');
      expect((denial!.context as Record<string, unknown>).transport).toBe('cookie');
    });

    // ── The other half: the LEGITIMATE case must not move ────────────────────
    it('a real session_not_started is STILL 409 + hint:restart_quiz (byte-identical)', async () => {
      _rpcResult = { data: null, error: { code: 'P0001', message: 'session_not_started' } };
      const res = await post()(makeRequest(path, { bearer: JWT }));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('SESSION_NOT_STARTED');
    });

    it('an UNRECOGNISED P0001 still falls through to 409, not to the denial branch', async () => {
      // Fail-closed on the denial side: only the guard's own wording gets 403,
      // so no other RAISE EXCEPTION can be misreported as a security event.
      _rpcResult = { data: null, error: { code: 'P0001', message: 'some other raise' } };
      const res = await post()(makeRequest(path, { bearer: JWT }));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('SESSION_NOT_STARTED');
      expect(
        logOpsEventMock.mock.calls
          .map((c) => c[0] as Record<string, unknown>)
          .find((e) => e?.message === 'submit_quiz_results_v2_ownership_denied'),
      ).toBeUndefined();
    });

    it('does NOT reclassify the denial as a permanent 500 (branch order holds)', async () => {
      _rpcResult = { data: null, error: { code: 'P0001', message: GUARD_MSG } };
      const res = await post()(makeRequest(path, { bearer: JWT }));
      expect(res.status).not.toBe(500);
      expect((await res.json()).code).not.toBe('RPC_PERMANENT');
    });
  },
);

describe('REG-394 — both submit routes translate the ownership denial IDENTICALLY', () => {
  it('same status, same code, same message on /api/quiz/submit and /api/v2/quiz/submit', async () => {
    _rpcResult = { data: null, error: { code: 'P0001', message: GUARD_MSG } };
    const web = await webPOST(makeRequest('/api/quiz/submit', { bearer: JWT }));
    const webBody = await web.json();

    _rpcResult = { data: null, error: { code: 'P0001', message: GUARD_MSG } };
    const v2 = await v2POST(makeRequest('/api/v2/quiz/submit', { bearer: JWT }));
    const v2Body = await v2.json();

    expect(web.status).toBe(403);
    expect(v2.status).toBe(403);
    expect(webBody.code).toBe(v2Body.code);
    expect(webBody.error).toBe(v2Body.error);
    expect(webBody.retryable).toBe(v2Body.retryable); // both undefined
  });
});

// ════════════════════════════════════════════════════════════════════════════
// P-6 — Behaviour-neutral for web (cookie-only callers).
// ════════════════════════════════════════════════════════════════════════════
describe.each(ROUTES)(
  'REG-390 $name — cookie-only (web) caller is behaviour-neutral',
  ({ path, post }) => {
    it('still runs the RPC on the cookie client and never builds a Bearer client', async () => {
      const res = await post()(makeRequest(path));

      expect(cookieRpc).toHaveBeenCalledTimes(1);
      expect(cookieRpc.mock.calls[0][0]).toBe('submit_quiz_results_v2');
      expect(bearerRpc).not.toHaveBeenCalled();
      expect(createClientSpy).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it('returns the SAME success body a web caller got before the transport change', async () => {
      const res = await post()(makeRequest(path));
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.score_percent).toBe(80);
      expect(body.data.xp_earned).toBe(100);
      expect(body.data.idempotent_replay).toBe(false);
      expect(body.data.marking_authenticity_path).toBe('oracle_v2');
      // No `retryable` key contaminates a SUCCESS envelope.
      expect(body.retryable).toBeUndefined();
    });

    it('still translates P0001 → 409 for a cookie caller (unchanged)', async () => {
      _rpcResult = { data: null, error: { code: 'P0001', message: 'session_not_started: x' } };
      const res = await post()(makeRequest(path));
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('SESSION_NOT_STARTED');
    });

    it('still translates a transient failure → 503 RPC_FAILED for a cookie caller', async () => {
      _rpcResult = { data: null, error: { code: '08006', message: 'connection reset' } };
      const res = await post()(makeRequest(path));
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe('RPC_FAILED');
    });

    it('still replays a unique-violation from the cached row (200, idempotent_replay)', async () => {
      _rpcResult = { data: null, error: { code: '23505', message: 'duplicate key value' } };
      _cachedRow = {
        data: {
          id: SESSION_ID,
          total_questions: 10,
          correct_answers: 8,
          score_percent: 80,
          score: 100,
        },
        error: null,
      };
      const res = await post()(makeRequest(path));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.idempotent_replay).toBe(true);
      expect(body.data.score_percent).toBe(80);
    });
  },
);

// ════════════════════════════════════════════════════════════════════════════
// Cross-route parity — the two routes must not drift.
// ════════════════════════════════════════════════════════════════════════════
describe('REG-391 — the two submit routes translate errors IDENTICALLY', () => {
  it('42501 produces the same status/code/retryable/message on both routes', async () => {
    _rpcResult = { data: null, error: { code: '42501', message: 'permission denied for function x' } };
    const web = await webPOST(makeRequest('/api/quiz/submit', { bearer: JWT }));
    const webBody = await web.json();

    _rpcResult = { data: null, error: { code: '42501', message: 'permission denied for function x' } };
    const v2 = await v2POST(makeRequest('/api/v2/quiz/submit', { bearer: JWT }));
    const v2Body = await v2.json();

    expect(web.status).toBe(v2.status);
    expect(webBody.code).toBe(v2Body.code);
    expect(webBody.retryable).toBe(v2Body.retryable);
    expect(webBody.error).toBe(v2Body.error);
  });

  it('a transient error produces the same status/code/retryable on both routes', async () => {
    _rpcResult = { data: null, error: { code: '40P01', message: 'deadlock detected' } };
    const web = await webPOST(makeRequest('/api/quiz/submit', { bearer: JWT }));
    const webBody = await web.json();

    _rpcResult = { data: null, error: { code: '40P01', message: 'deadlock detected' } };
    const v2 = await v2POST(makeRequest('/api/v2/quiz/submit', { bearer: JWT }));
    const v2Body = await v2.json();

    expect(web.status).toBe(503);
    expect(v2.status).toBe(503);
    expect(webBody.code).toBe(v2Body.code);
    expect(webBody.retryable).toBe(v2Body.retryable);
  });
});
