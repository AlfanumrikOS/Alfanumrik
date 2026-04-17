// D2: verify useAllowedSubjects partitions subjects into unlocked/locked.
// The hook is the single source of truth used by dashboard/foxy/profile/etc.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
    const { subjects, unlocked, locked } = useAllowedSubjects();
    expect(subjects).toHaveLength(2);
    expect(unlocked.map(s => s.code)).toEqual(['math']);
    expect(locked.map(s => s.code)).toEqual(['physics']);
  });

  it('returns empty arrays when no data yet', () => {
    fetcherMock.mockReturnValue(undefined);
    const { subjects, unlocked, locked } = useAllowedSubjects();
    expect(subjects).toEqual([]);
    expect(unlocked).toEqual([]);
    expect(locked).toEqual([]);
  });
});
