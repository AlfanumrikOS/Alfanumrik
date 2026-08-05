// src/__tests__/eval/irt/metrics.test.ts
//
// Phase 3 E2 — IRT shadow-eval harness metrics (eval/irt/harness/metrics.ts).
// Pure/offline lane: no DB, no LLM, no network. Relative import resolves via
// the vitest `(../)+eval/` alias to the repo-root eval/ directory.

import { describe, it, expect } from 'vitest';
import {
  median,
  auc,
  brier,
  summariseShadowSamples,
  compareModels,
  type CalibratedResponseRow,
  type ShadowSampleRow,
} from '../../../../eval/irt/harness/metrics';

describe('median', () => {
  it('odd count → middle value', () => {
    expect(median([3, 1, 2])).toBe(2);
  });
  it('even count → mean of the middle two', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
  it('ignores null/undefined/NaN entries', () => {
    expect(median([null, 5, undefined, NaN, 1])).toBe(3);
  });
  it('empty / all-null → null', () => {
    expect(median([])).toBeNull();
    expect(median([null, undefined])).toBeNull();
  });
});

describe('auc (Mann-Whitney, tie-aware)', () => {
  it('perfect separation → 1', () => {
    expect(
      auc([
        { label: true, p: 0.9 },
        { label: true, p: 0.8 },
        { label: false, p: 0.3 },
        { label: false, p: 0.2 },
      ]),
    ).toBe(1);
  });

  it('perfectly inverted → 0', () => {
    expect(
      auc([
        { label: true, p: 0.1 },
        { label: false, p: 0.9 },
      ]),
    ).toBe(0);
  });

  it('hand-computed pairwise fixture → 0.75', () => {
    // pos p = {0.9, 0.4}; neg p = {0.5, 0.2}. Concordant pairs: (0.9,0.5)✓,
    // (0.9,0.2)✓, (0.4,0.5)✗, (0.4,0.2)✓ → 3/4.
    expect(
      auc([
        { label: true, p: 0.9 },
        { label: true, p: 0.4 },
        { label: false, p: 0.5 },
        { label: false, p: 0.2 },
      ]),
    ).toBeCloseTo(0.75, 12);
  });

  it('full tie between classes → 0.5 (average-rank handling)', () => {
    expect(
      auc([
        { label: true, p: 0.5 },
        { label: false, p: 0.5 },
      ]),
    ).toBeCloseTo(0.5, 12);
  });

  it('single class → null (undefined AUC)', () => {
    expect(auc([{ label: true, p: 0.9 }])).toBeNull();
    expect(
      auc([
        { label: false, p: 0.1 },
        { label: false, p: 0.2 },
      ]),
    ).toBeNull();
  });
});

describe('brier', () => {
  it('perfect confident predictions → 0', () => {
    expect(
      brier([
        { label: true, p: 1 },
        { label: false, p: 0 },
      ]),
    ).toBe(0);
  });
  it('coin-flip predictions → 0.25', () => {
    expect(
      brier([
        { label: true, p: 0.5 },
        { label: false, p: 0.5 },
      ]),
    ).toBeCloseTo(0.25, 12);
  });
  it('hand-computed: [(1, 0.8), (0, 0.4)] → (0.04 + 0.16)/2 = 0.10', () => {
    expect(
      brier([
        { label: true, p: 0.8 },
        { label: false, p: 0.4 },
      ]),
    ).toBeCloseTo(0.1, 12);
  });
  it('empty → null', () => {
    expect(brier([])).toBeNull();
  });
});

describe('summariseShadowSamples', () => {
  const row = (
    rho: number | null,
    t5: number | null,
    t10: number | null,
    nc = 10,
    ncal = 4,
  ): ShadowSampleRow => ({
    spearmanRho: rho,
    top5Overlap: t5,
    top10Overlap: t10,
    nCandidates: nc,
    nCalibrated: ncal,
  });

  it('aggregates medians and totals; null metrics are skipped not zeroed', () => {
    const s = summariseShadowSamples([
      row(0.9, 1, 0.8),
      row(0.5, 0.6, 0.6),
      row(null, 0.2, null),
    ]);
    expect(s.nSamples).toBe(3);
    expect(s.medianSpearman).toBeCloseTo(0.7, 12); // median of [0.5, 0.9]
    expect(s.medianTop5Overlap).toBeCloseTo(0.6, 12);
    expect(s.medianTop10Overlap).toBeCloseTo(0.7, 12); // median of [0.6, 0.8]
    expect(s.totalCandidatesScored).toBe(30);
    expect(s.totalCalibratedScored).toBe(12);
  });

  it('empty input → nulls and zeros', () => {
    const s = summariseShadowSamples([]);
    expect(s.nSamples).toBe(0);
    expect(s.medianSpearman).toBeNull();
    expect(s.totalCandidatesScored).toBe(0);
  });
});

describe('compareModels — paired 2PL vs proxy fit', () => {
  const r = (
    studentId: string,
    correct: boolean,
    theta: number,
    a: number,
    b: number,
    d: number,
  ): CalibratedResponseRow => ({
    studentId,
    correct,
    theta,
    irtA: a,
    irtB: b,
    irtDifficulty: d,
  });

  it('counts distinct students and drops rows with non-finite fields before scoring', () => {
    const rows = [
      r('s1', true, 0.5, 1.2, 0.0, 0.1),
      r('s1', false, 0.5, 0.8, 1.0, 0.9),
      r('s2', true, -0.2, 1.0, -0.5, -0.4),
      r('s3', true, NaN, 1.0, 0.0, 0.0), // dropped: theta NaN
    ];
    const cmp = compareModels(rows);
    expect(cmp.n).toBe(3);
    expect(cmp.nStudents).toBe(2); // s1, s2 (s3 dropped)
  });

  it('2PL clearly better when correctness tracks a*(theta-b) but not the proxy difficulty', () => {
    // Construct responses where the 2PL geometry separates outcomes and the
    // proxy difficulty is ANTI-correlated with them.
    const rows: CalibratedResponseRow[] = [
      // Correct answers: theta far above b (2PL p high) but proxy d far above
      // theta (proxy p low → proxy predicts wrong).
      r('s1', true, 1.0, 2.0, -1.0, 3.0),
      r('s2', true, 1.2, 2.0, -0.8, 3.2),
      r('s3', true, 0.8, 2.0, -1.2, 2.8),
      // Wrong answers: theta far below b (2PL p low) but proxy d far below
      // theta (proxy p high → proxy predicts correct).
      r('s4', false, -1.0, 2.0, 1.0, -3.0),
      r('s5', false, -1.2, 2.0, 0.8, -3.2),
      r('s6', false, -0.8, 2.0, 1.2, -2.8),
    ];
    const cmp = compareModels(rows);
    expect(cmp.auc2pl).toBe(1); // 2PL separates perfectly
    expect(cmp.aucProxy).toBe(0); // proxy perfectly inverted
    expect(cmp.deltaAUC).toBe(1);
    expect(cmp.brier2pl!).toBeLessThan(cmp.brierProxy!);
    expect(cmp.deltaBrier!).toBeLessThan(0);
  });

  it('empty input → nulls, zero counts', () => {
    const cmp = compareModels([]);
    expect(cmp.n).toBe(0);
    expect(cmp.nStudents).toBe(0);
    expect(cmp.auc2pl).toBeNull();
    expect(cmp.deltaAUC).toBeNull();
    expect(cmp.deltaBrier).toBeNull();
  });
});
