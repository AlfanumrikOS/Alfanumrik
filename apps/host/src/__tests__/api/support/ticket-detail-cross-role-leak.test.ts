/**
 * GET/POST /api/support/tickets/[id] — the P13 leak this whole lane exists to
 * close: a STUDENT must 404 on a thread their PARENT authored about them.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * A support ticket is scoped by TWO columns:
 *     student_id ∈ (caller's anchor set)  AND  user_role = (caller's anchor)
 * A guardian's ticket is anchored to the CHILD's `student_id` with
 * `user_role = 'parent'` (api/support/tickets/route.ts). The DETAIL route
 * filtered on `student_id` ALONE, so a student could open a ticket their parent
 * had filed about them. Harmless-ish while a ticket was one frozen message; with
 * `support_ticket_replies` attached it discloses the entire support conversation
 * about the child — refunds, escalations, behavioural concerns.
 *
 * ── WHY THIS FILE AND NOT `tickets.test.ts` ─────────────────────────────────
 * `tickets.test.ts` asserts the FILTERS the route applied
 * (`_selectFilters.user_role === 'student'`). That is a structural assertion
 * against a mock that returns the same fixed row whatever it is asked for — it
 * proves a `.eq()` was called, not that the wrong row is unreachable. The fake
 * here is FILTER-AWARE: it holds a small table of rows and applies the route's
 * own `.in()` / `.eq()` predicates to it, so "the student gets 404" is decided
 * by whether the route's filters actually exclude the row. Drop the `user_role`
 * narrowing and this file goes red; drop it and `tickets.test.ts` also goes red,
 * but only this one demonstrates the DISCLOSURE.
 *
 * Also pinned here:
 *   • internal operator notes never reach the requester (the route uses
 *     `supabaseAdmin`, which BYPASSES RLS — `.eq('is_internal', false)` is the
 *     only enforcement, and the reply-table RLS policy is a backstop that this
 *     client never consults);
 *   • the ownership anchor columns never ride out in the response (a parent
 *     ticket's `student_id` IS the child's id);
 *   • POST cannot write into a thread the caller does not own, under the same
 *     two-column scope.
 *
 * P13: every id here is synthetic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const VALID_UUID = 'ffffffff-1111-4111-8111-111111111111';
const CHILD_STUDENT_ID = 'aaaaaaaa-1111-4111-8111-111111111111';
const STUDENT_AUTH_ID = 'aaaaaaaa-2222-4222-8222-222222222222';
const PARENT_AUTH_ID = 'bbbbbbbb-2222-4222-8222-222222222222';

/* ── Ticket rows the fake DB holds ──────────────────────────────────────── */
interface TicketRow {
  id: string;
  student_id: string;
  user_role: string;
  subject: string;
  message: string;
  category: string;
  priority: string;
  status: string;
  created_at: string;
}

/** THE ticket at the centre of the leak: filed by the PARENT, anchored to the
 *  CHILD's student_id. Its subject/message are the disclosure. */
const PARENT_TICKET: TicketRow = {
  id: VALID_UUID,
  student_id: CHILD_STUDENT_ID,
  user_role: 'parent',
  subject: 'Refund request and concern about my child',
  message: 'We want a refund and are worried about the at-risk flag.',
  category: 'billing',
  priority: 'high',
  status: 'open',
  created_at: '2026-08-01T00:00:00Z',
};

/** The same child's OWN ticket — must stay reachable by the child. */
const STUDENT_TICKET: TicketRow = {
  id: 'cccccccc-1111-4111-8111-111111111111',
  student_id: CHILD_STUDENT_ID,
  user_role: 'student',
  subject: 'App crashed during a quiz',
  message: 'The quiz page went blank.',
  category: 'bug',
  priority: 'normal',
  status: 'open',
  created_at: '2026-08-02T00:00:00Z',
};

interface ReplyRow {
  id: string;
  ticket_id: string;
  author_role: string;
  author_user_id: string;
  body: string;
  is_internal: boolean;
  created_at: string;
}

