/**
 * POST /api/school-admin/classes/bulk-create — Track A.4 contract tests
 *
 * Pins:
 *   - Template preset expands to grades × sections (grades as STRINGS, P5).
 *   - Explicit list mode works.
 *   - Existing (school_id, grade, section, academic_year) classes are SKIPPED
 *     (idempotent), never duplicated; in-batch duplicates skipped.
 *   - Cap enforced (> MAX_BULK_CLASSES → 413).
 *   - school_id is taken from auth ONLY — a body school_id is ignored; every
 *     insert carries the auth school_id (tenant isolation).
 *   - Auth gate denies with the authorizeSchoolAdmin errorResponse (P9), using
 *     the class.manage permission code.
 *   - P13: logger/audit calls carry counts + indices only, never class names.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockAuthorize, mockLogSchoolAudit, mockLoggerInfo } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockLogSchoolAudit: vi.fn().mockResolvedValue(undefined),
  mockLoggerInfo: vi.fn(),
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/audit', () => ({
  logSchoolAudit: (...a: unknown[]) => mockLogSchoolAudit(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: (...a: unknown[]) => mockLoggerInfo(...a) },
}));

const SCHOOL_ID = '00000000-0000-0000-0000-000000000aaa';
const OTHER_SCHOOL_ID = '00000000-0000-0000-0000-000000000fff';
const ADMIN_USER = '00000000-0000-0000-0000-000000000099';

// ── Supabase mock ────────────────────────────────────────────────────
// from('classes')
//   .select(...).eq('school_id', …).is('deleted_at', null)   — existing dedupe
//   .insert({...}).select('id').single()                     — create
interface ClassState {
  existing: Array<{ id: string; grade: string; section: string; academic_year: string }>;
  insertError: boolean;
}
let state: ClassState;
const insertPayloads: Array<Record<string, unknown>> = [];
const eqCalls: Array<{ col: string; val: unknown }> = [];
let insertSeq = 0;

function classesBuilder() {
  return {
    select: () => ({
      eq: (col: string, val: unknown) => {
        eqCalls.push({ col, val });
        return {
          is: () =>
            Promise.resolve({
              data: state.existing.map((c) => ({ ...c })),
              error: null,
            }),
        };
      },
    }),
    insert: (payload: Record<string, unknown>) => {
      insertPayloads.push(payload);
      return {
        select: () => ({
          single: async () =>
            state.insertError
              ? { data: null, error: { message: 'insert failed' } }
              : { data: { id: `new-class-${insertSeq++}` }, error: null },
        }),
      };
    },
  };
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'classes') return classesBuilder();
      throw new Error(`unexpected table: ${table}`);
    },
  }),
}));

import { POST } from '@/app/api/school-admin/classes/bulk-create/route';

function authedAs(schoolId = SCHOOL_ID) {
  mockAuthorize.mockResolvedValue({ authorized: true, schoolId, userId: ADMIN_USER, schoolAdminId: 'admin-row' });
}
function denied(status = 403) {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    schoolId: null,
    userId: null,
    errorResponse: new Response(
      JSON.stringify({ success: false, error: 'Not a school administrator' }),
      { status, headers: { 'Content-Type': 'application/json' } },
    ),
  });
}
function req(body: unknown): Request {
  return new Request('http://localhost/api/school-admin/classes/bulk-create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertPayloads.length = 0;
  eqCalls.length = 0;
  insertSeq = 0;
  state = { existing: [], insertError: false };
});

describe('bulk-create — auth gate (P9)', () => {
  it('returns the authorizeSchoolAdmin errorResponse when not authorized', async () => {
    denied(403);
    const res = await POST(req({ template: {} }) as never);
    expect(res.status).toBe(403);
    expect(insertPayloads).toHaveLength(0);
    expect(mockLogSchoolAudit).not.toHaveBeenCalled();
  });

  it('requests the class.manage permission code', async () => {
    authedAs();
    await POST(req({ classes: [{ grade: '6', section: 'A' }] }) as never);
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'class.manage');
  });
});

describe('bulk-create — template preset', () => {
  it('expands default template to 7 grades × 4 sections = 28 classes, grades as STRINGS', async () => {
    authedAs();
    const res = await POST(req({ template: { academic_year: '2026-27' } }) as never);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { total: number; created: number } };
    expect(json.data.total).toBe(28);
    expect(json.data.created).toBe(28);
    expect(insertPayloads).toHaveLength(28);
    // P5: every inserted grade is a STRING from "6".."12".
    for (const p of insertPayloads) {
      expect(typeof p.grade).toBe('string');
      expect(['6', '7', '8', '9', '10', '11', '12']).toContain(p.grade as string);
    }
    // Grid cover check: grade "6" × sections A..D present.
    const g6 = insertPayloads.filter((p) => p.grade === '6').map((p) => p.section);
    expect(g6.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('honors a narrowed template (grades + sections subset)', async () => {
    authedAs();
    const res = await POST(req({ template: { grades: ['9', '10'], sections: ['A'] } }) as never);
    const json = (await res.json()) as { data: { total: number; created: number } };
    expect(json.data.total).toBe(2);
    expect(json.data.created).toBe(2);
  });
});

describe('bulk-create — explicit list + idempotency', () => {
  it('creates a list of classes', async () => {
    authedAs();
    const res = await POST(
      req({ classes: [{ grade: '6', section: 'A' }, { grade: '7', section: 'B', name: 'Custom' }] }) as never,
    );
    const json = (await res.json()) as { data: { created: number; rows: Array<{ status: string }> } };
    expect(json.data.created).toBe(2);
    expect(json.data.rows.every((r) => r.status === 'created')).toBe(true);
  });

  it('SKIPS an existing (school, grade, section, year) class — idempotent, no duplicate insert', async () => {
    authedAs();
    state.existing = [{ id: 'existing-6A', grade: '6', section: 'A', academic_year: '2026-27' }];
    const res = await POST(req({ classes: [{ grade: '6', section: 'A', academic_year: '2026-27' }] }) as never);
    const json = (await res.json()) as { data: { created: number; skipped: number; rows: Array<{ code: string; id?: string }> } };
    expect(json.data.created).toBe(0);
    expect(json.data.skipped).toBe(1);
    expect(json.data.rows[0].code).toBe('already_exists');
    expect(json.data.rows[0].id).toBe('existing-6A');
    expect(insertPayloads).toHaveLength(0); // never re-inserted
  });

  it('skips an in-batch duplicate (same classKey twice)', async () => {
    authedAs();
    const res = await POST(
      req({ classes: [{ grade: '6', section: 'A' }, { grade: '6', section: 'a' }] }) as never,
    );
    const json = (await res.json()) as { data: { created: number; skipped: number; rows: Array<{ code: string }> } };
    expect(json.data.created).toBe(1);
    expect(json.data.skipped).toBe(1);
    expect(json.data.rows[1].code).toBe('duplicate_in_batch');
  });

  it('marks an invalid grade row as failed (invalid_grade), still creates the valid one', async () => {
    authedAs();
    const res = await POST(
      req({ classes: [{ grade: '5', section: 'A' }, { grade: '6', section: 'B' }] }) as never,
    );
    const json = (await res.json()) as { data: { created: number; failed: number; rows: Array<{ status: string; code: string }> } };
    expect(json.data.created).toBe(1);
    expect(json.data.failed).toBe(1);
    expect(json.data.rows[0]).toMatchObject({ status: 'failed', code: 'invalid_grade' });
  });
});

describe('bulk-create — cap + tenant isolation', () => {
  it('rejects an explicit list over MAX_BULK_CLASSES at the Zod gate (400), no writes', async () => {
    authedAs();
    const classes = Array.from({ length: 201 }, (_, i) => ({ grade: '6', section: `S${i}` }));
    const res = await POST(req({ classes }) as never);
    // Zod .max(200) fails the ExplicitSchema → neither schema matches → 400.
    expect(res.status).toBe(400);
    expect(insertPayloads).toHaveLength(0);
  });

  it('rejects a TEMPLATE that expands beyond MAX_BULK_CLASSES → 413, no writes', async () => {
    authedAs();
    // 7 default grades × 30 sections = 210 > 200 cap.
    const sections = Array.from({ length: 30 }, (_, i) => `S${i}`);
    const res = await POST(req({ template: { sections } }) as never);
    expect(res.status).toBe(413);
    expect(insertPayloads).toHaveLength(0);
  });

  it('IGNORES a body school_id — every insert + the dedupe read use auth.schoolId', async () => {
    authedAs(SCHOOL_ID);
    const res = await POST(
      req({ school_id: OTHER_SCHOOL_ID, classes: [{ grade: '6', section: 'A' }] }) as never,
    );
    expect(res.status).toBe(200);
    // Insert carries the AUTH school, never the hostile body school.
    expect(insertPayloads[0].school_id).toBe(SCHOOL_ID);
    expect(insertPayloads[0].school_id).not.toBe(OTHER_SCHOOL_ID);
    // Dedupe read was scoped to the auth school.
    expect(eqCalls).toContainEqual({ col: 'school_id', val: SCHOOL_ID });
    expect(eqCalls).not.toContainEqual({ col: 'school_id', val: OTHER_SCHOOL_ID });
    // Audit pins the auth school.
    expect(mockLogSchoolAudit).toHaveBeenCalledWith(expect.objectContaining({ schoolId: SCHOOL_ID }));
  });
});

describe('bulk-create — P13 no PII in logs', () => {
  it('logger + audit carry counts only, never class names/sections', async () => {
    authedAs();
    await POST(
      req({ classes: [{ grade: '6', section: 'A', name: 'Sunrise Section', subject: 'Physics' }] }) as never,
    );
    const loggedArgs = JSON.stringify(mockLoggerInfo.mock.calls);
    const auditArgs = JSON.stringify(mockLogSchoolAudit.mock.calls);
    expect(loggedArgs).not.toMatch(/Sunrise Section/);
    expect(loggedArgs).not.toMatch(/Physics/);
    expect(auditArgs).not.toMatch(/Sunrise Section/);
    // Counts ARE present.
    expect(loggedArgs).toMatch(/"created"/);
    expect(loggedArgs).toMatch(/"total"/);
  });
});
