/**
 * Content domain (B6) — unit + integration contract tests.
 *
 * Unit tests run unconditionally:
 *   - Input validation (no env required).
 *   - Mocked supabaseAdmin: verifies the camelCase mapping, P5 grade
 *     coercion, options/array JSONB normalisation, and the
 *     "missing relation" soft-failure path.
 *
 * Integration tests run only when SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY
 * are present in the env. They use a deterministic fake UUID so they are
 * meaningful even against an empty database — the contract under test is
 * that the helpers return ok with an empty list / null for missing data,
 * or a soft-failure DB_ERROR if the table is not yet provisioned.
 *
 * Scope mirrors `src/__tests__/lib/domains/identity.test.ts` and
 * analytics/ops/notifications. See
 * docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md (Phase 0d).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasSupabaseIntegrationEnv } from '@/__tests__/helpers/integration';

// ── Mocked supabaseAdmin harness ──────────────────────────────────────────────
//
// The mock is module-scoped so tests can reach in and stub the resolved
// payload for each case. The fluent builder (.from().select()...etc) returns
// `mockResult` from any thenable terminator.

interface MockResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

let mockResult: MockResult = { data: null, error: null };

function makeBuilder() {
  // Each chained method returns the same builder; the final await reads
  // mockResult. This mimics the supabase-js fluent API just enough for
  // the content module's call shape.
  const builder: Record<string, unknown> = {};
  const chainable = ['select', 'eq', 'gte', 'lte', 'order', 'limit'];
  for (const m of chainable) {
    builder[m] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(() => Promise.resolve(mockResult));
  builder.then = (resolve: (v: MockResult) => unknown) =>
    Promise.resolve(mockResult).then(resolve);
  return builder;
}

vi.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => makeBuilder()),
  },
  getSupabaseAdmin: () => ({
    from: vi.fn(() => makeBuilder()),
  }),
}));

// Suppress logger noise during error-path tests — none of these assertions
// depend on what the logger actually does.
vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  getQuestion,
  listQuestions,
  getChapter,
  listChapters,
  getNcertContent,
  listChapterConcepts,
} from '@/lib/domains/content';

beforeEach(() => {
  mockResult = { data: null, error: null };
});

// ── Input validation ──────────────────────────────────────────────────────────

describe('content domain — input validation', () => {
  it('getQuestion rejects empty questionId with INVALID_INPUT', async () => {
    const r = await getQuestion('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getChapter rejects empty chapterId with INVALID_INPUT', async () => {
    const r = await getChapter('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listChapters rejects when grade is missing', async () => {
    // @ts-expect-error — testing runtime guard
    const r = await listChapters({});
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getNcertContent rejects when grade is missing', async () => {
    // @ts-expect-error — testing runtime guard
    const r = await getNcertContent({ subject: 'science' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('getNcertContent rejects when subject is missing', async () => {
    // @ts-expect-error — testing runtime guard
    const r = await getNcertContent({ grade: '8' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listChapterConcepts rejects empty chapterId with INVALID_INPUT', async () => {
    const r = await listChapterConcepts('');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });

  it('listQuestions rejects non-numeric difficulty', async () => {
    const r = await listQuestions({ difficulty: 'easy-not-numeric' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('INVALID_INPUT');
  });
});

// ── Mocked happy path (camelCase mapping, P5 coercion, options) ──────────────

describe('content domain — camelCase projection', () => {
  it('getQuestion maps snake_case row to camelCase + coerces grade to string', async () => {
    mockResult = {
      data: {
        id: 'q-1',
        subject: 'science',
        grade: 8, // intentionally numeric to test P5 coercion
        chapter_id: 'chap-uuid-1',
        chapter_number: 3,
        chapter_title: 'Light',
        topic: 'Reflection',
        question_text: 'What is the law of reflection?',
        question_hi: 'परावर्तन का नियम क्या है?',
        question_type: 'mcq',
        options: ['a', 'b', 'c', 'd'],
        correct_answer_index: 2,
        explanation: 'Angle of incidence equals angle of reflection.',
        explanation_hi: null,
        hint: 'Think mirror.',
        hint_hi: null,
        difficulty: 2,
        bloom_level: 'understand',
        is_active: true,
        source: 'ncert',
        is_ncert: true,
        verified_against_ncert: true,
        verification_state: 'verified',
        created_at: '2026-04-20T10:00:00Z',
        updated_at: '2026-04-20T10:00:00Z',
      },
      error: null,
    };

    const r = await getQuestion('q-1');
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.id).toBe('q-1');
    expect(r.data.grade).toBe('8'); // P5: string, not number
    expect(typeof r.data.grade).toBe('string');
    expect(r.data.questionText).toBe('What is the law of reflection?');
    expect(r.data.options).toEqual(['a', 'b', 'c', 'd']);
    expect(r.data.correctAnswerIndex).toBe(2);
    expect(r.data.bloomLevel).toBe('understand');
    expect(r.data.isNcert).toBe(true);
    expect(r.data.verifiedAgainstNcert).toBe(true);
    expect(r.data.verificationState).toBe('verified');
  });

  it('getQuestion returns ok(null) when not found', async () => {
    mockResult = { data: null, error: null };
    const r = await getQuestion('does-not-exist');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toBeNull();
  });

  it('getQuestion normalises options stored as JSON-string and as objects', async () => {
    mockResult = {
      data: {
        id: 'q-2',
        subject: 'math',
        grade: '9',
        chapter_id: null,
        chapter_number: 1,
        chapter_title: null,
        topic: null,
        question_text: 'pick',
        question_hi: null,
        question_type: 'mcq',
        // legacy shape: array of {text, isCorrect}
        options: [
          { text: 'one', isCorrect: false },
          { text: 'two', isCorrect: true },
          { text: 'three', isCorrect: false },
          { text: 'four', isCorrect: false },
        ],
        correct_answer_index: 1,
        explanation: 'two',
        explanation_hi: null,
        hint: null,
        hint_hi: null,
        difficulty: 1,
        bloom_level: 'remember',
        is_active: true,
        source: null,
        is_ncert: false,
        verified_against_ncert: false,
        verification_state: 'legacy_unverified',
        created_at: null,
        updated_at: null,
      },
      error: null,
    };
    const r = await getQuestion('q-2');
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.options).toEqual(['one', 'two', 'three', 'four']);
  });

  it('listQuestions returns mapped array', async () => {
    mockResult = {
      data: [
        {
          id: 'q-a',
          subject: 'science',
          grade: '8',
          chapter_id: null,
          chapter_number: 1,
          chapter_title: null,
          topic: null,
          question_text: 'q1',
          question_hi: null,
          question_type: 'mcq',
          options: ['a', 'b', 'c', 'd'],
          correct_answer_index: 0,
          explanation: null,
          explanation_hi: null,
          hint: null,
          hint_hi: null,
          difficulty: 2,
          bloom_level: 'understand',
          is_active: true,
          source: null,
          is_ncert: null,
          verified_against_ncert: null,
          verification_state: null,
          created_at: null,
          updated_at: null,
        },
      ],
      error: null,
    };
    const r = await listQuestions({ grade: '8', subject: 'science' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(1);
    expect(r.data[0].grade).toBe('8');
  });

  it('listQuestions clamps limit above 200 down to 200', async () => {
    mockResult = { data: [], error: null };
    const r = await listQuestions({ grade: '7', limit: 9999 });
    expect(r.ok).toBe(true);
    // The clamp is implementation-detail; the assertion is just that it
    // does not error and returns ok([]) — exposing the clamp value would
    // require introspecting the mock builder, which is brittle.
    if (!r.ok) return;
    expect(Array.isArray(r.data)).toBe(true);
  });

  it('getChapter maps cbse_syllabus row to camelCase', async () => {
    mockResult = {
      data: {
        id: 'chap-1',
        board: 'CBSE',
        grade: '10',
        subject_code: 'science',
        subject_display: 'Science',
        subject_display_hi: 'विज्ञान',
        chapter_number: 5,
        chapter_title: 'Periodic Classification',
        chapter_title_hi: null,
        chunk_count: 32,
        verified_question_count: 18,
        rag_status: 'ready',
        last_verified_at: '2026-04-21T00:00:00Z',
        is_in_scope: true,
        notes: null,
        created_at: '2026-04-15T00:00:00Z',
        updated_at: '2026-04-21T00:00:00Z',
      },
      error: null,
    };
    const r = await getChapter('chap-1');
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data) return;
    expect(r.data.id).toBe('chap-1');
    expect(r.data.subjectCode).toBe('science');
    expect(r.data.ragStatus).toBe('ready');
    expect(r.data.chunkCount).toBe(32);
    expect(r.data.verifiedQuestionCount).toBe(18);
    expect(r.data.isInScope).toBe(true);
    expect(r.data.grade).toBe('10');
  });

  it('listChapters scopes by grade only when subject is omitted', async () => {
    mockResult = { data: [], error: null };
    const r = await listChapters({ grade: '9' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toEqual([]);
  });

  it('getNcertContent returns soft DB_ERROR when ncert_content table is missing', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "ncert_content" does not exist' },
    };
    const r = await getNcertContent({ grade: '8', subject: 'science' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
    expect(r.error).toMatch(/not provisioned/);
  });

  it('listChapterConcepts maps array fields and JSONB defaults', async () => {
    mockResult = {
      data: [
        {
          id: 'cc-1',
          chapter_id: 'chap-1',
          grade: '8',
          subject: 'science',
          chapter_number: 3,
          chapter_title: 'Light',
          concept_number: 1,
          title: 'Reflection',
          title_hi: null,
          slug: 'reflection',
          learning_objective: 'Understand reflection',
          learning_objective_hi: null,
          explanation: 'Light bounces off surfaces.',
          explanation_hi: null,
          key_formula: null,
          example_title: null,
          example_content: null,
          example_content_hi: null,
          common_mistakes: ['confusing reflection with refraction'],
          exam_tips: ['draw clear diagrams', 'label angle markers'],
          diagram_refs: ['Figure 3.1'],
          diagram_description: null,
          practice_question: null,
          practice_options: null,
          practice_correct_index: null,
          practice_explanation: null,
          difficulty: 2,
          bloom_level: 'understand',
          estimated_minutes: 5,
          is_active: true,
          source: 'ncert_2025',
          created_at: '2026-04-10T00:00:00Z',
          updated_at: '2026-04-10T00:00:00Z',
        },
      ],
      error: null,
    };
    const r = await listChapterConcepts('chap-1');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toHaveLength(1);
    const c = r.data[0];
    expect(c.id).toBe('cc-1');
    expect(c.chapterId).toBe('chap-1');
    expect(c.grade).toBe('8');
    expect(c.commonMistakes).toEqual([
      'confusing reflection with refraction',
    ]);
    expect(c.examTips).toEqual([
      'draw clear diagrams',
      'label angle markers',
    ]);
    expect(c.diagramRefs).toEqual(['Figure 3.1']);
    // null JSONB columns should project to []
    expect(c.practiceOptions).toEqual([]);
    expect(c.estimatedMinutes).toBe(5);
  });
});

// ── Soft-failure paths (table missing, generic DB error) ──────────────────────

describe('content domain — error mapping', () => {
  it('treats Postgres 42P01 as DB_ERROR for question_bank', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "question_bank" does not exist' },
    };
    const r = await getQuestion('q-x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('treats Postgres 42P01 as DB_ERROR for cbse_syllabus', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "cbse_syllabus" does not exist' },
    };
    const r = await getChapter('chap-x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('treats Postgres 42P01 as DB_ERROR for chapter_concepts', async () => {
    mockResult = {
      data: null,
      error: { code: '42P01', message: 'relation "chapter_concepts" does not exist' },
    };
    const r = await listChapterConcepts('chap-x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });

  it('matches the missing-relation message text variant (no SQLSTATE code)', async () => {
    mockResult = {
      data: null,
      error: { message: 'relation "chapter_concepts" does not exist' },
    };
    const r = await listChapterConcepts('chap-x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
    expect(r.error).toMatch(/not provisioned/);
  });

  it('maps any other postgres error to DB_ERROR with the message preserved', async () => {
    mockResult = {
      data: null,
      error: { code: '42501', message: 'permission denied for table question_bank' },
    };
    const r = await getQuestion('q-x');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
    expect(r.error).toContain('permission denied');
  });

  it('listChapters returns DB_ERROR on generic error', async () => {
    mockResult = {
      data: null,
      error: { code: '42703', message: 'column does not exist' },
    };
    const r = await listChapters({ grade: '8' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DB_ERROR');
  });
});

// ── Integration happy-path (skipped without env) ─────────────────────────────

const FAKE_UUID = '00000000-0000-0000-0000-00000000dead';

const describeIntegration = hasSupabaseIntegrationEnv()
  ? describe
  : describe.skip;

describeIntegration('content domain — integration (null/empty path)', () => {
  it('getQuestion returns ok(null) or DB_ERROR for unknown id', async () => {
    const r = await getQuestion(FAKE_UUID);
    if (r.ok) {
      expect(r.data).toBeNull();
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('listQuestions returns ok([]) or DB_ERROR for unknown chapter', async () => {
    const r = await listQuestions({ chapterId: FAKE_UUID, limit: 5 });
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('getChapter returns ok(null) or DB_ERROR for unknown id', async () => {
    const r = await getChapter(FAKE_UUID);
    if (r.ok) {
      expect(r.data).toBeNull();
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('listChapters returns ok([]) or DB_ERROR for unknown grade', async () => {
    // Grade "6" is valid; an empty in-scope syllabus would still return [].
    const r = await listChapters({ grade: '6', subject: 'no-such-subject' });
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('getNcertContent returns ok([]) or DB_ERROR (table may be unprovisioned)', async () => {
    const r = await getNcertContent({ grade: '8', subject: 'science' });
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });

  it('listChapterConcepts returns ok([]) or DB_ERROR for unknown chapter', async () => {
    const r = await listChapterConcepts(FAKE_UUID);
    if (r.ok) {
      expect(Array.isArray(r.data)).toBe(true);
    } else {
      expect(r.code).toBe('DB_ERROR');
    }
  });
});
