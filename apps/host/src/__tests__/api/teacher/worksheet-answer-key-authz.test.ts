/**
 * R2 step C — `GET /api/teacher/worksheets/answer-key` authorization + the
 * client-side answer-key read that it replaces.
 *
 * WHY THIS EXISTS
 * ===============
 * `apps/host/src/app/teacher/worksheets/page.tsx` used to run
 *
 *     supabase.from('question_bank')
 *       .select('question_text, options, correct_answer_index, …')
 *
 * IN THE BROWSER, under the caller's own role. Printing an answer key is a
 * legitimate teacher need, but students, parents and teachers all authenticate
 * as the same `authenticated` Postgres role, so no RLS policy and no column
 * ACL can separate them. That single call site was the last blocker on the
 * `question_bank` answer-key column ACL — which closes the widest answer-key
 * exposure in the product.
 *
 * These pins therefore cover BOTH halves of the fix:
 *   1. the server gate (P9), including that a DENY never leaks a key (P13);
 *   2. the source contract that the page no longer selects the column at all —
 *      because a route that is perfect is worthless if the browser path is
 *      still open beside it.
 *
 * Invariants: P9 (server-side RBAC is the boundary), P8 (service-role read is
 * gated by an explicit app-level tenancy check), P13 (no key, no PII on any
 * deny path), P5 (grade is a string).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const AUTH_USER_ID = '00000000-0000-4000-8000-00000000aaaa';
const TEACHER_ID = '11111111-1111-4111-8111-111111111111';

const holders = vi.hoisted(() => ({
  authorize: vi.fn(),
  resolveTeacherIdentity: vi.fn(),
  resolveTeacherRosterScope: vi.fn(),
  /** teachers profile row returned by the scope helper's own lookup. */
  teacherProfile: { subjects_taught: ['math'], grades_taught: ['10'] } as Record<string, unknown> | null,
  /** rows the privileged question_bank read resolves with. */
  bankRows: [] as Array<Record<string, unknown>>,
  bankError: null as { message: string } | null,
  /** every table touched through the admin client, in order. */
  adminTables: [] as string[],
  /** the exact column list the route asked question_bank for. */
  bankSelect: '' as string,
}));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => holders.authorize(...a),
  resolveTeacherIdentity: (...a: unknown[]) => holders.resolveTeacherIdentity(...a),
  resolveTeacherRosterScope: (...a: unknown[]) => holders.resolveTeacherRosterScope(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@alfanumrik/lib/supabase-admin', () => {
  function bankChain() {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.eq = vi.fn(self);
    chain.limit = vi.fn(self);
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: holders.bankRows, error: holders.bankError });
    return chain;
  }

  return {
    supabaseAdmin: {
      from: vi.fn((table: string) => {
        holders.adminTables.push(table);
        if (table === 'teachers') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() =>
                  Promise.resolve({ data: holders.teacherProfile, error: null }),
                ),
              })),
            })),
          };
        }
        // question_bank
        return {
          select: vi.fn((cols: string) => {
            holders.bankSelect = cols;
            return bankChain();
          }),
        };
      }),
    },
  };
});

import { GET } from '@/app/api/teacher/worksheets/answer-key/route';

function makeReq(qs: string) {
  return new Request(`http://localhost/api/teacher/worksheets/answer-key?${qs}`);
}

