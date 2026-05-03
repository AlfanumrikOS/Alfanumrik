/**
 * QuizResults — goal-aware scorecard flag gating (Phase 1).
 *
 * Pins the additive, flag-gated mount of <GoalScorecardSentence /> in
 * QuizResults.tsx. Founder constraint: when ff_goal_aware_foxy is OFF or the
 * student has no recognized academic_goal, the existing markup tree must be
 * byte-identical to today (zero new mount points).
 *
 * Tests:
 *   1. flag OFF → zero mounts (byte-identical to today).
 *   2. flag ON + valid goal → exactly one mount.
 *   3. flag ON + null goal → zero mounts.
 *   4. flag ON + unknown goal → zero mounts.
 *
 * Mocking style follows `src/__tests__/app/support-page.test.tsx` —
 * hoisted mock state, mutable supabase chain, mutable auth state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// ─── Mutable mock state ───────────────────────────────────────────────

const authState = {
  isHi: false,
  student: { id: 'stu-1', name: 'Asha', grade: '8', academic_goal: null as string | null },
};

const flagState = {
  // is_enabled value returned by the supabase chain when querying
  // feature_flags.flag_name = 'ff_goal_aware_foxy'.
  goalFlagEnabled: false,
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

// Supabase client — branches by table:
//   - `feature_flags` query returns { is_enabled: flagState.goalFlagEnabled }
//   - `performance_scores`, `spaced_repetition_cards` resolve empty (so the
//     existing flashcard / perf-score effects don't crash the render)
vi.mock('@/lib/supabase', () => {
  function makeChain(table: string) {
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      insert: vi.fn(async () => ({ data: null, error: null })),
      single: vi.fn(async () => ({ data: null, error: null })),
      maybeSingle: vi.fn(async () => {
        if (table === 'feature_flags') {
          return {
            data: { is_enabled: flagState.goalFlagEnabled },
            error: null,
          };
        }
        return { data: null, error: null };
      }),
      then: (resolve: (r: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return chain;
  }
  return {
    supabase: {
      from: vi.fn((table: string) => makeChain(table)),
    },
  };
});

// Heavy quiz-results sub-components — render placeholders so we can focus on
// the goal-mount assertion.
vi.mock('@/components/quiz/NextActionCard', () => ({
  default: () => <div data-testid="next-action-stub" />,
}));
vi.mock('@/components/quiz/CelebrationOverlay', () => ({
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
  BottomNav: () => <nav data-testid="bottom-nav" />,
}));
vi.mock('@/lib/cognitive-engine', () => ({
  BLOOM_CONFIG: {},
  BLOOM_LEVELS: [],
}));

// ─── Subject under test ───────────────────────────────────────────────

import QuizResults from '@/components/quiz/QuizResults';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeProps(overrides: Partial<Parameters<typeof QuizResults>[0]> = {}) {
  return {
    results: {
      total: 5,
      correct: 4,
      score_percent: 80,
      xp_earned: 50,
      session_id: 'sess-1',
    },
    questions: [
      {
        id: 'q1',
        question_text: 'What is 2+2?',
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
    ],
    responses: [
      {
        question_id: 'q1',
        selected_option: 3,
        is_correct: true,
        time_spent: 5,
      },
    ],
    isHi: false,
    quizMode: 'practice' as const,
    cogLoad: { fatigueScore: 0, /* other CogLoadState fields */ } as never,
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
  flagState.goalFlagEnabled = false;
  vi.clearAllMocks();
});

afterEach(() => cleanup());

// ─── Tests ────────────────────────────────────────────────────────────

describe('QuizResults — goal-aware scorecard mount (default OFF)', () => {
  it('renders ZERO goal-scorecard mount when flag is off', async () => {
    flagState.goalFlagEnabled = false;
    authState.student.academic_goal = 'board_topper'; // valid goal but flag off
    render(<QuizResults {...makeProps()} />);
    // Wait long enough for the flag-eval useEffect to settle.
    await waitFor(() => {
      // Bottom nav should be present (means render completed).
      expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('goal-scorecard-mount')).not.toBeInTheDocument();
    expect(screen.queryByTestId('goal-scorecard-sentence')).not.toBeInTheDocument();
  });
});

describe('QuizResults — goal-aware scorecard mount (flag ON)', () => {
  it('renders EXACTLY ONE mount when flag is on and goal is valid', async () => {
    flagState.goalFlagEnabled = true;
    authState.student.academic_goal = 'board_topper';
    render(<QuizResults {...makeProps()} />);
    // The mount only appears after the flag-eval effect resolves true.
    await waitFor(() => {
      expect(screen.getByTestId('goal-scorecard-mount')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('goal-scorecard-mount')).toHaveLength(1);
    // And the inner sentence component too.
    expect(screen.getByTestId('goal-scorecard-sentence')).toBeInTheDocument();
  });

  it('renders ZERO mounts when flag is on but goal is null', async () => {
    flagState.goalFlagEnabled = true;
    authState.student.academic_goal = null;
    render(<QuizResults {...makeProps()} />);
    await waitFor(() => {
      expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    });
    // Give the flag effect a microtask to flip and re-render.
    await new Promise(r => setTimeout(r, 10));
    expect(screen.queryByTestId('goal-scorecard-mount')).not.toBeInTheDocument();
  });

  it('renders ZERO mounts when flag is on but goal is unrecognized', async () => {
    flagState.goalFlagEnabled = true;
    authState.student.academic_goal = 'some_unknown_goal';
    render(<QuizResults {...makeProps()} />);
    await waitFor(() => {
      expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    });
    await new Promise(r => setTimeout(r, 10));
    expect(screen.queryByTestId('goal-scorecard-mount')).not.toBeInTheDocument();
  });
});
