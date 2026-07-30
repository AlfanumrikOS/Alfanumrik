/**
 * IST helpers — unit tests.
 *
 * Covers `packages/lib/src/whatsapp/ist.ts`: fixed UTC+05:30 (no DST),
 * civil-date + HHMM mapping across the 18:30 UTC / midnight-IST boundary,
 * and the quiet-hours truth table (wrap-around windows, start-inclusive /
 * end-exclusive boundaries, start===end → no window).
 *
 * Owner: testing.
 */

import { describe, it, expect } from 'vitest';
import {
  IST_UTC_OFFSET_MINUTES,
  istNow,
  istDate,
  istHhmm,
  isWithinQuietHours,
} from '@alfanumrik/lib/whatsapp/ist';

describe('IST offset constant', () => {
  it('is fixed at +05:30 (330 minutes)', () => {
    expect(IST_UTC_OFFSET_MINUTES).toBe(330);
  });
});

describe('istDate / istHhmm — known UTC instants', () => {
  it('2026-07-29T19:30:00Z → IST 2026-07-30 01:00 (crosses midnight)', () => {
    const d = new Date('2026-07-29T19:30:00Z');
    expect(istDate(d)).toBe('2026-07-30');
    expect(istHhmm(d)).toBe(100);
  });

  it('18:29:59Z stays on the SAME IST civil date (23:59 IST)', () => {
    const d = new Date('2026-07-29T18:29:59Z');
    expect(istDate(d)).toBe('2026-07-29');
    expect(istHhmm(d)).toBe(2359);
  });

  it('18:30:00Z is exactly midnight IST of the NEXT civil date', () => {
    // The day_ist counter-reset boundary — the plan calls this out explicitly.
    const d = new Date('2026-07-29T18:30:00Z');
    expect(istDate(d)).toBe('2026-07-30');
    expect(istHhmm(d)).toBe(0);
  });

  it('16:00:00Z → 21:30 IST (quiet-hours start on the same date)', () => {
    const d = new Date('2026-07-29T16:00:00Z');
    expect(istDate(d)).toBe('2026-07-29');
    expect(istHhmm(d)).toBe(2130);
  });

  it('05:00:00Z → 10:30 IST mid-morning', () => {
    const d = new Date('2026-07-29T05:00:00Z');
    expect(istDate(d)).toBe('2026-07-29');
    expect(istHhmm(d)).toBe(1030);
  });

  it('crosses a month boundary correctly (2026-07-31T19:00Z → 2026-08-01 IST)', () => {
    const d = new Date('2026-07-31T19:00:00Z');
    expect(istDate(d)).toBe('2026-08-01');
    expect(istHhmm(d)).toBe(30);
  });

  it('crosses a year boundary correctly (2026-12-31T18:45Z → 2027-01-01 IST)', () => {
    const d = new Date('2026-12-31T18:45:00Z');
    expect(istDate(d)).toBe('2027-01-01');
    expect(istHhmm(d)).toBe(15);
  });

  it('istNow shifts the epoch by exactly +330 minutes', () => {
    const d = new Date('2026-07-29T12:00:00Z');
    expect(istNow(d).getTime() - d.getTime()).toBe(330 * 60_000);
  });
});

describe('isWithinQuietHours — wrap-around window 2130→0700', () => {
  const START = 2130;
  const END = 700;

  it.each([
    [2200, true, 'late evening inside'],
    [2359, true, 'just before midnight inside'],
    [0, true, 'midnight inside'],
    [300, true, '03:00 inside'],
    [659, true, '06:59 inside (end exclusive boundary - 1)'],
    [2130, true, 'start is INCLUSIVE'],
    [700, false, 'end is EXCLUSIVE'],
    [2129, false, 'one minute before start'],
    [701, false, 'one minute after end'],
    [1200, false, 'midday well outside'],
  ])('hhmm=%i → %s (%s)', (hhmm, expected) => {
    expect(isWithinQuietHours(hhmm, START, END)).toBe(expected);
  });
});

describe('isWithinQuietHours — non-wrapping window 0900→1700', () => {
  const START = 900;
  const END = 1700;

  it.each([
    [900, true, 'start inclusive'],
    [1200, true, 'inside'],
    [1659, true, 'end exclusive boundary - 1'],
    [1700, false, 'end exclusive'],
    [859, false, 'before start'],
    [2300, false, 'evening outside'],
    [0, false, 'midnight outside'],
  ])('hhmm=%i → %s (%s)', (hhmm, expected) => {
    expect(isWithinQuietHours(hhmm, START, END)).toBe(expected);
  });
});

describe('isWithinQuietHours — start === end means no quiet window', () => {
  it('always returns false, including AT the boundary value', () => {
    expect(isWithinQuietHours(900, 900, 900)).toBe(false);
    expect(isWithinQuietHours(0, 0, 0)).toBe(false);
    expect(isWithinQuietHours(2359, 2130, 2130)).toBe(false);
    expect(isWithinQuietHours(2130, 2130, 2130)).toBe(false);
  });
});
