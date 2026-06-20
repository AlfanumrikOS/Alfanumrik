/**
 * Teacher mastery heat scale — pure-function contract tests.
 *
 * `src/lib/teacher/heat-scale.ts` is the SINGLE SOURCE OF TRUTH for mastery
 * color/band across the Atlas teacher surfaces. These tests pin the band
 * boundaries exhaustively (inclusive lower bounds), the Tailwind class mapping,
 * the bilingual labels (P7), and the HEAT_THRESHOLDS ordering/coverage so a
 * future tweak to any cut point fails loudly instead of silently recoloring the
 * heatmap.
 *
 * Owning agent: testing.
 */

import { describe, it, expect } from 'vitest';
import {
  heatBand,
  heatColorClass,
  heatLabel,
  HEAT_THRESHOLDS,
  type HeatBand,
} from '@/lib/teacher/heat-scale';

describe('heatBand — band resolution at and around each threshold', () => {
  it.each<[number, HeatBand]>([
    [1, 'excellent'],
    [0.95, 'excellent'], // inclusive lower bound
    [0.8, 'strong'], // inclusive lower bound
    [0.6, 'developing'], // inclusive lower bound
    [0.3, 'weak'], // inclusive lower bound
    [0.299, 'critical'],
    [0, 'critical'],
  ])('p=%s → %s (threshold boundary)', (p, band) => {
    expect(heatBand(p)).toBe(band);
  });

  it.each<[number, HeatBand]>([
    [0.94, 'strong'], // just below excellent → strong
    [0.79, 'developing'], // just below strong → developing
    [0.59, 'weak'], // just below developing → weak
    [0.29, 'critical'], // just below weak → critical
  ])('just-below boundary p=%s falls to next band %s', (p, band) => {
    expect(heatBand(p)).toBe(band);
  });

  it('clamps non-finite input (NaN/Infinity treated as 0 → critical)', () => {
    // Number.isFinite(Infinity) === false, so the guard falls back to 0 → critical.
    expect(heatBand(Number.NaN)).toBe('critical');
    expect(heatBand(Number.POSITIVE_INFINITY)).toBe('critical');
  });

  it('treats negative mastery as critical', () => {
    expect(heatBand(-0.5)).toBe('critical');
  });
});

// Explicit guard for the Infinity contract: Number.isFinite(Infinity) === false,
// so heatBand falls back to 0 → 'critical'. (The it.each above documented the
// intent; this isolates the exact expected value.)
describe('heatBand — non-finite fallback is 0 (critical)', () => {
  it('Infinity → critical (not excellent)', () => {
    expect(heatBand(Number.POSITIVE_INFINITY)).toBe('critical');
  });
  it('NaN → critical', () => {
    expect(heatBand(Number.NaN)).toBe('critical');
  });
});

describe('heatColorClass — Tailwind bg class per band', () => {
  it.each<[number, string]>([
    [0.95, 'bg-emerald-600'],
    [1, 'bg-emerald-600'],
    [0.8, 'bg-violet-600'],
    [0.94, 'bg-violet-600'],
    [0.6, 'bg-blue-600'],
    [0.79, 'bg-blue-600'],
    [0.3, 'bg-amber-500'],
    [0.59, 'bg-amber-500'],
    [0.299, 'bg-slate-400'],
    [0, 'bg-slate-400'],
  ])('p=%s → %s', (p, cls) => {
    expect(heatColorClass(p)).toBe(cls);
  });

  it('non-finite input falls back to the critical slate class', () => {
    expect(heatColorClass(Number.NaN)).toBe('bg-slate-400');
    expect(heatColorClass(Number.POSITIVE_INFINITY)).toBe('bg-slate-400');
  });

  it('every band color is in sync with HEAT_THRESHOLDS bgClass', () => {
    for (const t of HEAT_THRESHOLDS) {
      // Use the threshold's own min so we land squarely in its band.
      expect(heatColorClass(t.min)).toBe(t.bgClass);
    }
  });
});

describe('heatLabel — bilingual labels (P7)', () => {
  it.each<[number, string, string]>([
    [0.95, 'Excellent', 'उत्कृष्ट'],
    [0.8, 'Strong', 'मज़बूत'],
    [0.6, 'Developing', 'विकासशील'],
    [0.3, 'Weak', 'कमज़ोर'],
    [0, 'Critical', 'गंभीर'],
  ])('p=%s → EN "%s" / HI "%s"', (p, en, hi) => {
    expect(heatLabel(false, p)).toBe(en);
    expect(heatLabel(true, p)).toBe(hi);
  });

  it('returns Hindi (Devanagari) when isHi=true', () => {
    const label = heatLabel(true, 0.95);
    expect(label).toBe('उत्कृष्ट');
    expect(label).toMatch(/[ऀ-ॿ]/); // contains Devanagari
  });

  it('returns English (ASCII) when isHi=false', () => {
    const label = heatLabel(false, 0.95);
    expect(label).toBe('Excellent');
    expect(label).not.toMatch(/[ऀ-ॿ]/);
  });
});

describe('HEAT_THRESHOLDS — ordering & coverage invariants', () => {
  it('is ordered strongest → weakest by descending min', () => {
    const mins = HEAT_THRESHOLDS.map((t) => t.min);
    const sortedDesc = [...mins].sort((a, b) => b - a);
    expect(mins).toEqual(sortedDesc);
  });

  it('declares all five bands exactly once', () => {
    const bands = HEAT_THRESHOLDS.map((t) => t.band);
    expect(bands).toEqual(['excellent', 'strong', 'developing', 'weak', 'critical']);
    expect(new Set(bands).size).toBe(5);
  });

  it('covers the full 0..1 range with the weakest band anchored at 0', () => {
    const last = HEAT_THRESHOLDS[HEAT_THRESHOLDS.length - 1];
    expect(last.band).toBe('critical');
    expect(last.min).toBe(0);
  });

  it('pins the canonical cut points (0.95 / 0.80 / 0.60 / 0.30 / 0)', () => {
    expect(HEAT_THRESHOLDS.map((t) => t.min)).toEqual([0.95, 0.8, 0.6, 0.3, 0]);
  });

  it('every threshold maps band ↔ bgClass consistently with heatColorClass/heatBand', () => {
    for (const t of HEAT_THRESHOLDS) {
      expect(heatBand(t.min)).toBe(t.band);
      expect(heatColorClass(t.min)).toBe(t.bgClass);
    }
  });
});
