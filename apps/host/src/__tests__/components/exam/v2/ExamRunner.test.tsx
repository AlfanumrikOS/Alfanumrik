/**
 * ExamRunner (screen 11 "Mock exam", `ff_exam_v2`) — presentational
 * component + autosave-wiring tests.
 *
 * Covers:
 *   1. Renders sections/timer/palette/options against the REAL
 *      `useMockTestState` state machine (unmocked — this pins that
 *      ExamRunner is a wrapper, not a reimplementation).
 *   2. Autosave cadence: nothing is queued until ~10s elapse; a queued
 *      write only happens when the response/cursor snapshot actually
 *      changed since the last flush.
 *   3. Idempotency-key discipline: the key is minted AT CAPTURE TIME (the
 *      moment an answer changes) and stays STABLE across ticks where
 *      nothing changed; a new answer produces a NEW key.
 *   4. Autosave never touches the submit endpoint — `global.fetch` (the
 *      transport `useMockTestState.submit` uses) is only ever called via
 *      the Submit button / auto-submit-at-zero, never from the autosave
 *      interval.
 *   5. Autosave stops once submitted.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock('@alfanumrik/ui/math/MathRenderer', () => ({
  default: ({ content, inline }: { content: string; inline?: boolean }) =>
    React.createElement(inline ? 'span' : 'p', {}, content),
}));

const queueWriteSpy = vi.fn().mockResolvedValue(undefined);
vi.mock('@alfanumrik/lib/offline/store', () => ({
  queueWrite: (row: unknown) => queueWriteSpy(row),
}));

import ExamRunner from '@alfanumrik/ui/exam/v2/ExamRunner';
import type { MockTestPaper, MockTestQuestion } from '@alfanumrik/ui/exams/mock-test-types';

const PAPER: MockTestPaper = {
  id: 'paper-1',
  paper_code: 'CBSE-M-10-1',
  exam_family: 'cbse_board',
  exam_year: 2026,
  total_questions: 2,
  duration_minutes: 60, // 3600s — plenty of headroom for the test's timer advances
  subject_scope: ['math'],
};

const QUESTIONS: MockTestQuestion[] = [
  {
    id: 'q1',
    question_number: 1,
    question_text: 'What is 2 + 2?',
    question_type: 'mcq_single',
    options: ['3', '4', '5', '6'],
    marks_correct: 1,
    marks_wrong: 0,
    section: 'A',
  },
  {
    id: 'q2',
    question_number: 2,
    question_text: 'What is 3 + 3?',
    question_type: 'mcq_single',
    options: ['5', '6', '7', '8'],
    marks_correct: 1,
    marks_wrong: 0,
    section: 'A',
  },
];

function renderRunner(attemptId = 'attempt-1') {
  return render(<ExamRunner paper={PAPER} questions={QUESTIONS} isHi={false} attemptId={attemptId} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn();
});

describe('ExamRunner — presentation (wraps useMockTestState, does not reimplement it)', () => {
  it('renders the section badge, mono timer, question text and 4 options', () => {
    vi.useFakeTimers();
    renderRunner();

    expect(screen.getByTestId('exam-runner-v2-section-badge')).toHaveTextContent('Section A');
    expect(screen.getByTestId('exam-runner-v2-timer')).toHaveTextContent('60:00');
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
    expect(screen.getByTestId('exam-runner-v2-option-0')).toBeInTheDocument();
    expect(screen.getByTestId('exam-runner-v2-option-3')).toBeInTheDocument();
  });

  it('renders the palette with one entry per question', () => {
    vi.useFakeTimers();
    renderRunner();
    expect(screen.getByTestId('exam-runner-v2-palette-0')).toBeInTheDocument();
    expect(screen.getByTestId('exam-runner-v2-palette-1')).toBeInTheDocument();
  });

  it('never reveals correctness before submit — deferred feedback (opposite of screen 07)', () => {
    vi.useFakeTimers();
    renderRunner();
    fireEvent.click(screen.getByTestId('exam-runner-v2-option-1'));
    // No "correct"/"wrong" affordance exists anywhere in the DOM pre-submit.
    expect(screen.queryByText(/correct/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/wrong/i)).not.toBeInTheDocument();
  });
});

describe('ExamRunner — autosave cadence + idempotency-key discipline', () => {
  it('queues nothing before ~10s elapse, even after an answer is selected', () => {
    vi.useFakeTimers();
    renderRunner();

    fireEvent.click(screen.getByTestId('exam-runner-v2-option-1'));
    act(() => { vi.advanceTimersByTime(9000); });
    expect(queueWriteSpy).not.toHaveBeenCalled();
  });

  it('queues exactly one autosave write after ~10s following an answer change, with a capture-time idempotency key', () => {
    vi.useFakeTimers();
    renderRunner();

    fireEvent.click(screen.getByTestId('exam-runner-v2-option-1'));
    act(() => { vi.advanceTimersByTime(10000); });

    expect(queueWriteSpy).toHaveBeenCalledTimes(1);
    const row = queueWriteSpy.mock.calls[0][0];
    expect(row.kind).toBe('mock_exam_autosave');
    expect(row.endpoint).toBe('/api/exams/papers/paper-1/autosave');
    expect(typeof row.idempotencyKey).toBe('string');
    expect(row.idempotencyKey.length).toBeGreaterThan(0);
    expect(row.payload.attempt_id).toBe('attempt-1');
    expect(row.payload.responses[0]).toEqual({
      question_id: 'q1',
      response_index: 1,
      marked_for_review: false,
    });
  });

  it('does NOT re-queue on the next tick when nothing changed (same idempotency key would be a no-op write)', () => {
    vi.useFakeTimers();
    renderRunner();

    fireEvent.click(screen.getByTestId('exam-runner-v2-option-1'));
    act(() => { vi.advanceTimersByTime(10000); });
    expect(queueWriteSpy).toHaveBeenCalledTimes(1);

    // Nothing changed — a second 10s tick must not queue again.
    act(() => { vi.advanceTimersByTime(10000); });
    expect(queueWriteSpy).toHaveBeenCalledTimes(1);
  });

  it('mints a NEW idempotency key when the answer state changes again, never reusing the stale one', () => {
    vi.useFakeTimers();
    renderRunner();

    fireEvent.click(screen.getByTestId('exam-runner-v2-option-1'));
    act(() => { vi.advanceTimersByTime(10000); });
    const firstKey = queueWriteSpy.mock.calls[0][0].idempotencyKey;

    // Change the answer before the next flush.
    fireEvent.click(screen.getByTestId('exam-runner-v2-option-2'));
    act(() => { vi.advanceTimersByTime(10000); });

    expect(queueWriteSpy).toHaveBeenCalledTimes(2);
    const secondKey = queueWriteSpy.mock.calls[1][0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
    expect(queueWriteSpy.mock.calls[1][0].payload.responses[0].response_index).toBe(2);
  });

  it('omits attempt_id from the autosave payload for the static-paper flow (no attemptId prop)', () => {
    vi.useFakeTimers();
    render(<ExamRunner paper={PAPER} questions={QUESTIONS} isHi={false} />);

    fireEvent.click(screen.getByTestId('exam-runner-v2-option-0'));
    act(() => { vi.advanceTimersByTime(10000); });

    expect(queueWriteSpy).toHaveBeenCalledTimes(1);
    expect(queueWriteSpy.mock.calls[0][0].payload.attempt_id).toBeUndefined();
  });

  it('never touches the submit endpoint from the autosave interval — fetch stays uncalled until Submit is clicked', () => {
    vi.useFakeTimers();
    renderRunner();

    fireEvent.click(screen.getByTestId('exam-runner-v2-option-1'));
    act(() => { vi.advanceTimersByTime(30000); }); // three autosave ticks' worth

    expect(queueWriteSpy).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('stops autosaving once the attempt is submitted', async () => {
    vi.useFakeTimers();
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        attempt_id: 'attempt-1',
        paper_id: 'paper-1',
        total_questions: 2,
        attempted_count: 1,
        correct_count: 1,
        wrong_count: 0,
        skipped_count: 1,
        raw_score: 1,
        max_score: 2,
        score_percent: 50,
        xp_earned: 30,
        submitted_at: new Date().toISOString(),
        time_taken_seconds: 10,
      }),
    });

    renderRunner();
    fireEvent.click(screen.getByTestId('exam-runner-v2-option-1'));
    // Navigate to the last question so Submit is available.
    fireEvent.click(screen.getByText(/Next/));
    fireEvent.click(screen.getByTestId('exam-runner-v2-submit'));

    // Flush the fetch → .json() → setSubmitted(true) microtask chain. Fake
    // timers are active, so `findBy*`'s real-timer polling would hang here —
    // use a fixed number of microtask flushes + a synchronous query instead.
    await act(async () => {
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
    });

    expect(screen.getByTestId('exam-runner-v2-submitted')).toBeInTheDocument();

    queueWriteSpy.mockClear();
    act(() => { vi.advanceTimersByTime(30000); });
    expect(queueWriteSpy).not.toHaveBeenCalled();
  });
});
