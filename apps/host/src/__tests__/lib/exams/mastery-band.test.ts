import { describe, it, expect } from 'vitest';
import { resolveExamReadinessBand, type MasteryBandInput } from '@alfanumrik/lib/exams/mastery-band';

/**
 * resolveExamReadinessBand() — pure relabel of concept_mastery.mastery_level
 * for the Wave B exam-schedule surface (packages/lib/src/exams/mastery-band.ts).
 *
 * Pins:
 *  1. Every known mastery_level maps to its documented band:
 *       mastered → exam_ready, proficient → getting_it,
 *       developing | beginner → shaky, not_started → new.
 *  2. Unknown / missing mastery_level falls back to classifying
 *     mastery_probability with the SAME cutoffs the live BKT writer uses
 *     (mirrored, not reinvented): >= 0.95 exam_ready, >= MASTERY_SECURE_MIN
 *     (0.70) getting_it, else shaky.
 *  3. Totally missing/malformed input (null, undefined, empty object, NaN
 *     probability) degrades to 'new' — never throws.
 */
describe('resolveExamReadinessBand', () => {
  describe('primary path — known mastery_level values', () => {
    it('mastered -> exam_ready', () => {
      expect(resolveExamReadinessBand({ mastery_level: 'mastered' })).toBe('exam_ready');
    });

    it('proficient -> getting_it', () => {
      expect(resolveExamReadinessBand({ mastery_level: 'proficient' })).toBe('getting_it');
    });

    it('developing -> shaky', () => {
      expect(resolveExamReadinessBand({ mastery_level: 'developing' })).toBe('shaky');
    });

    it('beginner -> shaky', () => {
      expect(resolveExamReadinessBand({ mastery_level: 'beginner' })).toBe('shaky');
    });

    it('not_started -> new', () => {
      expect(resolveExamReadinessBand({ mastery_level: 'not_started' })).toBe('new');
    });

    it('ignores mastery_probability when mastery_level is a known value (mastery_level wins)', () => {
      // A row that is 'mastered' by level but has a low/stale probability value
      // still resolves via the categorical level, not the numeric fallback.
      expect(
        resolveExamReadinessBand({ mastery_level: 'mastered', mastery_probability: 0.1 }),
      ).toBe('exam_ready');
      expect(
        resolveExamReadinessBand({ mastery_level: 'beginner', mastery_probability: 0.99 }),
      ).toBe('shaky');
    });
  });

  describe('defensive fallback — missing/unrecognised mastery_level', () => {
    it('falls back to mastery_probability >= 0.95 -> exam_ready', () => {
      expect(resolveExamReadinessBand({ mastery_probability: 0.95 })).toBe('exam_ready');
      expect(resolveExamReadinessBand({ mastery_probability: 0.99 })).toBe('exam_ready');
    });

    it('falls back to mastery_probability >= 0.70 (MASTERY_SECURE_MIN) -> getting_it', () => {
      expect(resolveExamReadinessBand({ mastery_probability: 0.7 })).toBe('getting_it');
      expect(resolveExamReadinessBand({ mastery_probability: 0.94 })).toBe('getting_it');
    });

    it('falls back to mastery_probability < 0.70 -> shaky', () => {
      expect(resolveExamReadinessBand({ mastery_probability: 0.69 })).toBe('shaky');
      expect(resolveExamReadinessBand({ mastery_probability: 0 })).toBe('shaky');
    });

    it('unrecognised mastery_level string still uses the probability fallback', () => {
      expect(
        resolveExamReadinessBand({ mastery_level: 'some_future_level', mastery_probability: 0.96 } as unknown as MasteryBandInput),
      ).toBe('exam_ready');
    });
  });

  describe('total function — never throws, degrades to new', () => {
    it('returns "new" for null input', () => {
      expect(resolveExamReadinessBand(null)).toBe('new');
    });

    it('returns "new" for undefined input', () => {
      expect(resolveExamReadinessBand(undefined)).toBe('new');
    });

    it('returns "new" for an empty object (no level, no probability)', () => {
      expect(resolveExamReadinessBand({})).toBe('new');
    });

    it('returns "new" when mastery_probability is null', () => {
      expect(resolveExamReadinessBand({ mastery_probability: null })).toBe('new');
    });

    it('returns "new" when mastery_probability is NaN', () => {
      expect(resolveExamReadinessBand({ mastery_probability: NaN })).toBe('new');
    });

    it('returns "new" when mastery_probability is not a number (defensive cast)', () => {
      expect(
        resolveExamReadinessBand({ mastery_probability: 'high' } as unknown as MasteryBandInput),
      ).toBe('new');
    });
  });
});
