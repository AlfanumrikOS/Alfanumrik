import { describe, it, expect } from 'vitest';
import {
  applyWeeklyCompletion,
  weeksBetween,
  MISS_TOLERANCE_WEEKS,
  type WeeklyStreakState,
} from '../learn/weekly-streak';

describe('weeksBetween', () => {
  it('returns 1 for consecutive weeks', () => {
    expect(weeksBetween('2026-W18', '2026-W19')).toBe(1);
  });

  it('returns 0 for the same week', () => {
    expect(weeksBetween('2026-W19', '2026-W19')).toBe(0);
  });

  it('returns the gap for non-consecutive same-year weeks', () => {
    expect(weeksBetween('2026-W10', '2026-W19')).toBe(9);
  });

  it('handles year boundary correctly', () => {
    // 2025-W52 → 2026-W01 is 1 week (assuming 2025 has 52 ISO weeks).
    // 2025 has 52 ISO weeks (Jan 1, 2025 was Wed, year-start rule); 2026-W01 starts 2025-12-29.
    expect(weeksBetween('2025-W52', '2026-W01')).toBe(1);
  });

  it('handles 53-week years (2026 has 53 weeks)', () => {
    // 2026-W53 → 2027-W01: 1 week.
    expect(weeksBetween('2026-W53', '2027-W01')).toBe(1);
  });

  it('returns negative number for backward direction (callers should not depend on negatives)', () => {
    expect(weeksBetween('2026-W19', '2026-W18')).toBe(-1);
  });
});

describe('applyWeeklyCompletion', () => {
  const fresh: WeeklyStreakState = { count: 0, lastIsoWeek: null };

  it('first-ever completion: count=0 -> count=1, lastIsoWeek set', () => {
    const next = applyWeeklyCompletion(fresh, '2026-W19');
    expect(next.count).toBe(1);
    expect(next.lastIsoWeek).toBe('2026-W19');
  });

  it('consecutive week: count=1 -> count=2', () => {
    const next = applyWeeklyCompletion({ count: 1, lastIsoWeek: '2026-W18' }, '2026-W19');
    expect(next.count).toBe(2);
    expect(next.lastIsoWeek).toBe('2026-W19');
  });

  it('one-week-miss tolerance: count=3 with lastIsoWeek=W17, complete W19 (skip W18) -> count=4', () => {
    const next = applyWeeklyCompletion({ count: 3, lastIsoWeek: '2026-W17' }, '2026-W19');
    expect(next.count).toBe(4);
    expect(next.lastIsoWeek).toBe('2026-W19');
  });

  it('two-week-miss tolerance: count=3 with lastIsoWeek=W16, complete W19 (skip W17,W18) -> count=4', () => {
    const next = applyWeeklyCompletion({ count: 3, lastIsoWeek: '2026-W16' }, '2026-W19');
    expect(next.count).toBe(4);
  });

  it('three-week-miss tolerance: count=3 with lastIsoWeek=W15, complete W19 (skip W16,W17,W18) -> count=4', () => {
    const next = applyWeeklyCompletion({ count: 3, lastIsoWeek: '2026-W15' }, '2026-W19');
    expect(next.count).toBe(4);
  });

  it('reset on 4 consecutive missed weeks: count=5 with lastIsoWeek=W14, complete W19 (skip W15-W18) -> count=1 (reset)', () => {
    const next = applyWeeklyCompletion({ count: 5, lastIsoWeek: '2026-W14' }, '2026-W19');
    expect(next.count).toBe(1);
    expect(next.lastIsoWeek).toBe('2026-W19');
  });

  it('reset on 5+ consecutive missed weeks (extreme gap): count=10 with lastIsoWeek=W01, complete W19 -> count=1', () => {
    const next = applyWeeklyCompletion({ count: 10, lastIsoWeek: '2026-W01' }, '2026-W19');
    expect(next.count).toBe(1);
  });

  it('idempotent same-week double completion: count=4 with lastIsoWeek=W19, complete W19 -> unchanged', () => {
    const before: WeeklyStreakState = { count: 4, lastIsoWeek: '2026-W19' };
    const next = applyWeeklyCompletion(before, '2026-W19');
    expect(next.count).toBe(4);
    expect(next.lastIsoWeek).toBe('2026-W19');
  });

  it('treats null lastIsoWeek as fresh (count starts from 1 regardless of previous count)', () => {
    // Defensive: if storage somehow has count > 0 but lastIsoWeek = null, don't increment;
    // start fresh so we don't leak phantom state.
    const next = applyWeeklyCompletion({ count: 7, lastIsoWeek: null }, '2026-W19');
    expect(next.count).toBe(1);
  });
});

describe('MISS_TOLERANCE_WEEKS constant', () => {
  it('exposes the documented threshold', () => {
    expect(MISS_TOLERANCE_WEEKS).toBe(4);
  });
});
