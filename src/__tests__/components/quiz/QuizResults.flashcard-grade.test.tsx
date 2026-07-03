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
};

const loggerState = {
  warns: [] as unknown[][],
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
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      insert: vi.fn(async (payload: unknown) => {
        if (table === 'spaced_repetition_cards') {
          const rows = Array.isArray(payload) ? payload : [payload];
          insertState.payloads.push(...(rows as Record<string, unknown>[]));
          return { data: null, error: insertState.error };
        }
        return { data: null, error: null };
      }),
      single: vi.fn(async () => ({ data: null, error: null })),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      then: (resolve: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
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
  loggerState.warns = [];
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
      // P5: grade is a string "6"-"12", sourced from useAuth().student.grade
      expect(card.grade).toBe('8');
      // RLS sr_own: student_id must be the caller's own student id
      expect(card.student_id).toBe('stu-1');
      // Remaining NOT-NULL columns must be present and non-empty
      expect(typeof card.subject).toBe('string');
      expect((card.subject as string).length).toBeGreaterThan(0);
      expect(typeof card.front_text).toBe('string');
      expect((card.front_text as string).trim().length).toBeGreaterThan(0);
      expect(typeof card.back_text).toBe('string');
      expect((card.back_text as string).trim().length).toBeGreaterThan(0);
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
