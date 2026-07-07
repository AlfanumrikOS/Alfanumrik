import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

/**
 * POST /api/school-admin/content/bulk — Bulk CSV question upload
 * + POST /api/school-admin/content — topic coercion (sibling route)
 *
 * Contracts pinned (P0 cross-layer gap batch, 2026-06-10):
 *   1. All-or-nothing: ONE invalid question among N → 400 with
 *      validation_errors[], created_count: 0, and ZERO DB inserts.
 *   2. P6 validation rejects: empty question_text, {{ / [BLANK] markers,
 *      ≠4 options, duplicate options (case-insensitive), out-of-range or
 *      non-integer correct_answer_index, empty explanation, invalid
 *      difficulty/bloom_level, non-string grade / grade outside "6"-"12".
 *   3. Cap: 501 questions → 400. Empty array → 400. 500 → allowed.
 *   4. Tenant isolation: rows get school_id from auth — body-supplied
 *      school_id is IGNORED. Rows start approved: false.
 *   5. Sibling single-POST route: missing/empty topic inserts topic: ''
 *      (column is NOT NULL — never null).
 *
 * Mock strategy follows src/__tests__/api/school-admin-students-seat-cap.test.ts:
 * authorizeSchoolAdmin, audit, and logger are module-mocked; supabase-admin is
 * replaced with a recording builder so inserted rows can be inspected.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { mockAuthorize, mockLogSchoolAudit } = vi.hoisted(() => ({
  mockAuthorize: vi.fn(),
  mockLogSchoolAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@alfanumrik/lib/school-admin-auth', () => ({
  authorizeSchoolAdmin: (...a: unknown[]) => mockAuthorize(...a),
}));
vi.mock('@alfanumrik/lib/audit', () => ({
  logSchoolAudit: (...a: unknown[]) => mockLogSchoolAudit(...a),
}));
vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Recording Supabase admin mock ─────────────────────────────────────────────

interface RecordedQuery {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

const recorded: RecordedQuery[] = [];
const results = new Map<string, { data: unknown; error: unknown }>();

function setResult(key: string, result: { data: unknown; error: unknown }) {
  results.set(key, result);
}

function makeBuilder(table: string) {
  const rec: RecordedQuery = { table, op: 'select', filters: [] };
  recorded.push(rec);
  const resolveResult = () =>
    results.get(`${rec.table}.${rec.op}`) ?? { data: null, error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: () => builder,
    insert: (rows: unknown) => {
      rec.op = 'insert';
      rec.payload = rows;
      return builder;
    },
    update: (vals: unknown) => {
      rec.op = 'update';
      rec.payload = vals;
      return builder;
    },
    delete: () => {
      rec.op = 'delete';
      return builder;
    },
    order: () => builder,
    range: () => Promise.resolve(resolveResult()),
    single: () => Promise.resolve(resolveResult()),
    maybeSingle: () => Promise.resolve(resolveResult()),
    then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve(resolveResult()).then(onF, onR),
  };
  for (const f of ['eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'ilike', 'is']) {
    builder[f] = (col: string, val: unknown) => {
      rec.filters.push([f, col, val]);
      return builder;
    };
  }
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({ from: (t: string) => makeBuilder(t) }),
}));

import { POST as BULK_POST } from '@/app/api/school-admin/content/bulk/route';
import { POST as SINGLE_POST } from '@/app/api/school-admin/content/route';

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCHOOL_ID = '00000000-0000-0000-0000-0000000000aa';
const ADMIN_USER = '00000000-0000-0000-0000-000000000099';

function mockAuthorized() {
  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: ADMIN_USER,
    schoolId: SCHOOL_ID,
    schoolAdminId: 'admin-001',
    schoolAdminRole: 'principal',
  });
}

function mockUnauthorized() {
  mockAuthorize.mockResolvedValue({
    authorized: false,
    userId: null,
    schoolId: null,
    schoolAdminId: null,
    schoolAdminRole: null,
    errorResponse: NextResponse.json(
      { success: false, error: 'Unauthorized', code: 'AUTH_REQUIRED' },
      { status: 401 }
    ),
  });
}

function validQuestion(overrides: Record<string, unknown> = {}) {
  return {
    subject: 'Mathematics',
    grade: '8',
    topic: 'Algebra',
    question_text: 'What is the value of x in 2x + 5 = 15?',
    options: ['5', '10', '15', '20'],
    correct_answer_index: 0,
    explanation: 'Subtract 5 from both sides, then divide by 2: x = 5.',
    difficulty: 'medium',
    bloom_level: 'apply',
    ...overrides,
  };
}

function makeBulkRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/school-admin/content/bulk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function makeSingleRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/school-admin/content', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function insertedQueries() {
  return recorded.filter((r) => r.op === 'insert' && r.table === 'school_questions');
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  results.clear();
  mockAuthorized();
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /api/school-admin/content/bulk
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/school-admin/content/bulk — auth & request shape', () => {
  it('returns 401 for unauthenticated requests and performs no DB queries', async () => {
    mockUnauthorized();
    const res = await BULK_POST(makeBulkRequest({ questions: [validQuestion()] }));
    expect(res.status).toBe(401);
    expect(recorded.length).toBe(0);
  });

  it('requires the school.manage_content permission (P9)', async () => {
    setResult('school_questions.insert', { data: [{ id: 'q1' }], error: null });
    await BULK_POST(makeBulkRequest({ questions: [validQuestion()] }));
    expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), 'school.manage_content');
  });

  it('returns 400 on malformed JSON body', async () => {
    const res = await BULK_POST(makeBulkRequest('not-json{{'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 400 when body has no "questions" array', async () => {
    const res = await BULK_POST(makeBulkRequest({ question: validQuestion() }));
    expect(res.status).toBe(400);
    expect(insertedQueries().length).toBe(0);
  });

  it('returns 400 for an empty questions array', async () => {
    const res = await BULK_POST(makeBulkRequest({ questions: [] }));
    expect(res.status).toBe(400);
    expect(insertedQueries().length).toBe(0);
  });
});

describe('POST /api/school-admin/content/bulk — size cap', () => {
  it('rejects 501 questions with 400 and performs no inserts', async () => {
    const questions = Array.from({ length: 501 }, () => validQuestion());
    const res = await BULK_POST(makeBulkRequest({ questions }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(String(body.error)).toMatch(/500/);
    expect(insertedQueries().length).toBe(0);
  });

  it('accepts exactly 500 valid questions (cap boundary)', async () => {
    setResult('school_questions.insert', {
      data: Array.from({ length: 500 }, (_, i) => ({ id: `q-${i}` })),
      error: null,
    });
    const questions = Array.from({ length: 500 }, () => validQuestion());
    const res = await BULK_POST(makeBulkRequest({ questions }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.created_count).toBe(500);
  });
});

describe('POST /api/school-admin/content/bulk — all-or-nothing P6 validation', () => {
  it('rejects the WHOLE batch when one of three questions is invalid (zero inserts)', async () => {
    const questions = [
      validQuestion(),
      validQuestion({ question_text: '' }), // invalid row at index 1
      validQuestion(),
    ];
    const res = await BULK_POST(makeBulkRequest({ questions }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.created_count).toBe(0);
    expect(Array.isArray(body.validation_errors)).toBe(true);
    expect(
      body.validation_errors.some(
        (e: { index: number; field: string }) => e.index === 1 && e.field === 'question_text'
      )
    ).toBe(true);
    // All-or-nothing: not a single DB query may have been issued
    expect(recorded.length).toBe(0);
  });

  const p6Cases: Array<[string, Record<string, unknown>, string]> = [
    ['empty question_text', { question_text: '' }, 'question_text'],
    ['whitespace-only question_text', { question_text: '   ' }, 'question_text'],
    ['question_text with {{ template marker', { question_text: 'Solve {{var}} for x' }, 'question_text'],
    ['question_text with [BLANK] placeholder', { question_text: 'Fill the [BLANK] in' }, 'question_text'],
    ['only 3 options', { options: ['1', '2', '3'] }, 'options'],
    ['5 options', { options: ['1', '2', '3', '4', '5'] }, 'options'],
    ['duplicate options (exact)', { options: ['5', '5', '10', '15'] }, 'options'],
    ['duplicate options (case-insensitive)', { options: ['Paris', 'paris', 'Lyon', 'Nice'] }, 'options'],
    ['duplicate options (whitespace-padded)', { options: [' 5 ', '5', '10', '15'] }, 'options'],
    ['empty-string option', { options: ['5', '', '10', '15'] }, 'options'],
    ['non-string option', { options: ['5', 10, '15', '20'] }, 'options'],
    ['correct_answer_index 4 (out of range)', { correct_answer_index: 4 }, 'correct_answer_index'],
    ['correct_answer_index -1 (out of range)', { correct_answer_index: -1 }, 'correct_answer_index'],
    ['correct_answer_index 1.5 (non-integer)', { correct_answer_index: 1.5 }, 'correct_answer_index'],
    ['missing correct_answer_index', { correct_answer_index: undefined }, 'correct_answer_index'],
    ['empty explanation', { explanation: '' }, 'explanation'],
    ['whitespace-only explanation', { explanation: '   ' }, 'explanation'],
    ['invalid difficulty', { difficulty: 'impossible' }, 'difficulty'],
    ['invalid bloom_level', { bloom_level: 'memorize' }, 'bloom_level'],
    ['integer grade 8 (P5: must be string)', { grade: 8 }, 'grade'],
    ['grade "5" below range (P5)', { grade: '5' }, 'grade'],
    ['grade "13" above range (P5)', { grade: '13' }, 'grade'],
    ['missing grade', { grade: undefined }, 'grade'],
    ['missing subject', { subject: '' }, 'subject'],
  ];

  for (const [name, overrides, expectedField] of p6Cases) {
    it(`rejects ${name} with 400 / created_count 0 / no inserts`, async () => {
      const res = await BULK_POST(
        makeBulkRequest({ questions: [validQuestion(overrides)] })
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.created_count).toBe(0);
      expect(
        body.validation_errors.some((e: { field: string }) => e.field === expectedField)
      ).toBe(true);
      expect(insertedQueries().length).toBe(0);
    });
  }
});

describe('POST /api/school-admin/content/bulk — happy path & tenant isolation', () => {
  it('inserts valid questions with school_id from AUTH (body-supplied school_id ignored) and approved=false', async () => {
    setResult('school_questions.insert', {
      data: [{ id: 'q-1' }, { id: 'q-2' }],
      error: null,
    });

    const questions = [
      // Hostile payload: tries to plant a question into another school
      validQuestion({ school_id: 'attacker-school-id', approved: true }),
      // Missing topic — NOT NULL column must be coerced to ''
      validQuestion({ topic: undefined, grade: '12' }),
    ];

    const res = await BULK_POST(makeBulkRequest({ questions }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.created_count).toBe(2);
    expect(body.validation_errors).toEqual([]);

    const inserts = insertedQueries();
    expect(inserts.length).toBe(1); // single batch insert
    const rows = inserts[0].payload as Array<Record<string, unknown>>;
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.school_id).toBe(SCHOOL_ID); // tenant isolation
      expect(row.school_id).not.toBe('attacker-school-id');
      expect(row.approved).toBe(false); // always pending review
      expect(row.created_by).toBe(ADMIN_USER);
      expect(typeof row.grade).toBe('string'); // P5
    }
    expect(rows[0].grade).toBe('8');
    expect(rows[1].grade).toBe('12');
    expect(rows[1].topic).toBe(''); // missing topic coerced to '' — never null
  });

  it('writes a metadata-only audit entry (content.bulk_uploaded, no question text)', async () => {
    setResult('school_questions.insert', { data: [{ id: 'q-1' }], error: null });

    await BULK_POST(makeBulkRequest({ questions: [validQuestion()] }));

    expect(mockLogSchoolAudit).toHaveBeenCalledTimes(1);
    const entry = mockLogSchoolAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(entry.schoolId).toBe(SCHOOL_ID);
    expect(entry.actorId).toBe(ADMIN_USER);
    expect(entry.action).toBe('content.bulk_uploaded');
    // P13: audit payload carries metadata only — never question content
    expect(JSON.stringify(entry)).not.toContain('What is the value of x');
    expect((entry.metadata as Record<string, unknown>).uploaded_count).toBe(1);
  });

  it('returns 500 (success: false) when the batch insert fails', async () => {
    setResult('school_questions.insert', {
      data: null,
      error: { message: 'db exploded' },
    });
    const res = await BULK_POST(makeBulkRequest({ questions: [validQuestion()] }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Sibling route: POST /api/school-admin/content — topic NOT NULL coercion
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/school-admin/content — topic coercion (NOT NULL column)', () => {
  it('inserts topic: "" (empty string, not null) when topic is missing', async () => {
    setResult('school_questions.insert', { data: [{ id: 'q-1' }], error: null });

    const res = await SINGLE_POST(makeSingleRequest(validQuestion({ topic: undefined })));
    expect(res.status).toBe(201);

    const rows = insertedQueries()[0].payload as Array<Record<string, unknown>>;
    expect(rows[0].topic).toBe('');
    expect(rows[0].topic).not.toBeNull();
  });

  it('inserts topic: "" when topic is a non-string value', async () => {
    setResult('school_questions.insert', { data: [{ id: 'q-1' }], error: null });

    const res = await SINGLE_POST(makeSingleRequest(validQuestion({ topic: 42 })));
    expect(res.status).toBe(201);

    const rows = insertedQueries()[0].payload as Array<Record<string, unknown>>;
    expect(rows[0].topic).toBe('');
  });

  it('trims a provided topic', async () => {
    setResult('school_questions.insert', { data: [{ id: 'q-1' }], error: null });

    const res = await SINGLE_POST(makeSingleRequest(validQuestion({ topic: '  Algebra  ' })));
    expect(res.status).toBe(201);

    const rows = insertedQueries()[0].payload as Array<Record<string, unknown>>;
    expect(rows[0].topic).toBe('Algebra');
  });
});
