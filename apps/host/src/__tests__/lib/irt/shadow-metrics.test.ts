/**
 * Unit tests for packages/lib/src/irt/shadow-metrics.ts (Phase 3 E2).
 *
 * Pure math — hand-computed fixtures only, no mocks, no I/O.
 */
import { describe, it, expect } from 'vitest';
import { spearmanRank, topKOverlap } from '@alfanumrik/lib/irt/shadow-metrics';

describe('spearmanRank', () => {
  it('returns 1 for a perfectly monotone-increasing relationship', () => {
    expect(spearmanRank([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 12);
  });

  it('returns -1 for a perfectly inverted relationship', () => {
    expect(spearmanRank([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 12);
  });

  it('is order-of-values-based, not index-based (permutation invariant to monotone maps)', () => {
    // Non-linear but monotone transform preserves ranks → rho = 1.
    expect(spearmanRank([1, 5, 9], [0.01, 100, 1e6])).toBeCloseTo(1, 12);
  });

  it('hand-computed no-tie fixture: a=[1,2,3], b=[2,1,3] → rho = 0.5', () => {
    // Tie-free shortcut: rho = 1 - 6·Σd²/(n(n²-1)); d = [-1, 1, 0] → Σd² = 2
    // → 1 - 12/24 = 0.5. The rank-Pearson general form must agree.
    expect(spearmanRank([1, 2, 3], [2, 1, 3])).toBeCloseTo(0.5, 12);
  });

  it('hand-computed TIE fixture: a=[1,2,2,3], b=[1,2,3,4] → rho = sqrt(0.9)', () => {
    // Average ranks: a → [1, 2.5, 2.5, 4]; b → [1, 2, 3, 4].
    // cov = 4.5, varA = 4.5, varB = 5 → rho = 4.5/sqrt(22.5) = sqrt(0.9).
    expect(spearmanRank([1, 2, 2, 3], [1, 2, 3, 4])).toBeCloseTo(Math.sqrt(0.9), 12);
  });

  it('returns null when a vector has zero rank variance (all tied)', () => {
    expect(spearmanRank([5, 5, 5], [1, 2, 3])).toBeNull();
    expect(spearmanRank([1, 2, 3], [7, 7, 7])).toBeNull();
  });

  it('returns null on length mismatch or fewer than 2 points', () => {
    expect(spearmanRank([1, 2], [1, 2, 3])).toBeNull();
    expect(spearmanRank([1], [1])).toBeNull();
    expect(spearmanRank([], [])).toBeNull();
  });

  it('returns null on non-finite inputs', () => {
    expect(spearmanRank([1, NaN], [1, 2])).toBeNull();
    expect(spearmanRank([1, 2], [Infinity, 2])).toBeNull();
  });
});

describe('topKOverlap', () => {
  it('identical top-K sets → 1', () => {
    expect(topKOverlap(['a', 'b', 'c'], ['a', 'b', 'c'], 3)).toBe(1);
    // Order within the top-K does not matter (set semantics).
    expect(topKOverlap(['a', 'b', 'c'], ['c', 'a', 'b'], 3)).toBe(1);
  });

  it('disjoint top-K sets → 0', () => {
    expect(topKOverlap(['a', 'b'], ['c', 'd'], 2)).toBe(0);
  });

  it('hand-computed Jaccard: {a,b,c,d} vs {c,d,e,f} at k=4 → 2/6', () => {
    expect(topKOverlap(['a', 'b', 'c', 'd'], ['c', 'd', 'e', 'f'], 4)).toBeCloseTo(1 / 3, 12);
  });

  it('only the top-K prefix counts — items beyond k are ignored', () => {
    // Top-2 of A = {a,b}; top-2 of B = {b,x}. Intersection {b}, union {a,b,x}.
    expect(topKOverlap(['a', 'b', 'c'], ['b', 'x', 'a'], 2)).toBeCloseTo(1 / 3, 12);
  });

  it('lists shorter than k use their full length (top-K of 3 items is those 3)', () => {
    expect(topKOverlap(['a', 'b', 'c'], ['a', 'b', 'c'], 10)).toBe(1);
    expect(topKOverlap(['a'], ['a'], 5)).toBe(1);
  });

  it('collapses duplicate ids within a list (set semantics)', () => {
    expect(topKOverlap(['a', 'a', 'b'], ['a', 'b'], 3)).toBe(1);
  });

  it('returns null for empty lists or non-positive k', () => {
    expect(topKOverlap([], ['a'], 5)).toBeNull();
    expect(topKOverlap(['a'], [], 5)).toBeNull();
    expect(topKOverlap(['a'], ['a'], 0)).toBeNull();
    expect(topKOverlap(['a'], ['a'], -1)).toBeNull();
  });
});
