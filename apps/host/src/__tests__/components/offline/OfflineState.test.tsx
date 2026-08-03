/**
 * OfflineState — what the student sees with no connection
 * (packages/ui/src/offline/v2/OfflineState.tsx).
 *
 * PURE PRESENTATION: chapters / queue counts / saved-explanation count are
 * all passed in.
 *
 * Pins:
 *   - "Never a blank screen": the banner + heading always render.
 *   - empty chapters -> the dedicated empty state, not a blank list.
 *   - the queue banner (reassuring copy — "nothing is lost, score won't
 *     change") shows ONLY when answerCount>0 || sessionCount>0, with correct
 *     singular/plural session wording.
 *   - Foxy is shown DISABLED WITH ITS REASON (never hidden) — always renders.
 *   - the saved-explanations shortcut appears only when count > 0, with
 *     correct singular/plural wording, and calls onOpenSavedExplanations.
 *   - clicking a downloaded chapter calls onOpenChapter(chapter).
 *   - accessibility: chapter rows and the saved-explanations button meet the
 *     44px minimum tap target.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import OfflineState, { type DownloadedChapter } from '@alfanumrik/ui/offline/v2/OfflineState';

function chapter(overrides: Partial<DownloadedChapter> = {}): DownloadedChapter {
  return {
    id: 'topic-1',
    title: 'Number Systems',
    summary: 'Full chapter + 40 questions',
    subjectCode: 'math',
    ...overrides,
  };
}

function getMinHeight(el: HTMLElement): number {
  return parseFloat(el.style.minHeight || '0');
}

describe('OfflineState — never a blank screen', () => {
  it('always renders the banner + heading, even with nothing downloaded and no queue', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.getByTestId('offline-state')).toBeInTheDocument();
    expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
    expect(screen.getByText('No internet — you can still work')).toBeInTheDocument();
  });

  it('shows the Hindi banner text', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={true}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.getByText('इंटरनेट नहीं है — फिर भी काम चलेगा')).toBeInTheDocument();
  });
});

describe('OfflineState — downloaded chapters', () => {
  it('shows the empty-downloads state when there are no chapters', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.getByTestId('offline-no-downloads')).toBeInTheDocument();
  });

  it('renders one row per chapter and calls onOpenChapter on click', () => {
    const onOpenChapter = vi.fn();
    const ch = chapter();
    render(
      <OfflineState
        chapters={[ch]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={onOpenChapter}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('offline-no-downloads')).not.toBeInTheDocument();
    const row = screen.getByTestId('offline-chapter');
    expect(row).toHaveTextContent('Number Systems');
    row.click();
    expect(onOpenChapter).toHaveBeenCalledWith(ch);
  });

  it('chapter rows meet the 44px minimum tap target', () => {
    render(
      <OfflineState
        chapters={[chapter()]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(getMinHeight(screen.getByTestId('offline-chapter'))).toBeGreaterThanOrEqual(44);
  });
});

describe('OfflineState — queue banner (reassurance copy)', () => {
  it('is absent when nothing is queued', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('offline-queue')).not.toBeInTheDocument();
  });

  it('appears when there are queued answers, with reassuring "nothing is lost" copy', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 3, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    const banner = screen.getByTestId('offline-queue');
    expect(banner).toHaveTextContent('nothing is lost');
    expect(banner).toHaveTextContent('score will not change');
  });

  it('appears when there are queued sessions even with zero queued answers', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 1 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.getByTestId('offline-queue')).toBeInTheDocument();
  });

  it('pluralizes "session" correctly for 1 vs 2+ sessions', () => {
    const { rerender } = render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 1, sessionCount: 1 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.getByTestId('offline-queue')).toHaveTextContent('1 finished session.');

    rerender(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 1, sessionCount: 2 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.getByTestId('offline-queue')).toHaveTextContent('2 finished sessions.');
  });
});

describe('OfflineState — Foxy shown disabled WITH its reason (never hidden)', () => {
  it('always renders the disabled-Foxy card', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    const foxy = screen.getByTestId('offline-foxy');
    expect(foxy).toHaveTextContent('Foxy needs internet');
    expect(foxy).toHaveTextContent('cannot answer right now');
  });

  it('shows the saved-explanations shortcut only when count > 0, and calls the callback', () => {
    const onOpenSavedExplanations = vi.fn();
    const { rerender } = render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={0}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={onOpenSavedExplanations}
      />,
    );
    expect(screen.queryByTestId('offline-saved-explanations')).not.toBeInTheDocument();

    rerender(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={2}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={onOpenSavedExplanations}
      />,
    );
    const btn = screen.getByTestId('offline-saved-explanations');
    expect(btn).toHaveTextContent('Open 2 saved explanations');
    btn.click();
    expect(onOpenSavedExplanations).toHaveBeenCalledTimes(1);
  });

  it('pluralizes "saved explanation" correctly for exactly 1', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={1}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(screen.getByTestId('offline-saved-explanations')).toHaveTextContent('Open 1 saved explanation');
  });

  it('the saved-explanations button meets the 44px minimum tap target', () => {
    render(
      <OfflineState
        chapters={[]}
        queue={{ answerCount: 0, sessionCount: 0 }}
        savedExplanationCount={1}
        isHi={false}
        onOpenChapter={vi.fn()}
        onOpenSavedExplanations={vi.fn()}
      />,
    );
    expect(getMinHeight(screen.getByTestId('offline-saved-explanations'))).toBeGreaterThanOrEqual(44);
  });
});
