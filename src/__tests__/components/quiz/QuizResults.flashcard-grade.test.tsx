/**
 * QuizResults — automatic spaced-repetition card creation (Wave 0 Task 0.7b).
 *
 * The auto-flashcard effect in QuizResults.tsx failed silently for months:
 * the insert payload omitted the NOT-NULL `grade` column (23502) and the
 * surrounding try/catch swallowed the returned error as "non-critical".
 *
 * Pins:
 *   1. Every card insert payload includes `grade` from the auth student
 *      profile (P5: string "6"-"12") plus all NOT-NULL columns
 *      (student_id, subject, front_text, back_text non-empty).
 *   2. 23505 (unique dup on student_id/topic/card_type) is benign —
 *      no logger.warn, no user-facing error, no false "created" banner.
 *   3. Any other insert error → logger.warn with the pg error code ONLY
 *      (P13: no card text, no student identifiers), and the results
 *      screen still renders (card creation is non-blocking).
 *   4. Per-question SRS dedupe key (fix/srs-dedupe-per-question): `topic`
 *      is the composite `${subject}:${chapter}:${question_id}` — NEVER the
 *      bloom level and NEVER null. The old `topic = bloom_level` key,
 *      combined with the DB partial unique index idx_src_u
 *      (student_id, topic, card_type) WHERE topic IS NOT NULL, capped every
 *      student at 6 lifetime review cards across ALL subjects (one per
 *      Bloom level, first-writer-wins) while NULL-bloom cards escaped
 *      dedupe entirely. Two distinct wrong questions must always produce
 *      two cards; the same question wrong twice stays one card (client
 *      source_id dedupe + 23505-benign race path).
 *
 * Mocking style follows `QuizResults.goal-flag.test.tsx` — hoisted mock
 * factories closing over module-level mutable state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// ─── Mutable mock state ───────────────────────────────────────────────

const authState = {
  isHi: false,
  student: {
    id: 'stu-1',
    name: 'Asha',
    grade: '8',
    academic_goal: null as string | null,
  } as { id: string; name: string; grade: string; academic_goal: string | null } | null,
};

const insertState = {
  // Every row handed to supabase.from('spaced_repetition_cards').insert(...)
  payloads: [] as Record<string, unknown>[],
  // Error returned by that insert (supabase-js returns errors, never throws)
  error: null as { code: string; message: string } | null,
  // Per-row errors keyed by source_id — simulates the DB partial unique
  // index idx_src_u rejecting SPECIFIC rows. A batch insert containing any
  // conflicting row aborts atomically (PostgREST semantics); a single-row
  // insert fails only if its own key conflicts. Exercises the REG-234
  // batch-then-retry path with the per-question composite topic key.
  rowErrors: {} as Record<string, { code: string; message: string }>,
};

const loggerState = {
  warns: [] as unknown[][],
};

// Rows the client-side dedupe reads see as already existing in
// spaced_repetition_cards (byText / bySource queries in QuizResults).
const queryState = {
  existingFrontTexts: [] as string[],
  existingSourceIds: [] as string[],
};

// ─── Mocks ────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: (...args: unknown[]) => {
      loggerState.warns.push(args);
    },
    error: vi.fn(),
  },
}));

vi.mock('@/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ unlocked: [], all: [] }),
}));

vi.mock('@/lib/share', () => ({
  shareResult: vi.fn(),
  quizShareMessage: () => 'msg',
}));

vi.mock('@/lib/score-config', () => ({
  getLevelFromScore: () => 'Beginner',
}));

vi.mock('@/lib/sounds', () => ({
  playSound: vi.fn(),
}));

// Supabase client — the spaced_repetition_cards insert records payloads and
// returns insertState.error; every other query resolves empty.
vi.mock('@/lib/supabase', () => {
  function makeChain(table: string) {
    let selectedCols = '';
    const chain: Record<string, unknown> = {
      select: vi.fn((cols?: string) => {
        selectedCols = typeof cols === 'string' ? cols : '';
        return chain;
      }),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      insert: vi.fn(async (payload: unknown) => {
        if (table === 'spaced_repetition_cards') {
          const rows = Array.isArray(payload) ? payload : [payload];
          insertState.payloads.push(...(rows as Record<string, unknown>[]));
          if (insertState.error) return { data: null, error: insertState.error };
          // Per-row conflict: any conflicting row aborts the whole batch
          // (PostgREST inserts are atomic); a single-row insert fails only
          // on its own key.
          const conflicting = rows.find(
            r => insertState.rowErrors[(r as Record<string, unknown>).source_id as string],
          );
          if (conflicting) {
            const key = (conflicting as Record<string, unknown>).source_id as string;
            return { data: null, error: insertState.rowErrors[key] };
          }
          return { data: null, error: null };
        }
        return { data: null, error: null };
      }),
      single: vi.fn(async () => ({ data: null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      then: (resolve: (r: unknown) => unknown) => {
        let data: Record<string, unknown>[] = [];
        if (table === 'spaced_repetition_cards') {
          if (selectedCols === 'front_text') {
            data = queryState.existingFrontTexts.map(t => ({ front_text: t }));
          } else if (selectedCols === 'source_id') {
            data = queryState.existingSourceIds.map(id => ({ source_id: id }));
          }
        }
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    return chain;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => makeChain(table)),
    },
    getFeatureFlags: vi.fn(async () => ({})),
  };
});

// Heavy quiz-results sub-components — placeholders keep the tests focused
// on the flashcard-creation effect.
vi.mock('@/components/quiz/NextActionCard', () => ({
  default: () => <div data-testid="next-action-stub" />,
}));
vi.mock('@/components/quiz/CelebrationOverlay', () => ({
  default: () => null,
}));
vi.mock('@/components/quiz/MisconceptionExplainer', () => ({
  default: () => null,
}));
vi.mock('@/components/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  StatCard: ({ value, label }: { value: React.ReactNode; label: string }) => (
    <div>{label}: {value}</div>
  ),
}));
vi.mock('@/lib/cognitive-engine', () => ({
  BLOOM_CONFIG: {},
  BLOOM_LEVELS: [],
}));

// ─── Subject under test ───────────────────────────────────────────────

import QuizResults from '@/components/quiz/QuizResults';

// ─── Helpers ──────────────────────────────────────────────────────────

const QUESTION_TEXT_1 = 'What is 2+2?';
const QUESTION_TEXT_2 = 'Which planet is known as the Red Planet?';

function makeProps(overrides: Partial<Parameters<typeof QuizResults>[0]> = {}) {
  return {
    results: {
      total: 2,
      correct: 0,
      score_percent: 0,
      xp_earned: 0,
      session_id: 'sess-1',
    },
    questions: [
      {
        id: 'q1',
        question_text: QUESTION_TEXT_1,
        question_hi: null,
        question_type: 'mcq',
        options: ['1', '2', '3', '4'],
        correct_answer_index: 3,
        explanation: 'Two plus two is four.',
        explanation_hi: null,
        hint: null,
        difficulty: 1,
        bloom_level: 'remember',
        chapter_number: 1,
      },
      {
        id: 'q2',
        question_text: QUESTION_TEXT_2,
        question_hi: null,
        question_type: 'mcq',
        options: ['Venus', 'Mars', 'Jupiter', 'Saturn'],
        correct_answer_index: 1,
        explanation: 'Mars appears red due to iron oxide.',
        explanation_hi: null,
        hint: null,
        difficulty: 1,
        bloom_level: 'understand',
        chapter_number: 2,
      },
    ],
    responses: [
      { question_id: 'q1', selected_option: 0, is_correct: false, time_spent: 5 },
      { question_id: 'q2', selected_option: 2, is_correct: false, time_spent: 6 },
    ],
    isHi: false,
    quizMode: 'practice' as const,
    cogLoad: { fatigueScore: 0 } as never,
    selectedSubject: 'math',
    studentName: 'Asha',
    timer: 30,
    onRetry: vi.fn(),
    onGoHome: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  authState.isHi = false;
  authState.student = { id: 'stu-1', name: 'Asha', grade: '8', academic_goal: null };
  insertState.payloads = [];
  insertState.error = null;
  insertState.rowErrors = {};
  loggerState.warns = [];
  queryState.existingFrontTexts = [];
  queryState.existingSourceIds = [];
  vi.clearAllMocks();
});

afterEach(() => cleanup());

// ─── Tests ────────────────────────────────────────────────────────────

describe('QuizResults — auto flashcard insert payload (Wave 0 Task 0.7b)', () => {
  it('includes grade from the auth student profile and all NOT-NULL columns', async () => {
    render(<QuizResults {...makeProps()} />);

    await waitFor(() => {
      expect(insertState.payloads.length).toBeGreaterThan(0);
    });
    // One card per wrong answer
    expect(insertState.payloads).toHaveLength(2);

    for (const card of insertState.payloads) {
      // Exact key allowlist — every key exists in the production table
      // (baseline migration 00000000000000_baseline_from_prod.sql ~13552);
      // phantom columns must never be sent.
      // `chapter_title` added deliberately (srs-dedupe humane-label fix):
      // it is a real production column (nullable text, baseline ~13552) and
      // both review-card display paths prefer it over the machine `topic`
      // dedupe key — without it students would see `math:5:uuid` labels.
      expect(Object.keys(card).sort()).toEqual([
        'back_text',
        'card_type',
        'chapter_number',
        'chapter_title',
        'front_text',
        'grade',
        'hint',
        'source',
        'source_id',
        'student_id',
        'subject',
        'topic',
      ]);
      // P5: grade is a string "6"-"12", sourced from useAuth().student.grade.
      // toMatch throws on non-strings, so this also pins "never a number".
      expect(card.grade).toBe('8');
      expect(card.grade).toMatch(/^([6-9]|1[0-2])$/);
      // RLS sr_own: student_id must be the caller's own student id
      expect(card.student_id).toBe('stu-1');
      // Remaining NOT-NULL columns must be present and non-empty
      expect(typeof card.subject).toBe('string');
      expect((card.subject as string).length).toBeGreaterThan(0);
      expect(typeof card.front_text).toBe('string');
      expect((card.front_text as string).trim().length).toBeGreaterThan(0);
      expect(typeof card.back_text).toBe('string');
      expect((card.back_text as string).trim().length).toBeGreaterThan(0);
      // Per-question SRS dedupe: topic is the composite key, never null.
      expect(typeof card.topic).toBe('string');
      expect((card.topic as string).length).toBeGreaterThan(0);
      // Humane display title: "Chapter N" from the question's chapter_number
      // — NEVER the composite dedupe key and NEVER a question id/uuid.
      expect(card.chapter_title).toMatch(/^Chapter \d+$/);
      expect(card.chapter_title).not.toContain(':');
      expect(card.chapter_title as string).not.toContain(card.source_id as string);
    }

    // Success path still surfaces the existing banner
    await waitFor(() => {
      expect(screen.getByText(/created from your mistakes/i)).toBeInTheDocument();
    });
  });

  it('does NOT latch a partial run: skips creation when subject is missing (NOT-NULL)', async () => {
    render(<QuizResults {...makeProps({ selectedSubject: null })} />);
    await waitFor(() => {
      expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    });
    await new Promise(r => setTimeout(r, 20));
    // No insert can satisfy the NOT-NULL subject column — no attempt made
    expect(insertState.payloads).toHaveLength(0);
    expect(loggerState.warns).toHaveLength(0);
  });
});

describe('QuizResults — per-question SRS dedupe key (fix/srs-dedupe-per-question)', () => {
  it('writes topic = `${subject}:${chapter}:${question_id}` — the composite key contains the question id', async () => {
    render(<QuizResults {...makeProps()} />);

    await waitFor(() => {
      expect(insertState.payloads).toHaveLength(2);
    });
    const topics = insertState.payloads.map(c => c.topic);
    // Exact composite shape: subject : chapter_number : question_bank id
    expect(topics).toEqual(['math:1:q1', 'math:2:q2']);
  });

  it('two DIFFERENT wrong questions with the SAME bloom level → two cards with distinct topics (old bloom key would have collapsed them into one)', async () => {
    const props = makeProps();
    // Force the collision the old key produced: same bloom_level, same chapter.
    props.questions = props.questions.map(q => ({
      ...q,
      bloom_level: 'remember',
      chapter_number: 1,
    }));
    render(<QuizResults {...props} />);

    await waitFor(() => {
      expect(insertState.payloads).toHaveLength(2);
    });
    const topics = insertState.payloads.map(c => c.topic as string);
    // Distinct per-question keys despite identical bloom + chapter.
    expect(new Set(topics).size).toBe(2);
    expect(topics).toEqual(['math:1:q1', 'math:1:q2']);
    // The bloom level must never be the dedupe key again.
    expect(topics).not.toContain('remember');
  });

  it('same question wrong twice (retake) → one card: client source_id dedupe skips the existing card', async () => {
    // q1 already has a card from a previous attempt.
    queryState.existingSourceIds = ['q1'];
    render(<QuizResults {...makeProps()} />);

    await waitFor(() => {
      expect(insertState.payloads).toHaveLength(1);
    });
    // Only q2's card is inserted; q1 is deduped client-side.
    expect(insertState.payloads[0].source_id).toBe('q2');
    expect(insertState.payloads[0].topic).toBe('math:2:q2');
    // The race path (dedupe read misses, DB catches it) is the 23505-benign
    // test below — together they pin "same question twice = one card".
  });

  it('REG-234 batch-then-retry with the new key: one row 23505s (retake race on its composite topic) → batch aborts, row retry keeps the OTHER card, banner reports exactly 1', async () => {
    // The client-side dedupe read missed q1 (race: another tab/attempt just
    // wrote it), so BOTH cards are attempted. The DB partial unique index
    // idx_src_u rejects q1's composite per-question key; PostgREST aborts
    // the whole 2-row batch on that one conflict.
    insertState.rowErrors = {
      q1: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "idx_src_u"',
      },
    };
    render(<QuizResults {...makeProps()} />);

    // 2 batch rows + 2 row-by-row retry attempts.
    await waitFor(() => {
      expect(insertState.payloads).toHaveLength(4);
    });
    // Batch carried both composite per-question keys…
    expect(insertState.payloads.slice(0, 2).map(c => c.topic)).toEqual([
      'math:1:q1',
      'math:2:q2',
    ]);
    // …and the retry re-attempted each row individually in order.
    expect(insertState.payloads[2].source_id).toBe('q1');
    expect(insertState.payloads[3].source_id).toBe('q2');

    // q1's 23505 is expected dedupe (same question wrong twice = one card,
    // DB-enforced side of the contract) — benign, never warned.
    expect(loggerState.warns).toHaveLength(0);

    // q2 survived the retry: created = 1, banner is singular ("1 flashcard",
    // not "2 flashcards" — the conflicting row must not be counted).
    await waitFor(() => {
      expect(
        screen.getByText(/1 flashcard created from your mistakes/i),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/2 flashcards/i)).not.toBeInTheDocument();
  });

  it('chapter_title falls back to the subject name when chapter_number is missing — never the composite key', async () => {
    const props = makeProps();
    // chapter_number 0 is the falsy "missing" case (the writer uses the same
    // `q.chapter_number || undefined` truthiness for the chapter_number column).
    props.questions = props.questions.map(q => ({ ...q, chapter_number: 0 }));
    render(<QuizResults {...props} />);

    await waitFor(() => {
      expect(insertState.payloads).toHaveLength(2);
    });
    for (const card of insertState.payloads) {
      // Humane fallback: the subject name (assessment-specified), not
      // "Chapter 0", not null, and never the machine topic key.
      expect(card.chapter_title).toBe('math');
      expect(card.chapter_title).not.toBe(card.topic);
    }
  });

  it('topic is never null/undefined for quiz-wrong cards (the NULL-topic dedupe escape is closed)', async () => {
    const props = makeProps();
    // Old code wrote `topic: q.bloom_level || undefined` — an empty bloom
    // produced a NULL topic, which idx_src_u's WHERE topic IS NOT NULL
    // predicate exempted from dedupe (unbounded duplicates on retakes).
    props.questions = props.questions.map(q => ({ ...q, bloom_level: '' }));
    render(<QuizResults {...props} />);

    await waitFor(() => {
      expect(insertState.payloads).toHaveLength(2);
    });
    for (const card of insertState.payloads) {
      expect(card.topic).not.toBeNull();
      expect(card.topic).not.toBeUndefined();
      expect(typeof card.topic).toBe('string');
      expect((card.topic as string).length).toBeGreaterThan(0);
    }
  });
});

describe('QuizResults — flashcard insert error handling', () => {
  it('treats 23505 (duplicate card) as benign: no warn, no error, no banner', async () => {
    insertState.error = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    render(<QuizResults {...makeProps()} />);

    await waitFor(() => {
      expect(insertState.payloads.length).toBeGreaterThan(0);
    });
    await new Promise(r => setTimeout(r, 20));

    // Expected dedupe — silent
    expect(loggerState.warns).toHaveLength(0);
    // No false "flashcards created" banner (nothing was inserted)
    expect(screen.queryByText(/created from your mistakes/i)).not.toBeInTheDocument();
    // Results screen unaffected
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
  });

  it('logs other insert errors via logger.warn with the pg code only (P13), results still render', async () => {
    insertState.error = {
      code: '23502',
      message: 'null value in column "grade" violates not-null constraint',
    };
    render(<QuizResults {...makeProps()} />);

    await waitFor(() => {
      expect(loggerState.warns.length).toBeGreaterThan(0);
    });

    // P13 key-level pin: every warned meta object carries EXACTLY the pg
    // error code key — never front_text/back_text/question keys or values.
    for (const [, meta] of loggerState.warns) {
      expect(Object.keys(meta as Record<string, unknown>)).toEqual(['code']);
    }

    const serialized = JSON.stringify(loggerState.warns);
    // Carries the pg error code…
    expect(serialized).toContain('23502');
    // …but never card text or student identifiers (P13)
    expect(serialized).not.toContain(QUESTION_TEXT_1);
    expect(serialized).not.toContain(QUESTION_TEXT_2);
    expect(serialized).not.toContain('Asha');
    expect(serialized).not.toContain('stu-1');

    // Non-blocking: results screen still renders, no false banner
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    expect(screen.queryByText(/created from your mistakes/i)).not.toBeInTheDocument();
  });
});
