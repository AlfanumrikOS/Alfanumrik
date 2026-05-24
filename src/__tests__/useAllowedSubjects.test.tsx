// D2: verify useAllowedSubjects partitions subjects into unlocked/locked.
// The hook is the single source of truth used by dashboard/foxy/profile/etc.
//
// NOTE (2026-05-24): the hook now derives `subjects/unlocked/locked` via real
// React.useMemo and `refresh` via useCallback (referential-stability fix for
// the infinite-render-loop bug). Real hooks require an active React render
// dispatcher, so these tests use renderHook(...) instead of calling the hook
// bare — calling it outside a render context now throws
// "Cannot read properties of null (reading 'useMemo')".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Mock swr so we can feed a deterministic server response to the hook.
const fetcherMock = vi.fn();
vi.mock('swr', () => ({
  default: (_key: any, _fetcher: any) => {
    const res = fetcherMock();
    return {
      data: res,
      error: null,
      isLoading: !res,
      mutate: vi.fn(),
    };
  },
}));

import { useAllowedSubjects } from '@/lib/useAllowedSubjects';

describe('useAllowedSubjects', () => {
  beforeEach(() => {
    fetcherMock.mockReset();
  });

  it('splits subjects into unlocked and locked', () => {
    fetcherMock.mockReturnValue({
      subjects: [
        { code: 'math', name: 'Math', nameHi: 'गणित', icon: '∑', color: '#000', subjectKind: 'cbse_core', isCore: true, isLocked: false },
        { code: 'physics', name: 'Physics', nameHi: 'भौतिकी', icon: '⚡', color: '#111', subjectKind: 'cbse_core', isCore: true, isLocked: true },
      ],
    });
    const { result } = renderHook(() => useAllowedSubjects());
    const { subjects, unlocked, locked } = result.current;
    expect(subjects).toHaveLength(2);
    expect(unlocked.map(s => s.code)).toEqual(['math']);
    expect(locked.map(s => s.code)).toEqual(['physics']);
  });

  it('returns empty arrays when no data yet', () => {
    fetcherMock.mockReturnValue(undefined);
    const { result } = renderHook(() => useAllowedSubjects());
    const { subjects, unlocked, locked } = result.current;
    expect(subjects).toEqual([]);
    expect(unlocked).toEqual([]);
    expect(locked).toEqual([]);
  });
});
