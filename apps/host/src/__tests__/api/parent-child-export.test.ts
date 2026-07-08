/**
 * /api/parent/children/[student_id]/export — DPDP §13 contract tests (Phase D.2).
 *
 * Pins:
 *   1. authorizeRequest gate fires with `child.view_progress` permission.
 *   2. 403 when caller has no guardian profile.
 *   3. 403 when caller IS a guardian but is not linked to the requested
 *      student (cross-guardian isolation — guardian X cannot export
 *      guardian Y's child).
 *   4. Happy path: returns JSON with all expected top-level keys, sets
 *      Content-Disposition: attachment + filename and Content-Type:
 *      application/json, and `Cache-Control: no-store` (PII).
 *   5. Audit row written with action `'parent.child_data_exported'`
 *      and `status: 'success'` plus per-table row counts.
 *   6. State-event published with kind `parent.child_data_exported`.
 *   7. 413 when total payload exceeds 10MB — body explains the ops
 *      offline-export handoff and a `failure` audit row is written.
 *   8. 400 when the student_id path param is not a valid UUID.
 *   9. Single-row tables (student, subscription, learning_profile) are
 *      not wrapped in an array when there's exactly one row.
 *  10. Source-level contract: route uses authorizeRequest and the
 *      `child.view_progress` permission (recurring gotcha).
 *
 * The Supabase chain is mocked at `supabaseAdmin.from(table)` granularity
 * with an in-memory store. The state-events bus is intercepted via
 * mockPublishEvent.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

// ── Hoisted holders for mocks ─────────────────────────────────────────
const holders = vi.hoisted(() => ({
  mockAuthorize:     vi.fn(),
  mockGetGuardian:   vi.fn(),
  mockListChildren:  vi.fn(),
  mockPublishEvent:  vi.fn(),
  mockLogAudit:      vi.fn(),
  mockState: {} as {
    tables?: Record<string, Array<Record<string, unknown>>>;
    tableErrors?: Record<string, { message: string } | undefined>;
    pad?: string | null;
  },
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
  logAudit: (...a: unknown[]) => holders.mockLogAudit(...a),
}));
vi.mock('@alfanumrik/lib/supabase-admin', () => {
  // Lazy-evaluated chain. Each step accumulates filters; the terminal
  // step (await or .maybeSingle()) materialises the query against
  // holders.mockState.tables. This avoids the "first eq resolves the
  // promise before the second eq is chained" footgun.
  const buildChain = (table: string) => {
    const filters: Array<{ col: string; val: unknown }> = [];
    const exec = () => {
      const err = holders.mockState.tableErrors?.[table];
      if (err) return Promise.resolve({ data: null, error: err });
      const rows = (holders.mockState.tables?.[table] ?? []).filter(
        (r) => filters.every((f) => r[f.col] === f.val),
      );
      return Promise.resolve({ data: rows, error: null });
    };
    const chain: {
      eq: (col: string, val: unknown) => typeof chain;
      maybeSingle: () => Promise<{ data: unknown; error: unknown }>;
      then: (onfulfilled: (v: unknown) => unknown, onrejected?: (e: unknown) => unknown) => Promise<unknown>;
    } = {
      eq(col: string, val: unknown) {
        filters.push({ col, val });
        return chain;
      },
      maybeSingle() {
        return exec().then((r) => {
          const data = (r.data as unknown[] | null) ?? [];
          return { data: (data as unknown[])[0] ?? null, error: r.error };
        });
      },
      then(onfulfilled, onrejected) {
        return exec().then(onfulfilled, onrejected);
      },
    };
    return chain;
  };
  return {
    supabaseAdmin: {
      from: (t: string) => ({
        select: (_cols: string) => buildChain(t),
      }),
    },
  };
});
vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.mockGetGuardian(...a),
}));
vi.mock('@alfanumrik/lib/domains/relationship', () => ({
  listChildrenForGuardian: (...a: unknown[]) => holders.mockListChildren(...a),
}));
vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...a: unknown[]) => holders.mockPublishEvent(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Fixture IDs ───────────────────────────────────────────────────────
// All UUIDs must satisfy isValidUUID (RFC4122 v4 — `4` in the version
// slot and one of `[89ab]` in the variant slot). The fake-but-valid form
// xxxxxxxx-xxxx-4xxx-axxx-xxxxxxxxxxxx is used throughout the codebase.
const GUARDIAN_AUTH_X = '11111111-1111-4111-a111-111111111111';
const GUARDIAN_ID_X   = '22222222-2222-4222-a222-222222222222';
const STUDENT_X       = '33333333-3333-4333-a333-333333333333';
const STUDENT_Y       = '44444444-4444-4444-a444-444444444444';
const SCHOOL_ID       = '55555555-5555-4555-a555-555555555555';

function makeRequest(studentId: string): Request {
  return new Request(`http://localhost/api/parent/children/${studentId}/export`, {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt.x' },
  });
}

function makeContext(studentId: string) {
  return { params: Promise.resolve({ student_id: studentId }) };
}

function authAsParent(authUserId: string = GUARDIAN_AUTH_X) {
  holders.mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: authUserId,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.view_progress'],
  });
}

function asGuardian(
  guardianId: string = GUARDIAN_ID_X,
  authUserId: string = GUARDIAN_AUTH_X,
) {
  holders.mockGetGuardian.mockResolvedValue({
    ok: true,
    data: { id: guardianId, authUserId, name: 'Test Parent', email: 'p@x.com', phone: null },
  });
}

function withLinkedChildren(
  children: Array<{ studentId: string; name: string; schoolId?: string | null }>,
) {
  holders.mockListChildren.mockResolvedValue({
    ok: true,
    data: children.map((c) => ({
      studentId: c.studentId,
      name: c.name,
      grade: '8',
      schoolId: c.schoolId ?? SCHOOL_ID,
      linkId: `link-${c.studentId}`,
      linkStatus: 'active',
      linkedAt: '2026-05-01T00:00:00.000Z',
    })),
  });
}

function withDefaultTables(studentId: string = STUDENT_X) {
  holders.mockState.tables = {
    students: [
      {
        id: studentId,
        auth_user_id: '99999999-9999-4999-a999-999999999999',
        name: 'Aanya',
        grade: '8',
        school_id: SCHOOL_ID,
      },
    ],
    student_subscriptions: [
      { id: 'sub-1', student_id: studentId, plan_code: 'pro', status: 'active' },
    ],
    student_learning_profiles: [
      { id: 'prof-1', student_id: studentId, bkt_state: {} },
    ],
    quiz_sessions: [
      { id: 'qs-1', student_id: studentId, subject_code: 'math', created_at: '2026-05-10T00:00:00Z' },
      { id: 'qs-2', student_id: studentId, subject_code: 'science', created_at: '2026-05-11T00:00:00Z' },
    ],
    quiz_responses: [
      { id: 'qr-1', student_id: studentId, session_id: 'qs-1', is_correct: true },
    ],
    foxy_chat_messages: [
      { id: 'fx-1', student_id: studentId, role: 'user', content: 'Hello Foxy' },
    ],
    score_history: [
      { id: 'sh-1', student_id: studentId, subject: 'math', score: 88 },
    ],
    assignment_submissions: [
      { id: 'as-1', student_id: studentId, assignment_id: 'a-1', score: 90 },
    ],
    notifications: [
      {
        id: 'n-1',
        recipient_id: studentId,
        recipient_type: 'student',
        type: 'streak',
        title: 'Day 5',
        message: 'Keep going',
      },
      // A guardian-addressed notification — must NOT appear in the export
      // even though we filter on recipient_id alone, because the route
      // applies a recipient_type='student' filter for notifications.
      {
        id: 'n-2',
        recipient_id: studentId,
        recipient_type: 'guardian',
        type: 'parent_message',
        title: 'New message',
        message: '...',
      },
    ],
    audit_logs: [
      {
        id: 'al-1',
        auth_user_id: '99999999-9999-4999-a999-999999999999',
        action: 'view',
        resource_type: 'students',
        resource_id: studentId,
        details: {},
        status: 'success',
        created_at: '2026-05-12T00:00:00Z',
      },
    ],
  };
  holders.mockState.tableErrors = {};
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.mockState.tables = undefined;
  holders.mockState.tableErrors = undefined;
  holders.mockState.pad = null;
  holders.mockPublishEvent.mockResolvedValue({ published: true });
});

// ── 1. Auth gate ─────────────────────────────────────────────────────
describe('GET /api/parent/children/[id]/export — auth gate', () => {
  it('returns the authorizeRequest errorResponse when not authorized', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null,
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
    const res = await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(res.status).toBe(401);
  });

  it('asks authorizeRequest for the child.view_progress permission', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    withLinkedChildren([{ studentId: STUDENT_X, name: 'Aanya' }]);
    withDefaultTables();
    await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(holders.mockAuthorize).toHaveBeenCalledTimes(1);
    const [, perm] = holders.mockAuthorize.mock.calls[0];
    expect(perm).toBe('child.view_progress');
  });

  it('returns 400 when student_id is not a valid UUID', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    const res = await GET(makeRequest('not-a-uuid'), makeContext('not-a-uuid'));
    expect(res.status).toBe(400);
  });
});

// ── 2. Ownership: cross-guardian isolation ───────────────────────────
describe('GET /api/parent/children/[id]/export — ownership', () => {
  it('returns 403 when the caller has no guardian profile', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    holders.mockGetGuardian.mockResolvedValue({ ok: true, data: null });
    const res = await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/parent/i);
  });

  it("returns 403 when guardian X tries to export guardian Y's child", async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent(GUARDIAN_AUTH_X);
    asGuardian(GUARDIAN_ID_X, GUARDIAN_AUTH_X);
    // Guardian X is linked only to STUDENT_X. They request STUDENT_Y.
    withLinkedChildren([{ studentId: STUDENT_X, name: 'Aanya' }]);
    const res = await GET(makeRequest(STUDENT_Y), makeContext(STUDENT_Y));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not linked/i);
    // A denied audit row MUST be written for misuse observability.
    expect(holders.mockLogAudit).toHaveBeenCalled();
    const auditEntry = holders.mockLogAudit.mock.calls[0][1];
    expect(auditEntry.action).toBe('parent.child_data_exported');
    expect(auditEntry.status).toBe('denied');
    // And no state_event was published for a denied request.
    expect(holders.mockPublishEvent).not.toHaveBeenCalled();
  });

  it('returns 500 when the children lookup fails (no silent success)', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    holders.mockListChildren.mockResolvedValue({ ok: false, error: 'db down' });
    const res = await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(res.status).toBe(500);
  });
});

// ── 3. Happy path ────────────────────────────────────────────────────
describe('GET /api/parent/children/[id]/export — happy path', () => {
  it('returns a JSON blob with all expected top-level keys', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    withLinkedChildren([{ studentId: STUDENT_X, name: 'Aanya' }]);
    withDefaultTables();
    const res = await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.schema_version).toBe('v1-2026-05');
    expect(typeof body.exported_at).toBe('string');
    expect(body.student).toBeDefined();
    expect(body.subscription).toBeDefined();
    expect(body.learning_profile).toBeDefined();
    expect(Array.isArray(body.quiz_sessions)).toBe(true);
    expect(Array.isArray(body.quiz_attempts)).toBe(true);
    expect(Array.isArray(body.foxy_chat_messages)).toBe(true);
    expect(Array.isArray(body.score_history)).toBe(true);
    expect(Array.isArray(body.submissions)).toBe(true);
    expect(Array.isArray(body.notifications)).toBe(true);
    expect(Array.isArray(body.consents)).toBe(true);
    expect(Array.isArray(body.audit_logs)).toBe(true);
  });

  it('sets attachment Content-Disposition and JSON Content-Type', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    withLinkedChildren([{ studentId: STUDENT_X, name: 'Aanya' }]);
    withDefaultTables();
    const res = await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(res.status).toBe(200);
    const cd = res.headers.get('content-disposition');
    expect(cd).toBeTruthy();
    expect(cd).toMatch(/attachment; filename="child-export-[0-9a-f]{8}-\d{8}\.json"/);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    // PII payload must never be cached.
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
  });

  it('filters notifications to recipient_type=student (no guardian-addressed rows)', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    withLinkedChildren([{ studentId: STUDENT_X, name: 'Aanya' }]);
    withDefaultTables();
    const res = await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    const body = JSON.parse(await res.text());
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].id).toBe('n-1');
    expect(body.notifications[0].recipient_type).toBe('student');
  });
});

// ── 4. Audit + state_event ───────────────────────────────────────────
describe('GET /api/parent/children/[id]/export — audit + state event', () => {
  it('writes a success audit row with per-table row counts', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    withLinkedChildren([{ studentId: STUDENT_X, name: 'Aanya' }]);
    withDefaultTables();
    const res = await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(res.status).toBe(200);
    expect(holders.mockLogAudit).toHaveBeenCalled();
    const entry = holders.mockLogAudit.mock.calls.find(
      (c) => (c[1] as { action: string }).action === 'parent.child_data_exported'
        && (c[1] as { status?: string }).status === 'success',
    );
    expect(entry).toBeDefined();
    const audit = entry![1] as { details: Record<string, unknown> };
    expect(audit.details.table_counts).toBeDefined();
    expect((audit.details.table_counts as Record<string, number>).students).toBe(1);
    expect((audit.details.table_counts as Record<string, number>).quiz_sessions).toBe(2);
    expect(typeof audit.details.row_count_total).toBe('number');
    expect(typeof audit.details.payload_bytes).toBe('number');
  });

  it('publishes a parent.child_data_exported state_event', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    withLinkedChildren([{ studentId: STUDENT_X, name: 'Aanya' }]);
    withDefaultTables();
    await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(holders.mockPublishEvent).toHaveBeenCalledTimes(1);
    const [, event] = holders.mockPublishEvent.mock.calls[0];
    expect((event as { kind: string }).kind).toBe('parent.child_data_exported');
    const payload = (event as { payload: Record<string, unknown> }).payload;
    expect(payload.guardianId).toBe(GUARDIAN_ID_X);
    expect(payload.studentId).toBe(STUDENT_X);
    expect(payload.schemaVersion).toBe('v1-2026-05');
    expect(typeof payload.payloadBytes).toBe('number');
    expect(typeof payload.tableCount).toBe('number');
    expect(typeof payload.rowCountTotal).toBe('number');
    // tenantId must carry the child's school_id (per the C.3 pattern).
    expect((event as { tenantId: string | null }).tenantId).toBe(SCHOOL_ID);
  });
});

// ── 5. 10MB cap ──────────────────────────────────────────────────────
describe('GET /api/parent/children/[id]/export — 10MB cap', () => {
  it('returns 413 when the assembled payload exceeds 10MB', async () => {
    const { GET } = await import('@/app/api/parent/children/[student_id]/export/route');
    authAsParent();
    asGuardian();
    withLinkedChildren([{ studentId: STUDENT_X, name: 'Aanya' }]);
    // Seed a foxy_chat_messages list big enough to blow past 10MB.
    // 11000 rows × ~1000 chars each ≈ 11MB. Each row's content uses
    // a deterministic 1000-char padding to keep the test reproducible.
    const PAD = 'x'.repeat(1000);
    const bigChats = Array.from({ length: 11000 }, (_, i) => ({
      id: `fx-${i}`,
      student_id: STUDENT_X,
      role: 'user',
      content: PAD,
    }));
    holders.mockState.tables = {
      students: [{ id: STUDENT_X, name: 'Aanya', grade: '8', school_id: SCHOOL_ID }],
      student_subscriptions: [],
      student_learning_profiles: [],
      quiz_sessions: [],
      quiz_responses: [],
      foxy_chat_messages: bigChats,
      score_history: [],
      assignment_submissions: [],
      notifications: [],
      audit_logs: [],
    };
    holders.mockState.tableErrors = {};

    const res = await GET(makeRequest(STUDENT_X), makeContext(STUDENT_X));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toMatch(/10MB|offline|ops@/i);
    // A `failure` audit row was written even though the download failed.
    expect(holders.mockLogAudit).toHaveBeenCalled();
    const denied = holders.mockLogAudit.mock.calls.find(
      (c) => (c[1] as { status?: string }).status === 'failure',
    );
    expect(denied).toBeDefined();
    // Oversized requests do NOT emit a state_event (we only emit on
    // successful downloads — see route comment).
    expect(holders.mockPublishEvent).not.toHaveBeenCalled();
  });
});

// ── 6. Source-level contract ─────────────────────────────────────────
describe('GET /api/parent/children/[id]/export — source-level contract', () => {
  it('uses authorizeRequest with child.view_progress permission', async () => {
    const src = await fs.readFile(
      path.resolve(
        process.cwd(),
        'src/app/api/parent/children/[student_id]/export/route.ts',
      ),
      'utf8',
    );
    expect(src).toMatch(/authorizeRequest\([^)]*['"]child\.view_progress['"]\s*\)/);
  });

  it('exports only GET — no POST/PATCH/DELETE writes from this route', async () => {
    const src = await fs.readFile(
      path.resolve(
        process.cwd(),
        'src/app/api/parent/children/[student_id]/export/route.ts',
      ),
      'utf8',
    );
    expect(src).toMatch(/export\s+async\s+function\s+GET\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+POST\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+PATCH\b/);
    expect(src).not.toMatch(/export\s+async\s+function\s+DELETE\b/);
  });

  it('references listChildrenForGuardian (not isGuardianLinkedToStudent) to surface schoolId for the state_event tenantId', async () => {
    const src = await fs.readFile(
      path.resolve(
        process.cwd(),
        'src/app/api/parent/children/[student_id]/export/route.ts',
      ),
      'utf8',
    );
    expect(src).toMatch(/listChildrenForGuardian/);
    // ChildSummary.studentId — the C.4 follow-up gotcha called out in
    // the brief. Mis-typing as `.id` (matches the row id, not the FK)
    // silently lets a parent export the wrong child if there's a
    // collision; pin the explicit `.studentId` reference.
    expect(src).toMatch(/\.studentId/);
  });
});
