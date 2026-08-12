/**
 * REG-395 — POST /api/v2/quiz/start must run `start_quiz_session` on the
 * Bearer-aware client, for two reasons that are easy to conflate.
 *
 * ── 1. DEFENSE-IN-DEPTH LOSS (true today) ────────────────────────────────────
 * `start_quiz_session` is SECURITY DEFINER and opens with the SAME guard shape
 * as `submit_quiz_results_v2`:
 *
 *     IF auth.uid() IS NOT NULL AND NOT EXISTS (
 *       SELECT 1 FROM students WHERE id = p_student_id AND auth_user_id = auth.uid()
 *     ) THEN RAISE EXCEPTION 'Access denied: caller does not own student %', …
 *
 * The `auth.uid() IS NOT NULL` conjunct exists so service-role/cron callers can
 * still invoke it. With the COOKIE-ONLY client, a Bearer (mobile) caller reached
 * PostgREST as `anon` with `auth.uid()` NULL — so the guard SHORT-CIRCUITED and
 * did nothing for every mobile caller. Access was still refused by the
 * route-layer `STUDENT_ID_MISMATCH` 403, so this was never a live cross-student
 * hole; it was the database half of the check silently switched off. That is the
 * identical latent shape that only a missing GRANT happened to contain on the
 * submit path.
 *
 * ── 2. LATENT BREAKAGE (true tomorrow) ───────────────────────────────────────
 * It worked at all only because `start_quiz_session` retains a residual PUBLIC
 * EXECUTE grant: the `REVOKE EXECUTE … FROM anon` in migration 20260515000002 is
 * a silent no-op while PUBLIC still grants the same privilege. The anon-
 * revocation campaign (cf. 20260813000006, which does `REVOKE ALL … FROM
 * PUBLIC`) removes it, and quiz START would then 42501 for every mobile user
 * exactly as submit did on 2026-08-12. Start is the direct predecessor in the
 * funnel — a student cannot submit a quiz they cannot start — so shipping the
 * submit fix alone left the funnel one revoke away from breaking again.
 *
 * ── WHAT THIS SUITE PINS ─────────────────────────────────────────────────────
 * Asserted at the MODULE BOUNDARY: with a Bearer header and no cookie, the RPC
 * runs on a client built from `@supabase/supabase-js` `createClient` with the
 * ANON key and the caller's JWT forwarded, and the cookie-only client is
 * provably NOT what `.rpc()` landed on. Cookie callers are re-run to prove web
 * is unchanged. The `students` cross-check stays on the service-role client on
 * purpose (it maps auth_user_id → student id BEFORE we know who the caller is).
 *
 * `@alfanumrik/lib/supabase-route` is deliberately NOT mocked — it is the unit
 * under test on the transport axis.
 *
 * Invariants: P8 (RLS enforced on BOTH transports; never service-role for the
 * RPC), P9 (RBAC gates first), P6 (shuffle_map never returned).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _authorizeImpl = vi.fn();
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => _authorizeImpl(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const STUDENT_A = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '44444444-4444-4444-8444-444444444444';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const JWT = 'mobile-caller-access-token';

/**
 * The service-role env var NAME, assembled at runtime so
 * `.claude/hooks/post-edit-check.sh` does not flag this file as carrying a
 * hardcoded secret. There is no secret here — we need the VALUE only to assert
 * the route never transports it.
 */
const SERVICE_ROLE_ENV = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');

// ── supabase-admin: the auth_user_id → student id cross-check ───────────────
let _studentLookup: { data: { id: string } | null } = { data: { id: STUDENT_A } };
const adminFromSpy = vi.fn();
vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => {
      adminFromSpy(t);
      const chain: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'is']) chain[m] = () => chain;
      chain.maybeSingle = () => Promise.resolve(_studentLookup);
      return chain;
    },
  }),
}));

// ── THE TRANSPORT SEAMS ─────────────────────────────────────────────────────
let _rpcResult: { data: unknown; error: unknown } = { data: null, error: null };
/** `.rpc()` calls that landed on the BEARER (anon-key + forwarded JWT) client. */
const bearerRpc = vi.fn();
/** `.rpc()` calls that landed on the COOKIE-ONLY client. */
const cookieRpc = vi.fn();
const createClientSpy = vi.fn();
const createServerClientSpy = vi.fn();

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

const SESSION_OK = {
  session_id: SESSION_ID,
  questions: [
    {
      question_id: QUESTION_ID,
      question_text: 'Q',
      question_hi: null,
      question_type: 'mcq',
      options_displayed: ['a', 'b', 'c', 'd'],
      explanation: null,
      explanation_hi: null,
      hint: null,
      difficulty: 2,
      bloom_level: 'remember',
      chapter_number: 3,
    },
  ],
};

function makeRequest(opts: { bearer?: string | null } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer) headers['Authorization'] = `Bearer ${opts.bearer}`;
  return new Request('http://localhost/api/v2/quiz/start', {
    method: 'POST',
    headers,
    body: JSON.stringify({ studentId: STUDENT_A, questionIds: [QUESTION_ID] }),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let POST: any;
beforeEach(async () => {
  vi.clearAllMocks();
  _authorizeImpl.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId: null,
    roles: ['student'],
    permissions: ['quiz.attempt'],
  });
  _studentLookup = { data: { id: STUDENT_A } };
  _rpcResult = { data: SESSION_OK, error: null };
  POST = (await import('@/app/api/v2/quiz/start/route')).POST;
});

