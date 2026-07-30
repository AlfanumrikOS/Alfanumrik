import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * POST /api/diagnostic/start — route-level contract tests.
 *
 * The SELECTION logic (blueprint, ladder, Tier-0 gate, Bloom's) is pure and is
 * pinned in `src/__tests__/lib/diagnostic/blueprint.test.ts`. This file pins the
 * things only the ROUTE can be responsible for, from
 * `docs/superpowers/specs/2026-07-29-diagnostic-cold-start-correctness.md` §8:
 *
 *   AC-13  a `chapter` parameter is a 400 CHAPTER_NOT_SUPPORTED
 *   AC-14  grades "11"/"12" reach the selector (200, 15 questions)
 *   AC-15  P5 — grade is a STRING on the request, on the diagnostic_assessments
 *          insert, and in the response. Integer 11 is rejected.
 *   AC-21  Rung 4 → HTTP 200 AND no `diagnostic_assessments` insert
 *   AC-22  Rung 4 → `alternatives` is never empty (Foxy CTA is unconditional),
 *          including the pathological no-other-subject / no-chapter case
 *   AC-23  Rung 4 telemetry carries no student_id / email / phone / name (P13)
 *   AC-32  the start path is XP-neutral (no atomic_quiz_profile_update)
 *
 * P13: every fixture id is synthetic.
 */

// ── RBAC ──────────────────────────────────────────────────────────────────────

const { mockAuthorize } = vi.hoisted(() => ({ mockAuthorize: vi.fn() }));

vi.mock('@alfanumrik/lib/rbac', () => ({
  authorizeRequest: (...a: unknown[]) => mockAuthorize(...a),
}));

// ── Subject governance (a separate, already-pinned boundary) ──────────────────

const { mockAllowedSubjects, mockValidateSubject } = vi.hoisted(() => ({
  mockAllowedSubjects: vi.fn(),
  mockValidateSubject: vi.fn(),
}));

vi.mock('@alfanumrik/lib/subjects', () => ({
  getAllowedSubjectsForStudent: (...a: unknown[]) => mockAllowedSubjects(...a),
  validateSubjectWrite: (...a: unknown[]) => mockValidateSubject(...a),
}));

// ── Ops telemetry (AC-23 inspects the payload) ────────────────────────────────

const { mockLogOpsEvent } = vi.hoisted(() => ({ mockLogOpsEvent: vi.fn() }));

vi.mock('@alfanumrik/lib/ops-events', () => ({
  logOpsEvent: (...a: unknown[]) => mockLogOpsEvent(...a),
}));

vi.mock('@alfanumrik/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Recording Supabase admin mock ─────────────────────────────────────────────

interface RecordedQuery {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  columns?: string;
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

const recorded: RecordedQuery[] = [];
const mockRpc = vi.fn();

/** Resolver per table — receives the recorded query so a table can answer twice. */
type Resolver = (rec: RecordedQuery) => { data: unknown; error: unknown };
const resolvers = new Map<string, Resolver>();

function setTable(table: string, r: Resolver | { data: unknown; error: unknown }) {
  resolvers.set(table, typeof r === 'function' ? r : () => r);
}

function makeBuilder(table: string) {
  const rec: RecordedQuery = { table, op: 'select', filters: [] };
  recorded.push(rec);
  const resolve = () => resolvers.get(table)?.(rec) ?? { data: null, error: null };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    select: (cols?: string) => {
      if (typeof cols === 'string' && rec.op === 'select') rec.columns = cols;
      return builder;
    },
    insert: (rows: unknown) => {
      rec.op = 'insert';
      rec.payload = rows;
      return builder;
    },
    update: (v: unknown) => {
      rec.op = 'update';
      rec.payload = v;
      return builder;
    },
    delete: () => {
      rec.op = 'delete';
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    single: () => Promise.resolve(resolve()),
    maybeSingle: () => Promise.resolve(resolve()),
    then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR),
  };
  for (const f of ['eq', 'neq', 'in', 'gte', 'lte', 'is', 'not']) {
    builder[f] = (col: string, val: unknown) => {
      rec.filters.push([f, col, val]);
      return builder;
    };
  }
  return builder;
}

vi.mock('@alfanumrik/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => ({
    from: (t: string) => makeBuilder(t),
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));

import { POST } from '@/app/api/diagnostic/start/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STUDENT_ID = 'student-1';
const SESSION_ID = '22222222-2222-2222-2222-222222222222';
const CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8];

