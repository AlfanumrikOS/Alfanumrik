/**
 * /diagnostic ResultsScreen — Phase 5 wiring.
 *
 * THE DEFECT THIS FILE PINS SHUT
 * `/api/diagnostic/complete` hardcoded `weak_topics: []` and `strong_topics: []`
 * (route.ts:360-373 before 2026-08-24), so the "Areas to strengthen" block at
 * ResultsScreen.tsx:202 had LITERALLY NEVER RENDERED in production — the
 * empty-state card always won. The same response returned
 * `placement_confidence` and `DiagnosticSummary` dropped it, so a disarmed
 * speed-run placement was displayed as if it were a real recommendation.
 *
 * These tests drive the screen from a summary shaped like the real response.
 *
 * P13: all fixtures synthetic.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@alfanumrik/ui/math/MathRenderer', () => ({
  default: ({ content }: { content: string | null | undefined }) => <>{content ?? ''}</>,
}));
vi.mock('@alfanumrik/ui/quiz/MisconceptionExplainer', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));

import ResultsScreen from '@/app/diagnostic/ResultsScreen';
import type { DiagnosticSummary } from '@/app/diagnostic/types';

function summary(over: Partial<DiagnosticSummary> = {}): DiagnosticSummary {
  return {
    session_id: '11111111-1111-1111-1111-111111111111',
    score_percent: 60,
    correct_answers: 9,
    total_questions: 15,
    weak_topics: [],
    strong_topics: [],
    recommended_difficulty: 'medium',
    ...over,
  };
}

function renderScreen(s: DiagnosticSummary, isHi = false) {
  return render(
    <ResultsScreen
      isHi={isHi}
      isPostOnboarding={false}
      summary={s}
      onPrimaryCta={() => {}}
      onRetake={() => {}}
    />,
  );
}

afterEach(cleanup);

describe('ResultsScreen — 5C weak/strong topics finally render', () => {
  it('renders "Areas to strengthen" with the derived topic chips', () => {
    renderScreen(summary({ weak_topics: ['Linear Equations', 'Trigonometry'] }));
    expect(screen.getByText('Areas to strengthen')).toBeTruthy();
    const chips = screen.getByTestId('diagnostic-weak-topics');
    expect(chips.textContent).toContain('Linear Equations');
    expect(chips.textContent).toContain('Trigonometry');
    // The empty state must yield once real analysis exists.
    expect(screen.queryByText(/Detailed topic analysis is not available/)).toBeNull();
  });

  it('renders "Strong areas" independently of the weak list', () => {
    renderScreen(summary({ strong_topics: ['Fractions'] }));
    expect(screen.getByText('Strong areas')).toBeTruthy();
    expect(screen.getByTestId('diagnostic-strong-topics').textContent).toContain('Fractions');
    expect(screen.queryByTestId('diagnostic-weak-topics')).toBeNull();
  });

  it('still shows the honest empty state when the aggregation produced nothing', () => {
    renderScreen(summary());
    expect(screen.getByText(/Detailed topic analysis is not available/)).toBeTruthy();
    expect(screen.queryByTestId('diagnostic-weak-topics')).toBeNull();
  });

  it('P7: renders the Hindi topic labels when isHi and a matching _hi list is present', () => {
    renderScreen(
      summary({
        weak_topics: ['Linear Equations'],
        weak_topics_hi: ['रैखिक समीकरण'],
        strong_topics: ['Fractions'],
        strong_topics_hi: ['भिन्न'],
      }),
      true,
    );
    expect(screen.getByTestId('diagnostic-weak-topics').textContent).toContain('रैखिक समीकरण');
    expect(screen.getByTestId('diagnostic-weak-topics').textContent).not.toContain('Linear Equations');
    expect(screen.getByTestId('diagnostic-strong-topics').textContent).toContain('भिन्न');
  });

  it('falls back to the English labels under isHi when the _hi list is absent (older server)', () => {
    renderScreen(summary({ weak_topics: ['Linear Equations'] }), true);
    expect(screen.getByTestId('diagnostic-weak-topics').textContent).toContain('Linear Equations');
  });

  it('falls back to English rather than mis-pairing when the _hi list length disagrees', () => {
    renderScreen(
      summary({ weak_topics: ['A', 'B'], weak_topics_hi: ['केवल एक'] }),
      true,
    );
    const chips = screen.getByTestId('diagnostic-weak-topics').textContent ?? '';
    expect(chips).toContain('A');
    expect(chips).toContain('B');
    expect(chips).not.toContain('केवल एक');
  });
});

describe('ResultsScreen — placement_confidence reaches the UI', () => {
  it('shows the low-confidence note when the server disarmed the placement', () => {
    renderScreen(summary({ placement_confidence: 'low', recommended_difficulty: 'medium' }));
    const note = screen.getByTestId('diagnostic-low-confidence-note');
    expect(note.textContent).toMatch(/moved through this very quickly/);
  });

  it('shows nothing extra on a normal-confidence placement', () => {
    renderScreen(summary({ placement_confidence: 'normal' }));
    expect(screen.queryByTestId('diagnostic-low-confidence-note')).toBeNull();
  });

  it('shows nothing extra when the field is absent (older server response)', () => {
    renderScreen(summary());
    expect(screen.queryByTestId('diagnostic-low-confidence-note')).toBeNull();
  });

  it('P7: the low-confidence note is Hindi under isHi', () => {
    renderScreen(summary({ placement_confidence: 'low' }), true);
    expect(screen.getByTestId('diagnostic-low-confidence-note').textContent)
      .toMatch(/बहुत तेजी से/);
  });
});

describe('ResultsScreen — 5A review mount', () => {
  it('mounts the per-question review when question_results are present', () => {
    render(
      <ResultsScreen
        isHi={false}
        isPostOnboarding={false}
        summary={summary({
          question_results: [
            {
              question_id: 'q1',
              question_number: 1,
              is_correct: false,
              selected_index: 0,
              correct_index: 2,
            },
          ],
        })}
        questions={[
          {
            id: 'q1',
            question_text: 'What is two plus two?',
            question_hi: null,
            question_type: 'mcq',
            options: ['3', '4', '5', '6'],
            correct_answer_index: 1,
            explanation: 'Two plus two is four.',
            explanation_hi: null,
            difficulty: 1,
            bloom_level: 'remember',
            chapter_number: 1,
            topic_id: 't1',
          },
        ]}
        onPrimaryCta={() => {}}
        onRetake={() => {}}
      />,
    );
    expect(screen.getByTestId('diagnostic-answer-review')).toBeTruthy();
    expect(screen.getByText(/Two plus two is four\./)).toBeTruthy();
  });

  it('does not mount the review when the server sent no question_results', () => {
    renderScreen(summary());
    expect(screen.queryByTestId('diagnostic-answer-review')).toBeNull();
  });

  it('renders the review even on a low-confidence run — an explanation is not an inference about the student', () => {
    render(
      <ResultsScreen
        isHi={false}
        isPostOnboarding={false}
        summary={summary({
          placement_confidence: 'low',
          question_results: [
            {
              question_id: 'q1',
              question_number: 1,
              is_correct: false,
              selected_index: 0,
              correct_index: 2,
            },
          ],
        })}
        questions={[
          {
            id: 'q1',
            question_text: 'What is two plus two?',
            question_hi: null,
            question_type: 'mcq',
            options: ['3', '4', '5', '6'],
            correct_answer_index: 1,
            explanation: 'Two plus two is four.',
            explanation_hi: null,
            difficulty: 1,
            bloom_level: 'remember',
            chapter_number: 1,
            topic_id: 't1',
          },
        ]}
        onPrimaryCta={() => {}}
        onRetake={() => {}}
      />,
    );
    expect(screen.getByTestId('diagnostic-low-confidence-note')).toBeTruthy();
    expect(screen.getByTestId('diagnostic-answer-review')).toBeTruthy();
  });
});

describe('ResultsScreen — P1 discipline preserved', () => {
  it('displays the server score verbatim and never recomputes it', () => {
    // 9/15 = 60 exactly; a component that recomputed would coincide, so also
    // assert an INCONSISTENT pair renders the SERVER value, not the ratio.
    renderScreen(summary({ score_percent: 73, correct_answers: 9, total_questions: 15 }));
    expect(screen.getByText('73%')).toBeTruthy();
    expect(screen.getByText(/9\/15/)).toBeTruthy();
    expect(screen.queryByText('60%')).toBeNull();
  });
});