function authDenied(status: number) {
  holders.authorize.mockResolvedValue({
    authorized: false,
    userId: null,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: status === 401 ? 'Unauthorized' : 'Forbidden' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}

function authAllowed() {
  holders.authorize.mockResolvedValue({ authorized: true, userId: AUTH_USER_ID, roles: ['teacher'] });
}

const KEY_ROW = {
  question_text: 'What is 2 + 2?',
  options: ['3', '4', '5', '6'],
  correct_answer_index: 1,
  explanation: 'Two plus two is four.',
};

beforeEach(() => {
  vi.clearAllMocks();
  holders.adminTables = [];
  holders.bankSelect = '';
  holders.bankRows = [];
  holders.bankError = null;
  holders.teacherProfile = { subjects_taught: ['math'], grades_taught: ['10'] };
  holders.resolveTeacherIdentity.mockResolvedValue({ id: TEACHER_ID, schoolId: 'school-1' });
  holders.resolveTeacherRosterScope.mockResolvedValue({
    teacher: { id: TEACHER_ID, schoolId: 'school-1' },
    classIds: [],
    classes: [],
    enrollments: [],
  });
});

const OK_QS = 'subject=math&grade=10&count=5&difficulty=medium';

/** Does this serialized body contain anything that could be an answer key? */
function leaksKey(body: string): boolean {
  return /correct_answer_index|"answer"|"questions"/.test(body);
}

describe('GET /api/teacher/worksheets/answer-key — RBAC gate (P9)', () => {
  it('gates on the existing, already-granted worksheet.create permission', async () => {
    authAllowed();
    holders.bankRows = [KEY_ROW];
    await GET(makeReq(OK_QS) as never);
    expect(holders.authorize).toHaveBeenCalledTimes(1);
    expect(holders.authorize.mock.calls[0][1]).toBe('worksheet.create');
  });

  it('unauthenticated caller → 401, no answer key in the body, no DB access at all', async () => {
    authDenied(401);
    const res = await GET(makeReq(OK_QS) as never);
    expect(res.status).toBe(401);
    const body = await res.text();
    expect(leaksKey(body)).toBe(false);
    expect(holders.adminTables).toEqual([]);
    expect(holders.resolveTeacherIdentity).not.toHaveBeenCalled();
  });

  it('caller without worksheet.create (e.g. a student) → 403, no answer key, no DB access', async () => {
    authDenied(403);
    const res = await GET(makeReq(OK_QS) as never);
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(leaksKey(body)).toBe(false);
    expect(holders.adminTables).toEqual([]);
  });

  it('authorizeRequest runs BEFORE input validation — a malformed request from an unauthenticated caller still 401s', async () => {
    authDenied(401);
    const res = await GET(makeReq('subject=&grade=99&count=nope') as never);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/teacher/worksheets/answer-key — content tenancy (P8/P13)', () => {
  it('caller with no ACTIVE teacher profile → 403 teacher_profile_required, no question_bank read', async () => {
    authAllowed();
    holders.resolveTeacherIdentity.mockResolvedValue(null);
    const res = await GET(makeReq(OK_QS) as never);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json).toEqual({
      success: false,
      error: 'Teacher account required',
      code: 'teacher_profile_required',
    });
    expect(holders.adminTables).not.toContain('question_bank');
  });

  it('subject outside the teacher scope → 403 out_of_scope, no answer key, no question_bank read', async () => {
    authAllowed();
    holders.teacherProfile = { subjects_taught: ['math'], grades_taught: ['10'] };
    const res = await GET(makeReq('subject=physics&grade=10&count=5') as never);
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(JSON.parse(body).code).toBe('out_of_scope');
    expect(leaksKey(body)).toBe(false);
    expect(holders.adminTables).not.toContain('question_bank');
  });

  it('grade outside the teacher scope → 403 out_of_scope even when the subject matches', async () => {
    authAllowed();
    holders.teacherProfile = { subjects_taught: ['math'], grades_taught: ['10'] };
    const res = await GET(makeReq('subject=math&grade=7&count=5') as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('out_of_scope');
    expect(holders.adminTables).not.toContain('question_bank');
  });

  it('empty subjects_taught is NOT a wildcard — it denies', async () => {
    authAllowed();
    holders.teacherProfile = { subjects_taught: [], grades_taught: [] };
    const res = await GET(makeReq(OK_QS) as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('out_of_scope');
    expect(holders.adminTables).not.toContain('question_bank');
  });

  it('an ACTIVE class assignment widens the scope (union with the profile arrays)', async () => {
    authAllowed();
    holders.teacherProfile = { subjects_taught: [], grades_taught: [] };
    holders.resolveTeacherRosterScope.mockResolvedValue({
      teacher: { id: TEACHER_ID, schoolId: 'school-1' },
      classIds: ['c1'],
      classes: [{ classId: 'c1', schoolId: 'school-1', grade: '10', subject: 'math' }],
      enrollments: [],
    });
    holders.bankRows = [KEY_ROW];
    const res = await GET(makeReq(OK_QS) as never);
    expect(res.status).toBe(200);
  });

  it('resolves the roster through the CANONICAL resolver, not a hand-rolled join', async () => {
    authAllowed();
    holders.bankRows = [KEY_ROW];
    await GET(makeReq(OK_QS) as never);
    expect(holders.resolveTeacherRosterScope).toHaveBeenCalledTimes(1);
    expect(holders.resolveTeacherRosterScope.mock.calls[0][1]).toMatchObject({
      includeClassDetails: true,
    });
    // No route-level re-query of the roster tables.
    expect(holders.adminTables).not.toContain('class_teachers');
    expect(holders.adminTables).not.toContain('class_enrollments');
  });
});

describe('GET /api/teacher/worksheets/answer-key — authorised teacher gets the key', () => {
  it('200 with the resolved answer text for an in-scope (subject, grade)', async () => {
    authAllowed();
    holders.bankRows = [KEY_ROW];
    const res = await GET(makeReq(OK_QS) as never);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.questions).toHaveLength(1);
    // The KEY: correct_answer_index 1 resolves to option '4'.
    expect(json.data.questions[0].answer).toBe('4');
    expect(json.data.questions[0].question).toContain('What is 2 + 2?');
    expect(json.data.questions[0].explanation).toBe('Two plus two is four.');
  });

  it('never returns the raw correct_answer_index — only the resolved option text', async () => {
    authAllowed();
    holders.bankRows = [KEY_ROW];
    const res = await GET(makeReq(OK_QS) as never);
    const body = await res.text();
    expect(body).not.toContain('correct_answer_index');
  });

  it('a genuinely empty bank is a 200 with zero questions, NOT an error', async () => {
    authAllowed();
    holders.bankRows = [];
    const res = await GET(makeReq(OK_QS) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { questions: [] } });
  });

  it('a failed read is a 500, NOT a success-shaped empty', async () => {
    authAllowed();
    holders.bankError = { message: 'connection reset' };
    const res = await GET(makeReq(OK_QS) as never);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.data).toBeUndefined();
  });

  it('P5 — an integer-shaped grade outside "6".."12" is rejected 400, never coerced', async () => {
    authAllowed();
    for (const g of ['5', '13', '10.0', 'ten', '']) {
      const res = await GET(makeReq(`subject=math&grade=${encodeURIComponent(g)}&count=5`) as never);
      expect(res.status, `grade=${g}`).toBe(400);
    }
    expect(holders.adminTables).not.toContain('question_bank');
  });

  it('count is clamped to a validated integer range before any DB access', async () => {
    authAllowed();
    for (const c of ['0', '31', '-1', 'abc', '']) {
      const res = await GET(makeReq(`subject=math&grade=10&count=${encodeURIComponent(c)}`) as never);
      expect(res.status, `count=${c}`).toBe(400);
    }
    expect(holders.adminTables).not.toContain('question_bank');
  });
});

// ── Source contract — the browser path must be CLOSED ─────────────────────
describe('teacher worksheets page — no client-side answer-key read', () => {
  const repoRoot = path.resolve(__dirname, '../../../../../..');
  const pagePath = path.join(repoRoot, 'apps/host/src/app/teacher/worksheets/page.tsx');
  const routePath = path.join(
    repoRoot,
    'apps/host/src/app/api/teacher/worksheets/answer-key/route.ts',
  );

  it('the page source no longer selects correct_answer_index', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    // Allow the word inside explanatory comments; forbid it inside a select().
    const selectCalls = src.match(/\.select\([^)]*\)/g) ?? [];
    for (const call of selectCalls) {
      expect(call).not.toContain('correct_answer_index');
    }
  });

  it('the page no longer queries question_bank from the browser at all', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).not.toMatch(/supabase\s*\n?\s*\.from\(\s*['"]question_bank['"]/);
    // …and no longer imports the browser Supabase client for this purpose.
    expect(src).not.toMatch(/from '@alfanumrik\/lib\/supabase'/);
  });

  it('the page fetches the key from the gated server route instead', () => {
    const src = fs.readFileSync(pagePath, 'utf8');
    expect(src).toContain('/api/teacher/worksheets/answer-key');
  });

  it('the route gates on an EXISTING permission code (no new code invented)', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    expect(src).toMatch(/authorizeRequest\(\s*request,\s*'worksheet\.create'\s*\)/);
  });

  it('the route is read-only — no write verb reaches the service-role client', () => {
    const src = fs.readFileSync(routePath, 'utf8');
    for (const verb of ['.insert(', '.update(', '.upsert(', '.delete(', '.rpc(']) {
      expect(src, `route must not call ${verb}`).not.toContain(verb);
    }
  });
});
