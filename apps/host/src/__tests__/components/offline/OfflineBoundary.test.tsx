/**
 * OfflineBoundary — mounts the offline screen over the student surface when
 * the device drops connection (packages/ui/src/offline/v2/OfflineBoundary.tsx).
 *
 * Pins:
 *   - flag off (ff_offline_v2 !== true) -> renders children untouched,
 *     regardless of isOffline.
 *   - flag on + online (isOffline=false) -> renders children untouched.
 *   - flag on + offline=true -> renders the (dynamically-imported) OfflineState
 *     screen instead of children.
 *   - opening a downloaded chapter calls touchChapter(id) AND navigates to
 *     /learn/<subjectCode>.
 *   - opening saved explanations navigates to /foxy?saved=1.
 *   - pending writes are correctly split into answerCount (quiz_answer) vs
 *     sessionCount (quiz_session) for the queue banner.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import OfflineBoundary from '@alfanumrik/ui/offline/v2/OfflineBoundary';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}));

let flagsData: Record<string, boolean> | undefined;
vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => ({ data: flagsData, isLoading: false }),
}));

interface OfflineStateShape {
  isOffline: boolean;
  chapters: Array<{ id: string; subjectCode: string; title: string; questionCount: number }>;
  pending: Array<{ kind: 'quiz_answer' | 'quiz_session'; idempotencyKey: string }>;
  savedExplanations: Array<{ id: string }>;
}
let offlineState: OfflineStateShape;
vi.mock('@alfanumrik/lib/offline/use-offline-state', () => ({
  useOfflineState: () => offlineState,
}));

const touchChapterMock = vi.fn();
vi.mock('@alfanumrik/lib/offline/store', () => ({
  touchChapter: (...a: unknown[]) => touchChapterMock(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  flagsData = { ff_offline_v2: true };
  offlineState = { isOffline: true, chapters: [], pending: [], savedExplanations: [] };
});

describe('OfflineBoundary — flag/online gating', () => {
  it('renders children untouched when the flag is off, even while offline', () => {
    flagsData = { ff_offline_v2: false };
    offlineState = { isOffline: true, chapters: [], pending: [], savedExplanations: [] };
    render(
      <OfflineBoundary isHi={false}>
        <div data-testid="child-content">Normal page</div>
      </OfflineBoundary>,
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-state')).not.toBeInTheDocument();
  });

  it('renders children untouched when the flags payload has not resolved yet', () => {
    flagsData = undefined;
    offlineState = { isOffline: true, chapters: [], pending: [], savedExplanations: [] };
    render(
      <OfflineBoundary isHi={false}>
        <div data-testid="child-content">Normal page</div>
      </OfflineBoundary>,
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
  });

  it('renders children untouched when the flag is on but the device is online', () => {
    offlineState = { isOffline: false, chapters: [], pending: [], savedExplanations: [] };
    render(
      <OfflineBoundary isHi={false}>
        <div data-testid="child-content">Normal page</div>
      </OfflineBoundary>,
    );
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.queryByTestId('offline-state')).not.toBeInTheDocument();
  });

  it('renders the OfflineState screen (not children) when the flag is on and the device is offline', async () => {
    render(
      <OfflineBoundary isHi={false}>
        <div data-testid="child-content">Normal page</div>
      </OfflineBoundary>,
    );
    // OfflineState is loaded via next/dynamic — allow the import to resolve.
    await waitFor(() => expect(screen.getByTestId('offline-state')).toBeInTheDocument());
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
  });
});

describe('OfflineBoundary — chapter open + saved-explanations navigation', () => {
  it('touches the chapter and navigates to /learn/<subjectCode> when a downloaded chapter is opened', async () => {
    offlineState = {
      isOffline: true,
      chapters: [{ id: 'topic-1', subjectCode: 'math', title: 'Number Systems', questionCount: 40 }],
      pending: [],
      savedExplanations: [],
    };
    render(
      <OfflineBoundary isHi={false}>
        <div>child</div>
      </OfflineBoundary>,
    );
    const row = await screen.findByTestId('offline-chapter');
    row.click();
    expect(touchChapterMock).toHaveBeenCalledWith('topic-1');
    expect(mockPush).toHaveBeenCalledWith('/learn/math');
  });

  it('builds the chapter summary from questionCount', async () => {
    offlineState = {
      isOffline: true,
      chapters: [{ id: 'topic-1', subjectCode: 'math', title: 'Number Systems', questionCount: 40 }],
      pending: [],
      savedExplanations: [],
    };
    render(
      <OfflineBoundary isHi={false}>
        <div>child</div>
      </OfflineBoundary>,
    );
    await waitFor(() => expect(screen.getByText('Full chapter + 40 questions')).toBeInTheDocument());
  });

  it('navigates to /foxy?saved=1 when saved explanations are opened', async () => {
    offlineState = {
      isOffline: true,
      chapters: [],
      pending: [],
      savedExplanations: [{ id: 'exp-1' }],
    };
    render(
      <OfflineBoundary isHi={false}>
        <div>child</div>
      </OfflineBoundary>,
    );
    const btn = await screen.findByTestId('offline-saved-explanations');
    btn.click();
    expect(mockPush).toHaveBeenCalledWith('/foxy?saved=1');
  });
});

describe('OfflineBoundary — pending-write queue split', () => {
  it('splits pending writes into answerCount (quiz_answer) and sessionCount (quiz_session)', async () => {
    offlineState = {
      isOffline: true,
      chapters: [],
      pending: [
        { kind: 'quiz_answer', idempotencyKey: 'a1' },
        { kind: 'quiz_answer', idempotencyKey: 'a2' },
        { kind: 'quiz_session', idempotencyKey: 's1' },
      ],
      savedExplanations: [],
    };
    render(
      <OfflineBoundary isHi={false}>
        <div>child</div>
      </OfflineBoundary>,
    );
    const banner = await screen.findByTestId('offline-queue');
    expect(banner).toHaveTextContent('2 answers');
    expect(banner).toHaveTextContent('1 finished session.');
  });
});
