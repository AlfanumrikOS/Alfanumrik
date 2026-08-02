/**
 * usePlacement — Wave B placement-check reader/writer hook
 * (packages/lib/src/placement/use-placement.ts).
 *
 * Pins:
 *   1. FABRICATED-TOPIC-ID BUG (fixed this session): `PlacementQuestion.topicId`
 *      is passed through from the raw fetched row's `topicId` VERBATIM,
 *      including `null` — it must never fall back to the question's own id.
 *      This is the regression brief's item 2.
 *   2. `submit()` mints a FRESH idempotencyKey per call (at answer time, not
 *      at retry time) — never reuses/memoizes one across answers.
 *   3. `submit()` reuses the SAME sessionId for every answer within one
 *      subject, and mints a NEW sessionId when `subject` changes (a new
 *      placement session).
 *   4. `submit()` advances `index` synchronously, before the network call
 *      settles ("the network must never make the student wait"), and calls
 *      `onComplete()` once the index passes the last question.
 *   5. `submit()` POSTs the answer body with `topicId` passed straight from
 *      the answer argument (matching pin 1's contract end-to-end).
 *   6. A network failure in `submit()`'s fetch never throws / blocks the
 *      student (try/catch swallows it silently — "no signal is fine, a
 *      blocked student is not").
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── swr mock — deterministic `data` without a real network round trip ──────
let swrData: unknown;
const swrMutate = vi.fn();
vi.mock('swr', () => ({
  default: () => ({ data: swrData, error: null, isLoading: false, mutate: swrMutate }),
}));

vi.mock('@alfanumrik/lib/api/auth-header', () => ({
  authHeader: vi.fn().mockResolvedValue({}),
}));

import { usePlacement } from '@alfanumrik/lib/placement/use-placement';

const QUESTION_WITH_TOPIC = {
  id: 'q1',
  topicId: 'topic-abc',
  chapterNumber: 1,
  stem: 'What is 2+2?',
  options: [{ id: '0', label: '4' }],
};

const QUESTION_WITHOUT_TOPIC = {
  id: 'q2',
  topicId: null,
  chapterNumber: null,
  stem: 'Never-taught topic question',
  options: [{ id: '0', label: 'A' }],
};

function fetchMock() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true }),
  });
}

beforeEach(() => {
  swrData = { schemaVersion: 1, subject: 'math', grade: '9', questions: [QUESTION_WITH_TOPIC, QUESTION_WITHOUT_TOPIC] };
  swrMutate.mockClear();
  vi.stubGlobal('fetch', fetchMock());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('usePlacement — topicId passthrough (fabricated-id bug fix)', () => {
  it('passes topicId through verbatim from the fetched row when present', () => {
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    expect(result.current.questions[0].topicId).toBe('topic-abc');
  });

  it('passes topicId through as null — never defaults to the question id', () => {
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    const q2 = result.current.questions[1];
    expect(q2.id).toBe('q2');
    expect(q2.topicId).toBeNull();
    expect(q2.topicId).not.toBe('q2');
  });

  it('returns an empty questions array when there is no data yet', () => {
    swrData = null;
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    expect(result.current.questions).toEqual([]);
  });
});

describe('usePlacement — submit() payload shape', () => {
  it('POSTs topicId straight from the answer argument (null stays null)', async () => {
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    await act(async () => {
      await result.current.submit({ questionId: 'q2', topicId: null, optionId: null, unseen: true });
    });
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/v2/placement/answer');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.topicId).toBeNull();
    expect(body.questionId).toBe('q2');
    expect(body.optionId).toBeNull();
    expect(body.unseen).toBe(true);
  });

  it('POSTs a real topicId through unchanged', async () => {
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    await act(async () => {
      await result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
    });
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.topicId).toBe('topic-abc');
  });

  it('includes a fresh UUID idempotencyKey and an ISO occurredAt on every submit', async () => {
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    await act(async () => {
      await result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
    });
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body1 = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body1.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(() => new Date(body1.occurredAt).toISOString()).not.toThrow();

    await act(async () => {
      await result.current.submit({ questionId: 'q2', topicId: null, optionId: null, unseen: true });
    });
    const body2 = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    // A fresh key per answer — never reused across submits.
    expect(body2.idempotencyKey).not.toBe(body1.idempotencyKey);
  });

  it('reuses the SAME sessionId across multiple answers within one subject', async () => {
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    await act(async () => {
      await result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
    });
    await act(async () => {
      await result.current.submit({ questionId: 'q2', topicId: null, optionId: null, unseen: true });
    });
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body1 = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const body2 = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(body1.sessionId).toBe(body2.sessionId);
  });

  it('mints a NEW sessionId when the subject changes (a new placement session)', async () => {
    const { result, rerender } = renderHook(({ subject }) => usePlacement(subject, vi.fn()), {
      initialProps: { subject: 'math' },
    });
    await act(async () => {
      await result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
    });
    rerender({ subject: 'science' });
    await act(async () => {
      await result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
    });
    const fetchSpy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const body1 = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const body2 = JSON.parse((fetchSpy.mock.calls[1][1] as RequestInit).body as string);
    expect(body1.sessionId).not.toBe(body2.sessionId);
  });
});

describe('usePlacement — index advancement + completion', () => {
  it('advances index synchronously, before the network call resolves', () => {
    // A fetch that never resolves within this test — proves the index
    // advance does not wait on it.
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    expect(result.current.index).toBe(0);
    act(() => {
      void result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
    });
    expect(result.current.index).toBe(1);
  });

  it('calls onComplete once the index passes the last question', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => usePlacement('math', onComplete));
    act(() => {
      void result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
    });
    expect(onComplete).not.toHaveBeenCalled();
    act(() => {
      void result.current.submit({ questionId: 'q2', topicId: null, optionId: null, unseen: true });
    });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('resets index to 0 when the subject changes', () => {
    const { result, rerender } = renderHook(({ subject }) => usePlacement(subject, vi.fn()), {
      initialProps: { subject: 'math' },
    });
    act(() => {
      void result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
    });
    expect(result.current.index).toBe(1);
    rerender({ subject: 'science' });
    expect(result.current.index).toBe(0);
  });

  it('skipAll is the same callback as onComplete', () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => usePlacement('math', onComplete));
    result.current.skipAll();
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe('usePlacement — network failure never blocks the student', () => {
  it('does not throw when the POST rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { result } = renderHook(() => usePlacement('math', vi.fn()));
    await expect(
      act(async () => {
        await result.current.submit({ questionId: 'q1', topicId: 'topic-abc', optionId: '0', unseen: false });
      }),
    ).resolves.not.toThrow();
  });
});
