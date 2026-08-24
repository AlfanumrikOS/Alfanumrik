/**
 * /diagnostic — per-question answer review (Phase 5A).
 *
 * CEO defect #4, second half: "Student shall also know why was the answer
 * incorrect."
 *
 * THE DEFECT THIS FILE PINS SHUT
 * `explanation` and `explanation_hi` shipped on the wire with the diagnostic
 * (`/api/diagnostic/start`'s CLIENT_QUESTION_FIELDS includes both;
 * `DiagnosticQuestion` declares both) and were NEVER rendered anywhere under
 * `apps/host/src/app/diagnostic/`. `QuizScreen.tsx` did not even contain the
 * string "correct" — during the diagnostic the student was never told an answer
 * was wrong, let alone why. A grep for `explanation` across that directory
 * returned only the two type declarations.
 *
 * Also pinned: the review never re-derives correctness. Verdicts come from
 * `question_results` (the server's C1 re-derivation), never from the client's
 * copy of `correct_answer_index` — otherwise a stale client question could show
 * a green tick on a row the server scored zero, contradicting the headline.
 *
 * P13: all fixtures synthetic.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// MathRenderer is KaTeX-lazy and Suspense-based; render its text directly so
// assertions are about the review, not about KaTeX.
vi.mock('@alfanumrik/ui/math/MathRenderer', () => ({
  default: ({ content }: { content: string | null | undefined }) => <>{content ?? ''}</>,
}));

// PROGRESSIVE-ENHANCEMENT MOUNT. In production `wrong_answer_remediations` has
// ZERO rows, so the real component fetches and renders null. The stub mirrors
// that default (renders nothing) and records its props so the test below can
// prove the mount is (a) present, (b) wired to the right distractor, and
// (c) not load-bearing for the explanation.
const explainerProps: Array<{ questionId: string; distractorIndex: number }> = [];
vi.mock('@alfanumrik/ui/quiz/MisconceptionExplainer', () => ({
  default: (p: { questionId: string; distractorIndex: number }) => {
    explainerProps.push(p);
    return null; // exactly what a 0-row remediation table produces
  },
}));

// next/dynamic → identity, so the lazy MisconceptionExplainer mount is exercised.
vi.mock('next/dynamic', () => ({
  default: (loader: () => Promise<{ default: unknown }>) => {
    let Comp: unknown = null;
    void loader().then((m) => { Comp = m.default; });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (props: any) => (Comp ? (Comp as any)(props) : null);
  },
}));

import DiagnosticReview from '@/app/diagnostic/DiagnosticReview';
import type { DiagnosticQuestion, DiagnosticQuestionResult } from '@/app/diagnostic/types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function q(
  id: string,
  overrides: Partial<DiagnosticQuestion> = {},
): DiagnosticQuestion {
  return {
    id,
    question_text: `What is the value of x in question ${id}?`,
    question_hi: `प्रश्न ${id} में x का मान क्या है?`,
    question_type: 'mcq',
    options: ['Four', 'Five', 'Six', 'Seven'],
    correct_answer_index: 2,
    explanation: `Because x equals six in ${id}.`,
    explanation_hi: `क्योंकि ${id} में x छह के बराबर है।`,
    difficulty: 2,
    bloom_level: 'understand',
    chapter_number: 3,
    topic_id: 'topic-1',
    ...overrides,
  };
}

function result(
  questionId: string,
  overrides: Partial<DiagnosticQuestionResult> = {},
): DiagnosticQuestionResult {
  return {
    question_id: questionId,
    question_number: 1,
    is_correct: false,
    selected_index: 0,
    correct_index: 2,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  explainerProps.length = 0;
});

// ══════════════════════════════════════════════════════════════════════════════

describe('DiagnosticReview — the student is told WHY (English)', () => {
  it('renders the English explanation for a WRONG answer', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1')]}
        results={[result('q1', { is_correct: false, selected_index: 0 })]}
      />,
    );
    expect(screen.getByText(/Because x equals six in q1\./)).toBeTruthy();
    expect(screen.queryByText(/क्योंकि/)).toBeNull();
  });

  it('marks the row incorrect and names both the picked and the correct option', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1')]}
        results={[result('q1', { is_correct: false, selected_index: 1, correct_index: 2 })]}
      />,
    );
    const row = screen.getByTestId('diagnostic-review-wrong');
    expect(within(row).getByText(/Incorrect/)).toBeTruthy();
    expect(within(row).getByText(/Your answer/)).toBeTruthy();
    expect(within(row).getByText('B')).toBeTruthy();   // picked
    expect(within(row).getByText('C')).toBeTruthy();   // correct
  });

  it('renders the explanation for CORRECT answers too (reinforcement, not just triage)', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1')]}
        results={[result('q1', { is_correct: true, selected_index: 2 })]}
      />,
    );
    expect(screen.getByTestId('diagnostic-review-correct')).toBeTruthy();
    expect(screen.getByText(/Because x equals six in q1\./)).toBeTruthy();
  });

  it('falls back to honest copy when question_bank has no explanation (P6 content gap)', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1', { explanation: null, explanation_hi: null })]}
        results={[result('q1')]}
      />,
    );
    expect(screen.getByText(/No explanation is available for this question yet\./)).toBeTruthy();
  });
});

describe('DiagnosticReview — P7 bilingual', () => {
  it('renders the Hindi explanation and Hindi chrome when isHi', () => {
    render(
      <DiagnosticReview isHi questions={[q('q1')]} results={[result('q1')]} />,
    );
    expect(screen.getByText(/क्योंकि q1 में x छह के बराबर है।/)).toBeTruthy();
    expect(screen.queryByText(/Because x equals six/)).toBeNull();
    // Chrome is Hindi too — heading, verdict badge, "your answer" label.
    expect(screen.getByText(/अपने जवाब देखें/)).toBeTruthy();
    expect(screen.getByText(/गलत/)).toBeTruthy();
    expect(screen.getByText(/तुम्हारा जवाब/)).toBeTruthy();
  });

  it('falls back to the English explanation when explanation_hi is missing (never blank)', () => {
    render(
      <DiagnosticReview
        isHi
        questions={[q('q1', { explanation_hi: null })]}
        results={[result('q1')]}
      />,
    );
    expect(screen.getByText(/Because x equals six in q1\./)).toBeTruthy();
  });

  it('renders the Hindi question text when present', () => {
    render(<DiagnosticReview isHi questions={[q('q1')]} results={[result('q1')]} />);
    expect(screen.getByText(/प्रश्न q1 में x का मान क्या है\?/)).toBeTruthy();
  });
});

describe('DiagnosticReview — correctness comes from the SERVER, never recomputed', () => {
  it('trusts question_results.is_correct even when it disagrees with the client question', () => {
    // The client's stale copy says index 2 is correct and the student picked 2,
    // so a component that recomputed would render GREEN. The server says wrong.
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1', { correct_answer_index: 2 })]}
        results={[result('q1', { is_correct: false, selected_index: 2, correct_index: 3 })]}
      />,
    );
    expect(screen.getByTestId('diagnostic-review-wrong')).toBeTruthy();
    expect(screen.queryByTestId('diagnostic-review-correct')).toBeNull();
  });

  it('highlights the option the SERVER named correct, not the client copy', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1', { correct_answer_index: 0 })]}
        results={[result('q1', { is_correct: false, selected_index: 1, correct_index: 3 })]}
      />,
    );
    const row = screen.getByTestId('diagnostic-review-wrong');
    // Option D (index 3) carries the ✓; option A (the stale client key) does not.
    expect(within(row).getByText('Seven').parentElement?.textContent).toContain('✓');
    expect(within(row).getByText('Four').parentElement?.textContent).not.toContain('✓');
  });

  it('the number of green rows equals the server correct count', () => {
    const questions = [q('a'), q('b'), q('c')];
    const results = [
      result('a', { question_number: 1, is_correct: true, selected_index: 2 }),
      result('b', { question_number: 2, is_correct: false, selected_index: 0 }),
      result('c', { question_number: 3, is_correct: true, selected_index: 2 }),
    ];
    render(<DiagnosticReview isHi={false} questions={questions} results={results} />);
    expect(screen.getAllByTestId('diagnostic-review-correct').length).toBe(2);
    expect(screen.getAllByTestId('diagnostic-review-wrong').length).toBe(1);
  });
});

describe('DiagnosticReview — MisconceptionExplainer is additive only', () => {
  it('mounts the explainer for a wrong MCQ with the picked distractor index', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1')]}
        results={[result('q1', { is_correct: false, selected_index: 3 })]}
      />,
    );
    expect(explainerProps).toEqual([{ questionId: 'q1', distractorIndex: 3 }]);
  });

  it('does NOT mount the explainer for a correct answer', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1')]}
        results={[result('q1', { is_correct: true, selected_index: 2 })]}
      />,
    );
    expect(explainerProps).toEqual([]);
  });

  it('THE CONTENT-GAP PIN: the explanation still renders when the explainer produces nothing', () => {
    // Production `wrong_answer_remediations` has 0 rows / 0% coverage, so the
    // explainer renders null for every question today. The "why was this wrong"
    // the student actually receives MUST NOT depend on it.
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1')]}
        results={[result('q1')]}
      />,
    );
    expect(screen.queryByTestId('misconception-explainer')).toBeNull(); // stub renders null
    expect(screen.getByTestId('diagnostic-review-explanation')).toBeTruthy();
    expect(screen.getByText(/Because x equals six in q1\./)).toBeTruthy();
  });
});

describe('DiagnosticReview — degenerate inputs', () => {
  it('renders nothing when there are no results', () => {
    const { container } = render(
      <DiagnosticReview isHi={false} questions={[q('q1')]} results={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no result can be joined to a question', () => {
    const { container } = render(
      <DiagnosticReview isHi={false} questions={[]} results={[result('q1')]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('omits an unjoinable row but still renders the joinable ones', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('a')]}
        results={[
          result('a', { question_number: 1, is_correct: false }),
          result('ghost', { question_number: 2, is_correct: false, correct_index: null }),
        ]}
      />,
    );
    expect(screen.getAllByTestId('diagnostic-review-wrong').length).toBe(1);
  });

  it('handles a skipped answer (null selected_index) without crashing or claiming a pick', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('q1')]}
        results={[result('q1', { is_correct: false, selected_index: null })]}
      />,
    );
    expect(screen.getByText(/Not answered/)).toBeTruthy();
    // No distractor to explain -> no explainer mount.
    expect(explainerProps).toEqual([]);
  });

  it('switches the subheading when every answer is correct', () => {
    render(
      <DiagnosticReview
        isHi={false}
        questions={[q('a')]}
        results={[result('a', { is_correct: true, selected_index: 2 })]}
      />,
    );
    expect(screen.getByText(/You got every question right/)).toBeTruthy();
  });
});
