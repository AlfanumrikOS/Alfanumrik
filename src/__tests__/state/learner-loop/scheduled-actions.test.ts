/**
 * Phase 3c tests — pure scheduled-actions bucket helpers.
 *
 * IST date math is finicky (cross-day at 18:30 UTC, ISO weeks start
 * Monday, month rollover at IST midnight). These tests pin the
 * boundaries so the same wall-clock moment always maps to the same
 * scheduled_actions row regardless of where the server runs.
 */

import { describe, it, expect } from 'vitest';
import {
  dayBucketIst,
  weekBucketIst,
  monthBucketIst,
  bucketForHorizon,
  expiresAtForHorizon,
} from '../../../lib/state/learner-loop/scheduled-actions';

// ─── dayBucketIst ────────────────────────────────────────────────────

describe('dayBucketIst', () => {
  it('noon UTC on a Wednesday in May → same calendar date in IST', () => {
    // 2026-05-13T12:00:00Z = 2026-05-13T17:30 IST
    expect(dayBucketIst(new Date('2026-05-13T12:00:00.000Z'))).toBe('2026-05-13');
  });

  it('20:00 UTC → next IST calendar day (UTC+5:30 crosses midnight at 18:30Z)', () => {
    // 2026-05-13T20:00Z = 2026-05-14T01:30 IST
    expect(dayBucketIst(new Date('2026-05-13T20:00:00.000Z'))).toBe('2026-05-14');
  });

  it('00:00 UTC → previous IST calendar day', () => {
    // 2026-05-13T00:00Z = 2026-05-13T05:30 IST — still same day
    expect(dayBucketIst(new Date('2026-05-13T00:00:00.000Z'))).toBe('2026-05-13');
  });

  it('IST midnight boundary: 18:29Z is the previous day; 18:30Z is the next', () => {
    expect(dayBucketIst(new Date('2026-05-13T18:29:59.000Z'))).toBe('2026-05-13');
    expect(dayBucketIst(new Date('2026-05-13T18:30:00.000Z'))).toBe('2026-05-14');
  });
});

// ─── weekBucketIst ───────────────────────────────────────────────────

describe('weekBucketIst', () => {
  it('Monday → that same Monday', () => {
    // 2026-05-11 is a Monday. Pick noon IST (06:30Z).
    expect(weekBucketIst(new Date('2026-05-11T06:30:00.000Z'))).toBe('2026-05-11');
  });

  it('Wednesday → previous Monday', () => {
    // 2026-05-13 is a Wednesday.
    expect(weekBucketIst(new Date('2026-05-13T06:30:00.000Z'))).toBe('2026-05-11');
  });

  it('Sunday → previous Monday (6 days back, NOT next Monday)', () => {
    // 2026-05-17 is a Sunday. ISO week ends Sunday — that Sunday
    // belongs to the week starting 2026-05-11.
    expect(weekBucketIst(new Date('2026-05-17T06:30:00.000Z'))).toBe('2026-05-11');
  });

  it('crosses month boundary correctly', () => {
    // 2026-06-01 is a Monday. 2026-05-31 is a Sunday.
    expect(weekBucketIst(new Date('2026-06-01T06:30:00.000Z'))).toBe('2026-06-01');
    expect(weekBucketIst(new Date('2026-05-31T06:30:00.000Z'))).toBe('2026-05-25');
  });
});

// ─── monthBucketIst ──────────────────────────────────────────────────

describe('monthBucketIst', () => {
  it('any day in May → 2026-05-01', () => {
    expect(monthBucketIst(new Date('2026-05-01T06:30:00.000Z'))).toBe('2026-05-01');
    expect(monthBucketIst(new Date('2026-05-15T06:30:00.000Z'))).toBe('2026-05-01');
    expect(monthBucketIst(new Date('2026-05-31T06:30:00.000Z'))).toBe('2026-05-01');
  });

  it('month rollover happens at IST midnight, not UTC midnight', () => {
    // 2026-05-31T20:00Z = 2026-06-01T01:30 IST → June bucket
    expect(monthBucketIst(new Date('2026-05-31T20:00:00.000Z'))).toBe('2026-06-01');
    // 2026-05-31T18:29Z = 2026-05-31T23:59 IST → still May
    expect(monthBucketIst(new Date('2026-05-31T18:29:00.000Z'))).toBe('2026-05-01');
  });
});

// ─── bucketForHorizon ────────────────────────────────────────────────

describe('bucketForHorizon', () => {
  const now = new Date('2026-05-13T06:30:00.000Z'); // Wednesday noon IST

  it('dispatches to daily', () => {
    expect(bucketForHorizon('daily', now)).toBe('2026-05-13');
  });
  it('dispatches to weekly', () => {
    expect(bucketForHorizon('weekly', now)).toBe('2026-05-11');
  });
  it('dispatches to monthly', () => {
    expect(bucketForHorizon('monthly', now)).toBe('2026-05-01');
  });
});

// ─── expiresAtForHorizon ─────────────────────────────────────────────

describe('expiresAtForHorizon', () => {
  it('daily expires at next IST midnight', () => {
    const now = new Date('2026-05-13T06:30:00.000Z'); // Wed 12:00 IST
    const expiresAt = expiresAtForHorizon('daily', now);
    // Next IST midnight = 2026-05-14 00:00 IST = 2026-05-13T18:30:00Z
    expect(expiresAt).toBe('2026-05-13T18:30:00.000Z');
  });

  it('weekly expires at next Monday IST midnight', () => {
    const now = new Date('2026-05-13T06:30:00.000Z'); // Wed
    // Next Monday = 2026-05-18 00:00 IST = 2026-05-17T18:30:00Z
    expect(expiresAtForHorizon('weekly', now)).toBe('2026-05-17T18:30:00.000Z');
  });

  it('weekly from Sunday expires at next-day Monday IST midnight', () => {
    const now = new Date('2026-05-17T06:30:00.000Z'); // Sunday
    // Next Monday = 2026-05-18 00:00 IST = 2026-05-17T18:30:00Z
    expect(expiresAtForHorizon('weekly', now)).toBe('2026-05-17T18:30:00.000Z');
  });

  it('monthly expires at first-of-next-month IST midnight', () => {
    const now = new Date('2026-05-13T06:30:00.000Z');
    // First of June IST = 2026-06-01 00:00 IST = 2026-05-31T18:30:00Z
    expect(expiresAtForHorizon('monthly', now)).toBe('2026-05-31T18:30:00.000Z');
  });

  it('all expires_at values are strictly after `now`', () => {
    const now = new Date('2026-05-13T06:30:00.000Z');
    for (const h of ['daily', 'weekly', 'monthly'] as const) {
      const expiresAt = Date.parse(expiresAtForHorizon(h, now));
      expect(expiresAt).toBeGreaterThan(now.getTime());
    }
  });
});
