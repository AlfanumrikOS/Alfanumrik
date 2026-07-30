/**
 * GET /api/usage/daily — contract tests.
 *
 * This route exists so the client can DISPLAY the number the server ENFORCES.
 * It is a thin read-through to `get_plan_limit()` — the same RPC
 * `check_and_record_usage()` derives its cap from, and which has honoured school
 * (B2B) coverage since migration 20260729130400.
 *
 * Pinned here:
 *   1. It creates NO limit authority of its own — the response `limit` is
 *      exactly what `get_plan_limit` returned, school boost included.
 *   2. CONSERVATIVE FALLBACK: on any failure to resolve the authoritative
 *      number it returns 503 with NO data. It must never fabricate a generous
 *      cap (that would let the client over-promise, the mirror image of the
 *      demo defect).
 *   3. An unsupported feature is rejected BEFORE reaching get_plan_limit, whose
 *      ELSE arm returns the generous ai_calls_total cap.
 *   4. TENANT SAFETY (P8/P13): the student is resolved strictly from the
 *      caller's own auth identity; a request-supplied studentId is ignored.
 *   5. READ-ONLY (P12): it never records usage, so it cannot let a student
 *      exceed the enforced cap.
 *
 * P13: synthetic ids only.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── RBAC ──────────────────────────────────────────────────────────────────────

const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorize(...a),
}));

// ── Recording admin client ────────────────────────────────────────────────────

const CALLER_STUDENT_ID = 'student-caller-1';
const OTHER_STUDENT_ID = 'student-someone-else-2';

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

const rpcCalls: RpcCall[] = [];
const tableReads: string[] = [];

let rpcResult: { data: unknown; error: unknown } = { data: 5, error: null };
let usageResult: { data: unknown; error: unknown } = {
  data: { usage_count: 0 },
  error: null,
};

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  const makeBuilder = (table: string) => {
    tableReads.push(table);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {
      select: () => b,
      eq: () => b,
      maybeSingle: () => Promise.resolve(usageResult),
      single: () => Promise.resolve(usageResult),
      then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
        Promise.resolve(usageResult).then(onF, onR),
    };
    return b;
  };
  const client = {
    from: (t: string) => makeBuilder(t),
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(rpcResult);
    },
  };
  return { supabaseAdmin: client, getSupabaseAdmin: () => client };
});

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { GET } from '@/app/api/usage/daily/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(query = 'feature=foxy_chat'): NextRequest {
  return new NextRequest(`http://localhost/api/usage/daily?${query}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer test-token' },
  });
}

function setAuthorized(studentId: string | null = CALLER_STUDENT_ID) {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    studentId,
    roles: ['student'],
    permissions: ['foxy.chat', 'quiz.attempt'],
  });
}

function setUnauthorized(status = 401, code = 'AUTH_REQUIRED') {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    errorResponse: new Response(JSON.stringify({ success: false, code }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  tableReads.length = 0;
  rpcResult = { data: 5, error: null };
  usageResult = { data: { usage_count: 0 }, error: null };
  setAuthorized();
});

// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/usage/daily — reads the enforcement authority', () => {
  it('returns the get_plan_limit value verbatim, with no local arithmetic', async () => {
    rpcResult = { data: 999999, error: null };
    usageResult = { data: { usage_count: 12 }, error: null };

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.limit).toBe(999999);
    expect(body.data.count).toBe(12);
    expect(body.data.remaining).toBe(999999 - 12);
    expect(body.data.allowed).toBe(true);
    expect(body.data.feature).toBe('foxy_chat');
  });

  it('calls get_plan_limit — the same RPC check_and_record_usage derives its cap from', async () => {
    await GET(makeRequest());
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].name).toBe('get_plan_limit');
    expect(rpcCalls[0].args).toEqual({
      p_student_id: CALLER_STUDENT_ID,
      p_feature: 'foxy_chat',
    });
  });

  it('a school-covered student gets the boosted number with no special-casing in the route', async () => {
    // get_plan_limit returns GREATEST(personal, school). The route just relays it.
    rpcResult = { data: 999999, error: null };
    const body = await (await GET(makeRequest())).json();
    expect(body.data.limit).toBe(999999);
    // The free-tier 5 must not appear anywhere.
    expect(body.data.limit).not.toBe(5);
  });

  it('maps feature=quiz to the quiz cap', async () => {
    rpcResult = { data: 20, error: null };
    const body = await (await GET(makeRequest('feature=quiz'))).json();
    expect(rpcCalls[0].args.p_feature).toBe('quiz');
    expect(body.data.limit).toBe(20);
    expect(body.data.feature).toBe('quiz');
  });

  it('defaults to foxy_chat when no feature is supplied', async () => {
    await GET(makeRequest(''));
    expect(rpcCalls[0].args.p_feature).toBe('foxy_chat');
  });

  it('reports allowed=false once the count reaches the limit', async () => {
    rpcResult = { data: 5, error: null };
    usageResult = { data: { usage_count: 5 }, error: null };
    const body = await (await GET(makeRequest())).json();
    expect(body.data.remaining).toBe(0);
    expect(body.data.allowed).toBe(false);
  });

  it('remaining never goes negative even if the count has overshot', async () => {
    rpcResult = { data: 5, error: null };
    usageResult = { data: { usage_count: 9 }, error: null };
    const body = await (await GET(makeRequest())).json();
    expect(body.data.remaining).toBe(0);
    expect(body.data.allowed).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/usage/daily — conservative fallback (never over-promise)', () => {
  it('returns 503 with NO data when get_plan_limit errors', async () => {
    rpcResult = { data: null, error: { message: 'rpc exploded' } };
    const res = await GET(makeRequest());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
  });

  it('returns 503 when get_plan_limit returns a non-numeric value — no guessed cap', async () => {
    for (const bad of [null, undefined, 'unlimited', {}, []]) {
      rpcCalls.length = 0;
      rpcResult = { data: bad, error: null };
      const res = await GET(makeRequest());
      expect(res.status, JSON.stringify(bad)).toBe(503);
      const body = await res.json();
      expect(body.data).toBeUndefined();
    }
  });

  it('never emits a fabricated generous number on ANY failure path', async () => {
    const failures: Array<{ data: unknown; error: unknown }> = [
      { data: null, error: { message: 'boom' } },
      { data: undefined, error: null },
      { data: 'lots', error: null },
    ];
    for (const f of failures) {
      rpcResult = f;
      const res = await GET(makeRequest());
      const text = await res.text();
      expect(res.status).toBe(503);
      expect(text).not.toContain('999999');
      expect(text).not.toMatch(/"limit"/);
    }
  });

  it('rejects an unsupported feature BEFORE auth or any RPC (get_plan_limit ELSE arm is generous)', async () => {
    const res = await GET(makeRequest('feature=notes'));
    expect(res.status).toBe(400);
    expect(rpcCalls.length).toBe(0);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it('rejects a typo\'d feature name rather than forwarding it', async () => {
    // Note the empty-string case: `?feature=` yields '' (not null), so the
    // `?? 'foxy_chat'` default does NOT apply and the request fails closed with
    // a 400. That is the conservative direction — a present-but-blank feature is
    // ambiguous and must not silently resolve to a cap.
    for (const bad of ['foxy_chatt', 'ai_total', 'notes', 'FOXY_CHAT', '']) {
      rpcCalls.length = 0;
      const res = await GET(makeRequest(`feature=${bad}`));
      expect(res.status, `feature="${bad}"`).toBe(400);
      expect(rpcCalls.length).toBe(0);
    }
  });

  it('a usage-row read ERROR still yields 200 with count 0 (the server-side gate is the real stop)', async () => {
    usageResult = { data: null, error: { message: 'usage read failed' } };
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.count).toBe(0);
  });

  it('a missing usage row means "no usage yet", not an error', async () => {
    usageResult = { data: null, error: null };
    const body = await (await GET(makeRequest())).json();
    expect(body.data.count).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

/**
 * PROTOTYPE-CHAIN POLLUTION IN THE FEATURE LOOKUP.
 *
 * The feature→permission table used to be a plain object literal typed
 * `Record<string, string>`. A plain object inherits `Object.prototype`, so
 * `TABLE['toString']` resolved to a FUNCTION, `TABLE['__proto__']` to an OBJECT
 * — both truthy. The `if (!permission)` guard therefore did NOT reject them and
 * a caller-controlled query string walked straight past input validation.
 *
 * Traced consequence (why this was a 500, not just a cosmetic miss): for a
 * student caller the non-string permission matches no granted code, so
 * `authorizeRequest` takes its DENY branch — and there
 * `requiredPermission.split('.')[0]` (rbac.ts:785) throws a TypeError on a
 * function/object. That call sits OUTSIDE this route's try block, so it escaped
 * as an unhandled 500 instead of the clean 400 the guard was written to produce.
 *
 * No cross-student exposure, no quota bypass, no write — but an
 * unauthenticated-shaped 500 on a student-facing route is a bad surface, and the
 * lookup must only ever honour OWN properties.
 *
 * `noUncheckedIndexedAccess` is off in apps/host/tsconfig.json, so
 * `Record<string, string>` indexing types as a non-optional `string`. TypeScript
 * believed the guard was redundant and gave no signal. A `Map` types `.get()` as
 * `string | undefined`, which is why the fix is structural rather than a guard.
 */