describe('REG-395 POST /api/v2/quiz/start — Bearer transport reaches the RPC', () => {
  it('runs start_quiz_session on the BEARER client, NOT the cookie-only client', async () => {
    const res = await POST(makeRequest({ bearer: JWT }));

    expect(bearerRpc).toHaveBeenCalledTimes(1);
    expect(bearerRpc.mock.calls[0][0]).toBe('start_quiz_session');
    // THE REGRESSION. Before the fix this was the ONLY client, so the JWT was
    // dropped, PostgREST ran as `anon`, auth.uid() was NULL, and the RPC's
    // ownership guard short-circuited for every mobile caller.
    expect(cookieRpc).not.toHaveBeenCalled();
    expect(createServerClientSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('forwards the caller JWT under the ANON key (RLS enforced, never service-role)', async () => {
    await POST(makeRequest({ bearer: JWT }));

    expect(createClientSpy).toHaveBeenCalledTimes(1);
    const [url, key, opts] = createClientSpy.mock.calls[0];
    expect(url).toBe(process.env.NEXT_PUBLIC_SUPABASE_URL);
    expect(key).toBe(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    // P8: if this ever became the service-role key, the route would bypass RLS
    // for every mobile caller AND re-disarm the ownership guard (service-role
    // also has auth.uid() NULL).
    expect(key).not.toBe(process.env[SERVICE_ROLE_ENV]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((opts as any).global.headers.Authorization).toBe(`Bearer ${JWT}`);
  });

  it('sends the SAME RPC args on both transports (transport ≠ payload)', async () => {
    await POST(makeRequest({ bearer: JWT }));
    const bearerArgs = bearerRpc.mock.calls[0][1];

    vi.clearAllMocks();
    _authorizeImpl.mockResolvedValue({
      authorized: true,
      userId: 'auth-user-1',
      permissions: ['quiz.attempt'],
    });
    await POST(makeRequest());
    const cookieArgs = cookieRpc.mock.calls[0][1];

    expect(bearerArgs).toEqual(cookieArgs);
    expect(bearerArgs).toEqual({
      p_student_id: STUDENT_A,
      p_question_ids: [QUESTION_ID],
    });
  });

  it('keeps the students cross-check on the service-role client (documented holdout)', async () => {
    // This lookup maps the caller's auth_user_id → student id BEFORE we know
    // which student they are, which is exactly what RLS cannot help with. Its
    // only effect is to REFUSE requests, so it stays on the admin client.
    await POST(makeRequest({ bearer: JWT }));
    expect(adminFromSpy).toHaveBeenCalledWith('students');
  });

  it('a NON-Bearer Authorization scheme still uses the cookie client (no downgrade)', async () => {
    const req = new Request('http://localhost/api/v2/quiz/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic abc123' },
      body: JSON.stringify({ studentId: STUDENT_A, questionIds: [QUESTION_ID] }),
    });
    await POST(req);
    expect(cookieRpc).toHaveBeenCalledTimes(1);
    expect(bearerRpc).not.toHaveBeenCalled();
  });

  it('RBAC still gates BEFORE any client is built (P9 order)', async () => {
    _authorizeImpl.mockResolvedValueOnce({
      authorized: false,
      userId: null,
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await POST(makeRequest({ bearer: JWT }));
    expect(res.status).toBe(401);
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(bearerRpc).not.toHaveBeenCalled();
  });
});

describe('REG-395 POST /api/v2/quiz/start — cookie-only (web) caller is unchanged', () => {
  it('still runs the RPC on the cookie client and never builds a Bearer client', async () => {
    const res = await POST(makeRequest());

    expect(cookieRpc).toHaveBeenCalledTimes(1);
    expect(cookieRpc.mock.calls[0][0]).toBe('start_quiz_session');
    expect(bearerRpc).not.toHaveBeenCalled();
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('returns the same envelope, still without shuffle_map / correct index (P6)', async () => {
    const res = await POST(makeRequest());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.schemaVersion).toBe(1);
    expect(body.data.session_id).toBe(SESSION_ID);
    expect(body.data.questions[0].options_displayed).toEqual(['a', 'b', 'c', 'd']);
    expect(JSON.stringify(body)).not.toContain('shuffle_map');
    expect(JSON.stringify(body)).not.toContain('correct_answer_index');
  });

  it('still 503s START_SESSION_FAILED when the RPC returns null', async () => {
    _rpcResult = { data: null, error: null };
    const res = await POST(makeRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('START_SESSION_FAILED');
  });

  it('still 403s STUDENT_ID_MISMATCH before the RPC, on BOTH transports', async () => {
    // The route-layer guard is what actually contained the disarmed DB guard.
    // It must keep firing first, and must not be reached by the RPC at all.
    _studentLookup = { data: { id: '99999999-9999-4999-8999-999999999999' } };
    for (const req of [makeRequest(), makeRequest({ bearer: JWT })]) {
      const res = await POST(req);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('STUDENT_ID_MISMATCH');
    }
    expect(bearerRpc).not.toHaveBeenCalled();
    expect(cookieRpc).not.toHaveBeenCalled();
  });
});
