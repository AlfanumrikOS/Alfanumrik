/**
 * Unit tests for src/lib/irt/fisher-info.ts
 *
 * Locks down the 2PL Fisher-info math against synthetic data with known
 * analytical properties:
 *   - When theta == b, P = 0.5 and Fisher info peaks at a^2 / 4.
 *   - As |theta - b| grows, P → 0 or 1 and Fisher info → 0.
 *   - Higher discrimination (a) = higher peak info at theta = b.
 *
 * Also pins the selection-score branching so any drift between TS and the
 * SQL RPC select_questions_by_irt_info shows up here.
 */

import { describe, it, expect } from 'vitest';
import {
  irt2plProb,
  irt2plFisherInfo,
  computeSelectionScore,
} from '@/lib/irt/fisher-info';

describe('irt2plProb', () => {
  it('returns 0.5 when theta equals b (regardless of a)', () => {
    expect(irt2plProb(0, 1, 0)).toBeCloseTo(0.5, 6);
    expect(irt2plProb(1.5, 2.5, 1.5)).toBeCloseTo(0.5, 6);
    expect(irt2plProb(-2, 0.5, -2)).toBeCloseTo(0.5, 6);
  });

  it('approaches 1 as theta >> b', () => {
    expect(irt2plProb(5, 1, 0)).toBeGreaterThan(0.99);
  });

  it('approaches 0 as theta << b', () => {
    expect(irt2plProb(-5, 1, 0)).toBeLessThan(0.01);
  });

  it('higher a sharpens the transition', () => {
    // At theta = 0.5, b = 0:
    //   a = 1: P ≈ 0.622
    //   a = 2: P ≈ 0.731
    //   a = 3: P ≈ 0.818
    expect(irt2plProb(0.5, 1, 0)).toBeLessThan(irt2plProb(0.5, 2, 0));
    expect(irt2plProb(0.5, 2, 0)).toBeLessThan(irt2plProb(0.5, 3, 0));
  });
});

describe('irt2plFisherInfo', () => {
  it('peaks at theta = b with value a^2 / 4', () => {
    // At theta = b, P = 0.5, P*(1-P) = 0.25, info = a^2 * 0.25
    expect(irt2plFisherInfo(0, 1.0, 0)).toBeCloseTo(0.25, 4);
    expect(irt2plFisherInfo(1, 2.0, 1)).toBeCloseTo(1.0, 4);
    expect(irt2plFisherInfo(-1, 0.5, -1)).toBeCloseTo(0.0625, 4);
  });

  it('decreases monotonically as |theta - b| grows', () => {
    const a = 1.5;
    const b = 0;
    const info0 = irt2plFisherInfo(0, a, b);     // peak
    const info1 = irt2plFisherInfo(1, a, b);     // 1 sigma off
    const info2 = irt2plFisherInfo(2, a, b);     // 2 sigma off
    expect(info0).toBeGreaterThan(info1);
    expect(info1).toBeGreaterThan(info2);
  });

  it('clips at extreme thetas (no division-by-zero)', () => {
    // P clipped to [0.001, 0.999] so info ≈ a^2 * 0.001 * 0.999 at extremes
    const info = irt2plFisherInfo(10, 1, 0);
    expect(info).toBeGreaterThan(0);
    expect(info).toBeLessThan(0.002); // clipped floor
    expect(Number.isFinite(info)).toBe(true);
  });

  it('higher a gives higher peak info', () => {
    // peak (theta = b) info scales as a^2
    expect(irt2plFisherInfo(0, 0.5, 0)).toBeCloseTo(0.0625, 4);
    expect(irt2plFisherInfo(0, 1.0, 0)).toBeCloseTo(0.25, 4);
    expect(irt2plFisherInfo(0, 2.0, 0)).toBeCloseTo(1.0, 4);
    expect(irt2plFisherInfo(0, 3.0, 0)).toBeCloseTo(2.25, 4);
  });
});

describe('computeSelectionScore — branch coverage matches SQL RPC', () => {
  const calibrated = {
    irt_a: 1.5,
    irt_b: 0.0,
    irt_calibration_n: 50,
    irt_difficulty: 0.0,
  };

  it("path 'fisher_info' when calibration_n >= 30 and (a, b) present", () => {
    const r = computeSelectionScore(0, calibrated);
    expect(r.path).toBe('fisher_info');
    // Fisher info at peak = a^2 / 4 = 0.5625, plus 0.5 calibrated bonus
    expect(r.score).toBeCloseTo(0.5625 + 0.5, 4);
  });

  it("path 'proxy_distance' when calibration_n < 30 but irt_difficulty present", () => {
    const r = computeSelectionScore(0.5, {
      irt_a: null,
      irt_b: null,
      irt_calibration_n: 5,
      irt_difficulty: 0.0,
    });
    expect(r.path).toBe('proxy_distance');
    // 1 / (1 + 0.5) = 0.6667
    expect(r.score).toBeCloseTo(2 / 3, 4);
  });

  it("path 'uncalibrated' when neither calibrated nor proxy", () => {
    const r = computeSelectionScore(0, {
      irt_a: null,
      irt_b: null,
      irt_calibration_n: 0,
      irt_difficulty: null,
    });
    expect(r.path).toBe('uncalibrated');
    expect(r.score).toBe(0.1);
  });

  it("calibrated bonus ensures fisher_info wins ties vs proxy", () => {
    const fisher = computeSelectionScore(0, calibrated);
    const proxy = computeSelectionScore(0, {
      irt_a: null,
      irt_b: null,
      irt_calibration_n: 5,
      irt_difficulty: 0.0,
    });
    expect(fisher.score).toBeGreaterThan(proxy.score);
  });
});
