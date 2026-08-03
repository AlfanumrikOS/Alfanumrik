/**
 * ResultSummary (screen 08 "Result", `ff_quiz_result_v2`) — presentational
 * component tests.
 *
 * Covers:
 *   1. P1 — score_percent is rendered EXACTLY as passed, never recomputed
 *      from correct/total (quiz-integrity Invariant 1/7).
 *   2. Mastery band renders as WORDS derived from
 *      packages/lib/src/dashboard/mastery-band-labels.ts (bandForValue /
 *      bandLabel) — the accuracy%-based system, NOT the exam-readiness
 *      ExamReadinessBand enum — bilingual (P7).
 *   3. Time renders as a formatted duration, never a bare raw-seconds int.
 *   4. Weak concepts: grouped by chapter_number, capped at 3, sorted by
 *      wrong-count desc.
 *   5. Citation-integrity: a weak concept only renders a cited "solution"
 *      when its sample question has a non-empty explanation; otherwise the
 *      diagnosis still renders but no NCERT chapter citation is shown.
 *   6. Ask Foxy / Retry / Next task callbacks fire with the expected
 *      arguments — "Next task" always renders (never a dead end).
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

vi.mock('@alfanumrik/ui/SectionErrorBoundary', () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alfanumrik/ui/ui', () => ({
  Card: ({ children, ...rest }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...rest}>{children}</div>
  ),
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
    <div data-testid="stat-card">
      {label}: {value}
    </div>
  ),
}));

vi.mock('@alfanumrik/ui/math/MathRenderer', () => ({
  default: ({ content }: { content: string }) => <span>{content}</span>,
}));

// mastery-band-labels is a pure, IO-free module — exercised for real so the
// test also pins that ResultSummary imports THIS module and not
// exams/mastery-band.ts's ExamReadinessBand vocabulary.

import ResultSummary, {
  type ResultSummaryProps,
  type ResultSummaryQuestion,
  type ResultSummaryResponse,
} from '@alfanumrik/ui/quiz/v2/ResultSummary';
import { bandForValue, bandLabel } from '@alfanumrik/lib/dashboard/mastery-band-labels';

afterEach(() => cleanup());

function makeQuestion(overrides: Partial<ResultSummaryQuestion> = {}): ResultSummaryQuestion {
  return {
    id: 'q1',
    question_text: 'What is 2+2?',
    question_hi: null,
    explanation: 'Two plus two is four.',
    explanation_hi: null,
    bloom_level: 'remember',
    chapter_number: 3,
    ...overrides,
  };
}

function makeResponse(overrides: Partial<ResultSummaryResponse> = {}): ResultSummaryResponse {
  return {
    question_id: 'q1',
    selected_option: 0,
    is_correct: false,
    time_spent: 5,
    ...overrides,
  };
}

function makeProps(overrides: Partial<ResultSummaryProps> = {}): ResultSummaryProps {
  return {
    isHi: false,
    results: {
      total: 4,
      correct: 3,
      score_percent: 77, // deliberately NOT (3/4)*100=75 — proves no recompute
      xp_earned: 40,
      session_id: 'sess-1',
    },
    questions: [makeQuestion()],
    responses: [makeResponse({ is_correct: true })],
    timer: 135, // 2:15
    subject: { code: 'math', name: 'Mathematics' },
    nextTask: { href: '/today', labelEn: 'Next task', labelHi: 'अगला काम' },
    onRetry: vi.fn(),
    onAskFoxy: vi.fn(),
    onNextTask: vi.fn(),
    ...overrides,
  };
}

describe('ResultSummary — score/band/time (P1, mastery-band vocabulary, no-float display)', () => {
  it('renders results.score_percent EXACTLY as passed, never recomputed from correct/total', () => {
    render(<ResultSummary {...makeProps()} />);
    // correct=3,total=4 would recompute to 75% — the passed 77% must win.
    expect(screen.getByTestId('result-summary-band')).toHaveTextContent('77%');
    expect(screen.queryByText('75%')).not.toBeInTheDocument();
  });

  it('renders the mastery band as WORDS from mastery-band-labels.ts (accuracy%), matching bandForValue/bandLabel directly', () => {
    render(<ResultSummary {...makeProps({ results: { total: 10, correct: 8, score_percent: 82, xp_earned: 10, session_id: 's' } })} />);
    const expected = bandLabel(bandForValue(82), false);
    expect(screen.getByTestId('result-summary-band')).toHaveTextContent(expected);
  });

  it('flips the band label to Hindi when isHi is true', () => {
    render(<ResultSummary {...makeProps({ isHi: true, results: { total: 10, correct: 2, score_percent: 20, xp_earned: 0, session_id: 's' } })} />);
    const expected = bandLabel(bandForValue(20), true);
    expect(screen.getByTestId('result-summary-band')).toHaveTextContent(expected);
  });

  it('formats time as mm:ss, never a bare raw-seconds integer', () => {
    render(<ResultSummary {...makeProps({ timer: 135 })} />);
    // StatCard renders `{label}: {value}` as separate text nodes, so match
    // the containing card's text rather than an exact "2:15"-only node.
    expect(screen.getByText(/2:15/)).toBeInTheDocument();
    expect(screen.queryByText(/(^|\D)135(\D|$)/)).not.toBeInTheDocument();
  });
});

describe('ResultSummary — weak concepts + citation integrity', () => {
  it('groups wrong responses by chapter_number, caps at 3, sorted by wrong-count desc', () => {
    const questions = [
      makeQuestion({ id: 'q1', chapter_number: 1 }),
      makeQuestion({ id: 'q2', chapter_number: 2 }),
      makeQuestion({ id: 'q3', chapter_number: 2 }),
      makeQuestion({ id: 'q4', chapter_number: 3 }),
      makeQuestion({ id: 'q5', chapter_number: 4 }),
      makeQuestion({ id: 'q6', chapter_number: 5 }),
    ];
    const responses = [
      makeResponse({ question_id: 'q1', is_correct: false }),
      makeResponse({ question_id: 'q2', is_correct: false }),
      makeResponse({ question_id: 'q3', is_correct: false }), // chapter 2 has 2 wrong
      makeResponse({ question_id: 'q4', is_correct: false }),
      makeResponse({ question_id: 'q5', is_correct: false }),
      makeResponse({ question_id: 'q6', is_correct: true }), // correct — excluded
    ];
    render(<ResultSummary {...makeProps({ questions, responses })} />);

    // Chapter 2 (2 wrong) must appear; only 3 of the 4 wrong chapters render.
    expect(screen.getByTestId('result-summary-weak-concept-2')).toBeInTheDocument();
    const rendered = screen.queryAllByTestId(/result-summary-weak-concept-/);
    expect(rendered).toHaveLength(3);
    // Chapter 5 has no wrong answers (q6 correct) — never rendered.
    expect(screen.queryByTestId('result-summary-weak-concept-5')).not.toBeInTheDocument();
  });

  it('excludes wrong responses whose question has no valid chapter_number', () => {
    const questions = [makeQuestion({ id: 'q1', chapter_number: 0 }), makeQuestion({ id: 'q2', chapter_number: null })];
    const responses = [
      makeResponse({ question_id: 'q1', is_correct: false }),
      makeResponse({ question_id: 'q2', is_correct: false }),
    ];
    render(<ResultSummary {...makeProps({ questions, responses })} />);
    expect(screen.queryByTestId(/result-summary-weak-concept-/)).not.toBeInTheDocument();
  });

  it('renders a cited NCERT chapter badge when the sample question has a non-empty explanation', () => {
    const questions = [makeQuestion({ id: 'q1', chapter_number: 4, explanation: 'Because X causes Y.' })];
    const responses = [makeResponse({ question_id: 'q1', is_correct: false })];
    render(<ResultSummary {...makeProps({ questions, responses })} />);
    const card = screen.getByTestId('result-summary-weak-concept-4');
    expect(within(card).getByText('NCERT · Chapter 4')).toBeInTheDocument();
    expect(within(card).getByText('Because X causes Y.')).toBeInTheDocument();
  });

  it('does NOT render a citation when the explanation is empty — never renders uncited text as authoritative', () => {
    const questions = [makeQuestion({ id: 'q1', chapter_number: 4, explanation: null })];
    const responses = [makeResponse({ question_id: 'q1', is_correct: false })];
    render(<ResultSummary {...makeProps({ questions, responses })} />);
    const card = screen.getByTestId('result-summary-weak-concept-4');
    expect(within(card).queryByText(/NCERT/)).not.toBeInTheDocument();
    // Diagnosis line still renders even without a cited solution.
    expect(within(card).getByText(/Chapter 4/)).toBeInTheDocument();
  });
});

describe('ResultSummary — Ask Foxy / Retry / Next task', () => {
  it('Ask Foxy calls onAskFoxy with a doubt-mode deep link carrying bloom + subject', () => {
    const onAskFoxy = vi.fn();
    const questions = [makeQuestion({ id: 'q1', chapter_number: 2, bloom_level: 'apply' })];
    const responses = [makeResponse({ question_id: 'q1', is_correct: false })];
    render(<ResultSummary {...makeProps({ questions, responses, onAskFoxy, subject: { code: 'physics', name: 'Physics' } })} />);

    screen.getByRole('button', { name: /Ask Foxy/ }).click();
    expect(onAskFoxy).toHaveBeenCalledWith('/foxy?mode=doubt&bloom=apply&subject=physics');
  });

  it('Retry calls onRetry from both the header back button and a weak-concept card', () => {
    const onRetry = vi.fn();
    const questions = [makeQuestion({ id: 'q1', chapter_number: 2 })];
    const responses = [makeResponse({ question_id: 'q1', is_correct: false })];
    render(<ResultSummary {...makeProps({ questions, responses, onRetry })} />);

    screen.getByRole('button', { name: /Retry/ }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);

    screen.getByLabelText('Go back').click();
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('Next task always renders and calls onNextTask with nextTask.href — never a dead end', () => {
    const onNextTask = vi.fn();
    render(
      <ResultSummary
        {...makeProps({
          onNextTask,
          nextTask: { href: '/learn/math/5', labelEn: 'Next task', labelHi: 'अगला काम' },
          questions: [makeQuestion({ chapter_number: 1 })],
          responses: [makeResponse({ is_correct: true })], // no wrong answers at all
        })}
      />
    );
    const cta = screen.getByTestId('result-summary-next-task');
    expect(cta).toBeInTheDocument();
    cta.click();
    expect(onNextTask).toHaveBeenCalledWith('/learn/math/5');
  });

  it('Next task label flips to Hindi when isHi is true', () => {
    render(<ResultSummary {...makeProps({ isHi: true, nextTask: { href: '/today', labelEn: 'Next task', labelHi: 'अगला काम' } })} />);
    expect(screen.getByTestId('result-summary-next-task')).toHaveTextContent('अगला काम');
  });
});

describe('ResultSummary — banners (parity with QuizResults for non-scoring display)', () => {
  it('shows the idempotent-replay banner when results.idempotent_replay is true', () => {
    render(<ResultSummary {...makeProps({ results: { total: 4, correct: 3, score_percent: 75, xp_earned: 0, session_id: 's', idempotent_replay: true } })} />);
    expect(screen.getByTestId('result-summary-replay-banner')).toBeInTheDocument();
  });

  it('shows the flagged (anti-cheat) banner and never hides/overrides the real score', () => {
    render(<ResultSummary {...makeProps({ results: { total: 4, correct: 3, score_percent: 75, xp_earned: 0, session_id: 's', flagged: true } })} />);
    expect(screen.getByTestId('result-summary-flagged-banner')).toBeInTheDocument();
    expect(screen.getByTestId('result-summary-band')).toHaveTextContent('75%');
  });

  it('shows the XP daily-cap banner when results.xp_capped is true', () => {
    render(
      <ResultSummary
        {...makeProps({
          results: { total: 4, correct: 4, score_percent: 100, xp_earned: 150, xp_uncapped: 220, xp_capped: true, session_id: 's' },
        })}
      />
    );
    expect(screen.getByTestId('result-summary-xp-cap-banner')).toBeInTheDocument();
  });
});
