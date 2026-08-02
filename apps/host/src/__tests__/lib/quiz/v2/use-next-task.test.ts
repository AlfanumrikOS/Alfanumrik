/**
 * useNextTask — screen 08 "Result" (`ff_quiz_result_v2`) "Next task" CTA.
 *
 * Reuses the EXISTING Today-queue mechanism (`useTodayQueue`) rather than
 * inventing a new "what's next" resolver. Pins:
 *   1. Resolves the primary Today item's deepLink into a navigable href.
 *   2. Falls back to `/today` on loading / null / empty queue — the CTA
 *      must never be absent (SCREENS.md: "Never a dead end").
 */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

type QueueState = { data: unknown; isLoading: boolean };
let mockQueueState: QueueState;

vi.mock('@alfanumrik/lib/today/use-today-queue', () => ({
  useTodayQueue: () => mockQueueState,
}));

import { useNextTask } from '@alfanumrik/lib/quiz/v2/use-next-task';

describe('useNextTask', () => {
  it('falls back to /today while the queue is still loading', () => {
    mockQueueState = { data: undefined, isLoading: true };
    const { result } = renderHook(() => useNextTask('stu-1'));
    expect(result.current.href).toBe('/today');
    expect(result.current.isLoading).toBe(true);
  });

  it('falls back to /today when the queue resolves to null (e.g. 404)', () => {
    mockQueueState = { data: null, isLoading: false };
    const { result } = renderHook(() => useNextTask('stu-1'));
    expect(result.current.href).toBe('/today');
  });

  it('resolves the primary item route with no params', () => {
    mockQueueState = {
      data: { primary: { deepLink: { route: '/review' } } },
      isLoading: false,
    };
    const { result } = renderHook(() => useNextTask('stu-1'));
    expect(result.current.href).toBe('/review');
  });

  it('resolves the primary item route WITH querystring params', () => {
    mockQueueState = {
      data: { primary: { deepLink: { route: '/quiz', params: { subject: 'math', chapter: 4 } } } },
      isLoading: false,
    };
    const { result } = renderHook(() => useNextTask('stu-1'));
    expect(result.current.href).toBe('/quiz?subject=math&chapter=4');
  });

  it('carries bilingual labels (P7)', () => {
    mockQueueState = { data: null, isLoading: false };
    const { result } = renderHook(() => useNextTask('stu-1'));
    expect(result.current.labelEn).toBe('Next task');
    expect(result.current.labelHi).toBe('अगला काम');
  });
});
