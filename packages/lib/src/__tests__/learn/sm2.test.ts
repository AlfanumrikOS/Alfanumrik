/**
 * Canonical SM-2 module pins (Foxy North-Star Phase 3, E4/F10).
 *
 * These are the endpoint-parity cases ported from
 * apps/host/src/__tests__/state/learner-loop/review-grade.test.ts (which
 * keeps running unchanged against the grade endpoint's re-export — together
 * the two suites pin that the move was verbatim: same math, same clamps).
 * Plus initialCardParams() pins against the DB column defaults.
 */

import { describe, it, expect } from 'vitest';
import { applySm2, initialCardParams } from '../../learn/sm2';

describe('applySm2 (canonical module — parity with the grade endpoint math)', () => {
  it('quality 0 (forgot) — resets interval to 1, streak to 0', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 30, streak: 5, quality: 0 });
    expect(out.intervalDays).toBe(1);
    expect(out.streak).toBe(0);
  });

  it('quality 3 from streak 0 — interval 1, streak 1', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 1, streak: 0, quality: 3 });
    expect(out.intervalDays).toBe(1);
    expect(out.streak).toBe(1);
  });

  it('quality 4 from streak 1 — interval jumps to 6, streak 2', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 1, streak: 1, quality: 4 });
    expect(out.intervalDays).toBe(6);
    expect(out.streak).toBe(2);
  });

  it('quality 5 from streak 2 — interval = round(prev * newEase)', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 6, streak: 2, quality: 5 });
    // newEase for q=5 from 2.5: 2.5 + (0.1 - 0) = 2.6 → round(6 * 2.6) = 16
    expect(out.easeFactor).toBeCloseTo(2.6);
    expect(out.intervalDays).toBe(16);
    expect(out.streak).toBe(3);
  });

  it('ease floor is 1.3 (frozen param — F10, matches SQL RPC)', () => {
    // newEase = 1.3 + (0.1 - 5*(0.08 + 5*0.02)) = 0.5 → clamp to 1.3
    const out = applySm2({ easeFactor: 1.3, intervalDays: 1, streak: 0, quality: 0 });
    expect(out.easeFactor).toBe(1.3);
  });

  it('ease ceiling is 3.0 (frozen param)', () => {
    const out = applySm2({ easeFactor: 3.0, intervalDays: 100, streak: 50, quality: 5 });
    expect(out.easeFactor).toBe(3.0);
  });

  it('interval cap is 365 days (frozen param)', () => {
    const out = applySm2({ easeFactor: 3.0, intervalDays: 200, streak: 10, quality: 5 });
    expect(out.intervalDays).toBe(365);
  });

  it('streak cap is 100 (frozen param)', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 30, streak: 100, quality: 4 });
    expect(out.streak).toBe(100);
  });

  it('quality 4 does NOT reset interval when streak > 1', () => {
    const out = applySm2({ easeFactor: 2.5, intervalDays: 30, streak: 3, quality: 4 });
    expect(out.intervalDays).not.toBe(1);
    expect(out.intervalDays).toBe(Math.round(30 * out.easeFactor));
  });
});

describe('initialCardParams', () => {
  it('matches the spaced_repetition_cards / concept_mastery column defaults', () => {
    expect(initialCardParams()).toEqual({ easeFactor: 2.5, intervalDays: 1, streak: 0 });
  });

  it('feeds applySm2 the same first-review result as a raw new card', () => {
    const fresh = initialCardParams();
    const graded = applySm2({ ...fresh, quality: 4 });
    expect(graded.intervalDays).toBe(1); // first success from streak 0 → 1 day
    expect(graded.streak).toBe(1);
  });
});
