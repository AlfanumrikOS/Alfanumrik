/**
 * PlacementCheck — the first-run calibration flow
 * (packages/ui/src/onboarding/v2/PlacementCheck.tsx).
 *
 * PURE PRESENTATION: no fetch, no hook, no scoring. The caller supplies the
 * questions and receives each response.
 *
 * Pins:
 *   - renders nothing when questions[index] is undefined (out of range).
 *   - the "not a test" framing line is always shown (non-negotiable UX rule).
 *   - clicking an option answers with { optionId: o.id, unseen: false } and
 *     the question's topicId PASSED THROUGH VERBATIM (including null — same
 *     fabricated-topic-id concern as usePlacement/the answer route).
 *   - clicking "Haven't done this yet" answers with { optionId: null, unseen: true }.
 *   - "Skip this" calls onSkipAll(), not onAnswer.
 *   - progress bar renders one segment per question.
 *   - accessibility: option buttons, the unseen button, and skip-all all meet
 *     the 44px minimum tap target.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PlacementQuestion } from '@alfanumrik/lib/placement/types';
import PlacementCheck from '@alfanumrik/ui/onboarding/v2/PlacementCheck';

function question(overrides: Partial<PlacementQuestion> = {}): PlacementQuestion {
  return {
    id: 'q1',
    topicId: 'topic-1',
    stem: 'What is 2 + 2?',
    options: [
      { id: '0', label: '3' },
      { id: '1', label: '4' },
      { id: '2', label: '5' },
    ],
    ...overrides,
  };
}

function getMinHeight(el: HTMLElement): number {
  return parseFloat(el.style.minHeight || '0');
}

describe('PlacementCheck — bounds', () => {
  it('renders nothing when the question at index is undefined', () => {
    const { container } = render(
      <PlacementCheck questions={[]} index={0} isHi={false} onAnswer={vi.fn()} onSkipAll={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('PlacementCheck — framing + structure', () => {
  it('always shows the "not a test" framing line', () => {
    render(<PlacementCheck questions={[question()]} index={0} isHi={false} onAnswer={vi.fn()} onSkipAll={vi.fn()} />);
    expect(screen.getByText(/not marked, not shown to anyone/i)).toBeInTheDocument();
  });

  it('shows the Hindi framing line', () => {
    render(<PlacementCheck questions={[question()]} index={0} isHi={true} onAnswer={vi.fn()} onSkipAll={vi.fn()} />);
    expect(screen.getByText('यह जाँच नहीं है और किसी को नहीं दिखती। बस ताकि आपका समय बर्बाद न हो।')).toBeInTheDocument();
  });

  it('shows "Question X of Y"', () => {
    render(
      <PlacementCheck
        questions={[question({ id: 'q1' }), question({ id: 'q2' })]}
        index={1}
        isHi={false}
        onAnswer={vi.fn()}
        onSkipAll={vi.fn()}
      />,
    );
    expect(screen.getByText('Question 2 of 2')).toBeInTheDocument();
  });

  it('renders the stem', () => {
    render(<PlacementCheck questions={[question()]} index={0} isHi={false} onAnswer={vi.fn()} onSkipAll={vi.fn()} />);
    expect(screen.getByText('What is 2 + 2?')).toBeInTheDocument();
  });

  it('renders one option button per option', () => {
    render(<PlacementCheck questions={[question()]} index={0} isHi={false} onAnswer={vi.fn()} onSkipAll={vi.fn()} />);
    expect(screen.getAllByTestId('placement-option')).toHaveLength(3);
  });
});

describe('PlacementCheck — answering', () => {
  it('answering an option calls onAnswer with the option id and unseen=false', () => {
    const onAnswer = vi.fn();
    render(
      <PlacementCheck questions={[question({ id: 'q1', topicId: 'topic-1' })]} index={0} isHi={false} onAnswer={onAnswer} onSkipAll={vi.fn()} />,
    );
    screen.getAllByTestId('placement-option')[1].click(); // label '4', id '1'
    expect(onAnswer).toHaveBeenCalledWith({ questionId: 'q1', topicId: 'topic-1', optionId: '1', unseen: false });
  });

  it('passes topicId: null through verbatim when the question has none — never defaults to the question id', () => {
    const onAnswer = vi.fn();
    render(
      <PlacementCheck questions={[question({ id: 'q1', topicId: null })]} index={0} isHi={false} onAnswer={onAnswer} onSkipAll={vi.fn()} />,
    );
    screen.getAllByTestId('placement-option')[0].click();
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ topicId: null }));
  });

  it('"Haven\'t done this yet" answers with optionId: null, unseen: true', () => {
    const onAnswer = vi.fn();
    render(
      <PlacementCheck questions={[question({ id: 'q1', topicId: 'topic-1' })]} index={0} isHi={false} onAnswer={onAnswer} onSkipAll={vi.fn()} />,
    );
    screen.getByTestId('placement-unseen').click();
    expect(onAnswer).toHaveBeenCalledWith({ questionId: 'q1', topicId: 'topic-1', optionId: null, unseen: true });
  });

  it('"Skip this" calls onSkipAll, not onAnswer', () => {
    const onAnswer = vi.fn();
    const onSkipAll = vi.fn();
    render(<PlacementCheck questions={[question()]} index={0} isHi={false} onAnswer={onAnswer} onSkipAll={onSkipAll} />);
    screen.getByTestId('placement-skip-all').click();
    expect(onSkipAll).toHaveBeenCalledTimes(1);
    expect(onAnswer).not.toHaveBeenCalled();
  });
});

describe('PlacementCheck — accessibility (44px minimum tap targets)', () => {
  it('option buttons meet the minimum', () => {
    render(<PlacementCheck questions={[question()]} index={0} isHi={false} onAnswer={vi.fn()} onSkipAll={vi.fn()} />);
    for (const btn of screen.getAllByTestId('placement-option')) {
      expect(getMinHeight(btn)).toBeGreaterThanOrEqual(44);
    }
  });

  it('the unseen button meets the minimum', () => {
    render(<PlacementCheck questions={[question()]} index={0} isHi={false} onAnswer={vi.fn()} onSkipAll={vi.fn()} />);
    expect(getMinHeight(screen.getByTestId('placement-unseen'))).toBeGreaterThanOrEqual(44);
  });

  it('the skip-all button meets the minimum', () => {
    render(<PlacementCheck questions={[question()]} index={0} isHi={false} onAnswer={vi.fn()} onSkipAll={vi.fn()} />);
    expect(getMinHeight(screen.getByTestId('placement-skip-all'))).toBeGreaterThanOrEqual(44);
  });
});
