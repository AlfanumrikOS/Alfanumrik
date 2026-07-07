/**
 * Phase D.6 pagination contract tests.
 *
 * Pins the cross-route pagination contract documented in
 * docs/runbooks/performance-targets.md §4:
 *
 *   - `limit` is clamped at 100.
 *   - Sensible defaults apply when ?limit= is omitted (notifications=50,
 *     messages=100 — per route, but the test only asserts that "limit
 *     omitted" returns at most the documented default).
 *   - `nextCursor` is monotonic (older cursors than the current row).
 *   - `hasMore` is true ⇔ nextCursor !== null.
 *   - `?before=` works as an alias of `?cursor=` (added in Phase D.6).
 *   - Negative / non-finite limits fall back to the default rather than
 *     producing an empty page or a 500.
 *
 * Routes under test:
 *   - GET /api/parent/notifications
 *   - GET /api/teacher/messages/threads/[id]/messages
 *
 * Shared Supabase-admin mock fixture: 150 rows in each table so we can
 * verify the 100-cap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Constants ───────────────────────────────────────────────────────────
const PARENT_AUTH = '11111111-1111-1111-1111-111111111111';
const PARENT_ID = '22222222-2222-2222-2222-222222222222';
const TEACHER_AUTH = '44444444-4444-4444-4444-444444444444';
const TEACHER_ID = '55555555-5555-5555-5555-555555555555';
const GUARDIAN_ID = '22222222-2222-2222-2222-222222222222';
const STUDENT_ID = '66666666-6666-6666-6666-666666666666';
const THREAD_ID = '77777777-7777-7777-7777-777777777777';

// ── Auth mock ───────────────────────────────────────────────────────────
const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Shared in-memory tables ─────────────────────────────────────────────
type NotifRow = {
  id: string;
  recipient_id: string;
  recipient_type: string;
  title: string;
  message: string;
  body: string | null;
  type: string;
  data: Record<string, unknown>;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
  delivery_channel: string;
};

type MessageRow = {
  id: string;
  thread_id: string;
  sender_role: 'teacher' | 'guardian';
  sender_auth_user_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

function makeNotificationFixture(count: number): NotifRow[] {
  const out: NotifRow[] = [];
  // created_at decreases as i grows (most recent has lowest i)
  for (let i = 0; i < count; i++) {
    const tsMin = String(i).padStart(3, '0');
    out.push({
      id: `00000000-0000-0000-0000-0000000${tsMin}`,
      recipient_id: PARENT_ID,
      recipient_type: 'guardian',
      title: `Notification ${i}`,
      message: `msg ${i}`,
      body: null,
      type: 'misc',
      data: {},
      is_read: i % 2 === 0,
      read_at: i % 2 === 0 ? '2026-05-14T12:00:00.000Z' : null,
      // ISO timestamps with monotonically DECREASING values so DESC sort
      // returns i=0, 1, 2, ... in that order.
      created_at: `2026-05-${String(15 - Math.floor(i / 24)).padStart(2, '0')}T${String(
        23 - (i % 24),
      ).padStart(2, '0')}:00:00.000Z`,
      delivery_channel: 'in_app',
    });
  }
  return out;
}

function makeMessagesFixture(count: number): MessageRow[] {
  const out: MessageRow[] = [];
  // created_at INCREASES with i so ASC sort returns i=0, 1, 2, ...
  for (let i = 0; i < count; i++) {
    const dd = String(1 + Math.floor(i / 24)).padStart(2, '0');
    const hh = String(i % 24).padStart(2, '0');
    out.push({
      id: `aaaaaaaa-aaaa-aaaa-aaaa-aaaaaa${String(i).padStart(6, '0')}`,
      thread_id: THREAD_ID,
      sender_role: i % 2 === 0 ? 'teacher' : 'guardian',
      sender_auth_user_id: i % 2 === 0 ? TEACHER_AUTH : PARENT_AUTH,
      body: `message ${i}`,
      created_at: `2026-05-${dd}T${hh}:00:00.000Z`,
      read_at: null,
    });
  }
  return out;
}

let notifications: NotifRow[] = [];
let messages: MessageRow[] = [];

// ── Supabase chain mock — minimal but covers the routes' usage. ─────────
function notificationsBuilder() {
  type Pred = (row: NotifRow) => boolean;
  const buildSelectChain = (opts?: { count?: string; head?: boolean }) => {
    const filters: Pred[] = [];
    let lt: { col: keyof NotifRow; val: string } | null = null;
    let orderDesc = false;
    let limitN: number | null = null;
    const chain = {
      eq(col: string, val: unknown) {
        filters.push((row) => (row as Record<string, unknown>)[col] === val);
        return chain;
      },
      lt(col: string, val: string) {
        lt = { col: col as keyof NotifRow, val };
        return chain;
      },
      order(_col: string, opt?: { ascending?: boolean }) {
        orderDesc = opt?.ascending === false;
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return resolve();
      },
      then(...args: Parameters<Promise<unknown>['then']>) {
        return resolve().then(...args);
      },
    };
    function applyFilters(): NotifRow[] {
      let out = notifications.filter((r) => filters.every((p) => p(r)));
      if (lt) out = out.filter((r) => String(r[lt!.col]) < lt!.val);
      if (orderDesc) out = [...out].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    }
    function resolve() {
      if (opts?.head) {
        const c = notifications.filter((r) => filters.every((p) => p(r))).length;
        return Promise.resolve({ data: null, count: c, error: null });
      }
      return Promise.resolve({ data: applyFilters(), error: null });
    }
    return chain;
  };
  return {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      return buildSelectChain(opts);
    },
  };
}

function guardiansBuilder() {
  return {
    select() {
      return {
        eq() {
          return {
            async maybeSingle() {
              return { data: { id: PARENT_ID }, error: null };
            },
          };
        },
      };
    },
  };
}

function teachersBuilder() {
  return {
    select() {
      return {
        eq() {
          return {
            async maybeSingle() {
              return { data: { id: TEACHER_ID }, error: null };
            },
          };
        },
      };
    },
  };
}

function threadsBuilder() {
  return {
    select() {
      return {
        eq() {
          return {
            async maybeSingle() {
              return {
                data: {
                  id: THREAD_ID,
                  teacher_id: TEACHER_ID,
                  guardian_id: GUARDIAN_ID,
                  student_id: STUDENT_ID,
                },
                error: null,
              };
            },
          };
        },
      };
    },
  };
}

function messagesBuilder() {
  type Pred = (row: MessageRow) => boolean;
  const buildSelectChain = () => {
    const filters: Pred[] = [];
    let gt: { col: keyof MessageRow; val: string } | null = null;
    let orderAsc = true;
    let limitN: number | null = null;
    // The teacher/parent message routes call .limit(...) BEFORE .gt(cursor)
    // because the route builds the base query, sets the limit, then attaches
    // the cursor in an `if (cursor) q = q.gt(...)` branch. We must keep the
    // chain-builder shape stable after .limit(); the Promise resolution only
    // happens when the caller awaits the chain (the `then` member below).
    const chain = {
      eq(col: string, val: unknown) {
        filters.push((row) => (row as Record<string, unknown>)[col] === val);
        return chain;
      },
      gt(col: string, val: string) {
        gt = { col: col as keyof MessageRow, val };
        return chain;
      },
      in(_col: string, _arr: unknown[]) {
        return chain;
      },
      order(_col: string, opt?: { ascending?: boolean }) {
        orderAsc = opt?.ascending !== false;
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      then(...args: Parameters<Promise<unknown>['then']>) {
        return resolve().then(...args);
      },
    };
    function applyFilters(): MessageRow[] {
      let out = messages.filter((r) => filters.every((p) => p(r)));
      if (gt) out = out.filter((r) => String(r[gt!.col]) > gt!.val);
      out = [...out].sort((a, b) =>
        orderAsc
          ? a.created_at < b.created_at
            ? -1
            : 1
          : a.created_at < b.created_at
            ? 1
            : -1,
      );
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    }
    function resolve() {
      return Promise.resolve({ data: applyFilters(), error: null });
    }
    return chain;
  };
  return {
    select(_cols: string) {
      return buildSelectChain();
    },
    update(_patch: Partial<MessageRow>) {
      // .update(...).in('id', ids) — no-op for these tests; the mark-read
      // side effect doesn't affect what the route returns.
      return {
        in() {
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from(table: string) {
      if (table === 'notifications') return notificationsBuilder();
      if (table === 'guardians') return guardiansBuilder();
      if (table === 'teachers') return teachersBuilder();
      if (table === 'teacher_parent_threads') return threadsBuilder();
      if (table === 'teacher_parent_messages') return messagesBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  },
}));

import { GET as GET_NOTIFICATIONS } from '@/app/api/parent/notifications/route';
import { GET as GET_TEACHER_MESSAGES } from '@/app/api/teacher/messages/threads/[id]/messages/route';

// ── Helpers ─────────────────────────────────────────────────────────────
function authedAsParent() {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: PARENT_AUTH,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.receive_alerts', 'child.view_progress'],
  });
}

function authedAsTeacher() {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: TEACHER_AUTH,
    studentId: null,
    roles: ['teacher'],
    permissions: ['class.manage'],
  });
}

function makeNotificationsRequest(query = ''): Request {
  return new Request(`http://localhost/api/parent/notifications${query}`, { method: 'GET' });
}

function makeTeacherMessagesRequest(query = ''): Request {
  return new Request(
    `http://localhost/api/teacher/messages/threads/${THREAD_ID}/messages${query}`,
    { method: 'GET' },
  );
}

const teacherCtx = { params: Promise.resolve({ id: THREAD_ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  // 150 rows so we can exercise the 100-cap.
  notifications = makeNotificationFixture(150);
  messages = makeMessagesFixture(150);
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/parent/notifications
// ─────────────────────────────────────────────────────────────────────
describe('GET /api/parent/notifications pagination contract', () => {
  it('applies the documented default limit (50) when ?limit= is omitted', async () => {
    authedAsParent();
    const res = await GET_NOTIFICATIONS(makeNotificationsRequest() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.items.length).toBeLessThanOrEqual(50);
    // We have 150 rows in fixture, so the first page must not include them all.
    expect(json.items.length).toBe(50);
    expect(json.hasMore).toBe(true);
    expect(typeof json.nextCursor).toBe('string');
  });

  it('honors ?limit=N up to the route cap (50 for this surface)', async () => {
    authedAsParent();
    const res = await GET_NOTIFICATIONS(makeNotificationsRequest('?limit=10') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.items.length).toBe(10);
    expect(json.hasMore).toBe(true);
  });

  it('clamps ?limit= above the cap (50 for notifications)', async () => {
    authedAsParent();
    const res = await GET_NOTIFICATIONS(makeNotificationsRequest('?limit=99999') as never);
    const json = await res.json();
    // Notification cap is 50; 99999 must NOT be honored.
    expect(json.items.length).toBeLessThanOrEqual(50);
    // The cap is the documented one — must equal MAX_LIMIT (50 for notifications).
    expect(json.items.length).toBe(50);
  });

  it('falls back to default for non-finite / negative ?limit=', async () => {
    authedAsParent();
    const negative = await GET_NOTIFICATIONS(makeNotificationsRequest('?limit=-5') as never);
    const negJson = await negative.json();
    expect(negJson.items.length).toBe(50);

    const nan = await GET_NOTIFICATIONS(makeNotificationsRequest('?limit=abc') as never);
    const nanJson = await nan.json();
    expect(nanJson.items.length).toBe(50);
  });

  it('returns a monotonically older nextCursor on each successive page', async () => {
    authedAsParent();
    const page1 = await (await GET_NOTIFICATIONS(makeNotificationsRequest('?limit=10') as never)).json();
    expect(page1.items.length).toBe(10);
    expect(page1.nextCursor).toBeTruthy();

    // Cursor must be a parseable ISO timestamp.
    const cursor1 = page1.nextCursor as string;
    expect(Number.isNaN(Date.parse(cursor1))).toBe(false);

    const page2 = await (
      await GET_NOTIFICATIONS(makeNotificationsRequest(`?limit=10&cursor=${cursor1}`) as never)
    ).json();
    expect(page2.items.length).toBe(10);
    expect(page2.nextCursor).toBeTruthy();

    // Strictly older — page2's nextCursor < page1's nextCursor (DESC order).
    expect((page2.nextCursor as string) < cursor1).toBe(true);

    // No overlap between pages.
    const ids1 = new Set(page1.items.map((i: { id: string }) => i.id));
    for (const item of page2.items) expect(ids1.has(item.id)).toBe(false);
  });

  it('accepts ?before= as alias of ?cursor= (Phase D.6 contract)', async () => {
    authedAsParent();
    const first = await (await GET_NOTIFICATIONS(makeNotificationsRequest('?limit=5') as never)).json();
    const cursor = first.nextCursor as string;

    const viaCursor = await (
      await GET_NOTIFICATIONS(makeNotificationsRequest(`?limit=5&cursor=${cursor}`) as never)
    ).json();
    const viaBefore = await (
      await GET_NOTIFICATIONS(makeNotificationsRequest(`?limit=5&before=${cursor}`) as never)
    ).json();

    expect(viaCursor.items.map((i: { id: string }) => i.id)).toEqual(
      viaBefore.items.map((i: { id: string }) => i.id),
    );
  });

  it('returns hasMore=false and nextCursor=null on the final page', async () => {
    authedAsParent();
    // Set fixture small enough that limit covers everything.
    notifications = makeNotificationFixture(3);
    const res = await GET_NOTIFICATIONS(makeNotificationsRequest('?limit=10') as never);
    const json = await res.json();
    expect(json.items.length).toBe(3);
    expect(json.hasMore).toBe(false);
    expect(json.nextCursor).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/teacher/messages/threads/[id]/messages
// ─────────────────────────────────────────────────────────────────────
describe('GET /api/teacher/messages/threads/[id]/messages pagination contract', () => {
  it('applies the documented default limit (100) when ?limit= is omitted', async () => {
    authedAsTeacher();
    const res = await GET_TEACHER_MESSAGES(
      makeTeacherMessagesRequest() as never,
      teacherCtx as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // The route's default = MAX_LIMIT = 100. Fixture has 150 rows, so the
    // first page is exactly 100.
    expect(json.messages.length).toBe(100);
    expect(json.hasMore).toBe(true);
    expect(json.nextCursor).toBeTruthy();
  });

  it('clamps ?limit= above the route cap (100)', async () => {
    authedAsTeacher();
    const res = await GET_TEACHER_MESSAGES(
      makeTeacherMessagesRequest('?limit=99999') as never,
      teacherCtx as never,
    );
    const json = await res.json();
    expect(json.messages.length).toBe(100);
  });

  it('?before= is honored identically to ?cursor= and is monotonic', async () => {
    authedAsTeacher();
    const page1 = await (
      await GET_TEACHER_MESSAGES(
        makeTeacherMessagesRequest('?limit=10') as never,
        teacherCtx as never,
      )
    ).json();
    expect(page1.messages.length).toBe(10);
    const cursor = page1.nextCursor as string;
    expect(typeof cursor).toBe('string');
    expect(Number.isNaN(Date.parse(cursor))).toBe(false);

    const viaCursor = await (
      await GET_TEACHER_MESSAGES(
        makeTeacherMessagesRequest(`?limit=10&cursor=${cursor}`) as never,
        teacherCtx as never,
      )
    ).json();
    const viaBefore = await (
      await GET_TEACHER_MESSAGES(
        makeTeacherMessagesRequest(`?limit=10&before=${cursor}`) as never,
        teacherCtx as never,
      )
    ).json();

    expect(viaCursor.messages.map((m: { id: string }) => m.id)).toEqual(
      viaBefore.messages.map((m: { id: string }) => m.id),
    );
    // Oldest-first chat ordering: page 2's nextCursor must be STRICTLY newer
    // than page 1's (the page advances forward in time).
    expect((viaCursor.nextCursor as string) > cursor).toBe(true);

    // Pages are disjoint.
    const ids1 = new Set(page1.messages.map((m: { id: string }) => m.id));
    for (const m of viaCursor.messages) expect(ids1.has(m.id)).toBe(false);
  });
});
