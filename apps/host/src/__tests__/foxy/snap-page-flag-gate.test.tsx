/**
 * /foxy/snap — ff_foxy_snap_v1 flag-gating + the REAL three-intent hand-off
 * into /foxy (apps/host/src/app/foxy/snap/page.tsx).
 *
 * Pins:
 *   - flag OFF (resolved) → notFound() (no legacy equivalent to redirect to,
 *     same shape as /revision's ff_revision_os_v1 gate).
 *   - flag still resolving / auth not ready → neither notFound() nor the
 *     screen mounts (skeleton only) — never flash a 404 for a legitimately-
 *     ON user.
 *   - flag ON → mounts SnapDoubt, and the topics hook is only enabled once
 *     the route is confirmed reachable.
 *   - the three intents build the REAL, EXISTING /foxy deep link
 *     (?subject=&mode=doubt&topic=&prompt=&source=snap_doubt) — the same
 *     mechanism the chapter page's "Ask Foxy" button already uses — with a
 *     DIFFERENT crafted prompt per intent, and degrade gracefully (no
 *     subject/topic params) when there is no confident topic match.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const dynamicSpy = vi.fn();
vi.mock('next/dynamic', () => ({
  default: () =>
    function SnapDoubtStub(props: Record<string, unknown>) {
      dynamicSpy(props);
      return React.createElement('div', { 'data-testid': 'snap-doubt-stub' });
    },
}));

const mockPush = vi.fn();
const mockNotFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  notFound: () => mockNotFound(),
}));

const mockUseRequireAuth = vi.fn();
vi.mock('@alfanumrik/lib/useRequireAuth', () => ({
  useRequireAuth: () => mockUseRequireAuth(),
}));

const mockUseFeatureFlags = vi.fn();
vi.mock('@alfanumrik/lib/swr', () => ({
  useFeatureFlags: () => mockUseFeatureFlags(),
}));

const mockUseSnapCurriculumTopics = vi.fn();
vi.mock('@alfanumrik/lib/foxy/use-snap-curriculum-topics', () => ({
  useSnapCurriculumTopics: (enabled: boolean) => mockUseSnapCurriculumTopics(enabled),
}));

function baseAuth(overrides: Record<string, unknown> = {}) {
  return { isReady: true, isHi: false, ...overrides };
}

function baseTopics(overrides: Record<string, unknown> = {}) {
  return { topics: [], isLoading: false, error: false, mutate: vi.fn(), ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSnapCurriculumTopics.mockReturnValue(baseTopics());
});

describe('/foxy/snap — ff_foxy_snap_v1 gate', () => {
  it('flag OFF: calls notFound(), never mounts SnapDoubt', async () => {
    mockUseRequireAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_foxy_snap_v1: false }, isLoading: false });

    const { default: SnapDoubtPage } = await import('@/app/foxy/snap/page');
    expect(() => render(<SnapDoubtPage />)).toThrow('NEXT_NOT_FOUND');
    expect(mockNotFound).toHaveBeenCalled();
    expect(dynamicSpy).not.toHaveBeenCalled();
  });

  it('flag still resolving: does not call notFound() and does not mount SnapDoubt yet', async () => {
    mockUseRequireAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: undefined, isLoading: true });

    const { default: SnapDoubtPage } = await import('@/app/foxy/snap/page');
    render(<SnapDoubtPage />);

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('snap-doubt-stub')).not.toBeInTheDocument();
    expect(screen.getByTestId('snap-gate-loading')).toBeInTheDocument();
  });

  it('auth not ready: does not call notFound() and does not mount SnapDoubt yet', async () => {
    mockUseRequireAuth.mockReturnValue(baseAuth({ isReady: false }));
    mockUseFeatureFlags.mockReturnValue({ data: { ff_foxy_snap_v1: true }, isLoading: false });

    const { default: SnapDoubtPage } = await import('@/app/foxy/snap/page');
    render(<SnapDoubtPage />);

    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('snap-doubt-stub')).not.toBeInTheDocument();
  });

  it('flag ON + auth ready: mounts SnapDoubt and enables the topics hook', async () => {
    mockUseRequireAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_foxy_snap_v1: true }, isLoading: false });

    const { default: SnapDoubtPage } = await import('@/app/foxy/snap/page');
    render(<SnapDoubtPage />);

    await screen.findByTestId('snap-doubt-stub');
    expect(mockUseSnapCurriculumTopics).toHaveBeenCalledWith(true);
  });

  it('flag OFF: the topics hook is called with enabled=false (no wasted fetch behind a dark route)', async () => {
    mockUseRequireAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_foxy_snap_v1: false }, isLoading: false });

    const { default: SnapDoubtPage } = await import('@/app/foxy/snap/page');
    expect(() => render(<SnapDoubtPage />)).toThrow('NEXT_NOT_FOUND');
    expect(mockUseSnapCurriculumTopics).toHaveBeenCalledWith(false);
  });
});

describe('/foxy/snap — REAL three-intent hand-off into /foxy', () => {
  beforeEach(() => {
    mockUseRequireAuth.mockReturnValue(baseAuth());
    mockUseFeatureFlags.mockReturnValue({ data: { ff_foxy_snap_v1: true }, isLoading: false });
  });

  async function renderAndGetProps() {
    const { default: SnapDoubtPage } = await import('@/app/foxy/snap/page');
    render(<SnapDoubtPage />);
    await screen.findByTestId('snap-doubt-stub');
    return dynamicSpy.mock.calls[dynamicSpy.mock.calls.length - 1][0] as Record<string, any>;
  }

  it('creates a block from typed text and selects it (onSubmitText -> selectedBlockId)', async () => {
    const props = await renderAndGetProps();
    act(() => {
      props.onSubmitText('Solve: 3x + 5 = 20');
    });

    const latest = dynamicSpy.mock.calls[dynamicSpy.mock.calls.length - 1][0] as Record<string, any>;
    expect(latest.blocks).toHaveLength(1);
    expect(latest.blocks[0].text).toBe('Solve: 3x + 5 = 20');
    expect(latest.selectedBlockId).toBe(latest.blocks[0].id);
  });

  it('with no topic match: routes to /foxy with mode=doubt, source=snap_doubt, prompt only (no subject/topic)', async () => {
    const props = await renderAndGetProps();
    props.onIntent('explain', { id: 'b1', text: 'Solve: 3x + 5 = 20' });

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    expect(url.startsWith('/foxy?')).toBe(true);
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('mode')).toBe('doubt');
    expect(params.get('source')).toBe('snap_doubt');
    expect(params.has('subject')).toBe(false);
    expect(params.has('topic')).toBe(false);
    expect(params.get('prompt')).toContain('Solve: 3x + 5 = 20');
  });

  it('"explain" / "steps" / "hint" send DIFFERENT crafted prompts for the same block', async () => {
    const props = await renderAndGetProps();
    const block = { id: 'b1', text: 'Solve: 3x + 5 = 20' };

    props.onIntent('explain', block);
    props.onIntent('steps', block);
    props.onIntent('hint', block);

    expect(mockPush).toHaveBeenCalledTimes(3);
    const prompts = mockPush.mock.calls.map(
      ([url]) => new URLSearchParams((url as string).split('?')[1]).get('prompt'),
    );
    expect(new Set(prompts).size).toBe(3); // all three prompts are distinct
    prompts.forEach((p) => expect(p).toContain('Solve: 3x + 5 = 20'));
  });

  it('with a confident topic match: subject + topic params are included in the /foxy hand-off', async () => {
    mockUseSnapCurriculumTopics.mockReturnValue(
      baseTopics({
        topics: [
          {
            id: 'topic-1',
            title: 'Linear Equations in One Variable',
            titleHi: null,
            chapterNumber: 2,
            subjectCode: 'math',
            subjectName: 'Mathematics',
          },
        ],
      }),
    );

    const props = await renderAndGetProps();
    // Real flow: onSubmitText creates AND selects the block (mirrors the
    // component's real typed-text-fallback -> selection behavior), which
    // makes the page compute a real match via matchTopicFromText().
    act(() => {
      props.onSubmitText('Solve this linear equation in one variable: 3x + 5 = 20');
    });
    const latest = dynamicSpy.mock.calls[dynamicSpy.mock.calls.length - 1][0] as Record<string, any>;
    expect(latest.match).not.toBeNull();
    expect(latest.match.subjectCode).toBe('math');

    latest.onIntent('hint', latest.blocks[0]);

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    const params = new URLSearchParams(url.split('?')[1]);
    expect(params.get('subject')).toBe('math');
    expect(params.get('topic')).toBe('Linear Equations in One Variable');
  });
});
