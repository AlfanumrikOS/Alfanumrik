/**
 * /api/support/tickets — guardian (parent) create + list-own path (Phase 2).
 *
 * The support route used to authorize only via `foxy.chat` (student/teacher).
 * Phase 2 added a guardian fallback: a logged-in parent (who holds
 * `child.view_progress`, never `foxy.chat`) can now create AND list their own
 * support tickets. A guardian ticket is anchored to one of their linked
 * children's student_id and tagged `user_role='parent'`, so GET filters
 * `student_id IN (linked children) AND user_role='parent'` — a guardian never
 * sees the child's own (`user_role='student'`) tickets, and vice versa.
 *
 * This file pins, as hard assertions:
 *   - POST guardian create → persists to support_tickets, anchored to a linked
 *     child, role 'parent', and returns the new ticket_id.
 *   - GET guardian list → returns only the guardian's own (role='parent')
 *     tickets, scoped to their linked children (.in(student_id, childIds) +
 *     .eq(user_role,'parent')).
 *   - A guardian with NO linked child → 403 NO_LINKED_CHILD on create, and an
 *     EMPTY list on GET (never another family's tickets).
 *   - Rate limit: the 6th create inside the window → 429 RATE_LIMITED.
 *   - P13: the inserted email column is redacted ('authenticated@redacted'),
 *     and the ops-event context carries ids/role/category only — never the
 *     ticket message text.
 *
 * NOTE on the rate limiter: the route owns a module-level in-memory
 * TICKET_RATE_STORE keyed by auth.userId. It is NOT reset between tests, so
 * each test below uses a DISTINCT guardian auth id to avoid cross-test
 * contamination, and the 429 test deliberately drives a single id past 5.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const holders = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockGetGuardian: vi.fn(),
  mockListChildren: vi.fn(),
  mockLogOps: vi.fn(),
  // supabase-admin in-memory: captures the inserted ticket row + list filters.
  insertedRows: [] as Array<Record<string, unknown>>,
  insertError: null as { message: string } | null,
  listRows: [] as Array<Record<string, unknown>>,
  listError: null as { message: string } | null,
  lastListFilters: [] as Array<{ op: string; col: string; val: unknown }>,
}));

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.mockAuthorize(...a),
}));
vi.mock('@/lib/domains/identity', () => ({
  getGuardianByAuthUserId: (...a: unknown[]) => holders.mockGetGuardian(...a),
}));
vi.mock('@/lib/domains/relationship', () => ({
  listChildrenForGuardian: (...a: unknown[]) => holders.mockListChildren(...a),
}));
vi.mock('@/lib/ops-events', () => ({
  logOpsEvent: (...a: unknown[]) => holders.mockLogOps(...a),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/supabase-admin', () => {
  function ticketsChain() {
    const filters: Array<{ op: string; col: string; val: unknown }> = [];
    let pendingInsert: Record<string, unknown> | null = null;
    const chain: Record<string, unknown> = {
      insert(row: Record<string, unknown>) {
        pendingInsert = row;
        return chain;
      },
      select() {
        return chain;
      },
      eq(col: string, val: unknown) {
        filters.push({ op: 'eq', col, val });
        return chain;
      },
      in(col: string, val: unknown) {
        filters.push({ op: 'in', col, val });
        return chain;
      },
      order() {
        return chain;
      },
      single() {
        // terminal for insert().select().single()
        if (pendingInsert) {
          if (holders.insertError) return Promise.resolve({ data: null, error: holders.insertError });
          holders.insertedRows.push(pendingInsert);
          return Promise.resolve({
            data: { id: 'ticket-new-id', created_at: '2026-06-15T00:00:00.000Z' },
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      range() {
        // terminal for the GET list query
        holders.lastListFilters = filters;
        return Promise.resolve({
          data: holders.listError ? null : holders.listRows,
          error: holders.listError,
          count: holders.listError ? null : holders.listRows.length,
        });
      },
    };
    return chain;
  }
  return {
    supabaseAdmin: { from: (_t: string) => ticketsChain() },
  };
});

// ── Fixture IDs ───────────────────────────────────────────────────────
const GUARDIAN_AUTH = '11111111-1111-4111-a111-111111111111';
const CHILD_A = '33333333-3333-4333-a333-333333333333';
const CHILD_B = '44444444-4444-4444-a444-444444444444';

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/support/tickets', {
    method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'content-type': 'application/json', 'user-agent': 'jsdom' },
    body: JSON.stringify(body),
  });
}
function getReq(query = ''): Request {
  return new Request(`http://localhost/api/support/tickets${query}`, {
    method: 'GET',
    headers: { Authorization: 'Bearer fake.jwt' },
  });
}

// Guardian auth: foxy.chat FAILS (403, but authenticated → userId set), then
// child.view_progress SUCCEEDS. The route's authorizeTicketRequest tries
// foxy.chat first, then child.view_progress.
function authAsGuardian(userId: string) {
  holders.mockAuthorize.mockImplementation(async (_req: unknown, perm: string) => {
    if (perm === 'foxy.chat') {
      return {
        authorized: false,
        userId, // authenticated, but lacks foxy.chat
        studentId: null,
        roles: ['parent'],
        permissions: [],
        errorResponse: new Response(JSON.stringify({ success: false, error: 'Forbidden' }), { status: 403 }),
      };
    }
    // child.view_progress
    return {
      authorized: true,
      userId,
      studentId: null,
      roles: ['parent'],
      permissions: ['child.view_progress'],
    };
  });
}

function withLinkedChildren(authUserId: string, childIds: string[]) {
  holders.mockGetGuardian.mockResolvedValue({ ok: true, data: { id: 'guardian-1', authUserId, name: 'P', email: 'p@x.com' } });
  holders.mockListChildren.mockResolvedValue({
    ok: true,
    data: childIds.map((id) => ({
      studentId: id, name: 'C', grade: '8', schoolId: 's', linkId: `link-${id}`, linkStatus: 'active', linkedAt: null,
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holders.insertedRows = [];
  holders.insertError = null;
  holders.listRows = [];
  holders.listError = null;
  holders.lastListFilters = [];
  holders.mockLogOps.mockResolvedValue(undefined);
});

describe('POST /api/support/tickets — guardian create', () => {
  it('persists a parent-anchored ticket and returns ticket_id', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    const uid = '1aaaaaaa-1111-4111-a111-111111111111';
    authAsGuardian(uid);
    withLinkedChildren(uid, [CHILD_A, CHILD_B]);
    const res = await POST(postReq({ subject: 'Cannot see report', description: 'My child report is blank', category: 'bug' }) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.ticket_id).toBe('ticket-new-id');

    // Exactly one row persisted, anchored to the FIRST linked child + role parent.
    expect(holders.insertedRows).toHaveLength(1);
    const row = holders.insertedRows[0];
    expect(row.student_id).toBe(CHILD_A);
    expect(row.user_role).toBe('parent');
    expect(row.status).toBe('open');
    expect(row.category).toBe('bug');
  });

  it('returns 403 NO_LINKED_CHILD when the guardian has no linked child — no row inserted', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    const uid = '2bbbbbbb-2222-4222-a222-222222222222';
    authAsGuardian(uid);
    withLinkedChildren(uid, []); // no children
    const res = await POST(postReq({ subject: 'Hi', description: 'Need help' }) as never);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('NO_LINKED_CHILD');
    expect(holders.insertedRows).toHaveLength(0);
  });

  it('P13: persists a redacted email and logs ops context WITHOUT the message body', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    const uid = '3ccccccc-3333-4333-a333-333333333333';
    authAsGuardian(uid);
    withLinkedChildren(uid, [CHILD_A]);
    const secret = 'PLEASE CALL ME AT 9999999999 my private complaint';
    await POST(postReq({ subject: 'Billing', description: secret, category: 'billing', priority: 'high' }) as never);

    // Email is redacted in the persisted row.
    expect(holders.insertedRows[0].email).toBe('authenticated@redacted');

    // Ops event was logged, and its serialized payload contains no message text / phone.
    expect(holders.mockLogOps).toHaveBeenCalledTimes(1);
    const opsArg = holders.mockLogOps.mock.calls[0][0];
    const serialized = JSON.stringify(opsArg);
    expect(serialized).not.toContain('9999999999');
    expect(serialized).not.toContain('private complaint');
    // But the operational metadata IS present.
    expect(opsArg.context.role).toBe('parent');
    expect(opsArg.context.category).toBe('billing');
  });

  it('rate limit: the 6th create inside the window returns 429 RATE_LIMITED', async () => {
    const { POST } = await import('@/app/api/support/tickets/route');
    // A dedicated id so this test owns its own rate window.
    const uid = '4ddddddd-4444-4444-a444-444444444444';
    authAsGuardian(uid);
    withLinkedChildren(uid, [CHILD_A]);
    const make = () => POST(postReq({ subject: 's', description: 'd' }) as never);
    // 5 allowed.
    for (let i = 0; i < 5; i++) {
      const r = await make();
      expect(r.status).toBe(200);
    }
    // 6th rejected.
    const sixth = await make();
    expect(sixth.status).toBe(429);
    const body = await sixth.json();
    expect(body.code).toBe('RATE_LIMITED');
    expect(typeof body.retry_after_ms).toBe('number');
    // The rejected request never inserts a 6th row (still only 5 persisted).
    expect(holders.insertedRows).toHaveLength(5);
  });
});

describe('GET /api/support/tickets — guardian list-own', () => {
  it('scopes the list to the guardian linked children AND user_role=parent', async () => {
    const { GET } = await import('@/app/api/support/tickets/route');
    const uid = '5eeeeeee-5555-4555-a555-555555555555';
    authAsGuardian(uid);
    withLinkedChildren(uid, [CHILD_A, CHILD_B]);
    holders.listRows = [
      { id: 't1', subject: 'A', category: 'bug', priority: 'normal', status: 'open', created_at: '2026-06-10', updated_at: null, resolved_at: null },
    ];
    const res = await GET(getReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.tickets).toHaveLength(1);

    // The query filtered by IN(student_id, [children]) and eq(user_role, 'parent').
    const inFilter = holders.lastListFilters.find((f) => f.op === 'in' && f.col === 'student_id');
    expect(inFilter).toBeDefined();
    expect(inFilter!.val).toEqual([CHILD_A, CHILD_B]);
    const roleFilter = holders.lastListFilters.find((f) => f.op === 'eq' && f.col === 'user_role');
    expect(roleFilter!.val).toBe('parent');
  });

  it('a guardian with NO linked child gets an EMPTY list (never another family tickets)', async () => {
    const { GET } = await import('@/app/api/support/tickets/route');
    const uid = '6fffffff-6666-4666-a666-666666666666';
    authAsGuardian(uid);
    withLinkedChildren(uid, []);
    const res = await GET(getReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.tickets).toEqual([]);
    expect(body.data.total).toBe(0);
    // No DB list query was issued for the empty-children short-circuit.
    expect(holders.lastListFilters).toEqual([]);
  });

  it('returns the authorizeRequest 401 verbatim when unauthenticated', async () => {
    const { GET } = await import('@/app/api/support/tickets/route');
    holders.mockAuthorize.mockResolvedValue({
      authorized: false,
      userId: null, // not authenticated → foxy 401 is preferred
      studentId: null,
      roles: [],
      permissions: [],
      errorResponse: new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 }),
    });
    const res = await GET(getReq() as never);
    expect(res.status).toBe(401);
  });
});
