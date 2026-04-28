/**
 * scoring.ts — direct unit tests.
 *
 * src/lib/scoring.ts is the single source of truth for product invariants
 * P1 (Score Accuracy) and P2 (XP Economy). It is imported by xp-ledger
 * parity tests but the module itself has no dedicated test file. This file
 * exercises both pure functions across happy paths, boundary conditions,
 * and degenerate inputs.
 *
 * P1: score_percent = Math.round((correct / total) * 100)
 * P2: xp = (correct * 10) + (>=80 ? 20 : 0) + (===100 ? 50 : 0)
 */

import { describe, it, expect } from 'vitest';
import { calculateScorePercent, calculateQuizXP } from '@/lib/scoring';

describe('calculateScorePercent (P1: Score Accuracy)', () => {
  it('returns 0 when total is 0 (avoids division by zero)', () => {
    expect(calculateScorePercent(0, 0)).toBe(0);
  });

  it('returns 0 when total is negative (treated as no quiz)', () => {
    expect(calculateScorePercent(0, -1)).toBe(0);
  });

  it('returns 100 for a perfect score', () => {
    expect(calculateScorePercent(10, 10)).toBe(100);
  });

  it('returns 0 when no answers correct', () => {
    expect(calculateScorePercent(0, 10)).toBe(0);
  });

  it('rounds 70% from 7/10', () => {
    expect(calculateScorePercent(7, 10)).toBe(70);
  });

  it('rounds 1/3 to 33 (not 33.33)', () => {
    // P1 contract: Math.round, not Math.floor / Math.ceil
    expect(calculateScorePercent(1, 3)).toBe(33);
  });

  it('rounds 2/3 to 67 (banker-like rounding via Math.round)', () => {
    expect(calculateScorePercent(2, 3)).toBe(67);
  });

  it('handles 1-question quiz: 0 correct → 0%', () => {
    expect(calculateScorePercent(0, 1)).toBe(0);
  });

  it('handles 1-question quiz: 1 correct → 100%', () => {
    expect(calculateScorePercent(1, 1)).toBe(100);
  });

  it('handles half: 5/10 → 50%', () => {
    expect(calculateScorePercent(5, 10)).toBe(50);
  });

  it('rounds 4/9 = 44.44 to 44', () => {
    expect(calculateScorePercent(4, 9)).toBe(44);
  });

  it('rounds 5/9 = 55.56 to 56', () => {
    expect(calculateScorePercent(5, 9)).toBe(56);
  });
});

describe('calculateQuizXP (P2: XP Economy)', () => {
  it('returns 0 XP for 0 correct, 0% score', () => {
    expect(calculateQuizXP(0, 0)).toBe(0);
  });

  it('awards 10 XP per correct, no bonus below 80%', () => {
    // 7 correct, 70% → 7 * 10 = 70 XP exactly (no high-score bonus)
    expect(calculateQuizXP(7, 70)).toBe(70);
  });

  it('awards high-score bonus at exactly 80%', () => {
    // 8 correct, 80% → (8 * 10) + 20 = 100 XP (bonus is >= 80, inclusive)
    expect(calculateQuizXP(8, 80)).toBe(100);
  });

  it('does NOT award high-score bonus at 79% (boundary just below)', () => {
    // 7 correct, 79% (e.g. 7/9 = 78%, or 79/100) → no bonus
    expect(calculateQuizXP(7, 79)).toBe(70);
  });

  it('awards high-score + perfect bonus only at exactly 100%', () => {
    // 10 correct, 100% → (10 * 10) + 20 + 50 = 170 XP
    expect(calculateQuizXP(10, 100)).toBe(170);
  });

  it('awards high-score bonus at 99% but NOT perfect bonus', () => {
    // 9 correct, 99% → (9 * 10) + 20 = 110 XP (no perfect bonus)
    expect(calculateQuizXP(9, 99)).toBe(110);
  });

  it('awards high-score bonus at 90%', () => {
    expect(calculateQuizXP(9, 90)).toBe(110);
  });

  it('handles 1-question quiz: 1 correct, 100% → 10 + 20 + 50 = 80 XP', () => {
    expect(calculateQuizXP(1, 100)).toBe(80);
  });

  it('handles 1-question quiz: 0 correct, 0% → 0 XP', () => {
    expect(calculateQuizXP(0, 0)).toBe(0);
  });

  it('treats 100.0 as exactly 100 (perfect bonus fires)', () => {
    // Defensive: scorePct is always a rounded integer per P1, but verify
    // strict equality semantics anyway.
    expect(calculateQuizXP(5, 100)).toBe(50 + 20 + 50);
  });
});
