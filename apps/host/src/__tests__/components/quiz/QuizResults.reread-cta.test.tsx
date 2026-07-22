/**
 * QuizResults — "Re-read Chapter N" CTA always routes to the permanent
 * Study-Menu v2 destination (/refresh?tab=chapters).
 *
 * Regression: `ff_revise_route_v1` was permanently DELETED from
 * `feature_flags` in migration 20260603120000_remove_ff_revise_route_v1.sql
 * once /refresh?tab=chapters became the unconditional replacement (mirroring
 * how `ff_study_menu_v2` was retired — see
 * packages/lib/src/routes/study-menu-routes.ts, whose `reviseRoute()` always
 * returns '/refresh?tab=chapters' post-retirement). Because the flag row no
 * longer exists, `reviseFlags?.ff_revise_route_v1 === true` always evaluated
 * to `false`, so the CTA silently fell back to the legacy
 * `/learn/[s]/[c]?mode=read&from=quiz` deep link forever, even though the
 * backing API for /refresh?tab=chapters (`GET /api/learner/revise-stack`)
 * was already fully working.
 *
 * Pins:
 *   1. The CTA renders when there is at least one wrong-answered question
 *      with a valid chapter_number.
 *   2. Its href is always `/refresh?tab=chapters&subject=...&chapter=...&from=quiz`
 *      — never the legacy `/learn/...?mode=read&from=quiz` deep link —
 *      regardless of what `getFeatureFlags()` returns (empty map, flag
 *      present-but-false, or any other shape).
 *   3. The CTA does not render when there are no wrong answers, or no
 *      selectedSubject.
 *
 * Mocking style follows `QuizResults.goal-flag.test.tsx` — hoisted mock
 * factories closing over module-level mutable state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// ─── Mutable mock state ───────────────────────────────────────────────

const authState = {
  isHi: false,
  student: { id: 'stu-1', name: 'Asha', grade: '8', academic_goal: null as string | null },
};

// getFeatureFlags() response — mutated per-test to prove the CTA's
// destination is flag-independent.
const flagsState = {
  flags: {} as Record<string, unknown>,
};

const routerPush = vi.fn();

// ─── Mocks ────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: routerPush,
    replace: vi.fn(),
    back: vi.fn(),
  }),
}));

vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => authState,
}));

vi.mock('@alfanumrik/lib/useAllowedSubjects', () => ({
  useAllowedSubjects: () => ({ unlocked: [], all: [] }),
}));

vi.mock('@alfanumrik/lib/share', () => ({
  shareResult: vi.fn(),
  quizShareMessage: () => 'msg',
}));

vi.mock('@alfanumrik/lib/score-config', () => ({
  getLevelFromScore: () => 'Beginner',
}));

vi.mock('@alfanumrik/lib/sounds', () => ({
  playSound: vi.fn(),
}));

vi.mock('@alfanumrik/lib/supabase', () => {
  function makeChain(table: string) {
    const chain: Record<string, unknown> = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      insert: vi.fn(async () => ({ data: null, error: null })),
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
    // QuizResults calls useFeatureFlags() (packages/lib/src/swr.tsx), which
    // internally calls getFeatureFlags(). Its return shape is mutated per
    // test to prove the Re-read CTA no longer branches on any flag value.
    getFeatureFlags: vi.fn(async () => flagsState.flags),
  };
});

vi.mock('@alfanumrik/ui/quiz/NextActionCard', () => ({
  default: () => <div data-testid="next-action-stub" />,
}));
vi.mock('@alfanumrik/ui/quiz/CelebrationOverlay', () => ({
  default: () => null,
}));
vi.mock('@alfanumrik/ui/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@alfanumrik/ui/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} {...rest}>
      {children}
    </button>
  ),
  StatCard: ({ value, label }: { value: React.ReactNode; label: string }) => (
    <div>
      {label}: {value}
    </div>
  ),
}));
vi.mock('@alfanumrik/lib/cognitive-engine', () => ({
  BLOOM_CONFIG: {},
  BLOOM_LEVELS: [],
}));

// ─── Subject under test ───────────────────────────────────────────────

import QuizResults from '@alfanumrik/ui/quiz/QuizResults';

// ─── Helpers ──────────────────────────────────────────────────────────

function makeProps(overrides: Partial<Parameters<typeof QuizResults>[0]> = {}) {
  return {
    results: {
      total: 2,
      correct: 1,
      score_percent: 50,
      xp_earned: 10,
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
        chapter_number: 3,
      },
      {
        id: 'q2',
        question_text: 'What is 3+3?',
        question_hi: null,
        question_type: 'mcq',
        options: ['5', '6', '7', '8'],
        correct_answer_index: 1,
        explanation: 'Three plus three is six.',
        explanation_hi: null,
        hint: null,
        difficulty: 1,
        bloom_level: 'remember',
        chapter_number: 3,
      },
    ],
    responses: [
      { question_id: 'q1', selected_option: 0, is_correct: false, time_spent: 5 },
      { question_id: 'q2', selected_option: 1, is_correct: true, time_spent: 5 },
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
  flagsState.flags = {};
  vi.clearAllMocks();
});

afterEach(() => cleanup());

// ─── Tests ────────────────────────────────────────────────────────────

describe('QuizResults — Re-read Chapter CTA destination', () => {
  it('routes to /refresh?tab=chapters when getFeatureFlags() returns an empty map (flag row deleted)', async () => {
    flagsState.flags = {};
    render(<QuizResults {...makeProps()} />);

    const cta = await screen.findByTestId('quiz-results-reread-chapter-cta');
    cta.click();

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(
        '/refresh?tab=chapters&subject=math&chapter=3&from=quiz'
      );
    });
    // Must never fall back to the legacy deep link.
    expect(routerPush).not.toHaveBeenCalledWith(
      expect.stringContaining('/learn/math/3?mode=read')
    );
  });

  it('routes to /refresh?tab=chapters even if a stale-shaped flags map is returned (e.g. leftover ff_revise_route_v1: false)', async () => {
    flagsState.flags = { ff_revise_route_v1: false, ff_study_menu_v2: true };
    render(<QuizResults {...makeProps()} />);

    const cta = await screen.findByTestId('quiz-results-reread-chapter-cta');
    cta.click();

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith(
        '/refresh?tab=chapters&subject=math&chapter=3&from=quiz'
      );
    });
  });

  it('does not render the CTA when every response is correct', async () => {
    render(
      <QuizResults
        {...makeProps({
          responses: [
            { question_id: 'q1', selected_option: 3, is_correct: true, time_spent: 5 },
            { question_id: 'q2', selected_option: 1, is_correct: true, time_spent: 5 },
          ],
        })}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('quiz-results-reread-chapter-cta')).not.toBeInTheDocument();
  });

  it('does not render the CTA when selectedSubject is missing', async () => {
    render(<QuizResults {...makeProps({ selectedSubject: undefined })} />);

    await waitFor(() => {
      expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('quiz-results-reread-chapter-cta')).not.toBeInTheDocument();
  });
});
