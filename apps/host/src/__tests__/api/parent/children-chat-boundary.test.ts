/**
 * /api/parent/children/[student_id]/chat — guardian Foxy-transcript P13 boundary.
 *
 * THE ARCHITECT-REQUESTED P13 REGRESSION (highest priority). This file is the
 * verification gate for the most sensitive surface in Phase 2 of the portal
 * RBAC/SaaS remediation: exposing a child's Foxy AI-tutor chat transcript to
 * their linked parent. It pins, as hard assertions, the four properties the
 * architect called out plus the keyset-pagination contract:
 *
 *   1. READ ONLY THE OWN APPROVED CHILD — when canAccessStudent() is true the
 *      route reads foxy_chat_messages scoped on `.eq('student_id', <child id>)`
 *      and ONLY that child's rows come back. The boundary call is keyed by the
 *      CALLER's auth id + the path student id (canAccessStudent(userId, childId)).
 *
 *   2. UNLINKED / PENDING GUARDIAN GETS 403 + ZERO ROWS — when
 *      canAccessStudent() is false (no link, or a pending-not-approved link),
 *      the route returns 403, the RLS-scoped read is NEVER issued (no transcript
 *      is ever assembled), and a `denied` audit row is written. (Defense in
 *      depth: even if the app gate were bypassed, the RLS policy from migration
 *      20260620000200 — is_guardian_of() requires status IN ('active','approved')
 *      — would itself return zero rows. We assert the app-gate behaviour here and
 *      the policy intent in the source/migration contract test below.)
 *
 *   3. NO GUARDIAN WRITE PATH — the route module exports GET only. There is no
 *      POST/PUT/PATCH/DELETE handler, and the route never calls .insert/.update/
 *      .delete/.upsert/.rpc. The guardian transcript view is strictly read-only.
 *
 *   4. NO STUDENT PAYLOAD ON ANY DENY PATH (P13) — the 401/400/403 bodies carry
 *      only the { success:false, error } envelope. No `data`, no `messages`, no
 *      message text, ever.
 *
 *   5. KEYSET PAGINATION (before → next_before) — the happy path returns
 *      page.{limit,has_more,next_before}; with limit+1 rows available, has_more
 *      is true and next_before is the created_at of the last returned (oldest-in-
 *      page) message, so the caller pages back in time by passing it as `before`.
 *      Passing `before` issues a `.lt('created_at', <iso>)` keyset filter.
 *
 * Mocking strategy mirrors the established parent-route pattern
 * (src/__tests__/api/parent/children-erasure / pulse-authorization): @alfanumrik/lib/rbac
 * is stubbed so authorizeRequest / canAccessStudent / logAudit are controllable
 * and observable, and @supabase/ssr's createServerClient is a tiny in-memory
 * query builder that records the filters applied so we can prove the student_id
 * scope and the keyset .lt() were issued — and prove the read was NEVER reached
 * on a deny path.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── Hoisted, controllable mock holders ────────────────────────────────
const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockCanAccess: vi.fn(),
  mockLogAudit: vi.fn(),
  // Records the last query the route built against foxy_chat_messages.
  lastQuery: {} as {
    table?: string;
    selectCols?: string;
    filters?: Array<{ op: string; col: string; val: unknown }>;
    orderCol?: string;
    orderAsc?: boolean;
    limit?: number;
  },
  // Rows the in-memory client returns, and an optional error.
  rows: [] as Array<Record<string, unknown>>,
  queryError: null as { message: string } | null,
  // True iff createServerClient().from('foxy_chat_messages') was reached.
  readReached: false,
  // Any forbidden mutation seam the route might (must not) touch.
  mutationsCalled: [] as string[],
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  canAccessStudent: (...a: unknown[]) => holders.mockCanAccess(...a),
  logAudit: (...a: unknown[]) => holders.mockLogAudit(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// next/headers cookies() — awaited in the route. Returns a minimal store.
vi.mock('next/headers', () => ({
  cookies: async () => ({
    getAll: () => [],
    setAll: () => {},
    get: () => undefined,
  }),
}));

// The RLS-scoped client. We build a chain that accumulates filters and only
// materialises on `await` (.then). This is the SAME lazy-chain pattern used by
// parent-child-export's supabase-admin mock, so the route's
//   .from(...).select(...).eq(...).order(...).limit(...)  (+ optional .lt(...))
// resolves correctly regardless of call order.
vi.mock('@supabase/ssr', () => {
  const buildChain = (table: string) => {
    holders.readReached = true;
    holders.lastQuery = { table, filters: [] };
    const exec = () =>
      Promise.resolve(
        holders.queryError
          ? { data: null, error: holders.queryError }
          : { data: holders.rows, error: null },
      );
    const chain: Record<string, unknown> = {
      select(cols: string) {
        holders.lastQuery.selectCols = cols;
        return chain;
      },
      eq(col: string, val: unknown) {
        holders.lastQuery.filters!.push({ op: 'eq', col, val });
        return chain;
      },
      lt(col: string, val: unknown) {
        holders.lastQuery.filters!.push({ op: 'lt', col, val });
        return chain;
      },
      order(col: string, opts: { ascending?: boolean }) {
        holders.lastQuery.orderCol = col;
        holders.lastQuery.orderAsc = opts?.ascending ?? true;
        return chain;
      },
      limit(n: number) {
        holders.lastQuery.limit = n;
        return chain;
      },
      // Forbidden mutation seams — recorded so we can prove they are never hit.
      insert() {
        holders.mutationsCalled.push('insert');
        return chain;
      },
      update() {
        holders.mutationsCalled.push('update');
        return chain;
      },
      delete() {
        holders.mutationsCalled.push('delete');
        return chain;
      },
      upsert() {
        holders.mutationsCalled.push('upsert');
        return chain;
      },
      then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
        return exec().then(onF, onR);
      },
    };
    return chain;
  };

  return {
    createServerClient: () => ({
      from: (t: string) => buildChain(t),
      rpc: (...a: unknown[]) => {
        holders.mutationsCalled.push(`rpc:${String(a[0])}`);
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
});

// ── Fixture IDs (valid RFC4122 v4) ────────────────────────────────────
const GUARDIAN_AUTH = '11111111-1111-4111-a111-111111111111';
const CHILD_OWN = '33333333-3333-4333-a333-333333333333';
const CHILD_OTHER = '44444444-4444-4444-a444-444444444444';

const SUPA_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-test-key',
};

function makeRequest(studentId: string, query = ''): Request {
  return new Request(
    `http://localhost/api/parent/children/${studentId}/chat${query}`,
    { method: 'GET', headers: { Authorization: 'Bearer fake.jwt.parent' } },
  );
}
function makeContext(studentId: string) {
  return { params: Promise.resolve({ student_id: studentId }) };
}

function authAsParent(userId: string = GUARDIAN_AUTH) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.view_progress'],
  });
}
function authFail(status: number) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ success: false, error: status === 401 ? 'Unauthorized' : 'Forbidden' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

/** P13 GUARD — a deny/empty body must carry NO transcript payload. */
function expectNoTranscriptPayload(body: Record<string, unknown>) {
  expect(body.success).toBe(false);
  expect(body.data).toBeUndefined();
  expect(body).not.toHaveProperty('messages');
  expect(body).not.toHaveProperty('page');
  // No chat text or role markers leak anywhere in the serialized body.
  const s = JSON.stringify(body);
  expect(s).not.toContain('assistant');
  expect(s).not.toContain('Photosynthesis'); // a sentinel chat term used below
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.lastQuery = {};
  holders.rows = [];
  holders.queryError = null;
  holders.readReached = false;
  holders.mutationsCalled = [];
  Object.assign(process.env, SUPA_ENV);
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Auth + boundary deny paths (P13: no payload, read never reached)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/parent/children/[id]/chat — auth + boundary (P13)', () => {
  it('returns the authorizeRequest errorResponse (401) when unauthenticated — no read, no payload', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authFail(401);
    const res = await GET(makeRequest(CHILD_OWN), makeContext(CHILD_OWN));
    expect(res.status).toBe(401);
    expect(holders.mockCanAccess).not.toHaveBeenCalled();
    expect(holders.readReached).toBe(false);
    expectNoTranscriptPayload(await res.json());
  });

  it('asks authorizeRequest for the child.view_progress permission', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent();
    holders.mockCanAccess.mockResolvedValue(true);
    await GET(makeRequest(CHILD_OWN), makeContext(CHILD_OWN));
    expect(holders.mockAuthorize).toHaveBeenCalledTimes(1);
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('child.view_progress');
  });

  it('returns 400 for a non-UUID student id — boundary not consulted, no read, no payload', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent();
    const res = await GET(makeRequest('not-a-uuid'), makeContext('not-a-uuid'));
    expect(res.status).toBe(400);
    expect(holders.mockCanAccess).not.toHaveBeenCalled();
    expect(holders.readReached).toBe(false);
    expectNoTranscriptPayload(await res.json());
  });

  it('UNLINKED guardian → 403, read never reached, denied audit, no payload', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(false); // no guardian_student_links row
    const res = await GET(makeRequest(CHILD_OTHER), makeContext(CHILD_OTHER));
    expect(res.status).toBe(403);

    // The boundary IS the gate and it was keyed by (caller auth, path child).
    expect(holders.mockCanAccess).toHaveBeenCalledWith(GUARDIAN_AUTH, CHILD_OTHER);
    // No transcript was ever read.
    expect(holders.readReached).toBe(false);

    // The denial is audited.
    expect(holders.mockLogAudit).toHaveBeenCalledTimes(1);
    const [auditUser, entry] = holders.mockLogAudit.mock.calls[0];
    expect(auditUser).toBe(GUARDIAN_AUTH);
    expect(entry.action).toBe('parent.child_chat_viewed');
    expect(entry.status).toBe('denied');
    expect(entry.resourceId).toBe(CHILD_OTHER);

    expectNoTranscriptPayload(await res.json());
  });

  it('PENDING-link guardian is the SAME deny as unlinked — 403, no read, no payload', async () => {
    // canAccessStudent encodes the approved/active requirement (is_guardian_of()
    // returns false for status NOT IN ('active','approved')). A pending link
    // therefore surfaces identically: canAccess=false → 403. This pins that a
    // not-yet-approved guardian cannot read the transcript.
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(false); // pending link → not approved
    const res = await GET(makeRequest(CHILD_OWN), makeContext(CHILD_OWN));
    expect(res.status).toBe(403);
    expect(holders.readReached).toBe(false);
    expectNoTranscriptPayload(await res.json());
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Happy path: reads ONLY the own approved child, RLS-scoped, no writes
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/parent/children/[id]/chat — approved-child read (P13/P8)', () => {
  it('reads foxy_chat_messages scoped to EXACTLY the path child_id and returns only its rows', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(true);
    holders.rows = [
      { id: 'm2', session_id: 'sess-1', role: 'assistant', content: 'Photosynthesis is...', created_at: '2026-06-14T10:01:00.000Z' },
      { id: 'm1', session_id: 'sess-1', role: 'user', content: 'What is photosynthesis?', created_at: '2026-06-14T10:00:00.000Z' },
    ];
    const res = await GET(makeRequest(CHILD_OWN), makeContext(CHILD_OWN));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Boundary keyed by (caller, child) and the RLS read happened.
    expect(holders.mockCanAccess).toHaveBeenCalledWith(GUARDIAN_AUTH, CHILD_OWN);
    expect(holders.readReached).toBe(true);
    expect(holders.lastQuery.table).toBe('foxy_chat_messages');

    // THE SCOPE PIN: a single student_id eq filter, equal to the path child.
    const studentFilters = holders.lastQuery.filters!.filter((f) => f.col === 'student_id');
    expect(studentFilters).toHaveLength(1);
    expect(studentFilters[0]).toEqual({ op: 'eq', col: 'student_id', val: CHILD_OWN });

    // Newest-first ordering on created_at.
    expect(holders.lastQuery.orderCol).toBe('created_at');
    expect(holders.lastQuery.orderAsc).toBe(false);

    // Payload returns exactly the seeded rows, mapped to {id,role,text,...}.
    expect(body.success).toBe(true);
    expect(body.data.student_id).toBe(CHILD_OWN);
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.messages[0]).toMatchObject({ id: 'm2', role: 'assistant', text: 'Photosynthesis is...', session_id: 'sess-1' });
  });

  it('writes a success audit row carrying only a metadata count (no message text)', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(true);
    holders.rows = [
      { id: 'm1', session_id: 's', role: 'user', content: 'secret child question', created_at: '2026-06-14T10:00:00.000Z' },
    ];
    await GET(makeRequest(CHILD_OWN), makeContext(CHILD_OWN));
    const success = holders.mockLogAudit.mock.calls.find((c) => c[1]?.status === 'success');
    expect(success).toBeDefined();
    const entry = success![1];
    expect(entry.action).toBe('parent.child_chat_viewed');
    expect(entry.resourceId).toBe(CHILD_OWN);
    expect(entry.details).toEqual({ message_count: 1 });
    // P13: the audit details NEVER carry the message body.
    expect(JSON.stringify(entry.details)).not.toContain('secret child question');
  });

  it('issues NO write/RPC against the RLS client — strictly read-only (no guardian write path)', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(true);
    holders.rows = [];
    await GET(makeRequest(CHILD_OWN), makeContext(CHILD_OWN));
    expect(holders.mutationsCalled).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Keyset pagination (before → next_before)
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/parent/children/[id]/chat — keyset pagination', () => {
  it('over-fetches limit+1 and reports has_more + next_before (= oldest returned created_at)', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(true);
    // Request limit=2; provide 3 rows (limit+1) so has_more is detected.
    holders.rows = [
      { id: 'm3', session_id: 's', role: 'assistant', content: 'c', created_at: '2026-06-14T10:02:00.000Z' },
      { id: 'm2', session_id: 's', role: 'user', content: 'b', created_at: '2026-06-14T10:01:00.000Z' },
      { id: 'm1', session_id: 's', role: 'assistant', content: 'a', created_at: '2026-06-14T10:00:00.000Z' },
    ];
    const res = await GET(makeRequest(CHILD_OWN, '?limit=2'), makeContext(CHILD_OWN));
    const body = await res.json();

    // Over-fetch by one to detect the next page.
    expect(holders.lastQuery.limit).toBe(3);
    // Only `limit` rows are returned; the +1 is consumed as the has_more probe.
    expect(body.data.messages).toHaveLength(2);
    expect(body.data.page.limit).toBe(2);
    expect(body.data.page.has_more).toBe(true);
    // next_before is the created_at of the LAST returned (oldest in page) row.
    expect(body.data.page.next_before).toBe('2026-06-14T10:01:00.000Z');
  });

  it('passing ?before applies a keyset .lt(created_at, iso) filter and pages strictly older', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(true);
    holders.rows = [];
    const before = '2026-06-14T10:01:00.000Z';
    await GET(makeRequest(CHILD_OWN, `?before=${encodeURIComponent(before)}`), makeContext(CHILD_OWN));
    const lt = holders.lastQuery.filters!.find((f) => f.op === 'lt' && f.col === 'created_at');
    expect(lt).toBeDefined();
    expect(lt!.val).toBe(before);
  });

  it('last page: <= limit rows → has_more false and next_before null', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(true);
    holders.rows = [
      { id: 'm1', session_id: 's', role: 'user', content: 'only one', created_at: '2026-06-14T10:00:00.000Z' },
    ];
    const res = await GET(makeRequest(CHILD_OWN, '?limit=50'), makeContext(CHILD_OWN));
    const body = await res.json();
    expect(body.data.page.has_more).toBe(false);
    expect(body.data.page.next_before).toBeNull();
  });

  it('caps an over-large limit at 100 (over-fetch becomes 101)', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(true);
    holders.rows = [];
    await GET(makeRequest(CHILD_OWN, '?limit=9999'), makeContext(CHILD_OWN));
    expect(holders.lastQuery.limit).toBe(101);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Error handling never leaks the transcript
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/parent/children/[id]/chat — read failure', () => {
  it('returns 500 with no payload when the RLS read errors', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/chat/route');
    authAsParent(GUARDIAN_AUTH);
    holders.mockCanAccess.mockResolvedValue(true);
    holders.queryError = { message: 'rls denied / db error' };
    const res = await GET(makeRequest(CHILD_OWN), makeContext(CHILD_OWN));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.data).toBeUndefined();
    expect(body).not.toHaveProperty('messages');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. Source / migration contract: read-only, RLS-scoped client, approved-guardian DB boundary
// ════════════════════════════════════════════════════════════════════════════

describe('GET /api/parent/children/[id]/chat — source + migration contract', () => {
  it('route exports GET only — no POST/PUT/PATCH/DELETE write handler', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/app/api/parent/children/[student_id]/chat/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/export\s+async\s+function\s+GET\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+POST\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+PUT\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+PATCH\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+DELETE\b/);
  });

  it('uses the RLS-scoped SSR client (createServerClient + anon key), NOT supabase-admin', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/app/api/parent/children/[student_id]/chat/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/createServerClient/);
    expect(src).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
    // The transcript read must NOT route through the service-role admin client.
    // Strip line comments first so this checks real CODE, not the prose that
    // (correctly) explains why supabase-admin is deliberately avoided.
    const code = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(/from\s+['"]@\/lib\/supabase-admin['"]/);
    expect(code).not.toMatch(/\bsupabaseAdmin\b/);
  });

  it('gates on authorizeRequest(child.view_progress) + canAccessStudent', async () => {
    const src = await fs.readFile(
      path.resolve(process.cwd(), 'src/app/api/parent/children/[student_id]/chat/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/authorizeRequest\([^)]*['"]child\.view_progress['"]\s*\)/);
    expect(src).toMatch(/canAccessStudent/);
  });

  it('migration 20260620000200 grants guardians SELECT-only, approved-scoped, with NO write policy', async () => {
    const sql = await fs.readFile(
      path.resolve(
        process.cwd(),
        'supabase/migrations/20260620000200_portal_rbac_remediation_phase2_guardian_read_foxy_chat.sql',
      ),
      'utf8',
    );
    // Guardian policy on the transcript table is FOR SELECT, scoped by is_guardian_of.
    expect(sql).toMatch(/foxy_chat_messages_guardian_select/);
    expect(sql).toMatch(/FOR SELECT/);
    expect(sql).toMatch(/is_guardian_of/);
    // No guardian INSERT/UPDATE/DELETE/ALL policy is introduced.
    expect(sql).not.toMatch(/guardian.*FOR\s+INSERT/i);
    expect(sql).not.toMatch(/guardian.*FOR\s+UPDATE/i);
    expect(sql).not.toMatch(/guardian.*FOR\s+DELETE/i);
    expect(sql).not.toMatch(/guardian.*FOR\s+ALL/i);
    // Additive only — no destructive DDL. Strip `--` comment lines first so this
    // checks executable SQL, not the prose that lists what the migration avoids.
    const ddl = sql.replace(/--.*$/gm, '');
    expect(ddl).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(ddl).not.toMatch(/\bTRUNCATE\b/i);
    // The only DROP allowed is the guarded DROP POLICY (idempotent re-create).
    expect(ddl).not.toMatch(/\bDROP\s+(?!POLICY)/i);
  });
});
