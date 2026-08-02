/**
 * useExamSchedule — Wave B exam-schedule reader hook
 * (packages/lib/src/exams/use-exam-schedule.ts).
 *
 * Two suites:
 *  A) Derived-state logic (dayLabel / thisWeek / later / next / setByInitials)
 *     — 'swr' is mocked so `data` is deterministic; this is where the bulk of
 *     the hook's own logic lives.
 *  B) The real network fetcher (fetchExamSchedule) — 'swr' is left
 *     UNMOCKED and `global.fetch` is stubbed instead, so the 404->null /
 *     non-ok-throws / credentials / auth-header contract is genuinely
 *     exercised (not bypassed by a swr mock).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ── Suite A: swr mocked ──────────────────────────────────────────────────────
let swrData: { schemaVersion: 1; entries: unknown[] } | null;
vi.mock('swr', () => ({
  default: () => ({ data: swrData, error: null, isLoading: false, mutate: vi.fn() }),
}));
vi.mock('@alfanumrik/lib/api/auth-header', () => ({
  authHeader: vi.fn().mockResolvedValue({}),
}));

import { useExamSchedule } from '@alfanumrik/lib/exams/use-exam-schedule';

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    source: 'student' as const,
    title: 'Test',
    startsOn: '2026-08-02',
    endsOn: '2026-08-02',
    ...overrides,
  };
}

// Pin "now" to a fixed instant for deterministic day-diff math.
const NOW_ISO = '2026-08-02T09:00:00.000+05:30'; // startOfDay = 2026-08-02 local

beforeEach(() => {
  vi.setSystemTime(new Date(NOW_ISO));
  swrData = { schemaVersion: 1, entries: [] };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useExamSchedule — dayLabel formatting', () => {
  it('labels an entry starting today as "Today" (English)', () => {
    swrData = { schemaVersion: 1, entries: [entry({ startsOn: '2026-08-02', endsOn: '2026-08-02' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.entries[0].dayLabel).toBe('Today');
  });

  it('labels an entry starting today as "आज" (Hindi)', () => {
    swrData = { schemaVersion: 1, entries: [entry({ startsOn: '2026-08-02', endsOn: '2026-08-02' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', true));
    expect(result.current.entries[0].dayLabel).toBe('आज');
  });

  it('labels an entry starting tomorrow as "Tomorrow" / "कल"', () => {
    swrData = { schemaVersion: 1, entries: [entry({ startsOn: '2026-08-03', endsOn: '2026-08-03' })] };
    const en = renderHook(() => useExamSchedule('stu-1', false));
    expect(en.result.current.entries[0].dayLabel).toBe('Tomorrow');
    const hi = renderHook(() => useExamSchedule('stu-1', true));
    expect(hi.result.current.entries[0].dayLabel).toBe('कल');
  });

  it('labels 2-6 days out with the short weekday name', () => {
    // 2026-08-05 is 3 days after 2026-08-02.
    swrData = { schemaVersion: 1, entries: [entry({ startsOn: '2026-08-05', endsOn: '2026-08-05' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    const expected = new Intl.DateTimeFormat('en-IN', { weekday: 'short' }).format(new Date('2026-08-05'));
    expect(result.current.entries[0].dayLabel).toBe(expected);
  });

  it('labels 7+ days out with a formatted date, not a weekday name', () => {
    swrData = { schemaVersion: 1, entries: [entry({ startsOn: '2026-09-01', endsOn: '2026-09-01' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    const expected = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date('2026-09-01'));
    expect(result.current.entries[0].dayLabel).toBe(expected);
  });

  it('labels a multi-day entry as a start-end range, regardless of how far out it is', () => {
    swrData = { schemaVersion: 1, entries: [entry({ startsOn: '2026-09-01', endsOn: '2026-09-10' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    const fmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
    const expected = `${fmt.format(new Date('2026-09-01'))} – ${fmt.format(new Date('2026-09-10'))}`;
    expect(result.current.entries[0].dayLabel).toBe(expected);
  });
});

describe('useExamSchedule — this-week / later split', () => {
  it('places an entry starting within 6 days into thisWeek', () => {
    swrData = { schemaVersion: 1, entries: [entry({ id: 'soon', startsOn: '2026-08-08', endsOn: '2026-08-08' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.thisWeek.map((e) => e.id)).toEqual(['soon']);
    expect(result.current.later).toEqual([]);
  });

  it('places an entry starting exactly 7 days out into later (boundary is exclusive)', () => {
    swrData = { schemaVersion: 1, entries: [entry({ id: 'week-boundary', startsOn: '2026-08-09', endsOn: '2026-08-09' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.thisWeek).toEqual([]);
    expect(result.current.later.map((e) => e.id)).toEqual(['week-boundary']);
  });

  it('places a far-future entry into later', () => {
    swrData = { schemaVersion: 1, entries: [entry({ id: 'far', startsOn: '2026-12-01', endsOn: '2026-12-01' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.later.map((e) => e.id)).toEqual(['far']);
  });

  it('splits a mixed set correctly', () => {
    swrData = {
      schemaVersion: 1,
      entries: [
        entry({ id: 'soon', startsOn: '2026-08-03', endsOn: '2026-08-03' }),
        entry({ id: 'far', startsOn: '2026-10-01', endsOn: '2026-10-01' }),
      ],
    };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.thisWeek.map((e) => e.id)).toEqual(['soon']);
    expect(result.current.later.map((e) => e.id)).toEqual(['far']);
  });
});

describe('useExamSchedule — next', () => {
  it('is thisWeek[0] when an entry is within the week', () => {
    swrData = {
      schemaVersion: 1,
      entries: [
        entry({ id: 'soon', startsOn: '2026-08-03', endsOn: '2026-08-03' }),
        entry({ id: 'far', startsOn: '2026-10-01', endsOn: '2026-10-01' }),
      ],
    };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.next?.id).toBe('soon');
  });

  it('falls back to all[0] when nothing is within the week but a later entry exists', () => {
    swrData = { schemaVersion: 1, entries: [entry({ id: 'far', startsOn: '2026-12-01', endsOn: '2026-12-01' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.next?.id).toBe('far');
  });

  it('is null when there are no entries at all', () => {
    swrData = { schemaVersion: 1, entries: [] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.next).toBeNull();
  });

  it('is null when there is no data yet (SWR still loading / 404)', () => {
    swrData = null;
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.next).toBeNull();
    expect(result.current.entries).toEqual([]);
  });
});

describe('useExamSchedule — setByInitials', () => {
  it('computes initials from the first two words of setBy for a teacher entry', () => {
    swrData = {
      schemaVersion: 1,
      entries: [entry({ source: 'teacher', setBy: 'Priya Sharma', startsOn: '2026-08-03', endsOn: '2026-08-03' })],
    };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.entries[0].setByInitials).toBe('PS');
  });

  it('is undefined for a student entry even if setBy happened to be present', () => {
    swrData = {
      schemaVersion: 1,
      entries: [entry({ source: 'student', setBy: 'Priya Sharma', startsOn: '2026-08-03', endsOn: '2026-08-03' })],
    };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.entries[0].setByInitials).toBeUndefined();
  });

  it('is undefined for a school entry (no setBy)', () => {
    swrData = { schemaVersion: 1, entries: [entry({ source: 'school', startsOn: '2026-08-03', endsOn: '2026-08-03' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.entries[0].setByInitials).toBeUndefined();
  });

  it('is undefined for a teacher entry with no setBy name', () => {
    swrData = { schemaVersion: 1, entries: [entry({ source: 'teacher', startsOn: '2026-08-03', endsOn: '2026-08-03' })] };
    const { result } = renderHook(() => useExamSchedule('stu-1', false));
    expect(result.current.entries[0].setByInitials).toBeUndefined();
  });
});

// ── Suite B: real swr + mocked global.fetch (the actual network fetcher) ──
// A separate describe using vi.doUnmock is not viable for a hoisted
// module-level vi.mock('swr', ...), so this exercises fetchExamSchedule's
// contract indirectly through a documented, isolated expectation: this suite
// lives in its own file (use-exam-schedule-fetcher.test.ts) since Vitest
// applies `vi.mock` calls at the top of a file to the WHOLE file — see that
// file for the 404->null / throw-on-error / credentials assertions.
