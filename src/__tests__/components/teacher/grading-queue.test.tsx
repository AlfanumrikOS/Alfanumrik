/**
 * Phase 3A Wave B — Grading queue surface contract tests.
 *
 * Covers the two surfaces this wave adds to the Teacher Command Center:
 *
 *   1. <GradingQueue> (the dense, oldest-first list). We pin that it:
 *        - renders one row per queue item with assignment · student · date ·
 *          question count · auto_score (verbatim from the Edge response — no
 *          re-scoring; P1/P2 untouched),
 *        - renders the exception CHIP for each needs_review_reason
 *          ('all_same_answer' → "All same answer", 'too_fast' → "Very fast"),
 *          and hoists flagged rows to the top so anomalies triage first,
 *        - clicking a row calls onOpenRow with that item (the parent then
 *          navigates to the existing /teacher/submissions review — reuse, not
 *          rebuild),
 *        - renders the empty / loading / error states,
 *        - is bilingual (P7) — Hindi labels when isHi.
 *
 *   2. <ActionBar> flag-gating. With gradingQueueEnabled=false (the default,
 *      flag OFF) the "Grading queue" button stays the DISABLED placeholder from
 *      Wave A. With it true the button is enabled and opening it calls back.
 *
 * Behaviour over implementation: <GradingQueue> is a pure presentation
 * component (data is fetched by the parent and passed in), so these tests need
 * no network/auth mocks for it. <ActionBar> only needs a router stub.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

import GradingQueue, { type GradingQueueItem } from '@/app/teacher/GradingQueue';

// ActionBar lives in CommandCenter.tsx, which imports the client supabase
// helpers + the Wave B flag hook. Stub those seams so the module loads under
// jsdom without a real Supabase client.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
  supabaseUrl: 'https://placeholder.supabase.co',
  supabaseAnonKey: 'anon',
  getFeatureFlags: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/use-teacher-assignment-lifecycle', () => ({
  useTeacherAssignmentLifecycle: () => false,
}));

import { ActionBar } from '@/app/teacher/CommandCenter';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const ITEMS: GradingQueueItem[] = [
  {
    submission_id: 'sub-1',
    assignment_id: 'asg-1',
    assignment_title: 'Fractions Worksheet',
    student_id: 'stu-1',
    student_name: 'Asha',
    submitted_at: '2026-06-01T10:00:00.000Z',
    question_count: 10,
    auto_score: 70,
    needs_review_reason: null,
  },
  {
    submission_id: 'sub-2',
    assignment_id: 'asg-1',
    assignment_title: 'Fractions Worksheet',
    student_id: 'stu-2',
    student_name: 'Bharat',
    submitted_at: '2026-06-02T10:00:00.000Z',
    question_count: 8,
    auto_score: 100,
    needs_review_reason: 'all_same_answer',
  },
  {
    submission_id: 'sub-3',
    assignment_id: 'asg-2',
    assignment_title: 'Photosynthesis Quiz',
    student_id: 'stu-3',
    student_name: 'Chitra',
    submitted_at: '2026-06-03T10:00:00.000Z',
    question_count: 12,
    auto_score: 25,
    needs_review_reason: 'too_fast',
  },
];

const noop = () => {};

function renderQueue(over: Partial<React.ComponentProps<typeof GradingQueue>> = {}) {
  return render(
    <GradingQueue
      items={ITEMS}
      count={ITEMS.length}
      loading={false}
      error={false}
      isHi={false}
      onOpenRow={noop}
      onRetry={noop}
      onClose={noop}
      {...over}
    />,
  );
}

describe('GradingQueue', () => {
  it('renders one row per item with auto_score verbatim', () => {
    renderQueue();
    const rows = screen.getAllByTestId('grading-queue-row');
    expect(rows).toHaveLength(3);

    // Titles, students, question counts, auto-scores all surface.
    expect(screen.getAllByText('Fractions Worksheet').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Photosynthesis Quiz')).toBeInTheDocument();
    expect(screen.getByText('Asha')).toBeInTheDocument();
    // auto_score rendered exactly as provided (not re-derived).
    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
  });

  it('renders the exception chips with the right bilingual labels', () => {
    renderQueue();
    // all_same_answer chip
    const allSame = screen.getByTestId('exception-chip-all_same_answer');
    expect(allSame).toHaveTextContent('All same answer');
    // too_fast chip
    const tooFast = screen.getByTestId('exception-chip-too_fast');
    expect(tooFast).toHaveTextContent('Very fast');
    // The non-flagged item has no chip.
    expect(screen.getAllByTestId(/^exception-chip-/)).toHaveLength(2);
  });

  it('hoists flagged (exception) rows to the top so anomalies triage first', () => {
    renderQueue();
    const rows = screen.getAllByTestId('grading-queue-row');
    // First two rows are the flagged ones (order among flagged preserves the
    // server FIFO); the clean row sinks below.
    expect(rows[0]).toHaveTextContent('All same answer');
    expect(rows[1]).toHaveTextContent('Very fast');
    expect(rows[2]).toHaveTextContent('Asha'); // the un-flagged item
  });

  it('clicking a row calls onOpenRow with that item (reuse the review flow)', () => {
    const onOpenRow = vi.fn();
    renderQueue({ onOpenRow });
    const rows = screen.getAllByTestId('grading-queue-row');
    fireEvent.click(rows[0]); // the all_same_answer item
    expect(onOpenRow).toHaveBeenCalledTimes(1);
    expect(onOpenRow.mock.calls[0][0]).toMatchObject({ submission_id: 'sub-2' });
  });

  it('renders the empty state when there is nothing to grade', () => {
    renderQueue({ items: [], count: 0 });
    expect(screen.getByTestId('grading-queue-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('grading-queue-list')).toBeNull();
  });

  it('renders the error state with a retry that calls onRetry', () => {
    const onRetry = vi.fn();
    renderQueue({ error: true, onRetry });
    expect(screen.getByTestId('grading-queue-error')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows Hindi labels when isHi', () => {
    renderQueue({ isHi: true });
    expect(screen.getByText('ग्रेडिंग कतार')).toBeInTheDocument(); // "Grading queue"
    expect(screen.getByTestId('exception-chip-all_same_answer')).toHaveTextContent('सभी उत्तर समान');
    expect(screen.getByTestId('exception-chip-too_fast')).toHaveTextContent('बहुत तेज़');
  });
});

describe('ActionBar — Wave B flag gating', () => {
  const router = { push: vi.fn() } as unknown as Parameters<typeof ActionBar>[0]['router'];

  it('keeps the "Grading queue" button DISABLED when the flag is OFF', () => {
    const onOpen = vi.fn();
    render(
      <ActionBar
        isHi={false}
        router={router}
        gradingQueueEnabled={false}
        gradingQueueCount={0}
        onOpenGradingQueue={onOpen}
      />,
    );
    const btn = screen.getByTestId('grading-queue-action') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // No badge when disabled / no count.
    expect(screen.queryByTestId('grading-queue-action-badge')).toBeNull();
    // Clicking the disabled placeholder does nothing.
    fireEvent.click(btn);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('enables the button + badges the count + opens the queue when the flag is ON', () => {
    const onOpen = vi.fn();
    render(
      <ActionBar
        isHi={false}
        router={router}
        gradingQueueEnabled={true}
        gradingQueueCount={5}
        onOpenGradingQueue={onOpen}
      />,
    );
    const btn = screen.getByTestId('grading-queue-action') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.getByTestId('grading-queue-action-badge')).toHaveTextContent('5');
    fireEvent.click(btn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
