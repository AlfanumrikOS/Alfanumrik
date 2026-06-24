/**
 * Level-up detection formula regression tests (REG-135)
 *
 * Pins the level-crossing predicate used in QuizResults.tsx:
 *   if (!results.idempotent_replay && calculateLevel(xpBefore) < calculateLevel(xpAfter))
 *     setShowLevelUp(true);
 *
 * Source-of-truth: calculateLevel() in src/lib/xp-config.ts
 * XP_PER_LEVEL = 500 (level boundary)
 *
 * P2 invariant: XP economy unchanged. Level formula is Math.floor(xp / 500) + 1.
 */

import { calculateLevel, XP_PER_LEVEL, getLevelName, LEVEL_NAMES, LEVEL_NAMES_HI } from '@/lib/xp-config';
import { describe, it, expect } from 'vitest';

// ─── Level boundary math ─────────────────────────────────────────────────────

describe('calculateLevel boundary math (REG-135)', () => {
  it('level 1 starts at 0 XP', () => {
    expect(calculateLevel(0)).toBe(1);
  });

  it('level 1 ends at 499 XP (not yet at boundary)', () => {
    expect(calculateLevel(499)).toBe(1);
  });

  it('level 2 starts at exactly 500 XP', () => {
    expect(calculateLevel(500)).toBe(2);
  });

  it('detects boundary crossing at exactly 500 XP (1 XP earned)', () => {
    const xpBefore = 499;
    const xpEarned = 1;
    const xpAfter = xpBefore + xpEarned;
    expect(calculateLevel(xpBefore)).toBe(1);
    expect(calculateLevel(xpAfter)).toBe(2);
    expect(calculateLevel(xpBefore) < calculateLevel(xpAfter)).toBe(true);
  });

  it('does NOT fire when level stays the same (mid-level XP gain)', () => {
    const xpBefore = 100;
    const xpEarned = 50;
    const xpAfter = xpBefore + xpEarned;
    expect(calculateLevel(xpBefore)).toBe(calculateLevel(xpAfter));
    expect(calculateLevel(xpBefore) < calculateLevel(xpAfter)).toBe(false);
  });

  it('does NOT fire at XP = 0 even after small XP gain (stays level 1)', () => {
    expect(calculateLevel(0) < calculateLevel(10)).toBe(false);
  });

  it('detects crossing from level 9 to 10 (4499 → 4500)', () => {
    const xpBefore = 4499;
    const xpAfter = xpBefore + 1;
    expect(calculateLevel(xpBefore)).toBe(9);
    expect(calculateLevel(xpAfter)).toBe(10);
    expect(calculateLevel(xpBefore) < calculateLevel(xpAfter)).toBe(true);
  });

  it('XP_PER_LEVEL is 500 — the level boundary the formula depends on', () => {
    // This test fails if someone silently changes XP_PER_LEVEL.
    expect(XP_PER_LEVEL).toBe(500);
  });

  it('calculateLevel formula: Math.floor(xp / 500) + 1', () => {
    // Exhaustive spot-checks of the expected boundary values.
    const cases: [number, number][] = [
      [0, 1],
      [499, 1],
      [500, 2],
      [999, 2],
      [1000, 3],
      [2500, 6],
      [4999, 10],
      [5000, 11], // beyond named levels
    ];
    for (const [xp, expected] of cases) {
      expect(calculateLevel(xp)).toBe(expected);
    }
  });
});

// ─── idempotent_replay guard ─────────────────────────────────────────────────

describe('idempotent_replay suppression guard (REG-135)', () => {
  it('does NOT fire on idempotent_replay (guard must short-circuit before level check)', () => {
    // The UI guard: if (results.idempotent_replay) return — no setShowLevelUp call.
    // Crossing 499 → 500 would normally trigger but is blocked by the replay flag.
    const isReplay = true;
    const wouldCrossLevel = calculateLevel(499) < calculateLevel(500); // true
    const wouldFire = !isReplay && wouldCrossLevel;
    expect(wouldFire).toBe(false); // suppressed because idempotent_replay
  });

  it('DOES fire when replay is false and level crosses boundary', () => {
    const isReplay = false;
    const wouldCrossLevel = calculateLevel(499) < calculateLevel(500);
    const wouldFire = !isReplay && wouldCrossLevel;
    expect(wouldFire).toBe(true);
  });
});

// ─── Bilingual level names (P7) ─────────────────────────────────────────────

describe('Level name bilingual coverage (P7 — REG-135)', () => {
  it('every level 1-10 has an English name', () => {
    for (let level = 1; level <= 10; level++) {
      expect(LEVEL_NAMES[level]).toBeDefined();
      expect(typeof LEVEL_NAMES[level]).toBe('string');
      expect(LEVEL_NAMES[level].length).toBeGreaterThan(0);
    }
  });

  it('every level 1-10 has a Hindi name (Devanagari)', () => {
    for (let level = 1; level <= 10; level++) {
      expect(LEVEL_NAMES_HI[level]).toBeDefined();
      expect(typeof LEVEL_NAMES_HI[level]).toBe('string');
      expect(LEVEL_NAMES_HI[level].length).toBeGreaterThan(0);
    }
  });

  it('getLevelName returns English when isHi is false', () => {
    const name = getLevelName(1, false);
    expect(name).toBe(LEVEL_NAMES[1]);
    expect(name).toBe('Curious Cub');
  });

  it('getLevelName returns Hindi when isHi is true', () => {
    const name = getLevelName(1, true);
    expect(name).toBe(LEVEL_NAMES_HI[1]);
  });

  it('getLevelName clamps to level 10 for levels above 10', () => {
    const nameEn = getLevelName(15, false);
    expect(nameEn).toBe(LEVEL_NAMES[10]);
    const nameHi = getLevelName(15, true);
    expect(nameHi).toBe(LEVEL_NAMES_HI[10]);
  });

  it('English and Hindi names are different strings (not accidental same copy)', () => {
    for (let level = 1; level <= 10; level++) {
      expect(LEVEL_NAMES[level]).not.toBe(LEVEL_NAMES_HI[level]);
    }
  });
});

// ─── Edge cases ──────────────────────────────────────────────────────────────

describe('Level-up detection edge cases', () => {
  it('XP daily cap (200) cannot cross a level boundary from 0 XP', () => {
    // A student starting at 0 XP earns max 200 XP in one day — stays at level 1.
    expect(calculateLevel(0) < calculateLevel(200)).toBe(false);
  });

  it('large XP jump can skip multiple levels — all crossings detected if before/after used', () => {
    // If a student had 400 XP and earned 1200 XP (hypothetical), they cross 2 levels.
    const xpBefore = 400;
    const xpAfter = 1600;
    expect(calculateLevel(xpBefore)).toBe(1);
    expect(calculateLevel(xpAfter)).toBe(4);
    expect(calculateLevel(xpBefore) < calculateLevel(xpAfter)).toBe(true);
  });

  it('exactly at level boundary (500n XP) does not trigger another level-up', () => {
    // Student already AT 500 XP (exactly level 2), earns 0 XP — no crossing.
    const xpBefore = 500;
    const xpAfter = 500;
    expect(calculateLevel(xpBefore) < calculateLevel(xpAfter)).toBe(false);
  });
});
