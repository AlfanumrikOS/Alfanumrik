/**
 * PracticeRunner — screen 07 "Practice" (`ff_quiz_v2`) presentational
 * component. Pure props-in unit tests (no orchestrator, no RPC) — the
 * orchestrator wiring (confirmAnswerPracticeV2's checkQuizAnswer
 * call-count/no-retry-guard/final-submit-shape pins) lives in
 * `src/__tests__/app/quiz-practice-v2-check-answer.test.tsx`.
 *
 * This file pins the component's OWN "no retry after reveal" visual
 * contract — every option becomes `disabled` and the confirm control is
 * fully replaced by "Next" the instant `isAnswered` is true, regardless of
 * whether `checkResult` has resolved yet — plus the three `checkResult`
 * render states (verdict / degraded / checking).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('@alfanumrik/ui/math/MathRenderer', () => ({
  default: ({ content }: { content: string }) => content,
}));

import PracticeRunner, { type PracticeRunnerProps } from '@alfanumrik/ui/quiz/v2/PracticeRunner';

afterEach(() => cleanup());

function baseProps(overrides: Partial<PracticeRunnerProps> = {}): PracticeRunnerProps {
  return {
    isHi: false,
    question: {
      id: 'q1',
      options: ['1', '2', '3', '4'],
      questionText: 'What is 2+2?',
      questionTextHi: null,
      chapterNumber: 1,
      bloomLevel: 'remember',
      hint: null,
    },
    questionNumber: 1,
    totalQuestions: 2,
    selectedOption: null,
    isAnswered: false,
    checking: false,
    checkResult: null,
    subjectName: 'Science',
    subjectIcon: '🔬',
    subjectColor: '#16A34A',
    hintLevel: 0,
    onSelect: vi.fn(),
    onConfirm: vi.fn(),
    onNext: vi.fn(),
    onRequestHint: vi.fn(),
    ...overrides,
  };
}

describe('PracticeRunner — no-retry-after-reveal visual contract', () => {
  it('unanswered: options are enabled, Confirm is shown, Next is not', () => {
    render(<PracticeRunner {...baseProps()} />);
    for (let i = 0; i < 4; i++) {
      expect(screen.getByTestId(`practice-runner-v2-option-${i}`)).not.toBeDisabled();
    }
    expect(screen.getByTestId('practice-runner-v2-confirm')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-runner-v2-next')).not.toBeInTheDocument();
  });

  it('answered: ALL options become disabled and Confirm is replaced by Next — regardless of whether checkResult has resolved', () => {
    // checkResult is still null (RPC in flight) — options must ALREADY be
    // locked. Locking never waits for the verdict.
    render(<PracticeRunner {...baseProps({ selectedOption: 3, isAnswered: true, checking: true, checkResult: null })} />);
    for (let i = 0; i < 4; i++) {
      expect(screen.getByTestId(`practice-runner-v2-option-${i}`)).toBeDisabled();
    }
    expect(screen.queryByTestId('practice-runner-v2-confirm')).not.toBeInTheDocument();
    expect(screen.getByTestId('practice-runner-v2-next')).toBeInTheDocument();
  });

  it('clicking a disabled option after answering never calls onSelect', () => {
    const onSelect = vi.fn();
    render(<PracticeRunner {...baseProps({ selectedOption: 3, isAnswered: true, checkResult: null, onSelect })} />);
    fireEvent.click(screen.getByTestId('practice-runner-v2-option-0'));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('renders the checking state while the RPC is in flight', () => {
    render(<PracticeRunner {...baseProps({ selectedOption: 3, isAnswered: true, checking: true, checkResult: null })} />);
    expect(screen.getByTestId('practice-runner-v2-checking')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-runner-v2-verdict')).not.toBeInTheDocument();
    expect(screen.queryByTestId('practice-runner-v2-degraded')).not.toBeInTheDocument();
    // Next is disabled while still checking with no result yet.
    expect(screen.getByTestId('practice-runner-v2-next')).toBeDisabled();
  });

  it('renders a correct verdict, highlighting the correct option', () => {
    render(
      <PracticeRunner
        {...baseProps({
          selectedOption: 3,
          isAnswered: true,
          checkResult: { isCorrect: true, correctDisplayedIndex: 3, explanation: 'Because math.', explanationHi: null },
        })}
      />,
    );
    const verdict = screen.getByTestId('practice-runner-v2-verdict');
    expect(verdict).toHaveAttribute('data-correct', 'true');
    expect(screen.getByTestId('practice-runner-v2-next')).not.toBeDisabled();
  });

  it('renders a wrong verdict distinctly from a correct one', () => {
    render(
      <PracticeRunner
        {...baseProps({
          selectedOption: 0,
          isAnswered: true,
          checkResult: { isCorrect: false, correctDisplayedIndex: 3, explanation: 'Because math.', explanationHi: null },
        })}
      />,
    );
    expect(screen.getByTestId('practice-runner-v2-verdict')).toHaveAttribute('data-correct', 'false');
  });

  it('renders the graceful-degrade state when checkResult is "unavailable" — no correctness is implied', () => {
    render(<PracticeRunner {...baseProps({ selectedOption: 1, isAnswered: true, checkResult: 'unavailable' })} />);
    expect(screen.getByTestId('practice-runner-v2-degraded')).toBeInTheDocument();
    expect(screen.queryByTestId('practice-runner-v2-verdict')).not.toBeInTheDocument();
    expect(screen.getByTestId('practice-runner-v2-next')).not.toBeDisabled();
  });

  it('never shows a timer element (SCREENS.md: "No timer on practice") and always shows the "progress is saved" reassurance', () => {
    render(<PracticeRunner {...baseProps()} />);
    expect(screen.getByTestId('practice-runner-v2-saved-note')).toBeInTheDocument();
    expect(screen.queryByText(/^\d{1,2}:\d{2}$/)).not.toBeInTheDocument();
  });
});
