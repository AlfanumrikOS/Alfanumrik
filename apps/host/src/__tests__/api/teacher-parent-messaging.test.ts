/**
 * Phase C.3 — teacher ↔ parent messaging API contract tests.
 *
 * Pins:
 *   - Teacher POST creates a thread + first message.
 *   - Guardian POST creates a thread + first message.
 *   - Cross-role visibility: teacher-sent rows show on parent's thread
 *     list and vice versa.
 *   - Cross-tenant POSTs are rejected (403) when a teacher tries to
 *     post into another teacher's thread, or a guardian into another
 *     guardian's thread.
 *   - GET messages marks unread-from-counterparty rows read.
 *   - Empty thread list / empty message list paths.
 *   - Auth-gate denial returns 403.
 *   - Cross-tenant GET on a wrong-owner thread id returns 403.
 *
 * The Supabase chain is mocked at `supabaseAdmin.from(table)` granularity
 * with a tiny in-memory store that mirrors the columns we actually
 * touch. The state-events bus is intercepted by mocking publishEvent —
 * we only assert the route called it with the right kind/payload.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────
const { mockAuthorize, mockPublishEvent, authState } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockPublishEvent: vi.fn(),
  authState: { userId: null as string | null },
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@alfanumrik/lib/state/events/publish', () => ({
  publishEvent: (...args: unknown[]) => mockPublishEvent(...args),
}));

// ── Fixture IDs (hex only — must satisfy the shape-only UUID regex) ──
const TEACHER_AUTH_A = '11111111-aaaa-aaaa-aaaa-111111111111';
const TEACHER_AUTH_B = '11111111-bbbb-bbbb-bbbb-111111111111';
const TEACHER_ID_A   = '22222222-aaaa-aaaa-aaaa-222222222222';
const TEACHER_ID_B   = '22222222-bbbb-bbbb-bbbb-222222222222';

const GUARDIAN_AUTH_X = '33333333-cccc-cccc-cccc-333333333333';
const GUARDIAN_AUTH_Y = '33333333-dddd-dddd-dddd-333333333333';
const GUARDIAN_ID_X   = '44444444-cccc-cccc-cccc-444444444444';
const GUARDIAN_ID_Y   = '44444444-dddd-dddd-dddd-444444444444';

const STUDENT_ID_X    = '55555555-cccc-cccc-cccc-555555555555';
const STUDENT_ID_Y    = '55555555-dddd-dddd-dddd-555555555555';

const SCHOOL_ID       = '66666666-6666-6666-6666-666666666666';

// ── In-memory store ───────────────────────────────────────────────────
interface ThreadRow {
  id: string;
  teacher_id: string;
  guardian_id: string;
  student_id: string;
  school_id: string | null;
  subject: string | null;
  created_at: string;
  updated_at: string;
  last_message_at: string;
}
interface MessageRow {
  id: string;
  thread_id: string;
  sender_role: 'teacher' | 'guardian';
  sender_auth_user_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}
interface NotificationRow {
  id: string;
  recipient_id: string;
  recipient_type: string;
  type: string;
  title: string;
  message: string;
  body: string;
  data: Record<string, unknown>;
  is_read: boolean;
  created_at: string;
}

let threads: ThreadRow[];
let messages: MessageRow[];
let notifications: NotificationRow[];
// Per-table lookup tables for auth_user_id resolution.
let teachers: Array<{ id: string; auth_user_id: string; school_id: string | null; name: string }>;
let guardians: Array<{ id: string; auth_user_id: string; name: string }>;
let students:  Array<{ id: string; name: string; school_id: string | null }>;
let links:     Array<{ guardian_id: string; student_id: string; status: string }>;

let idCounter = 0;
const newId = () => `99999999-0000-0000-0000-${String(++idCounter).padStart(12, '0')}`;

function resetStore() {
  idCounter = 0;
  teachers = [
    { id: TEACHER_ID_A, auth_user_id: TEACHER_AUTH_A, school_id: SCHOOL_ID, name: 'Teacher A' },
    { id: TEACHER_ID_B, auth_user_id: TEACHER_AUTH_B, school_id: SCHOOL_ID, name: 'Teacher B' },
  ];
  guardians = [
    { id: GUARDIAN_ID_X, auth_user_id: GUARDIAN_AUTH_X, name: 'Parent X' },
    { id: GUARDIAN_ID_Y, auth_user_id: GUARDIAN_AUTH_Y, name: 'Parent Y' },
  ];
  students = [
    { id: STUDENT_ID_X, name: 'Child X', school_id: SCHOOL_ID },
    { id: STUDENT_ID_Y, name: 'Child Y', school_id: SCHOOL_ID },
  ];
  links = [
    { guardian_id: GUARDIAN_ID_X, student_id: STUDENT_ID_X, status: 'approved' },
    { guardian_id: GUARDIAN_ID_Y, student_id: STUDENT_ID_Y, status: 'approved' },
  ];
  threads = [];
  messages = [];
  notifications = [];
}

// ── Generic chain builder ────────────────────────────────────────────
// Supports .select(cols).eq.in.is.gt.order.limit.maybeSingle/single
// plus .insert.select.single, .update.eq.in
type Row = Record<string, unknown>;
function makeBuilder(tableRows: () => Row[], onInsert?: (rows: Row[]) => Row[], onUpdate?: (patch: Row, filtered: Row[]) => Row[]) {
  function selectBuilder() {
    const filters: Array<(r: Row) => boolean> = [];
    let orderAsc: boolean | null = null;
    let orderCol: string | null = null;
    let limitN: number | null = null;
    const apply = () => {
      let out = tableRows().filter((r) => filters.every((p) => p(r)));
      if (orderCol) {
        const col = orderCol;
        const asc = orderAsc !== false;
        out = [...out].sort((a, b) =>
          String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : asc ? 1 : -1,
        );
      }
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    };
    const chain = {
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return chain;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return chain;
      },
      is(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return chain;
      },
      gt(col: string, val: string) {
        filters.push((r) => String(r[col]) > val);
        return chain;
      },
      order(col: string, opt?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opt?.ascending !== false;
        return chain;
      },
      limit(n: number) {
        limitN = n;
        return chain;
      },
      async maybeSingle() {
        const r = apply();
        return { data: r[0] ?? null, error: null };
      },
      async single() {
        const r = apply();
        return r[0] ? { data: r[0], error: null } : { data: null, error: { message: 'no row' } };
      },
      then<T = { data: Row[]; error: null }>(...args: Parameters<Promise<T>['then']>) {
        return Promise.resolve({ data: apply(), error: null } as unknown as T).then(...args);
      },
    };
    return chain;
  }
  function insertChain(rowsToInsert: Row | Row[]) {
    const arr = Array.isArray(rowsToInsert) ? rowsToInsert : [rowsToInsert];
    const inserted = (onInsert?.(arr) ?? []) as Row[];
    return {
      select() {
        return {
          async single() {
            return inserted[0]
              ? { data: inserted[0], error: null }
              : { data: null, error: { message: 'insert failed' } };
          },
          async maybeSingle() {
            return { data: inserted[0] ?? null, error: null };
          },
          then<T = { data: Row[]; error: null }>(...args: Parameters<Promise<T>['then']>) {
            return Promise.resolve({ data: inserted, error: null } as unknown as T).then(...args);
          },
        };
      },
      // Direct await without .select() — used by notifications insert.
      then<T = { data: null; error: null }>(...args: Parameters<Promise<T>['then']>) {
        return Promise.resolve({ data: null, error: null } as unknown as T).then(...args);
      },
    };
  }
  function updateChain(patch: Row) {
    const filters: Array<(r: Row) => boolean> = [];
    const chain = {
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return chain;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return chain;
      },
      then<T = { data: Row[]; error: null }>(...args: Parameters<Promise<T>['then']>) {
        const matched = tableRows().filter((r) => filters.every((p) => p(r)));
        const updated = onUpdate?.(patch, matched) ?? matched;
        return Promise.resolve({ data: updated, error: null } as unknown as T).then(...args);
      },
    };
    return chain;
  }
  return {
    select() {
      return selectBuilder();
    },
    insert(r: Row | Row[]) {
      return insertChain(r);
    },
    update(patch: Row) {
      return updateChain(patch);
    },
  };
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from(table: string) {
      switch (table) {
        case 'teachers':
          return makeBuilder(() => teachers as unknown as Row[]);
        case 'guardians':
          return makeBuilder(() => guardians as unknown as Row[]);
        case 'students':
          return makeBuilder(() => students as unknown as Row[]);
        case 'guardian_student_links':
          return makeBuilder(() => links as unknown as Row[]);
        case 'teacher_parent_threads':
          return makeBuilder(
            () => threads as unknown as Row[],
            (rows) => {
              const inserted: ThreadRow[] = [];
              for (const r of rows) {
                const now = new Date().toISOString();
                const row: ThreadRow = {
                  id: newId(),
                  teacher_id:  r.teacher_id  as string,
                  guardian_id: r.guardian_id as string,
                  student_id:  r.student_id  as string,
                  school_id:   (r.school_id as string | null) ?? null,
                  subject:     (r.subject    as string | null) ?? null,
                  created_at:  now,
                  updated_at:  now,
                  last_message_at: now,
                };
                threads.push(row);
                inserted.push(row);
              }
              return inserted as unknown as Row[];
            },
          );
        case 'teacher_parent_messages':
          return makeBuilder(
            () => messages as unknown as Row[],
            (rows) => {
              const inserted: MessageRow[] = [];
              for (const r of rows) {
                const now = new Date(Date.now() + idCounter).toISOString();
                const row: MessageRow = {
                  id: newId(),
                  thread_id:           r.thread_id           as string,
                  sender_role:         r.sender_role         as 'teacher' | 'guardian',
                  sender_auth_user_id: r.sender_auth_user_id as string,
                  body:                r.body                as string,
                  created_at:          now,
                  read_at:             null,
                };
                messages.push(row);
                // Simulate trigger: bump last_message_at on the thread.
                const th = threads.find((t) => t.id === row.thread_id);
                if (th) {
                  th.last_message_at = now;
                  th.updated_at      = now;
                }
                inserted.push(row);
              }
              return inserted as unknown as Row[];
            },
            (patch, matched) => {
              for (const m of matched) Object.assign(m, patch);
              return matched;
            },
          );
        case 'notifications':
          return makeBuilder(
            () => notifications as unknown as Row[],
            (rows) => {
              const inserted: NotificationRow[] = [];
              for (const r of rows) {
                const row: NotificationRow = {
                  id: newId(),
                  recipient_id:   r.recipient_id   as string,
                  recipient_type: r.recipient_type as string,
                  type:           r.type           as string,
                  title:          r.title          as string,
                  message:        r.message        as string,
                  body:           r.body           as string,
                  data:           (r.data          as Record<string, unknown>) ?? {},
                  is_read:        false,
                  created_at:     new Date().toISOString(),
                };
                notifications.push(row);
                inserted.push(row);
              }
              return inserted as unknown as Row[];
            },
          );
        case 'state_events':
          // The mocked publishEvent never reaches here; just be safe.
          return makeBuilder(() => []);
        case 'feature_flags':
          return makeBuilder(() => []);
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
    rpc: vi.fn(),
  },
}));

vi.mock('@alfanumrik/lib/supabase-server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string, args?: Record<string, unknown>) => {
      const guardian = guardians.find((g) => g.auth_user_id === authState.userId);
      if (!guardian) {
        return { data: { success: false, error_code: 'no_guardian', error: 'Guardian account not found' }, error: null };
      }

      if (name === 'parent_send_teacher_message') {
        const body = String(args?.p_body ?? '').trim();
        let threadId = args?.p_thread_id as string | null;
        let teacherId = args?.p_teacher_id as string | null;
        let studentId = args?.p_student_id as string | null;
        let schoolId: string | null = null;
        let isNewThread = false;

        if (threadId) {
          const thread = threads.find((t) => t.id === threadId);
          if (!thread) return { data: { success: false, error_code: 'thread_not_found', error: 'Thread not found' }, error: null };
          if (thread.guardian_id !== guardian.id) {
            return { data: { success: false, error_code: 'thread_not_owned', error: 'Thread not owned by caller' }, error: null };
          }
          teacherId = thread.teacher_id;
          studentId = thread.student_id;
          schoolId = thread.school_id;
        } else {
          const linked = links.some((l) =>
            l.guardian_id === guardian.id &&
            l.student_id === studentId &&
            ['approved', 'active'].includes(l.status),
          );
          if (!linked) {
            return { data: { success: false, error_code: 'not_linked', error: 'Child not linked to your account' }, error: null };
          }
          const teacher = teachers.find((t) => t.id === teacherId);
          if (!teacher) return { data: { success: false, error_code: 'teacher_not_found', error: 'Teacher not found' }, error: null };
          schoolId = teacher.school_id;
          const existing = threads.find((t) =>
            t.teacher_id === teacherId &&
            t.guardian_id === guardian.id &&
            t.student_id === studentId,
          );
          if (existing) {
            threadId = existing.id;
          } else {
            const now = new Date().toISOString();
            threadId = newId();
            threads.push({
              id: threadId,
              teacher_id: teacherId!,
              guardian_id: guardian.id,
              student_id: studentId!,
              school_id: schoolId,
              subject: (args?.p_subject as string | null) ?? null,
              created_at: now,
              updated_at: now,
              last_message_at: now,
            });
            isNewThread = true;
          }
        }

        const now = new Date(Date.now() + idCounter).toISOString();
        const messageId = newId();
        messages.push({
          id: messageId,
          thread_id: threadId!,
          sender_role: 'guardian',
          sender_auth_user_id: authState.userId!,
          body,
          created_at: now,
          read_at: null,
        });
        const thread = threads.find((t) => t.id === threadId);
        if (thread) {
          thread.last_message_at = now;
          thread.updated_at = now;
        }

        await mockPublishEvent(null, {
          kind: 'parent.teacher_message_sent',
          payload: { threadId, messageId, teacherId, guardianId: guardian.id, studentId, bodyLength: body.length, isNewThread },
        });

        notifications.push({
          id: newId(),
          recipient_id: teacherId!,
          recipient_type: 'teacher',
          type: 'parent_message',
          title: `New message from ${guardian.name ?? 'A parent'}`,
          message: body.length > 200 ? `${body.slice(0, 200)}...` : body,
          body: body.length > 200 ? `${body.slice(0, 200)}...` : body,
          data: { thread_id: threadId, message_id: messageId, student_id: studentId },
          is_read: false,
          created_at: new Date().toISOString(),
        });

        return { data: { success: true, thread_id: threadId, message_id: messageId, is_new_thread: isNewThread }, error: null };
      }

      if (name === 'parent_list_message_threads') {
        const limit = Math.min(Math.max(Number(args?.p_limit ?? 50), 1), 50);
        const rows = threads
          .filter((t) => t.guardian_id === guardian.id)
          .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at))
          .slice(0, limit)
          .map((thread) => {
            const latest = [...messages]
              .filter((m) => m.thread_id === thread.id)
              .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
            const unread_count = messages.filter((m) =>
              m.thread_id === thread.id &&
              m.sender_role === 'teacher' &&
              m.read_at === null,
            ).length;
            return {
              ...thread,
              teacher_name: teachers.find((t) => t.id === thread.teacher_id)?.name ?? null,
              student_name: students.find((s) => s.id === thread.student_id)?.name ?? null,
              last_message_preview: latest ? (latest.body.length > 120 ? `${latest.body.slice(0, 120)}...` : latest.body) : null,
              last_message_sender_role: latest?.sender_role ?? null,
              unread_count,
            };
          });
        return {
          data: { success: true, threads: rows, unreadTotal: rows.reduce((sum, row) => sum + row.unread_count, 0) },
          error: null,
        };
      }

      if (name === 'parent_list_thread_messages') {
        const threadId = args?.p_thread_id as string;
        const thread = threads.find((t) => t.id === threadId);
        if (!thread) return { data: { success: false, error_code: 'thread_not_found', error: 'Thread not found' }, error: null };
        if (thread.guardian_id !== guardian.id) {
          return { data: { success: false, error_code: 'thread_not_owned', error: 'Thread not owned by caller' }, error: null };
        }
        const cursor = args?.p_cursor ? String(args.p_cursor) : null;
        const limit = Math.min(Math.max(Number(args?.p_limit ?? 100), 1), 100);
        const all = messages
          .filter((m) => m.thread_id === threadId && (!cursor || m.created_at > cursor))
          .sort((a, b) => a.created_at.localeCompare(b.created_at));
        const page = all.slice(0, limit);
        const hasMore = all.length > limit;
        const readAt = new Date().toISOString();
        for (const m of page) {
          if (m.sender_role === 'teacher' && m.read_at === null) m.read_at = readAt;
        }
        return {
          data: {
            success: true,
            messages: page,
            nextCursor: hasMore ? page[page.length - 1]?.created_at ?? null : null,
            hasMore,
          },
          error: null,
        };
      }

      return { data: null, error: { message: `unexpected rpc: ${name}` } };
    },
  }),
}));

// Import routes after mocks. Tests reference Web `Request` / `Response`.
import { POST as TEACHER_POST } from '@/app/api/teacher/messages/route';
import { GET  as TEACHER_THREADS } from '@/app/api/teacher/messages/threads/route';
import { GET  as TEACHER_MESSAGES } from '@/app/api/teacher/messages/threads/[id]/messages/route';
import { POST as PARENT_POST } from '@/app/api/parent/messages/route';
import { GET  as PARENT_THREADS } from '@/app/api/parent/messages/threads/route';
import { GET  as PARENT_MESSAGES } from '@/app/api/parent/messages/threads/[id]/messages/route';

// ── helpers ──────────────────────────────────────────────────────────
function authedAs(authUserId: string, permissions: string[]) {
  authState.userId = authUserId;
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: authUserId,
    studentId: null,
    roles: ['teacher'],
    permissions,
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

function postRequest(url: string, body: unknown): Request {
  return new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getRequest(url: string): Request {
  return new Request(`http://localhost${url}`, { method: 'GET' });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  // publishEvent default: succeed silently.
  mockPublishEvent.mockResolvedValue({ published: true });
});

// ── teacher POST ──────────────────────────────────────────────────────
describe('POST /api/teacher/messages', () => {
  it('creates a thread and first message when no thread_id supplied', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        guardian_id: GUARDIAN_ID_X,
        student_id:  STUDENT_ID_X,
        body:        'Hello parent, your child is doing well.',
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.is_new_thread).toBe(true);
    expect(threads).toHaveLength(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].sender_role).toBe('teacher');
    // Spine event was emitted.
    expect(mockPublishEvent).toHaveBeenCalledTimes(1);
    expect(mockPublishEvent.mock.calls[0][1].kind).toBe('teacher.parent_message_sent');
    // Notification row for the guardian was created.
    expect(notifications.filter((n) => n.recipient_id === GUARDIAN_ID_X && n.recipient_type === 'guardian')).toHaveLength(1);
  });

  it('appends to existing thread when thread_id supplied', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    // Seed thread.
    threads.push({
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      teacher_id: TEACHER_ID_A,
      guardian_id: GUARDIAN_ID_X,
      student_id: STUDENT_ID_X,
      school_id: SCHOOL_ID,
      subject: null,
      created_at: '2026-05-15T10:00:00.000Z',
      updated_at: '2026-05-15T10:00:00.000Z',
      last_message_at: '2026-05-15T10:00:00.000Z',
    });
    const res = await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        thread_id: 'aaaaaaaa-0000-0000-0000-000000000001',
        body:      'Follow-up — math test on Friday.',
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_new_thread).toBe(false);
    expect(threads).toHaveLength(1); // no new thread
    expect(messages).toHaveLength(1);
  });

  it('rejects cross-tenant thread_id with 403 (teacher A → teacher B thread)', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    threads.push({
      id: 'bbbbbbbb-0000-0000-0000-000000000001',
      teacher_id: TEACHER_ID_B, // owned by B, not A
      guardian_id: GUARDIAN_ID_Y,
      student_id: STUDENT_ID_Y,
      school_id: SCHOOL_ID,
      subject: null,
      created_at: '2026-05-15T10:00:00.000Z',
      updated_at: '2026-05-15T10:00:00.000Z',
      last_message_at: '2026-05-15T10:00:00.000Z',
    });
    const res = await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        thread_id: 'bbbbbbbb-0000-0000-0000-000000000001',
        body:      'should fail',
      }) as never,
    );
    expect(res.status).toBe(403);
    expect(messages).toHaveLength(0);
    expect(mockPublishEvent).not.toHaveBeenCalled();
  });

  it('returns 404 when the guardian/student pair has no approved link', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    // Strip links.
    links = [];
    const res = await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        guardian_id: GUARDIAN_ID_X,
        student_id:  STUDENT_ID_X,
        body:        'no link → no thread',
      }) as never,
    );
    expect(res.status).toBe(404);
    expect(threads).toHaveLength(0);
  });

  it('resolves the primary guardian when only student_id supplied', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        // No guardian_id — the route resolves the primary linked guardian.
        student_id: STUDENT_ID_X,
        body:       'hello via student-only path',
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_new_thread).toBe(true);
    expect(threads).toHaveLength(1);
    expect(threads[0].guardian_id).toBe(GUARDIAN_ID_X);
  });

  it('rejects 400 on empty body', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        guardian_id: GUARDIAN_ID_X,
        student_id:  STUDENT_ID_X,
        body:        '   ',
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  it('403s when auth gate denies', async () => {
    unauthorized();
    const res = await TEACHER_POST(
      postRequest('/api/teacher/messages', { guardian_id: GUARDIAN_ID_X, student_id: STUDENT_ID_X, body: 'x' }) as never,
    );
    expect(res.status).toBe(403);
  });
});

// ── parent POST ──────────────────────────────────────────────────────
describe('POST /api/parent/messages', () => {
  it('creates a thread and first message when no thread_id supplied', async () => {
    authedAs(GUARDIAN_AUTH_X, ['child.view_progress']);
    const res = await PARENT_POST(
      postRequest('/api/parent/messages', {
        teacher_id: TEACHER_ID_A,
        student_id: STUDENT_ID_X,
        body:       'Thanks for the update.',
      }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.is_new_thread).toBe(true);
    expect(messages[0].sender_role).toBe('guardian');
    expect(mockPublishEvent.mock.calls[0][1].kind).toBe('parent.teacher_message_sent');
    // Notification row for teacher.
    expect(notifications.filter((n) => n.recipient_id === TEACHER_ID_A && n.recipient_type === 'teacher')).toHaveLength(1);
  });

  it('rejects when guardian is not linked to the named student', async () => {
    authedAs(GUARDIAN_AUTH_X, ['child.view_progress']);
    // X is only linked to STUDENT_ID_X; trying STUDENT_ID_Y should 404.
    const res = await PARENT_POST(
      postRequest('/api/parent/messages', {
        teacher_id: TEACHER_ID_A,
        student_id: STUDENT_ID_Y,
        body:       'should fail',
      }) as never,
    );
    expect(res.status).toBe(404);
  });

  it('rejects cross-tenant thread_id (guardian X → guardian Y thread)', async () => {
    authedAs(GUARDIAN_AUTH_X, ['child.view_progress']);
    threads.push({
      id: 'cccccccc-0000-0000-0000-000000000001',
      teacher_id: TEACHER_ID_A,
      guardian_id: GUARDIAN_ID_Y, // owned by Y, not X
      student_id: STUDENT_ID_Y,
      school_id: SCHOOL_ID,
      subject: null,
      created_at: '2026-05-15T10:00:00.000Z',
      updated_at: '2026-05-15T10:00:00.000Z',
      last_message_at: '2026-05-15T10:00:00.000Z',
    });
    const res = await PARENT_POST(
      postRequest('/api/parent/messages', {
        thread_id: 'cccccccc-0000-0000-0000-000000000001',
        body:      'cross-tenant',
      }) as never,
    );
    expect(res.status).toBe(403);
  });
});

// ── cross-role visibility ────────────────────────────────────────────
describe('cross-role visibility', () => {
  it('teacher A sends → parent X sees the thread in their list', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        guardian_id: GUARDIAN_ID_X,
        student_id:  STUDENT_ID_X,
        body:        'first message',
      }) as never,
    );

    // Switch identity to parent X and call /api/parent/messages/threads.
    authedAs(GUARDIAN_AUTH_X, ['child.view_progress']);
    const res = await PARENT_THREADS(getRequest('/api/parent/messages/threads') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.threads).toHaveLength(1);
    expect(json.threads[0].guardian_id).toBe(GUARDIAN_ID_X);
    expect(json.threads[0].teacher_id).toBe(TEACHER_ID_A);
    expect(json.threads[0].last_message_preview).toBe('first message');
    // The teacher-sent message is unread from the parent's perspective.
    expect(json.unreadTotal).toBe(1);
  });

  it('parent X sends → teacher A sees the thread in their list', async () => {
    authedAs(GUARDIAN_AUTH_X, ['child.view_progress']);
    await PARENT_POST(
      postRequest('/api/parent/messages', {
        teacher_id: TEACHER_ID_A,
        student_id: STUDENT_ID_X,
        body:       'from parent',
      }) as never,
    );

    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await TEACHER_THREADS(getRequest('/api/teacher/messages/threads') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.threads).toHaveLength(1);
    expect(json.threads[0].last_message_preview).toBe('from parent');
    expect(json.unreadTotal).toBe(1);
  });
});

// ── GET messages list + read marking ──────────────────────────────────
describe('GET threads/[id]/messages — read marking', () => {
  it('marks teacher-sent rows read when the parent reads', async () => {
    // Teacher sends two messages.
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const first = await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        guardian_id: GUARDIAN_ID_X,
        student_id:  STUDENT_ID_X,
        body:        'msg 1',
      }) as never,
    );
    const j1 = await first.json();
    await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        thread_id: j1.thread_id,
        body:      'msg 2',
      }) as never,
    );

    // Parent reads.
    authedAs(GUARDIAN_AUTH_X, ['child.view_progress']);
    const res = await PARENT_MESSAGES(
      getRequest(`/api/parent/messages/threads/${j1.thread_id}/messages`) as never,
      { params: Promise.resolve({ id: j1.thread_id }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toHaveLength(2);
    for (const m of json.messages) {
      expect(m.read_at).toBeTruthy();
    }
    // unreadTotal should now be 0 from the parent's perspective.
    const threadsList = await (await PARENT_THREADS(getRequest('/api/parent/messages/threads') as never)).json();
    expect(threadsList.unreadTotal).toBe(0);
  });

  it('marks guardian-sent rows read when the teacher reads', async () => {
    authedAs(GUARDIAN_AUTH_X, ['child.view_progress']);
    const sent = await PARENT_POST(
      postRequest('/api/parent/messages', {
        teacher_id: TEACHER_ID_A,
        student_id: STUDENT_ID_X,
        body:       'from parent',
      }) as never,
    );
    const j = await sent.json();
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await TEACHER_MESSAGES(
      getRequest(`/api/teacher/messages/threads/${j.thread_id}/messages`) as never,
      { params: Promise.resolve({ id: j.thread_id }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages.every((m: { read_at: string | null }) => m.read_at !== null)).toBe(true);
  });

  it('rejects cross-tenant GET of a thread not owned by the caller (403)', async () => {
    // Teacher A creates thread.
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const sent = await TEACHER_POST(
      postRequest('/api/teacher/messages', {
        guardian_id: GUARDIAN_ID_X,
        student_id:  STUDENT_ID_X,
        body:        'x',
      }) as never,
    );
    const j = await sent.json();

    // Teacher B tries to read it.
    authedAs(TEACHER_AUTH_B, ['class.manage']);
    const res = await TEACHER_MESSAGES(
      getRequest(`/api/teacher/messages/threads/${j.thread_id}/messages`) as never,
      { params: Promise.resolve({ id: j.thread_id }) },
    );
    expect(res.status).toBe(403);

    // Guardian Y tries to read parent X's thread.
    authedAs(GUARDIAN_AUTH_Y, ['child.view_progress']);
    const res2 = await PARENT_MESSAGES(
      getRequest(`/api/parent/messages/threads/${j.thread_id}/messages`) as never,
      { params: Promise.resolve({ id: j.thread_id }) },
    );
    expect(res2.status).toBe(403);
  });
});

// ── empty lists ──────────────────────────────────────────────────────
describe('empty lists', () => {
  it('teacher with no threads gets [] and unreadTotal=0', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await TEACHER_THREADS(getRequest('/api/teacher/messages/threads') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.threads).toEqual([]);
    expect(json.unreadTotal).toBe(0);
  });

  it('parent with no threads gets [] and unreadTotal=0', async () => {
    authedAs(GUARDIAN_AUTH_X, ['child.view_progress']);
    const res = await PARENT_THREADS(getRequest('/api/parent/messages/threads') as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.threads).toEqual([]);
    expect(json.unreadTotal).toBe(0);
  });

  it('empty message list (thread with no messages) returns [] not error', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    threads.push({
      id: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa',
      teacher_id: TEACHER_ID_A,
      guardian_id: GUARDIAN_ID_X,
      student_id: STUDENT_ID_X,
      school_id: SCHOOL_ID,
      subject: null,
      created_at: '2026-05-15T10:00:00.000Z',
      updated_at: '2026-05-15T10:00:00.000Z',
      last_message_at: '2026-05-15T10:00:00.000Z',
    });
    const res = await TEACHER_MESSAGES(
      getRequest('/api/teacher/messages/threads/aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa/messages') as never,
      { params: Promise.resolve({ id: 'aaaaaaaa-1111-1111-1111-aaaaaaaaaaaa' }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toEqual([]);
  });
});
