/**
 * review/os revision-labels — display-only label helpers for the Alfa OS
 * Revision Center. masteryProbability is a value the engine already produced;
 * here it is mapped ONLY to a qualitative impact label and NEVER rendered as a
 * number. Tests pin the 0.5 / 0.8 bucketing as a display heuristic (not a score)
 * plus the subject-casing and date helpers.
 *
 * Owning agent: testing.
 */

import { describe, it, expect } from 'vitest';
import {
  formatSubject,
  masteryImpact,
  averageImpact,
  impactMeta,
  formatShortDay,
} from '@alfanumrik/ui/review/os/revision-labels';

describe('masteryImpact — 0.5 / 0.8 display bucketing (low mastery ⇒ high impact)', () => {
  it('< 0.5 → high', () => {
    expect(masteryImpact(0)).toBe('high');
    expect(masteryImpact(0.49)).toBe('high');
  });
  it('exactly 0.5 → medium (boundary is inclusive-low)', () => {
    expect(masteryImpact(0.5)).toBe('medium');
  });
  it('[0.5, 0.8) → medium', () => {
    expect(masteryImpact(0.5)).toBe('medium');
    expect(masteryImpact(0.79)).toBe('medium');
  });
  it('exactly 0.8 → low (boundary is inclusive-low)', () => {
    expect(masteryImpact(0.8)).toBe('low');
  });
  it('>= 0.8 → low', () => {
    expect(masteryImpact(0.95)).toBe('low');
    expect(masteryImpact(1)).toBe('low');
  });
});

describe('averageImpact — averages probabilities then buckets', () => {
  it('empty array → low (nothing to revise)', () => {
    expect(averageImpact([])).toBe('low');
  });
  it('averages then buckets: [0.2, 0.4] → avg 0.3 → high', () => {
    expect(averageImpact([0.2, 0.4])).toBe('high');
  });
  it('averages then buckets: [0.6, 0.7] → avg 0.65 → medium', () => {
    expect(averageImpact([0.6, 0.7])).toBe('medium');
  });
  it('averages then buckets: [0.9, 0.9] → avg 0.9 → low', () => {
    expect(averageImpact([0.9, 0.9])).toBe('low');
  });
});

describe('impactMeta — glyph + label, never colour-only', () => {
  it('each level carries a text glyph + non-empty label', () => {
    for (const level of ['high', 'medium', 'low'] as const) {
      const meta = impactMeta(level, false);
      expect(meta.glyph.length).toBeGreaterThan(0);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.color.length).toBeGreaterThan(0);
    }
  });
  it('Hindi labels differ from English', () => {
    expect(impactMeta('high', true).label).not.toBe(impactMeta('high', false).label);
  });
});

describe('formatSubject — pure string-casing', () => {
  it('title-cases a snake_case subject code', () => {
    expect(formatSubject('social_science')).toBe('Social Science');
  });
  it('handles hyphen/space separators', () => {
    expect(formatSubject('computer-science')).toBe('Computer Science');
    expect(formatSubject('english core')).toBe('English Core');
  });
  it('empty input → empty string', () => {
    expect(formatSubject('')).toBe('');
  });
});

describe('formatShortDay — timezone-stable (UTC) day labels', () => {
  it('parses a YYYY-MM-DD string as UTC midnight and returns the day-of-month', () => {
    const out = formatShortDay('2026-06-11', false);
    expect(out.day).toBe('11');
    expect(out.weekday.length).toBeGreaterThan(0);
    expect(out.isoLabel.length).toBeGreaterThan(0);
  });
});
