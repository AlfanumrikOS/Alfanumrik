/**
 * Phase 3A Wave D (backend) — POST /api/teacher/parent-notify contract tests.
 *
 * The "tell the parent" capability: a teacher (e.g. on a remediation resolve)
 * fires a single POST that finds-or-creates the teacher↔parent thread and
 * appends a templated (or custom) message, REUSING the existing
 * teacher_parent_threads / teacher_parent_messages infra. No new table, no new
 * permission — gated on `class.manage`, the same gate the rest of the teacher
 * messaging surface uses.
 *
 * Pins:
 *   - Auth gate: 401/403 when authorizeRequest denies.
 *   - Roster boundary (P8): a student NOT on the caller's roster → 403, no
 *     thread/message written.
 *   - No linked guardian → clean 409 { no_guardian: true }, NOT an error, no
 *     message sent (the UI shows "no parent linked").
 *   - Happy path: find-or-create thread + append a TEMPLATED message with
 *     sender_role='teacher'; returns { thread_id, message_id }.
 *   - Find path: an existing (teacher, guardian, student) thread is REUSED
 *     (no duplicate thread row).
 *   - Custom-message path: a provided `message` is used verbatim (sanitised).
 *   - include_report: appends an inline progress summary line (mastery /
 *     recent avg) — the "attachment" is an inline text summary, migration-free.
 *
 * The Supabase chain is mocked at `supabaseAdmin.from(table)` granularity with a
 * tiny in-memory store mirroring only the columns the route touches — the same
 * approach as teacher-parent-messaging.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────
const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));

vi.mock('@/lib/rbac', () => ({
  authorizeRequest: (...args: unknown[]) => mockAuthorize(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Fixture IDs (hex only — satisfy the shape-only UUID regex) ────────
const TEACHER_AUTH_A = '11111111-aaaa-aaaa-aaaa-111111111111';
const TEACHER_ID_A   = '22222222-aaaa-aaaa-aaaa-222222222222';
const TEACHER_ID_B   = '22222222-bbbb-bbbb-bbbb-222222222222';

const GUARDIAN_ID_X  = '44444444-cccc-cccc-cccc-444444444444';

const STUDENT_ID_X   = '55555555-cccc-cccc-cccc-555555555555'; // on roster, linked
const STUDENT_OFF    = '55555555-ffff-ffff-ffff-555555555555'; // NOT on roster
const STUDENT_NOLINK = '55555555-dddd-dddd-dddd-555555555555'; // on roster, NO guardian

const CLASS_ID       = '77777777-7777-7777-7777-777777777777';
const SCHOOL_ID      = '66666666-6666-6666-6666-666666666666';
const CHAPTER_ID     = '88888888-8888-8888-8888-888888888888';
const REMEDIATION_ID = '99999999-aaaa-aaaa-aaaa-999999999999';

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

let threads: ThreadRow[];
let messages: MessageRow[];
let notifications: Array<Record<string, unknown>>;
let teachers: Array<{ id: string; auth_user_id: string; school_id: string | null }>;
let students: Array<{ id: string; name: string; grade: string | null }>;
let classTeachers: Array<{ teacher_id: string; class_id: string }>;
let classStudents: Array<{ class_id: string; student_id: string }>;
let links: Array<{ guardian_id: string; student_id: string; status: string; created_at: string }>;
let remediations: Array<{ id: string; teacher_id: string; student_id: string; chapter_id: string | null; status: string }>;
let topics: Array<{ id: string; title: string }>;
let bktRows: Array<{ student_id: string; p_know: number }>;
let quizSessions: Array<{ student_id: string; score_percent: number | null; completed_at: string | null }>;

let idCounter = 0;
const newId = () => `aaaaaaaa-0000-0000-0000-${String(++idCounter).padStart(12, '0')}`;

function resetStore() {
  idCounter = 0;
  teachers = [{ id: TEACHER_ID_A, auth_user_id: TEACHER_AUTH_A, school_id: SCHOOL_ID }];
  students = [
    { id: STUDENT_ID_X, name: 'Aarav Sharma', grade: '7' },
    { id: STUDENT_OFF, name: 'Other Kid', grade: '7' },
    { id: STUDENT_NOLINK, name: 'Riya Verma', grade: '8' },
  ];
  classTeachers = [{ teacher_id: TEACHER_ID_A, class_id: CLASS_ID }];
  classStudents = [
    { class_id: CLASS_ID, student_id: STUDENT_ID_X },
    { class_id: CLASS_ID, student_id: STUDENT_NOLINK },
  ];
  links = [
    { guardian_id: GUARDIAN_ID_X, student_id: STUDENT_ID_X, status: 'approved', created_at: '2026-01-01T00:00:00.000Z' },
  ];
  remediations = [
    { id: REMEDIATION_ID, teacher_id: TEACHER_ID_A, student_id: STUDENT_ID_X, chapter_id: CHAPTER_ID, status: 'resolved' },
  ];
  topics = [{ id: CHAPTER_ID, title: 'Fractions' }];
  bktRows = [
    { student_id: STUDENT_ID_X, p_know: 0.8 },
    { student_id: STUDENT_ID_X, p_know: 0.6 },
  ];
  quizSessions = [
    { student_id: STUDENT_ID_X, score_percent: 80, completed_at: '2026-06-01T00:00:00.000Z' },
    { student_id: STUDENT_ID_X, score_percent: 90, completed_at: '2026-06-02T00:00:00.000Z' },
  ];
  threads = [];
  messages = [];
  notifications = [];
}

// ── Generic chain builder (subset used by the route) ──────────────────
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
        out = [...out].sort((a, b) => (String(a[col]) < String(b[col]) ? (asc ? -1 : 1) : asc ? 1 : -1));
      }
      if (limitN !== null) out = out.slice(0, limitN);
      return out;
    };
    const chain = {
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return chain; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return chain; },
      is(col: string, val: unknown) { filters.push((r) => r[col] === val); return chain; },
      not(col: string, _op: string, val: unknown) {
        // Only `.not('completed_at','is',null)` is used — keep completed rows.
        filters.push((r) => (val === null ? r[col] !== null && r[col] !== undefined : r[col] !== val));
        return chain;
      },
      order(col: string, opt?: { ascending?: boolean }) { orderCol = col; orderAsc = opt?.ascending !== false; return chain; },
      limit(n: number) { limitN = n; return chain; },
      async maybeSingle() { const r = apply(); return { data: r[0] ?? null, error: null }; },
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
            return inserted[0] ? { data: inserted[0], error: null } : { data: null, error: { message: 'insert failed' } };
          },
          async maybeSingle() { return { data: inserted[0] ?? null, error: null }; },
        };
      },
      then<T = { data: null; error: null }>(...args: Parameters<Promise<T>['then']>) {
        return Promise.resolve({ data: null, error: null } as unknown as T).then(...args);
      },
    };
  }
  function updateChain(patch: Row) {
    const filters: Array<(r: Row) => boolean> = [];
    const chain = {
      eq(col: string, val: unknown) { filters.push((r) => r[col] === val); return chain; },
      in(col: string, vals: unknown[]) { filters.push((r) => vals.includes(r[col])); return chain; },
      then<T = { data: Row[]; error: null }>(...args: Parameters<Promise<T>['then']>) {
        const matched = tableRows().filter((r) => filters.every((p) => p(r)));
        const updated = onUpdate?.(patch, matched) ?? matched;
        return Promise.resolve({ data: updated, error: null } as unknown as T).then(...args);
      },
    };
    return chain;
  }
  return {
    select() { return selectBuilder(); },
    insert(r: Row | Row[]) { return insertChain(r); },
    update(patch: Row) { return updateChain(patch); },
  };
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from(table: string) {
      switch (table) {
        case 'teachers':           return makeBuilder(() => teachers as unknown as Row[]);
        case 'students':           return makeBuilder(() => students as unknown as Row[]);
        case 'class_teachers':     return makeBuilder(() => classTeachers as unknown as Row[]);
        case 'class_students':     return makeBuilder(() => classStudents as unknown as Row[]);
        case 'guardian_student_links': return makeBuilder(() => links as unknown as Row[]);
        case 'teacher_remediation_assignments': return makeBuilder(() => remediations as unknown as Row[]);
        case 'curriculum_topics':  return makeBuilder(() => topics as unknown as Row[]);
        // E2E fix pass (2026-06-16): the route's include_report mastery read was
        // repointed off the phantom `bkt_mastery_state` table (never on disk →
        // the mastery line silently never rendered) onto the real
        // `concept_mastery` table. The mock case must follow, or the
        // include_report mastery assertion below would pass against a phantom.
        case 'concept_mastery':    return makeBuilder(() => bktRows as unknown as Row[]);
        case 'quiz_sessions':      return makeBuilder(() => quizSessions as unknown as Row[]);
        case 'teacher_parent_threads':
          return makeBuilder(
            () => threads as unknown as Row[],
            (rows) => {
              const inserted: ThreadRow[] = [];
              for (const r of rows) {
                const now = new Date().toISOString();
                const row: ThreadRow = {
                  id: newId(),
                  teacher_id: r.teacher_id as string,
                  guardian_id: r.guardian_id as string,
                  student_id: r.student_id as string,
                  school_id: (r.school_id as string | null) ?? null,
                  subject: (r.subject as string | null) ?? null,
                  created_at: now,
                  updated_at: now,
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
                  thread_id: r.thread_id as string,
                  sender_role: r.sender_role as 'teacher' | 'guardian',
                  sender_auth_user_id: r.sender_auth_user_id as string,
                  body: r.body as string,
                  created_at: now,
                  read_at: null,
                };
                messages.push(row);
                const th = threads.find((t) => t.id === row.thread_id);
                if (th) { th.last_message_at = now; th.updated_at = now; }
                inserted.push(row);
              }
              return inserted as unknown as Row[];
            },
          );
        case 'notifications':
          return makeBuilder(
            () => notifications as unknown as Row[],
            (rows) => {
              const inserted: Row[] = [];
              for (const r of rows) { const row = { id: newId(), ...r }; notifications.push(row); inserted.push(row); }
              return inserted;
            },
          );
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    },
    rpc: vi.fn(),
  },
}));

// Import the route after the mocks.
import { POST } from '@/app/api/teacher/parent-notify/route';

// ── helpers ───────────────────────────────────────────────────────────
function authedAs(authUserId: string, permissions: string[]) {
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
    errorResponse: new Response(JSON.stringify({ success: false, error: 'Forbidden' }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}
function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/teacher/parent-notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ── auth gate ─────────────────────────────────────────────────────────
describe('POST /api/teacher/parent-notify — auth', () => {
  it('returns 403 when the auth gate denies (no class.manage)', async () => {
    unauthorized(403);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, context: 'general', message: 'hi' }) as never);
    expect(res.status).toBe(403);
    expect(messages).toHaveLength(0);
  });

  it('propagates a 401 from the auth gate', async () => {
    unauthorized(401);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, context: 'general', message: 'hi' }) as never);
    expect(res.status).toBe(401);
  });

  it('checks the class.manage permission (NOT a new permission)', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    await POST(postRequest({ student_id: STUDENT_ID_X, context: 'general', message: 'hi' }) as never);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'class.manage');
  });
});

// ── validation ────────────────────────────────────────────────────────
describe('POST /api/teacher/parent-notify — validation', () => {
  it('400 on a missing/invalid student_id', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ context: 'general', message: 'hi' }) as never);
    expect(res.status).toBe(400);
  });

  it('400 on an unknown context', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, context: 'banana' }) as never);
    expect(res.status).toBe(400);
  });
});

// ── roster boundary (P8) ──────────────────────────────────────────────
describe('POST /api/teacher/parent-notify — roster boundary', () => {
  it('403 when the student is not on the caller-teacher roster (no write)', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_OFF, context: 'general', message: 'x' }) as never);
    expect(res.status).toBe(403);
    expect(threads).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });

  it('403 when the caller has no teacher row', async () => {
    authedAs('00000000-0000-0000-0000-000000000000', ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, context: 'general', message: 'x' }) as never);
    expect(res.status).toBe(403);
  });
});

// ── no linked guardian → clean 409 ────────────────────────────────────
describe('POST /api/teacher/parent-notify — no linked guardian', () => {
  it('returns 409 { no_guardian: true } and sends NO message (not an error)', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_NOLINK, context: 'general', message: 'x' }) as never);
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.no_guardian).toBe(true);
    expect(threads).toHaveLength(0);
    expect(messages).toHaveLength(0);
  });
});

// ── happy path: templated message ─────────────────────────────────────
describe('POST /api/teacher/parent-notify — templated happy path', () => {
  it('creates the thread + appends a templated remediation_resolved message (sender_role=teacher)', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(
      postRequest({ student_id: STUDENT_ID_X, context: 'remediation_resolved', remediation_id: REMEDIATION_ID }) as never,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.thread_id).toBeTruthy();
    expect(json.message_id).toBeTruthy();

    expect(threads).toHaveLength(1);
    expect(threads[0].guardian_id).toBe(GUARDIAN_ID_X);
    expect(messages).toHaveLength(1);
    expect(messages[0].sender_role).toBe('teacher');
    // Templated body: factual, names the student's first name + the concept.
    expect(messages[0].body).toContain('Aarav');
    expect(messages[0].body).toContain('Fractions');
  });

  it('reuses an existing (teacher,guardian,student) thread instead of creating a duplicate', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    // Seed an existing thread for this triple.
    threads.push({
      id: 'bbbbbbbb-0000-0000-0000-000000000001',
      teacher_id: TEACHER_ID_A,
      guardian_id: GUARDIAN_ID_X,
      student_id: STUDENT_ID_X,
      school_id: SCHOOL_ID,
      subject: null,
      created_at: '2026-05-01T00:00:00.000Z',
      updated_at: '2026-05-01T00:00:00.000Z',
      last_message_at: '2026-05-01T00:00:00.000Z',
    });
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, context: 'general' }) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.thread_id).toBe('bbbbbbbb-0000-0000-0000-000000000001');
    expect(threads).toHaveLength(1); // no duplicate
    expect(messages).toHaveLength(1);
  });

  it('falls back to a generic template when remediation_id is omitted (general context)', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, context: 'general' }) as never);
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toContain('Aarav');
  });
});

// ── custom-message path ───────────────────────────────────────────────
describe('POST /api/teacher/parent-notify — custom message', () => {
  it('uses the provided message verbatim (sanitised) instead of the template', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(
      postRequest({ student_id: STUDENT_ID_X, context: 'general', message: '  Please review the homework.  ' }) as never,
    );
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(1);
    expect(messages[0].body).toBe('Please review the homework.');
  });

  it('rejects an empty/whitespace custom message with 400', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(postRequest({ student_id: STUDENT_ID_X, context: 'general', message: '   ' }) as never);
    expect(res.status).toBe(400);
    expect(messages).toHaveLength(0);
  });
});

// ── include_report → inline summary ──────────────────────────────────
describe('POST /api/teacher/parent-notify — include_report', () => {
  it('appends an inline progress summary line (mastery / recent avg) to the message body', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    const res = await POST(
      postRequest({
        student_id: STUDENT_ID_X,
        context: 'remediation_resolved',
        remediation_id: REMEDIATION_ID,
        include_report: true,
      }) as never,
    );
    expect(res.status).toBe(200);
    expect(messages).toHaveLength(1);
    // Overall mastery mean = round((80+60)/2) = 70; recent avg = round((80+90)/2) = 85.
    expect(messages[0].body).toContain('70%');
    expect(messages[0].body).toContain('85%');
  });

  it('does NOT append a summary line when include_report is false/omitted', async () => {
    authedAs(TEACHER_AUTH_A, ['class.manage']);
    await POST(
      postRequest({ student_id: STUDENT_ID_X, context: 'remediation_resolved', remediation_id: REMEDIATION_ID }) as never,
    );
    expect(messages[0].body).not.toContain('mastery');
    expect(messages[0].body).not.toContain('85%');
  });
});