const REPLIES: ReplyRow[] = [
  {
    id: 'r-public',
    ticket_id: STUDENT_TICKET.id,
    author_role: 'operator',
    author_user_id: 'op-1',
    body: 'Thanks — we are looking into it.',
    is_internal: false,
    created_at: '2026-08-02T01:00:00Z',
  },
  {
    id: 'r-internal',
    ticket_id: STUDENT_TICKET.id,
    author_role: 'operator',
    author_user_id: 'op-1',
    body: 'INTERNAL: parent already escalated, offer goodwill credit, do not admit fault.',
    is_internal: true,
    created_at: '2026-08-02T02:00:00Z',
  },
];

/* ── Filter-aware supabaseAdmin double ──────────────────────────────────── */

type Pred = { kind: 'eq' | 'in'; col: string; value: unknown };

const { state } = vi.hoisted(() => ({
  state: {
    tickets: [] as unknown[],
    replies: [] as unknown[],
    replyError: null as { message: string } | null,
    inserted: null as Record<string, unknown> | null,
    insertError: null as { message: string } | null,
  },
}));

function matches(row: Record<string, unknown>, preds: Pred[]): boolean {
  return preds.every((p) =>
    p.kind === 'in'
      ? (p.value as unknown[]).includes(row[p.col])
      : row[p.col] === p.value,
  );
}

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  /**
   * The fake honours BOTH halves of a PostgREST read: the `.eq()/.in()`
   * predicates AND the `.select()` column projection. Modelling the projection
   * matters — the route's defence against leaking `author_user_id` /
   * `is_internal` IS the narrow column list, so a fake that returned whole rows
   * would make that assertion untestable (and a fake that always returned
   * narrow rows would make it vacuous).
   */
  function project(row: Record<string, unknown>, columns: string): Record<string, unknown> {
    const cols = columns.split(',').map((c) => c.trim()).filter(Boolean);
    if (cols.length === 0 || cols.includes('*')) return { ...row };
    const out: Record<string, unknown> = {};
    for (const c of cols) if (c in row) out[c] = row[c];
    return out;
  }

  function chain(table: string, columns: string) {
    const preds: Pred[] = [];
    const rows = () => (table === 'support_tickets' ? state.tickets : state.replies);
    const result = () => {
      if (table === 'support_ticket_replies' && state.replyError) {
        return { data: null, error: state.replyError };
      }
      return {
        data: (rows() as Array<Record<string, unknown>>)
          .filter((r) => matches(r, preds))
          .map((r) => project(r, columns)),
        error: null,
      };
    };
    const builder: Record<string, unknown> = {
      eq: (col: string, value: unknown) => { preds.push({ kind: 'eq', col, value }); return builder; },
      in: (col: string, value: unknown) => { preds.push({ kind: 'in', col, value }); return builder; },
      order: () => builder,
      limit: () => Promise.resolve(result()),
      range: () => Promise.resolve(result()),
      maybeSingle: () => {
        const r = result();
        return Promise.resolve({ data: (r.data as unknown[])?.[0] ?? null, error: r.error });
      },
      single: () => {
        const r = result();
        return Promise.resolve({ data: (r.data as unknown[])?.[0] ?? null, error: r.error });
      },
      then: (onFulfilled: (v: unknown) => unknown) => Promise.resolve(result()).then(onFulfilled),
    };
    return builder;
  }

  const admin = {
    from: (table: string) => ({
      select: (columns = '*') => chain(table, columns),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      insert: (row: Record<string, unknown>) => {
        state.inserted = row;
        return {
          select: () => ({
            single: async () =>
              state.insertError
                ? { data: null, error: state.insertError }
                : {
                    data: {
                      id: 'r-new',
                      author_role: row.author_role,
                      body: row.body,
                      created_at: '2026-08-11T00:00:00Z',
                    },
                    error: null,
                  },
          }),
        };
      },
    }),
  };
  return { supabaseAdmin: admin, getSupabaseAdmin: () => admin };
});

/* ── rbac / identity doubles ────────────────────────────────────────────── */

