/**
 * /exams/mock/[paperId] — ff_exam_v2 flag-gating (Wave B3, screen 11 "Mock
 * exam" additive route).
 *
 * Pins the wiring in
 * apps/host/src/app/(student)/exams/mock/[paperId]/page.tsx, NOT
 * <ExamRunner>'s own behaviour (see components/exam/v2/ExamRunner.test.tsx
 * for that):
 *
 *   - flag OFF (or still resolving) → legacy <MockTestRunner> renders,
 *     <ExamRunner> never mounts. Covers both the static (JEE/NEET/Olympiad)
 *     flow and the cbse_board dynamic-attempt flow.
 *   - flag ON → <ExamRunner> renders with the same paper/questions/isHi/
 *     attemptId props <MockTestRunner> would have received — no prop drift
 *     between the two branches.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

afterEach(() => cleanup());

// ── next/navigation ──────────────────────────────────────────────────────
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  useParams: () => ({ paperId: 'paper-1' }),
  useRouter: () => ({ replace: mockReplace, push: vi.fn(), back: vi.fn() }),
}));

// ── Auth ──────────────────────────────────────────────────────────────────
const mockUseAuth = vi.fn();
vi.mock('@alfanumrik/lib/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

// ── Feature flags ─────────────────────────────────────────────────────────
const mockUseFeatureFlags = vi.fn();
vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => mockUseFeatureFlags(),
}));

// ── swr (single useSWR call in this page: the paper GET) ────────────────
let mockPaperResult: { kind: string; data?: unknown } | undefined;
vi.mock('swr', () => ({
  default: () => ({ data: mockPaperResult, error: undefined, isLoading: false }),
}));

// ── LoadingFoxy stub ──────────────────────────────────────────────────────
vi.mock('@alfanumrik/ui/ui', () => ({
  LoadingFoxy: () => React.createElement('div', { 'data-testid': 'loading-foxy' }),
}));

// ── Runner stubs — assert on props passed, not internal rendering ───────
const examRunnerSpy = vi.fn();
vi.mock('@alfanumrik/ui/exam/v2/ExamRunner', () => ({
  default: (props: Record<string, unknown>) => {
    examRunnerSpy(props);
    return React.createElement('div', { 'data-testid': 'exam-runner-v2-stub' });
  },
}));

const mockTestRunnerSpy = vi.fn();
vi.mock('@alfanumrik/ui/exams/MockTestRunner', () => ({
  default: (props: Record<string, unknown>) => {
    mockTestRunnerSpy(props);
    return React.createElement('div', { 'data-testid': 'mock-test-runner-stub' });
  },
}));

function baseAuth(overrides: Record<string, unknown> = {}) {
  return { isHi: false, isLoggedIn: true, isLoading: false, ...overrides };
}

const STATIC_PAPER = {
  id: 'paper-1',
  paper_code: 'JEE-2024-M1',
  exam_family: 'jee_main',
  exam_year: 2024,
  total_questions: 2,
  duration_minutes: 60,
  subject_scope: ['physics'],
};

const STATIC_QUESTIONS = [
  {
    id: 'q1',
    question_number: 1,
    question_text: 'Q1?',
    question_type: 'mcq_single',
    options: ['a', 'b', 'c', 'd'],
    marks_correct: 4,
    marks_wrong: -1,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockPaperResult = undefined;
  global.fetch = vi.fn();
});

describe('/exams/mock/[paperId] — ff_exam_v2 gate (static JEE/NEET/Olympiad flow)', () => {
  it('flag OFF: renders legacy MockTestRunner, never mounts ExamRunner', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_exam_v2: false } });
    mockPaperResult = { kind: 'ok', data: { paper: STATIC_PAPER, questions: STATIC_QUESTIONS, served_count: 1, viewer_role: 'student' } };

    const { default: Page } = await import('@/app/(student)/exams/mock/[paperId]/page');
    render(<Page />);

    await screen.findByTestId('mock-test-runner-stub');
    expect(screen.queryByTestId('exam-runner-v2-stub')).not.toBeInTheDocument();
    expect(mockTestRunnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paper: STATIC_PAPER, questions: STATIC_QUESTIONS, isHi: false }),
    );
  });

  it('flag still resolving: renders legacy MockTestRunner, never ExamRunner', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: undefined });
    mockPaperResult = { kind: 'ok', data: { paper: STATIC_PAPER, questions: STATIC_QUESTIONS, served_count: 1, viewer_role: 'student' } };

    const { default: Page } = await import('@/app/(student)/exams/mock/[paperId]/page');
    render(<Page />);

    await screen.findByTestId('mock-test-runner-stub');
    expect(screen.queryByTestId('exam-runner-v2-stub')).not.toBeInTheDocument();
  });

  it('flag ON: renders ExamRunner with the same paper/questions/isHi props MockTestRunner would receive', async () => {
    mockUseAuth.mockReturnValue(baseAuth({ isHi: true }));
    mockUseFeatureFlags.mockReturnValue({ data: { ff_exam_v2: true } });
    mockPaperResult = { kind: 'ok', data: { paper: STATIC_PAPER, questions: STATIC_QUESTIONS, served_count: 1, viewer_role: 'student' } };

    const { default: Page } = await import('@/app/(student)/exams/mock/[paperId]/page');
    render(<Page />);

    await screen.findByTestId('exam-runner-v2-stub');
    expect(screen.queryByTestId('mock-test-runner-stub')).not.toBeInTheDocument();
    expect(examRunnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ paper: STATIC_PAPER, questions: STATIC_QUESTIONS, isHi: true }),
    );
    // Static flow: no attemptId is ever passed (see mock-test-types.ts's Props comment).
    expect(examRunnerSpy.mock.calls[0][0].attemptId).toBeUndefined();
  });
});

describe('/exams/mock/[paperId] — ff_exam_v2 gate (cbse_board dynamic-attempt flow)', () => {
  const CBSE_PAPER = { ...STATIC_PAPER, exam_family: 'cbse_board' };
  const START_QUESTIONS = [
    { question_id: 'q1', section: 'A', marks: 1, order: 1, text: 'Q1?', options: ['a', 'b', 'c', 'd'] },
  ];

  function mockStartFetchOk() {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ attempt_id: 'attempt-1', questions: START_QUESTIONS }),
    });
  }

  it('flag OFF: after start + exam-structure confirm, renders legacy MockTestRunner with attemptId', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_exam_v2: false } });
    mockPaperResult = { kind: 'ok', data: { paper: CBSE_PAPER, questions: [], served_count: 0, viewer_role: 'student' } };
    mockStartFetchOk();

    const { default: Page } = await import('@/app/(student)/exams/mock/[paperId]/page');
    render(<Page />);

    const startButton = await screen.findByTestId('mock-test-exam-structure-start');
    startButton.click();

    await screen.findByTestId('mock-test-runner-stub');
    expect(screen.queryByTestId('exam-runner-v2-stub')).not.toBeInTheDocument();
    expect(mockTestRunnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: 'attempt-1' }),
    );
  });

  it('flag ON: after start + exam-structure confirm, renders ExamRunner with the SAME attemptId', async () => {
    mockUseAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_exam_v2: true } });
    mockPaperResult = { kind: 'ok', data: { paper: CBSE_PAPER, questions: [], served_count: 0, viewer_role: 'student' } };
    mockStartFetchOk();

    const { default: Page } = await import('@/app/(student)/exams/mock/[paperId]/page');
    render(<Page />);

    const startButton = await screen.findByTestId('mock-test-exam-structure-start');
    startButton.click();

    await screen.findByTestId('exam-runner-v2-stub');
    expect(screen.queryByTestId('mock-test-runner-stub')).not.toBeInTheDocument();
    expect(examRunnerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ attemptId: 'attempt-1' }),
    );
  });
});
