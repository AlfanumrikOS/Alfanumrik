/**
 * Foxy personality lines — unit tests.
 *
 * Covers the random-tier picker logic in src/lib/foxy-lines.ts.
 * Math.random is stubbed to make tier + index selection deterministic.
 *
 * Bilingual contract (P7): every line tier returns localised text when isHi
 * is set; never falls back to the wrong language silently.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getCorrectLine,
  getWrongLine,
  getSessionCompleteLine,
} from '@/lib/foxy-lines';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getCorrectLine', () => {
  it('returns the first English line in tier 0 for streak <= 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // index 0
    const line = getCorrectLine(1, false);
    expect(line).toBe('Nice!');
  });

  it('returns Hindi when isHi=true (P7)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const line = getCorrectLine(1, true);
    expect(line).toBe('बढ़िया!');
  });

  it('uses tier 1 for streak 2-3', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getCorrectLine(2, false)).toBe("You're rolling!");
    expect(getCorrectLine(3, false)).toBe("You're rolling!");
  });

  it('uses tier 2 for streak 4-5', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getCorrectLine(4, false)).toBe('On fire!');
    expect(getCorrectLine(5, false)).toBe('On fire!');
  });

  it('uses tier 3 (max) for streak 6+', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getCorrectLine(6, false)).toBe('Incredible streak!');
    expect(getCorrectLine(99, false)).toBe('Incredible streak!');
  });

  it('returns a non-empty string for streak 0 (boundary)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const line = getCorrectLine(0, false);
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });
});

describe('getWrongLine', () => {
  it('returns first-wrong tier 0 for wrongStreak <= 1', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getWrongLine(1, false)).toBe("Close! Let's see why.");
  });

  it('returns repeated-wrong tier 1 for wrongStreak >= 2', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getWrongLine(2, false)).toBe("It's okay, you're learning.");
    expect(getWrongLine(5, false)).toBe("It's okay, you're learning.");
  });

  it('returns Hindi when isHi=true', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getWrongLine(1, true)).toBe('करीब! चलो देखते हैं क्यों।');
  });

  it('never mocks the student — all wrong lines stay encouraging', () => {
    // Sample every index of every tier in both languages and confirm none
    // contain mocking words. This guards a product invariant: P12 (AI safety,
    // age-appropriate) — the wrong-answer lines are part of Foxy's voice.
    const banned = [/stupid/i, /dumb/i, /idiot/i, /loser/i, /failure/i];
    for (let r = 0; r < 1; r += 0.1) {
      vi.spyOn(Math, 'random').mockReturnValue(r);
      for (const wrongStreak of [1, 5]) {
        for (const isHi of [false, true]) {
          const line = getWrongLine(wrongStreak, isHi);
          for (const re of banned) {
            expect(line).not.toMatch(re);
          }
        }
      }
    }
  });
});

describe('getSessionCompleteLine', () => {
  it('returns the first English session-complete line', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getSessionCompleteLine(false)).toBe(
      'Great session! You showed up, and that matters.',
    );
  });

  it('returns Hindi when isHi=true', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(getSessionCompleteLine(true)).toBe(
      'बढ़िया सत्र! तुमने मेहनत की, यही मायने रखता है।',
    );
  });

  it('returns a non-empty string at the array upper bound', () => {
    // Math.random returns [0,1); index = floor(0.999 * 3) = 2 (last entry)
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const line = getSessionCompleteLine(false);
    expect(typeof line).toBe('string');
    expect(line.length).toBeGreaterThan(0);
  });
});
