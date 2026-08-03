/**
 * TopicPage — screen 06 "Topic" (packages/ui/src/learn/v2/TopicPage.tsx).
 *
 * PRESENTATION ONLY: every read is a prop, every write is a callback. Pins:
 *
 *   - three states: loading (Skeleton), error (EmptyState + retry callback),
 *     empty (`topic: null` → EmptyState), loaded.
 *   - citation integrity (SCREENS.md §06, non-negotiable):
 *       * citation present + pageRange present → explanation renders with
 *         "Chapter N: Title · p. X".
 *       * citation present but pageRange null → explanation STILL renders
 *         (chapter identity alone is real, not fabricated) but the page
 *         slot honestly reads "page unavailable", never a guessed number.
 *       * citation null (no chapter identity at all) → explanation body is
 *         NOT rendered; an "uncited" notice appears instead. The raw
 *         explanation text must never appear on screen in this case.
 *   - the "bit people miss" callout renders independently of citation
 *     (it is curated tip copy, not NCERT/AI text) and is labelled as a tip.
 *   - diagram slot only renders when an image URL is present.
 *   - Ask Foxy / Practice / Keep offline / Prev / Next all call their
 *     respective callbacks — this component never constructs a URL itself.
 *   - Keep offline row is absent entirely when offlineEnabled is false.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TopicPage, { type TopicPageProps } from '@alfanumrik/ui/learn/v2/TopicPage';

function baseProps(overrides: Partial<TopicPageProps> = {}): TopicPageProps {
  return {
    isHi: false,
    loading: false,
    error: false,
    onRetry: vi.fn(),
    subjectName: 'Mathematics',
    subjectIcon: '∑',
    subjectColor: '#7C3AED',
    chapterNumber: 4,
    topicIndex: 0,
    topicCount: 3,
    topic: {
      id: 'topic-1',
      title: 'Quadratic Equations',
      explanation: 'A quadratic equation has the form ax² + bx + c = 0.\n\nThe discriminant tells us the nature of the roots.',
    },
    citation: { chapterNumber: 4, chapterTitle: 'Quadratic Equations', pageRange: '78-82' },
    diagram: null,
    calloutText: 'Students often forget to check the discriminant sign before stating the nature of roots.',
    onBack: vi.fn(),
    onPrevTopic: null,
    onNextTopic: null,
    onAskFoxy: vi.fn(),
    onPractice: vi.fn(),
    offlineEnabled: false,
    isOfflineKept: false,
    offlineBusy: false,
    onKeepOffline: vi.fn(),
    ...overrides,
  };
}

describe('TopicPage — three states', () => {
  it('loading: renders the skeleton, nothing else', () => {
    render(<TopicPage {...baseProps({ loading: true })} />);
    expect(screen.getByTestId('topic-v2-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('topic-v2-page')).not.toBeInTheDocument();
  });

  it('error: renders EmptyState with a retry action wired to onRetry', () => {
    const onRetry = vi.fn();
    render(<TopicPage {...baseProps({ error: true, onRetry })} />);
    expect(screen.getByTestId('topic-v2-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty: topic null renders EmptyState with a back action, not a crash', () => {
    const onBack = vi.fn();
    render(<TopicPage {...baseProps({ topic: null, onBack })} />);
    expect(screen.getByTestId('topic-v2-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('loaded: renders the title and the explanation', () => {
    render(<TopicPage {...baseProps()} />);
    expect(screen.getByTestId('topic-v2-page')).toBeInTheDocument();
    expect(screen.getByTestId('topic-v2-title')).toHaveTextContent('Quadratic Equations');
    expect(screen.getAllByTestId('topic-v2-explanation').length).toBeGreaterThan(0);
  });
});

describe('TopicPage — citation integrity (non-negotiable)', () => {
  it('renders the citation chip with chapter + page when both are known', () => {
    render(<TopicPage {...baseProps()} />);
    const citation = screen.getByTestId('topic-v2-citation');
    expect(citation).toHaveTextContent('Chapter 4');
    expect(citation).toHaveTextContent('p. 78-82');
  });

  it('still renders the explanation when the page range is unknown, but marks the page honestly as unavailable — never a guessed number', () => {
    render(
      <TopicPage
        {...baseProps({
          citation: { chapterNumber: 4, chapterTitle: 'Quadratic Equations', pageRange: null },
        })}
      />,
    );
    expect(screen.getAllByTestId('topic-v2-explanation').length).toBeGreaterThan(0);
    const citation = screen.getByTestId('topic-v2-citation');
    expect(citation).toHaveTextContent('page unavailable');
    expect(citation).not.toHaveTextContent('p. null');
    expect(citation).not.toHaveTextContent('p. undefined');
  });

  it('never renders the explanation body when there is no citation at all — shows an uncited notice instead', () => {
    render(<TopicPage {...baseProps({ citation: null })} />);
    expect(screen.queryByTestId('topic-v2-explanation')).not.toBeInTheDocument();
    expect(screen.queryByText(/discriminant tells us the nature/)).not.toBeInTheDocument();
    expect(screen.getByTestId('topic-v2-uncited-notice')).toBeInTheDocument();
  });

  it('renders nothing extra when there is no explanation text at all (distinct from the uncited case)', () => {
    render(
      <TopicPage
        {...baseProps({
          topic: { id: 'topic-1', title: 'Quadratic Equations', explanation: null },
          citation: null,
        })}
      />,
    );
    expect(screen.queryByTestId('topic-v2-explanation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('topic-v2-uncited-notice')).not.toBeInTheDocument();
  });
});

describe('TopicPage — "the bit people miss" callout', () => {
  it('renders the callout labelled as a tip, independent of citation state', () => {
    render(<TopicPage {...baseProps({ citation: null })} />);
    const callout = screen.getByTestId('topic-v2-callout');
    expect(callout).toHaveTextContent('The bit people miss');
    expect(callout).toHaveTextContent('discriminant sign');
  });

  it('omits the callout section when there is no tip text', () => {
    render(<TopicPage {...baseProps({ calloutText: null })} />);
    expect(screen.queryByTestId('topic-v2-callout')).not.toBeInTheDocument();
  });
});

describe('TopicPage — figure slot', () => {
  it('renders the diagram when an image URL is present', () => {
    render(
      <TopicPage
        {...baseProps({
          diagram: { imageUrl: 'https://cdn.example/diagram.png', altText: 'Parabola', caption: 'A parabola', captionHi: null },
        })}
      />,
    );
    expect(screen.getByTestId('topic-v2-diagram')).toBeInTheDocument();
    expect(screen.getByAltText('Parabola')).toBeInTheDocument();
  });

  it('renders no diagram slot when diagram is null', () => {
    render(<TopicPage {...baseProps({ diagram: null })} />);
    expect(screen.queryByTestId('topic-v2-diagram')).not.toBeInTheDocument();
  });
});

describe('TopicPage — actions reuse existing mechanisms (no invented URLs)', () => {
  it('Practice calls onPractice', () => {
    const onPractice = vi.fn();
    render(<TopicPage {...baseProps({ onPractice })} />);
    fireEvent.click(screen.getByTestId('topic-v2-practice'));
    expect(onPractice).toHaveBeenCalledTimes(1);
  });

  it('Ask Foxy calls onAskFoxy', () => {
    const onAskFoxy = vi.fn();
    render(<TopicPage {...baseProps({ onAskFoxy })} />);
    fireEvent.click(screen.getByTestId('topic-v2-ask-foxy'));
    expect(onAskFoxy).toHaveBeenCalledTimes(1);
  });

  it('Back calls onBack', () => {
    const onBack = vi.fn();
    render(<TopicPage {...baseProps({ onBack })} />);
    fireEvent.click(screen.getByTestId('topic-v2-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('TopicPage — topic navigation', () => {
  it('hides prev/next entirely when both callbacks are null', () => {
    render(<TopicPage {...baseProps({ onPrevTopic: null, onNextTopic: null })} />);
    expect(screen.queryByTestId('topic-v2-prev')).not.toBeInTheDocument();
    expect(screen.queryByTestId('topic-v2-next')).not.toBeInTheDocument();
  });

  it('disables prev when null but wires next when present', () => {
    const onNextTopic = vi.fn();
    render(<TopicPage {...baseProps({ onPrevTopic: null, onNextTopic })} />);
    expect(screen.getByTestId('topic-v2-prev')).toBeDisabled();
    fireEvent.click(screen.getByTestId('topic-v2-next'));
    expect(onNextTopic).toHaveBeenCalledTimes(1);
  });
});

describe('TopicPage — keep offline (design 14, real store wiring)', () => {
  it('hides the row entirely when offlineEnabled is false', () => {
    render(<TopicPage {...baseProps({ offlineEnabled: false })} />);
    expect(screen.queryByTestId('topic-v2-keep-offline')).not.toBeInTheDocument();
  });

  it('calls onKeepOffline when tapped', () => {
    const onKeepOffline = vi.fn();
    render(<TopicPage {...baseProps({ offlineEnabled: true, onKeepOffline })} />);
    fireEvent.click(screen.getByTestId('topic-v2-keep-offline'));
    expect(onKeepOffline).toHaveBeenCalledTimes(1);
  });

  it('shows the kept state and disables further taps once isOfflineKept is true', () => {
    render(<TopicPage {...baseProps({ offlineEnabled: true, isOfflineKept: true })} />);
    const btn = screen.getByTestId('topic-v2-keep-offline');
    expect(btn).toHaveTextContent('Kept offline');
    expect(btn).toBeDisabled();
  });

  it('shows the saving state and disables further taps while offlineBusy is true', () => {
    render(<TopicPage {...baseProps({ offlineEnabled: true, offlineBusy: true })} />);
    const btn = screen.getByTestId('topic-v2-keep-offline');
    expect(btn).toHaveTextContent('Saving...');
    expect(btn).toBeDisabled();
  });
});

describe('TopicPage — bilingual (P7)', () => {
  it('renders Hindi copy for headline UI when isHi is true', () => {
    render(
      <TopicPage
        {...baseProps({
          isHi: true,
          citation: { chapterNumber: 4, chapterTitle: 'द्विघात समीकरण', pageRange: '78-82' },
        })}
      />,
    );
    expect(screen.getByTestId('topic-v2-practice')).toHaveTextContent('अभ्यास करो');
    expect(screen.getByTestId('topic-v2-ask-foxy')).toHaveTextContent('Foxy से पूछो');
    expect(screen.getByTestId('topic-v2-citation')).toHaveTextContent('अध्याय 4');
  });
});