const { auth } = vi.hoisted(() => ({
  auth: { foxy: null as unknown, parent: null as unknown, childIds: [] as string[] },
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: async (_req: unknown, code: string) =>
    code === 'foxy.chat' ? auth.foxy : auth.parent,
}));
vi.mock('@alfanumrik/lib/domains/identity', () => ({
  getGuardianByAuthUserId: async () => ({ ok: true, data: { id: 'g-1' } }),
}));
vi.mock('@alfanumrik/lib/domains/relationship', () => ({
  listChildrenForGuardian: async () => ({
    ok: true,
    data: auth.childIds.map((id) => ({ studentId: id })),
  }),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const DENY = (status: number) => ({
  authorized: false,
  userId: null,
  studentId: null,
  roles: [],
  permissions: [],
  errorResponse: new Response(JSON.stringify({ error: 'denied' }), { status }),
});

function asStudent() {
  auth.foxy = {
    authorized: true,
    userId: STUDENT_AUTH_ID,
    studentId: CHILD_STUDENT_ID,
    roles: ['student'],
    permissions: ['foxy.chat'],
  };
  auth.parent = DENY(403);
  auth.childIds = [];
}

function asParentOf(...childIds: string[]) {
  auth.foxy = DENY(403);
  auth.parent = {
    authorized: true,
    userId: PARENT_AUTH_ID,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.view_progress'],
  };
  auth.childIds = childIds;
}

async function callGet(id: string): Promise<Response> {
  const { GET } = await import('../../../app/api/support/tickets/[id]/route');
  return GET(
    new Request(`http://localhost/api/support/tickets/${id}`) as never,
    { params: Promise.resolve({ id }) },
  );
}

async function callPost(id: string, body: unknown): Promise<Response> {
  const { POST } = await import('../../../app/api/support/tickets/[id]/route');
  return POST(
    new Request(`http://localhost/api/support/tickets/${id}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }) as never,
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  state.tickets = [PARENT_TICKET, STUDENT_TICKET];
  state.replies = REPLIES;
  state.replyError = null;
  state.inserted = null;
  state.insertError = null;
  asStudent();
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE LEAK
// ════════════════════════════════════════════════════════════════════════════
describe('P13 — a student cannot read a parent-authored thread about them', () => {
  it('404s the child on their parent\'s ticket (same student_id, different user_role)', async () => {
    asStudent();
    const res = await callGet(VALID_UUID);
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('NOT_FOUND');

    // Nothing about the parent's conversation may appear on ANY deny path.
    const wire = JSON.stringify(body);
    expect(wire).not.toContain('Refund');
    expect(wire).not.toContain('refund');
    expect(wire).not.toContain('at-risk');
    expect(wire).not.toContain(CHILD_STUDENT_ID);
  });

  it('the child CAN still read their own ticket (the narrowing is not a blanket deny)', async () => {
    asStudent();
    const res = await callGet(STUDENT_TICKET.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ticket.id).toBe(STUDENT_TICKET.id);
    expect(body.data.ticket.subject).toBe('App crashed during a quiz');
  });

  it('the PARENT can read their own ticket about the child', async () => {
    asParentOf(CHILD_STUDENT_ID);
    const res = await callGet(VALID_UUID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.ticket.id).toBe(VALID_UUID);
  });

  it('the parent CANNOT read the child\'s own ticket (the anchor cuts both ways)', async () => {
    asParentOf(CHILD_STUDENT_ID);
    const res = await callGet(STUDENT_TICKET.id);
    expect(res.status).toBe(404);
  });

  it('an unlinked parent 404s on the ticket (no anchor → no ownership)', async () => {
    asParentOf('dddddddd-1111-4111-8111-111111111111');
    const res = await callGet(VALID_UUID);
    expect(res.status).toBe(404);
  });

  it('a guardian with no linked children 404s rather than 403s (existence not leaked)', async () => {
    asParentOf();
    const res = await callGet(VALID_UUID);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('NOT_FOUND');
  });

  it('a non-existent ticket and a not-yours ticket are indistinguishable', async () => {
    asStudent();
    const missing = await callGet('99999999-9999-4999-8999-999999999999');
    const notMine = await callGet(VALID_UUID);
    expect(missing.status).toBe(notMine.status);
    expect(await missing.json()).toEqual(await notMine.json());
  });

  it('401 when the caller holds neither support permission', async () => {
    auth.foxy = DENY(401);
    auth.parent = DENY(401);
    auth.childIds = [];
    const res = await callGet(VALID_UUID);
    expect(res.status).toBe(401);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Internal operator notes — supabaseAdmin bypasses RLS, so the route's own
//    filter is the ONLY thing standing between an operator note and a child.
// ════════════════════════════════════════════════════════════════════════════
describe('P13 — internal operator notes never reach the requester', () => {
  it('omits is_internal replies from the student-facing payload', async () => {
    asStudent();
    const body = await (await callGet(STUDENT_TICKET.id)).json();

    expect(body.data.replies).toHaveLength(1);
    expect(body.data.replies[0].id).toBe('r-public');

    const wire = JSON.stringify(body);
    expect(wire).not.toContain('INTERNAL');
    expect(wire).not.toContain('goodwill credit');
    expect(wire).not.toContain('do not admit fault');
  });

  it('never returns author_user_id or is_internal on any reply', async () => {
    asStudent();
    const body = await (await callGet(STUDENT_TICKET.id)).json();
    for (const r of body.data.replies) {
      expect(r.author_user_id).toBeUndefined();
      expect(r.is_internal).toBeUndefined();
      expect(Object.keys(r).sort()).toEqual(['author_role', 'body', 'created_at', 'id']);
    }
    expect(JSON.stringify(body)).not.toContain('op-1');
  });

  it('a FAILED thread read reports replies_unavailable — never a silent empty thread', async () => {
    asStudent();
    state.replyError = { message: 'connection reset' };
    const body = await (await callGet(STUDENT_TICKET.id)).json();

    expect(body.data.replies_unavailable).toBe(true);
    expect(body.data.replies).toEqual([]);
    // The distinguishability IS the contract: a successful empty read must not
    // carry the flag, or the UI cannot tell silence from failure.
    state.replyError = null;
    state.replies = [];
    const ok = await (await callGet(STUDENT_TICKET.id)).json();
    expect(ok.data.replies_unavailable).toBeUndefined();
    expect(ok.data.replies).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Ownership anchors never ride out on the wire
// ════════════════════════════════════════════════════════════════════════════
describe('P13 — the ownership anchor is never disclosed', () => {
  it('strips student_id and user_role from the ticket payload', async () => {
    asParentOf(CHILD_STUDENT_ID);
    const body = await (await callGet(VALID_UUID)).json();

    expect(body.data.ticket.student_id).toBeUndefined();
    expect(body.data.ticket.user_role).toBeUndefined();
    // For a parent-filed ticket the anchor IS the child's student id.
    expect(JSON.stringify(body)).not.toContain(CHILD_STUDENT_ID);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. POST — the same two-column scope guards writes
// ════════════════════════════════════════════════════════════════════════════
describe('P13 — a student cannot reply into a parent-authored thread', () => {
  it('404s the write and performs no insert', async () => {
    asStudent();
    const res = await callPost(VALID_UUID, { body: 'let me see this thread' });
    expect(res.status).toBe(404);
    expect(state.inserted).toBeNull();
  });

  it('allows the reply on the caller\'s OWN thread', async () => {
    asStudent();
    const res = await callPost(STUDENT_TICKET.id, { body: 'still happening today' });
    expect(res.status).toBe(200);
    expect(state.inserted).not.toBeNull();
  });

  it('derives every security-relevant field server-side, ignoring the body', async () => {
    asStudent();
    const res = await callPost(STUDENT_TICKET.id, {
      body: 'hello',
      // Hostile extras — all must be ignored.
      is_internal: true,
      author_role: 'operator',
      author_user_id: 'op-1',
      ticket_id: VALID_UUID,
    });
    expect(res.status).toBe(200);
    expect(state.inserted!.is_internal).toBe(false);
    expect(state.inserted!.author_role).toBe('student');
    expect(state.inserted!.author_user_id).toBe(STUDENT_AUTH_ID);
    expect(state.inserted!.ticket_id).toBe(STUDENT_TICKET.id);
  });

  it('a parent reply is anchored to author_role=parent, not student', async () => {
    asParentOf(CHILD_STUDENT_ID);
    const res = await callPost(VALID_UUID, { body: 'any update on the refund?' });
    expect(res.status).toBe(200);
    expect(state.inserted!.author_role).toBe('parent');
    expect(state.inserted!.is_internal).toBe(false);
  });

  it('rejects an empty body with 400 and writes nothing', async () => {
    asStudent();
    const res = await callPost(STUDENT_TICKET.id, { body: '   ' });
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });

  it('rejects a non-uuid ticket id with 400 before any DB work', async () => {
    asStudent();
    const res = await callPost('not-a-uuid', { body: 'hello there' });
    expect(res.status).toBe(400);
    expect(state.inserted).toBeNull();
  });
});
