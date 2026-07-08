/**
 * Unit tests for normalizeSlug() exported from src/lib/school-provisioning.ts.
 *
 * Pure function — no mocks, no DB, no network. Deterministic in all environments.
 * Covers the four documented normalization rules and five representative examples
 * from the JSDoc header in school-provisioning.ts.
 */

import { describe, it, expect } from 'vitest';
import { normalizeSlug } from '@alfanumrik/lib/school-provisioning';

describe('normalizeSlug()', () => {
  describe('representative examples from JSDoc', () => {
    it('"Delhi Public School" → "delhi-public-school"', () => {
      expect(normalizeSlug('Delhi Public School')).toBe('delhi-public-school');
    });

    it('"St. Xavier\'s (Bandra)" → "st-xaviers-bandra"', () => {
      expect(normalizeSlug("St. Xavier's (Bandra)")).toBe('st-xaviers-bandra');
    });

    it('"St. Xavier\'s High School" → "st-xaviers-high-school" (from JSDoc)', () => {
      expect(normalizeSlug("St. Xavier's High School")).toBe('st-xaviers-high-school');
    });

    it('"  ABC   School " → "abc-school" (from JSDoc)', () => {
      expect(normalizeSlug('  ABC   School ')).toBe('abc-school');
    });

    it('"School #1 (Bengaluru)" → "school-1-bengaluru" (from JSDoc)', () => {
      expect(normalizeSlug('School #1 (Bengaluru)')).toBe('school-1-bengaluru');
    });
  });

  describe('lowercases input', () => {
    it('converts uppercase letters to lowercase', () => {
      expect(normalizeSlug('DELHI')).toBe('delhi');
    });

    it('converts mixed-case to lowercase', () => {
      expect(normalizeSlug('Delhi Public School')).toBe('delhi-public-school');
    });
  });

  describe('replaces spaces with hyphens', () => {
    it('converts single spaces to hyphens', () => {
      expect(normalizeSlug('hello world')).toBe('hello-world');
    });

    it('converts multiple consecutive spaces to a single hyphen', () => {
      expect(normalizeSlug('hello   world')).toBe('hello-world');
    });

    it('collapses tabs-and-spaces runs (whitespace via trim then replace)', () => {
      // The implementation lowercases then trims then strips non-alnum-space-dash
      // then replaces whitespace-runs with one dash. Multiple spaces collapse.
      expect(normalizeSlug('a  b  c')).toBe('a-b-c');
    });
  });

  describe('strips non-alphanumeric-dash characters', () => {
    it('removes apostrophes', () => {
      expect(normalizeSlug("St. Xavier's")).toBe('st-xaviers');
    });

    it('removes periods', () => {
      expect(normalizeSlug('St. Mary')).toBe('st-mary');
    });

    it('removes parentheses', () => {
      expect(normalizeSlug('school (branch)')).toBe('school-branch');
    });

    it('removes hash / number signs', () => {
      expect(normalizeSlug('School #1')).toBe('school-1');
    });

    it('removes ampersands', () => {
      expect(normalizeSlug('Arts & Science')).toBe('arts-science');
    });
  });

  describe('collapses consecutive dashes', () => {
    it('two dashes in a row collapse to one', () => {
      // "a--b" — can arise after stripping a char between two hyphens
      expect(normalizeSlug('a--b')).toBe('a-b');
    });

    it('dashes produced by adjacent stripped chars + space collapse correctly', () => {
      // "St. Xavier's" → strip . and ' → "St Xaviers" → lowercase → dash → "st-xaviers"
      // The .replace(/[^a-z0-9\s-]/g, '') runs first (strips . and '), leaving
      // a space between "st" and "xaviers", then whitespace-run → dash.
      expect(normalizeSlug("St. Xavier's")).toBe('st-xaviers');
    });
  });

  describe('empty / null-safe behaviour', () => {
    it('returns "" for an empty string', () => {
      expect(normalizeSlug('')).toBe('');
    });

    it('returns "" for a string of only non-alphanumeric chars', () => {
      // All characters stripped, then trim removes nothing, result is ''
      expect(normalizeSlug('...')).toBe('');
    });

    it('returns "" for a string of only spaces', () => {
      expect(normalizeSlug('   ')).toBe('');
    });

    it('does not produce a leading or trailing dash', () => {
      const slug = normalizeSlug('  hello world  ');
      expect(slug).not.toMatch(/^-/);
      expect(slug).not.toMatch(/-$/);
    });
  });

  describe('digits are preserved', () => {
    it('keeps numeric characters', () => {
      expect(normalizeSlug('School 12')).toBe('school-12');
    });

    it('keeps a number-only name', () => {
      expect(normalizeSlug('123')).toBe('123');
    });
  });
});