let idCounter = 0;

function makeItem(over: Record<string, unknown> = {}) {
  idCounter++;
  return {
    id: `synthetic-q-${idCounter}`,
    question_text: `Synthetic CBSE item ${idCounter}: which of these values satisfies the equation?`,
    question_hi: null,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correct_answer_index: idCounter % 4,
    explanation: 'Substituting each option shows only one balances both sides of the equation.',
    explanation_hi: null,
    difficulty: 1,
    bloom_level: 'understand',
    chapter_number: CHAPTERS[idCounter % CHAPTERS.length],
    topic_id: null,
    question_type: 'mcq',
    question_type_v2: 'mcq',
    source_type: 'ncert_exercise',
    content_status: 'published',
    verification_state: 'verified',
    is_verified: true,
    is_active: true,
    deleted_at: null,
    grade: '9',
    subject: 'math',
    irt_a: null,
    irt_b: null,
    irt_calibration_n: 0,
    ...over,
  };
}

/** A pool that comfortably satisfies Rung 0 for the given grade. */
function makeFullPool(grade = '9') {
  const blooms = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'];
  const out: Record<string, unknown>[] = [];
  for (const band of [1, 2, 3]) {
    for (let i = 0; i < 24; i++) {
      out.push(
        makeItem({
          difficulty: band,
          grade,
          bloom_level: blooms[(i + band) % blooms.length],
          chapter_number: CHAPTERS[i % CHAPTERS.length],
        })
      );
    }
  }
  return out;
}

/** True when the query is the POOL fetch (its select carries the IRT columns). */
function isPoolQuery(rec: RecordedQuery) {
  return (rec.columns ?? '').includes('irt_a');
}

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/diagnostic/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

function insertsInto(table: string) {
  return recorded.filter((r) => r.table === table && r.op === 'insert');
}

