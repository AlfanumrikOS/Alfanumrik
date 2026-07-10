/**
 * /api/parent/notifications — Phase C.5 contract tests.
 *
 * Pins:
 *   - GET returns caller's notifications sorted DESC + unreadCount.
 *   - GET respects ?filter=unread.
 *   - GET 404s when no guardian row matches the auth user.
 *   - GET 403s when the auth gate denies.
 *   - PATCH /[id]/read updates only the caller's row (cross-parent → 403).
 *   - PATCH /[id]/read rejects invalid UUIDs (400).
 *   - mark-all-read updates only caller's rows.
 *   - mark-all-read returns 0 when nothing was unread.
 *   - All routes 403 on auth-gate denial.
 *   - Logger silenced.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Auth gate mock ───────────────────────────────────────────────────
const { mockAuthorize, mockRpc } = vi.hoisted(() => ({ mockAuthorize: vi.fn(), mockRpc: vi.fn() }));
vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

// ── Logger silencer ──────────────────────────────────────────────────
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    getAll: vi.fn(() => []),
    setAll: vi.fn(),
  })),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    rpc: mockRpc,
  })),
}));

// ── Supabase chain mock ──────────────────────────────────────────────
// Notifications table model:
//   notifications: id, recipient_id, recipient_type, title, message,
//                  body, type, data, is_read, read_at, created_at,
//                  delivery_channel
// We simulate two parents (P1, P2) and a small notifications table.

const PARENT_AUTH = '11111111-1111-1111-1111-111111111111';
const PARENT_ID = '22222222-2222-2222-2222-222222222222';
const OTHER_PARENT_ID = '33333333-3333-3333-3333-333333333333';
const repoRoot = path.resolve(__dirname, '../../../../..');

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

function fixture(): NotifRow[] {
  return [
    {
      id: '00000000-0000-0000-0000-000000000001',
      recipient_id: PARENT_ID,
      recipient_type: 'guardian',
      title: 'Quiz score posted',
      message: 'Aarav scored 80%',
      body: 'Full breakdown — math chapter 4 quiz, 8/10.',
      type: 'quiz_score',
      data: {},
      is_read: false,
      read_at: null,
      created_at: '2026-05-15T10:00:00.000Z',
      delivery_channel: 'in_app',
    },
    {
      id: '00000000-0000-0000-0000-000000000002',
      recipient_id: PARENT_ID,
      recipient_type: 'guardian',
      title: 'Weekly report ready',
      message: '5 quizzes this week',
      body: null,
      type: 'weekly_report',
      data: {},
      is_read: true,
      read_at: '2026-05-14T12:00:00.000Z',
      created_at: '2026-05-14T09:00:00.000Z',
      delivery_channel: 'in_app',
    },
    // OTHER parent's row — must NEVER leak.
    {
      id: '00000000-0000-0000-0000-000000000099',
      recipient_id: OTHER_PARENT_ID,
      recipient_type: 'guardian',
      title: 'Cross-parent secret',
      message: 'leak',
      body: null,
      type: 'misc',
      data: {},
      is_read: false,
      read_at: null,
      created_at: '2026-05-15T11:00:00.000Z',
      delivery_channel: 'in_app',
    },
  ];
}

let table: NotifRow[];
let guardianRow: { id: string } | null;

function notificationsBuilder() {
  // The route uses two distinct chains on this table:
  //   1. .select(cols).eq.eq.[eq?].[lt?].order.limit          → list
  //   2. .select('id', { count: 'exact', head: true }).eq.eq.eq → unread count
  //   3. .update(patch).eq.eq.eq.[eq].select(cols).maybeSingle | .select
  //
  // We reify the filter chain into an array of predicates that resolve at
  // the terminal `.limit()` / `.maybeSingle()` / `await` step.

  type Pred = (row: NotifRow) => boolean;
  const buildSelectChain = (opts?: { count?: string; head?: boolean }) => {
    const filters: Pred[] = [];
    let lt: { col: keyof NotifRow; val: string } | null = null;
    let orderDesc = false;
    let limitN: number | null = null;
    const chain = {
      eq(col: string, val: unknown) {
        filters.push(row => (row as Record<string, unknown>)[col] === val);
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
      // For maybeSingle (cursor-less unused path)
      async maybeSingle() {
        const r = applyFilters();
        return { data: r[0] ?? null, error: null };
      },
      // Allow `await` directly on the head:true count-only chain
      then(...args: Parameters<Promise<unknown>['then']>) {
        return resolve().then(...args);
      },
    };
    function applyFilters(): NotifRow[] {
      let out = table.filter(r => filters.every(p => p(r)));
      if (lt) out = out.filter(r => String(r[lt!.col]) < lt!.val);
      if (orderDesc) out = [...out].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    }
    function resolve() {
      if (opts?.head) {
        // count-only HEAD query: return { count, error }
        const c = table.filter(r => filters.every(p => p(r))).length;
        return Promise.resolve({ data: null, count: c, error: null });
      }
      return Promise.resolve({ data: applyFilters(), error: null });
    }
    return chain;
  };

  const buildUpdateChain = (patch: Partial<NotifRow>) => {
    const filters: Array<(row: NotifRow) => boolean> = [];
    const chain = {
      eq(col: string, val: unknown) {
        filters.push(row => (row as Record<string, unknown>)[col] === val);
        return chain;
      },
      select(_cols?: string) {
        const applyAndUpdate = () => {
          const matched = table.filter(r => filters.every(p => p(r)));
          for (const m of matched) Object.assign(m, patch);
          return matched;
        };
        const inner = {
          async maybeSingle() {
            const r = applyAndUpdate();
            return { data: r[0] ?? null, error: null };
          },
          then(...args: Parameters<Promise<unknown>['then']>) {
            return Promise.resolve({ data: applyAndUpdate(), error: null }).then(...args);
          },
        };
        return inner;
      },
    };
    return chain;
  };

  return {
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      return buildSelectChain(opts);
    },
    update(patch: Partial<NotifRow>) {
      return buildUpdateChain(patch);
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
              return { data: guardianRow, error: null };
            },
          };
        },
      };
    },
  };
}

function handleNotificationsRpc(name: string, args?: Record<string, unknown>) {
  if (!guardianRow) {
    return { success: false, status: 404, error: 'Guardian account not found' };
  }

  if (name === 'parent_list_notifications') {
    const limit = Math.min(Math.max(Number(args?.p_limit ?? 50), 1), 50);
    const filter = args?.p_filter === 'unread' ? 'unread' : 'all';
    const cursor = typeof args?.p_cursor === 'string' ? args.p_cursor : null;
    let rows = table.filter(
      row => row.recipient_id === guardianRow!.id && row.recipient_type === 'guardian',
    );

    if (filter === 'unread') rows = rows.filter(row => row.is_read === false);
    if (cursor) rows = rows.filter(row => row.created_at < cursor);
    rows = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const pagePlusOne = rows.slice(0, limit + 1);
    const hasMore = pagePlusOne.length > limit;
    const page = hasMore ? pagePlusOne.slice(0, limit) : pagePlusOne;
    const unreadCount = table.filter(
      row =>
        row.recipient_id === guardianRow!.id &&
        row.recipient_type === 'guardian' &&
        row.is_read === false,
    ).length;

    return {
      success: true,
      data: {
        items: page,
        nextCursor: hasMore ? page.at(-1)?.created_at ?? null : null,
        hasMore,
        unreadCount,
      },
    };
  }

  if (name === 'parent_mark_notification_read') {
    const id = args?.p_notification_id;
    const row = table.find(
      candidate =>
        candidate.id === id &&
        candidate.recipient_id === guardianRow!.id &&
        candidate.recipient_type === 'guardian',
    );
    if (!row) {
      return { success: false, status: 403, error: 'Notification not found or not owned' };
    }

    row.is_read = true;
    row.read_at = new Date().toISOString();
    return { success: true, data: { id: row.id, read_at: row.read_at } };
  }

  if (name === 'parent_mark_all_notifications_read') {
    let updated = 0;
    for (const row of table) {
      if (
        row.recipient_id === guardianRow!.id &&
        row.recipient_type === 'guardian' &&
        row.is_read === false
      ) {
        row.is_read = true;
        row.read_at = new Date().toISOString();
        updated += 1;
      }
    }

    return { success: true, data: { updated } };
  }

  throw new Error(`unexpected rpc: ${name}`);
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from(table: string) {
      if (table === 'notifications') return notificationsBuilder();
      if (table === 'guardians') return guardiansBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  },
}));

import { GET } from '@/app/api/parent/notifications/route';
import { PATCH } from '@/app/api/parent/notifications/[id]/read/route';
import { POST as MARK_ALL } from '@/app/api/parent/notifications/mark-all-read/route';

// ── Helpers ──────────────────────────────────────────────────────────
function authedAs(userId: string = PARENT_AUTH) {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId,
    studentId: null,
    roles: ['parent'],
    permissions: ['child.receive_alerts'],
  });
}

function unauthorized(status = 403) {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    studentId: null,
    roles: [],
    permissions: [],
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'Forbidden' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

function makeGetRequest(query = ''): Request {
  return new Request(`http://localhost/api/parent/notifications${query}`, { method: 'GET' });
}
function makePatchRequest(): Request {
  return new Request('http://localhost/api/parent/notifications/x/read', { method: 'PATCH' });
}
function makePostRequest(): Request {
  return new Request('http://localhost/api/parent/notifications/mark-all-read', { method: 'POST' });
}

beforeEach(() => {
  vi.clearAllMocks();
  table = fixture();
  guardianRow = { id: PARENT_ID };
  mockRpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => ({
    data: handleNotificationsRpc(name, args),
    error: null,
  }));
});

// ── GET /api/parent/notifications ────────────────────────────────────
describe('GET /api/parent/notifications', () => {
  it('returns the caller\'s notifications sorted DESC with unreadCount', async () => {
    authedAs();
    const res = await GET(makeGetRequest() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.items.map((i: { id: string }) => i.id)).toEqual([
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
    ]);
    // The OTHER parent's row must not leak.
    expect(json.items.find((i: { id: string }) => i.id.endsWith('99'))).toBeUndefined();
    expect(json.unreadCount).toBe(1);
  });

  it('respects ?filter=unread', async () => {
    authedAs();
    const res = await GET(makeGetRequest('?filter=unread') as never);
    const json = await res.json();
    expect(json.items).toHaveLength(1);
    expect(json.items[0].is_read).toBe(false);
  });

  it('returns 404 when the auth user has no guardian row', async () => {
    authedAs();
    guardianRow = null;
    const res = await GET(makeGetRequest() as never);
    expect(res.status).toBe(404);
  });

  it('returns 403 when the auth gate denies', async () => {
    unauthorized();
    const res = await GET(makeGetRequest() as never);
    expect(res.status).toBe(403);
  });
});

// ── PATCH /api/parent/notifications/[id]/read ────────────────────────
describe('PATCH /api/parent/notifications/[id]/read', () => {
  it('marks the caller\'s notification read and returns its read_at', async () => {
    authedAs();
    const res = await PATCH(makePatchRequest() as never, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.id).toBe('00000000-0000-0000-0000-000000000001');
    expect(json.read_at).toBeTruthy();
    // The mocked row was mutated in place.
    const row = table.find(r => r.id === '00000000-0000-0000-0000-000000000001');
    expect(row?.is_read).toBe(true);
    expect(row?.read_at).toBeTruthy();
  });

  it('rejects cross-parent ids with 403 (ownership pinned in WHERE clause)', async () => {
    authedAs();
    const res = await PATCH(makePatchRequest() as never, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000099' }),
    });
    expect(res.status).toBe(403);
    // The OTHER parent's row must still be untouched.
    const row = table.find(r => r.id === '00000000-0000-0000-0000-000000000099');
    expect(row?.is_read).toBe(false);
  });

  it('rejects invalid UUIDs with 400', async () => {
    authedAs();
    const res = await PATCH(makePatchRequest() as never, {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 403 when the auth gate denies', async () => {
    unauthorized();
    const res = await PATCH(makePatchRequest() as never, {
      params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
    });
    expect(res.status).toBe(403);
  });
});

// ── POST /api/parent/notifications/mark-all-read ─────────────────────
describe('POST /api/parent/notifications/mark-all-read', () => {
  it('updates only the caller\'s unread rows', async () => {
    authedAs();
    const res = await MARK_ALL(makePostRequest() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updated).toBe(1); // only one caller row was unread
    // Caller's rows are now all read.
    const callerUnread = table.filter(
      r => r.recipient_id === PARENT_ID && r.recipient_type === 'guardian' && !r.is_read,
    );
    expect(callerUnread).toHaveLength(0);
    // The OTHER parent's row remains untouched.
    const otherRow = table.find(r => r.recipient_id === OTHER_PARENT_ID);
    expect(otherRow?.is_read).toBe(false);
  });

  it('returns updated=0 when nothing was unread', async () => {
    authedAs();
    // Pre-mark the only unread row.
    const row = table.find(r => r.id === '00000000-0000-0000-0000-000000000001');
    if (row) row.is_read = true;
    const res = await MARK_ALL(makePostRequest() as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.updated).toBe(0);
  });

  it('returns 403 when the auth gate denies', async () => {
    unauthorized();
    const res = await MARK_ALL(makePostRequest() as never);
    expect(res.status).toBe(403);
  });
});

describe('XC-3 parent notifications route source contract', () => {
  it('uses scoped authenticated notification RPCs instead of route-level service-role access', () => {
    const routes = [
      {
        path: 'apps/host/src/app/api/parent/notifications/route.ts',
        rpc: 'parent_list_notifications',
      },
      {
        path: 'apps/host/src/app/api/parent/notifications/[id]/read/route.ts',
        rpc: 'parent_mark_notification_read',
      },
      {
        path: 'apps/host/src/app/api/parent/notifications/mark-all-read/route.ts',
        rpc: 'parent_mark_all_notifications_read',
      },
    ];

    for (const route of routes) {
      const sourcePath = path.join(repoRoot, route.path);
      expect(existsSync(sourcePath), `${route.path} must exist`).toBe(true);
      const source = readFileSync(sourcePath, 'utf8');

      expect(source).toContain(`rpc('${route.rpc}'`);
      expect(source).not.toContain('@alfanumrik/lib/supabase-admin');
      expect(source).not.toMatch(/\.from\(['"]guardians['"]\)/);
      expect(source).not.toMatch(/\.from\(['"]notifications['"]\)/);
    }
  });
});
