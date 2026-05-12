import { describe, it, expect } from 'vitest';
import { updateMasteryBKT, DEFAULT_BKT_PARAMS } from './bkt';

describe('updateMasteryBKT', () => {
  it('first-correct from default prior → ~0.693', () => {
    expect(updateMasteryBKT(0.30, true)).toBeCloseTo(0.693, 2);
  });

  it('first-wrong from default prior → ~0.146', () => {
    expect(updateMasteryBKT(0.30, false)).toBeCloseTo(0.146, 2);
  });

  it('correct on mastered (0.95) → ~0.990', () => {
    expect(updateMasteryBKT(0.95, true)).toBeCloseTo(0.990, 2);
  });

  it('wrong on mastered (0.95) → ~0.733', () => {
    expect(updateMasteryBKT(0.95, false)).toBeCloseTo(0.733, 2);
  });

  it('converges above 0.97 after 5 corrects from default', () => {
    let p = 0.30;
    for (let i = 0; i < 5; i++) p = updateMasteryBKT(p, true);
    expect(p).toBeGreaterThan(0.97);
  });

  it('drops below 0.20 after 10 wrongs from 0.95', () => {
    let p = 0.95;
    for (let i = 0; i < 10; i++) p = updateMasteryBKT(p, false);
    expect(p).toBeLessThan(0.20);
  });

  it('crosses 0.85 after 2 corrects from default', () => {
    let p = 0.30;
    p = updateMasteryBKT(p, true);
    p = updateMasteryBKT(p, true);
    expect(p).toBeGreaterThanOrEqual(0.85);
  });

  it('idempotent (pure function) — same inputs → same output', () => {
    const a = updateMasteryBKT(0.42, true);
    const b = updateMasteryBKT(0.42, true);
    expect(a).toBe(b);
  });

  it('clamps upper — prior=1.0 + correct stays below 1', () => {
    const r = updateMasteryBKT(1.0, true);
    expect(r).toBeLessThan(1);
  });

  it('clamps lower — prior=0.0 + wrong stays above 0', () => {
    const r = updateMasteryBKT(0.0, false);
    expect(r).toBeGreaterThan(0);
  });

  it('exposes DEFAULT_BKT_PARAMS with the documented values', () => {
    expect(DEFAULT_BKT_PARAMS).toEqual({
      pInit: 0.30, pTransit: 0.10, pGuess: 0.20, pSlip: 0.10,
    });
  });
});