beforeEach(() => {
  vi.clearAllMocks();
  recorded.length = 0;
  resolvers.clear();
  idCounter = 0;

  mockAuthorize.mockResolvedValue({
    authorized: true,
    userId: 'auth-user-1',
    roles: ['student'],
    permissions: ['diagnostic.attempt'],
  });
  mockValidateSubject.mockResolvedValue({ ok: true });
  mockAllowedSubjects.mockResolvedValue([
    { code: 'math', name: 'Math', nameHi: 'गणित', isLocked: false },
  ]);
  mockLogOpsEvent.mockResolvedValue(undefined);
  mockRpc.mockResolvedValue({ data: null, error: null });

  setTable('students', { data: { id: STUDENT_ID, grade: '9', stream: null }, error: null });
  setTable('cbse_syllabus', {
    data: CHAPTERS.map((chapter_number) => ({ chapter_number })),
    error: null,
  });
  setTable('question_bank', { data: [], error: null });
  setTable('diagnostic_assessments', { data: { id: SESSION_ID }, error: null });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/start — served form (AC-14, AC-15)', () => {
  function armFullPool(grade: string) {
    const pool = makeFullPool(grade);
    setTable('question_bank', (rec) => (isPoolQuery(rec) ? { data: pool, error: null } : { data: [], error: null }));
  }

  for (const grade of ['6', '7', '8', '9', '10', '11', '12']) {
    it(`AC-14/AC-15: grade "${grade}" (string) returns 200 with 15 questions and a session_id`, async () => {
      setTable('students', { data: { id: STUDENT_ID, grade, stream: 'science' }, error: null });
      armFullPool(grade);

      const res = await POST(makeRequest({ grade, subject: 'math' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.session_id).toBe(SESSION_ID);
      expect(body.data.questions.length).toBe(15);
      expect(body.blueprint).toEqual({ easy: 5, medium: 6, hard: 4 });

      // P5 on the response …
      expect(typeof body.data.grade).toBe('string');
      expect(body.data.grade).toBe(grade);
      // … and on the diagnostic_assessments insert.
      const inserted = insertsInto('diagnostic_assessments');
      expect(inserted.length).toBe(1);
      const payload = inserted[0].payload as Record<string, unknown>;
      expect(typeof payload.grade).toBe('string');
      expect(payload.grade).toBe(grade);
      expect(payload.total_questions).toBe(15);
    });
  }

  it('AC-15: integer grade 11 is rejected before any DB work', async () => {
    const res = await POST(makeRequest({ grade: 11, subject: 'math' }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('INVALID_GRADE');
    expect(recorded.length).toBe(0);
  });

  it('AC-13: a chapter parameter is rejected — the diagnostic is whole-subject', async () => {
    const res = await POST(makeRequest({ grade: '9', subject: 'math', chapter: 3 }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('CHAPTER_NOT_SUPPORTED');
    expect(recorded.length).toBe(0);
  });

  it('the client payload never carries server-side verification/IRT metadata', async () => {
    armFullPool('9');
    const res = await POST(makeRequest({ grade: '9', subject: 'math' }));
    const body = await res.json();
    for (const q of body.data.questions) {
      for (const leaked of [
        'verification_state',
        'is_verified',
        'irt_a',
        'irt_b',
        'irt_calibration_n',
        'source_type',
        'content_status',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(q, leaked), leaked).toBe(false);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/start — Rung 4 honest stop (AC-21, AC-22, AC-23)', () => {
  it('AC-21: returns HTTP 200 and inserts NO diagnostic_assessments row', async () => {
    setTable('question_bank', { data: [], error: null });

    const res = await POST(makeRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.diagnostic).toBeNull();
    expect(body.insufficientContent).toBe(true);
    expect(body.reason).toBe('INSUFFICIENT_POOL');
    expect(body.data.content_insufficient).toBe(true);
    expect(body.data.quality_tier).toBe('insufficient');

    // The load-bearing half: no half-started session.
    expect(insertsInto('diagnostic_assessments').length).toBe(0);
  });

  it('AC-21: a pool that is large but has no hard band still stops honestly, with no insert', async () => {
    const easyOnly = makeFullPool('9').filter((q) => q.difficulty !== 3);
    setTable('question_bank', (rec) =>
      isPoolQuery(rec) ? { data: easyOnly, error: null } : { data: [], error: null }
    );

    const res = await POST(makeRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(200);
    expect((await res.json()).insufficientContent).toBe(true);
    expect(insertsInto('diagnostic_assessments').length).toBe(0);
  });

  it('AC-22: alternatives is non-empty and always ends with the unconditional Foxy CTA', async () => {
    const res = await POST(makeRequest({ grade: '9', subject: 'math' }));
    const body = await res.json();
    expect(Array.isArray(body.alternatives)).toBe(true);
    expect(body.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(body.alternatives.some((a: { kind: string }) => a.kind === 'foxy')).toBe(true);
    expect(body.data.alternatives).toEqual(body.alternatives);
  });

  it('AC-22 pathological case: no other subject AND no syllabus chapters still yields >= 1 alternative', async () => {
    mockAllowedSubjects.mockResolvedValue([]);
    setTable('cbse_syllabus', { data: [], error: null });
    setTable('question_bank', { data: [], error: null });

    const res = await POST(makeRequest({ grade: '9', subject: 'math' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.alternatives.length).toBeGreaterThanOrEqual(1);
    expect(body.alternatives[body.alternatives.length - 1].kind).toBe('foxy');
    expect(insertsInto('diagnostic_assessments').length).toBe(0);
  });

  it('AC-22: every alternative carries bilingual EN + Hindi copy and an href (P7)', async () => {
    const res = await POST(makeRequest({ grade: '9', subject: 'math' }));
    const body = await res.json();
    for (const alt of body.alternatives) {
      expect(typeof alt.href).toBe('string');
      expect(alt.href.length).toBeGreaterThan(0);
      expect(typeof alt.label.en).toBe('string');
      expect(alt.label.en.trim().length).toBeGreaterThan(0);
      expect(typeof alt.label.hi).toBe('string');
      expect(alt.label.hi).toMatch(/[ऀ-ॿ]/);
    }
  });

  it('AC-23: the content-gap telemetry payload carries no student identifier or PII (P13)', async () => {
    await POST(makeRequest({ grade: '9', subject: 'math' }));
    expect(mockLogOpsEvent).toHaveBeenCalledTimes(1);

    const event = mockLogOpsEvent.mock.calls[0][0] as Record<string, unknown>;
    const serialized = JSON.stringify(event);
    expect(serialized).not.toMatch(/student_id|studentId|email|phone|"name"/i);
    expect(serialized).not.toContain(STUDENT_ID);

    const ctx = event.context as Record<string, unknown>;
    for (const key of Object.keys(ctx)) {
      expect(key).not.toMatch(/student_id|email|phone|name/i);
    }
    // The payload IS useful to ops: grade, subject, and pool shape counts.
    expect(ctx.grade).toBe('9');
    expect(ctx.subject).toBe('math');
    expect(typeof ctx.available_count).toBe('number');
  });

  it('the insufficient-content message is bilingual (P7)', async () => {
    const res = await POST(makeRequest({ grade: '9', subject: 'math' }));
    const body = await res.json();
    for (const block of [body.message, body.headline]) {
      expect(typeof block.en).toBe('string');
      expect(block.en.trim().length).toBeGreaterThan(0);
      expect(block.hi).toMatch(/[ऀ-ॿ]/);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/start — XP neutrality (AC-32)', () => {
  it('never calls atomic_quiz_profile_update on a served form', async () => {
    const pool = makeFullPool('9');
    setTable('question_bank', (rec) => (isPoolQuery(rec) ? { data: pool, error: null } : { data: [], error: null }));

    await POST(makeRequest({ grade: '9', subject: 'math' }));
    for (const call of mockRpc.mock.calls) {
      expect(call[0]).not.toBe('atomic_quiz_profile_update');
    }
    // And no XP-bearing table is touched.
    const tables = new Set(recorded.map((r) => r.table));
    expect(tables.has('quiz_sessions')).toBe(false);
    expect(tables.has('student_learning_profiles')).toBe(false);
    expect(recorded.filter((r) => r.table === 'students' && r.op !== 'select').length).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/diagnostic/start — grade-11/12 stream handling (AC-17)', () => {
  it('a grade-11 student with no stream and no unlocked subject gets the stream payload, not a 400', async () => {
    setTable('students', { data: { id: STUDENT_ID, grade: '11', stream: null }, error: null });
    mockAllowedSubjects.mockResolvedValue([]);

    const res = await POST(makeRequest({ grade: '11', subject: 'math' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.streamRequired).toBe(true);
    expect(body.diagnostic).toBeNull();
    expect(body.streamOptions).toEqual(['science', 'commerce', 'humanities']);
    expect(body.message.hi).toMatch(/[ऀ-ॿ]/);
    // No session, no diagnostic.
    expect(insertsInto('diagnostic_assessments').length).toBe(0);
  });

  it('a grade-11 student WITH a stream proceeds to the selector', async () => {
    setTable('students', { data: { id: STUDENT_ID, grade: '11', stream: 'science' }, error: null });
    const pool = makeFullPool('11');
    setTable('question_bank', (rec) => (isPoolQuery(rec) ? { data: pool, error: null } : { data: [], error: null }));

    const res = await POST(makeRequest({ grade: '11', subject: 'math' }));
    const body = await res.json();
    expect(body.streamRequired).toBeUndefined();
    expect(body.data.questions.length).toBe(15);
  });
});