const PROTOTYPE_KEYS = [
  'toString',
  'constructor',
  '__proto__',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
];

describe('GET /api/usage/daily — feature lookup honours OWN properties only', () => {
  it('rejects every Object.prototype key with a clean 400, before auth or any DB work', async () => {
    for (const key of PROTOTYPE_KEYS) {
      rpcCalls.length = 0;
      tableReads.length = 0;
      mockAuthorize.mockClear();

      const res = await GET(makeRequest(`feature=${encodeURIComponent(key)}`));

      expect(res.status, `feature="${key}" must be 400`).toBe(400);
      const body = await res.json();
      expect(body.success, `feature="${key}"`).toBe(false);
      expect(body.data, `feature="${key}" must carry no data`).toBeUndefined();

      // The whole point of validating first: nothing downstream may run.
      expect(mockAuthorize, `feature="${key}" must not reach auth`).not.toHaveBeenCalled();
      expect(rpcCalls.length, `feature="${key}" must not reach get_plan_limit`).toBe(0);
      expect(tableReads.length, `feature="${key}" must not read the DB`).toBe(0);
    }
  });

  it('never 500s on a prototype-key feature, even with a faithful rbac deny path', async () => {
    // Model rbac.ts:785 exactly: on the deny branch it calls
    // `requiredPermission.split('.')[0]`, which throws a TypeError for any
    // non-string. If the route ever forwards a prototype value again, this mock
    // reproduces the real unhandled 500 rather than hiding it behind a stub.
    mockAuthorize.mockImplementation(async (_req: unknown, requiredPermission: unknown) => {
      if (typeof requiredPermission !== 'string') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (requiredPermission as any).split('.');
      }
      return {
        authorized: true,
        userId: 'auth-user-1',
        studentId: CALLER_STUDENT_ID,
        roles: ['student'],
        permissions: ['foxy.chat', 'quiz.attempt'],
      };
    });

    for (const key of PROTOTYPE_KEYS) {
      const res = await GET(makeRequest(`feature=${encodeURIComponent(key)}`));
      expect(res.status, `feature="${key}" must not 500`).not.toBe(500);
      expect(res.status, `feature="${key}"`).toBe(400);
    }
  });

  it('the two real features still resolve — the fix rejects inherited keys, not own ones', async () => {
    for (const [feature, permission] of [
      ['foxy_chat', 'foxy.chat'],
      ['quiz', 'quiz.attempt'],
    ]) {
      mockAuthorize.mockClear();
      rpcCalls.length = 0;
      const res = await GET(makeRequest(`feature=${feature}`));
      expect(res.status, `feature="${feature}"`).toBe(200);
      expect(mockAuthorize.mock.calls[0][1]).toBe(permission);
      expect(rpcCalls[0].args.p_feature).toBe(feature);
    }
  });

  it('a prototype key can never reach get_plan_limit, whose ELSE arm is generous', async () => {
    // The original reason for validating first: get_plan_limit's ELSE branch
    // returns the wide ai_calls_total cap, so ANY unrecognised feature reaching
    // it would over-promise.
    for (const key of PROTOTYPE_KEYS) {
      rpcCalls.length = 0;
      await GET(makeRequest(`feature=${encodeURIComponent(key)}`));
      expect(rpcCalls.map((c) => c.args.p_feature), `feature="${key}"`).not.toContain(key);
      expect(rpcCalls.length).toBe(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/usage/daily — auth and tenant safety (P8/P9/P13)', () => {
  it('returns 401 when unauthenticated, and performs no DB work', async () => {
    setUnauthorized(401);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    expect(rpcCalls.length).toBe(0);
    expect(tableReads.length).toBe(0);
  });

  it('returns 403 when the caller lacks the feature permission', async () => {
    setUnauthorized(403, 'NO_PERMISSION');
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(rpcCalls.length).toBe(0);
  });

  it('authorizes against the permission matching the requested feature', async () => {
    await GET(makeRequest('feature=foxy_chat'));
    expect(mockAuthorize.mock.calls[0][1]).toBe('foxy.chat');

    mockAuthorize.mockClear();
    await GET(makeRequest('feature=quiz'));
    expect(mockAuthorize.mock.calls[0][1]).toBe('quiz.attempt');
  });

  it('returns 404 when the caller has no student profile', async () => {
    setAuthorized(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(404);
    expect(rpcCalls.length).toBe(0);
  });

  it('IGNORES a request-supplied studentId — a caller can only read their OWN quota', async () => {
    await GET(makeRequest(`feature=foxy_chat&studentId=${OTHER_STUDENT_ID}&student_id=${OTHER_STUDENT_ID}`));
    expect(rpcCalls.length).toBe(1);
    expect(rpcCalls[0].args.p_student_id).toBe(CALLER_STUDENT_ID);
    expect(rpcCalls[0].args.p_student_id).not.toBe(OTHER_STUDENT_ID);
  });

  it('the response body carries no PII and no student identifier (P13)', async () => {
    const res = await GET(makeRequest());
    const text = await res.text();
    expect(text).not.toContain(CALLER_STUDENT_ID);
    expect(text).not.toMatch(/email|phone|"name"|school_id|student_id/i);
    const body = JSON.parse(text);
    expect(Object.keys(body.data).sort()).toEqual(
      ['allowed', 'count', 'feature', 'limit', 'remaining'].sort()
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/usage/daily — read-only (P12)', () => {
  it('never calls check_and_record_usage or any recording RPC', async () => {
    await GET(makeRequest());
    for (const call of rpcCalls) {
      expect(call.name).not.toBe('check_and_record_usage');
      expect(call.name).not.toBe('record_ai_usage');
      expect(call.name).toBe('get_plan_limit');
    }
  });

  it('reads only the narrow student_daily_usage shape, never get_student_usage', async () => {
    await GET(makeRequest());
    expect(tableReads).toEqual(['student_daily_usage']);
    expect(rpcCalls.map((c) => c.name)).not.toContain('get_student_usage');
  });
});
