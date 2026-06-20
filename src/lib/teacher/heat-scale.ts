/**
 * Teacher mastery heat scale — the SINGLE SOURCE OF TRUTH for mastery color
 * across the Atlas teacher surfaces (heatmap cells, mastery bars, progress
 * rings). Phases 2-3 consume this; the inline `heatColor()` copies in
 * CommandCenter / GradingQueue / StudentMasteryReport are replaced by these
 * exports in Phase 2. Do NOT edit CommandCenter here — this file is additive.
 *
 * Pure functions, no React. `p` is always a 0..1 mastery fraction.
 *
 * UNIFIED bands (Atlas redesign):
 *   p >= 0.95  emerald-600  Excellent
 *   p >= 0.80  violet-600   Strong
 *   p >= 0.60  blue-600     Developing
 *   p >= 0.30  amber-500    Weak
 *   else        slate-400    Critical
 */

/** Mastery band identifiers, strongest → weakest. */
export type HeatBand = 'excellent' | 'strong' | 'developing' | 'weak' | 'critical';

/**
 * Canonical band thresholds (inclusive lower bound on a 0..1 fraction), ordered
 * strongest → weakest. Exported as the raw source of truth so callers that need
 * legends / axes can reuse the exact cut points instead of re-hardcoding them.
 */
export const HEAT_THRESHOLDS: ReadonlyArray<{
  band: HeatBand;
  min: number;
  bgClass: string;
}> = [
  { band: 'excellent', min: 0.95, bgClass: 'bg-emerald-600' },
  { band: 'strong', min: 0.8, bgClass: 'bg-violet-600' },
  { band: 'developing', min: 0.6, bgClass: 'bg-blue-600' },
  { band: 'weak', min: 0.3, bgClass: 'bg-amber-500' },
  { band: 'critical', min: 0, bgClass: 'bg-slate-400' },
] as const;

/** Resolve the band a mastery fraction falls into. */
export function heatBand(p: number): HeatBand {
  const v = Number.isFinite(p) ? p : 0;
  for (const t of HEAT_THRESHOLDS) {
    if (v >= t.min) return t.band;
  }
  return 'critical';
}

/**
 * Tailwind background class for a mastery fraction on the unified scale.
 * The single function every Atlas heatmap/bar/ring should call.
 */
export function heatColorClass(p: number): string {
  const v = Number.isFinite(p) ? p : 0;
  for (const t of HEAT_THRESHOLDS) {
    if (v >= t.min) return t.bgClass;
  }
  return 'bg-slate-400';
}

const BAND_LABELS: Record<HeatBand, { en: string; hi: string }> = {
  excellent: { en: 'Excellent', hi: 'उत्कृष्ट' },
  strong: { en: 'Strong', hi: 'मज़बूत' },
  developing: { en: 'Developing', hi: 'विकासशील' },
  weak: { en: 'Weak', hi: 'कमज़ोर' },
  critical: { en: 'Critical', hi: 'गंभीर' },
};

/** Bilingual band label for a mastery fraction (P7). */
export function heatLabel(isHi: boolean, p: number): string {
  const band = heatBand(p);
  return isHi ? BAND_LABELS[band].hi : BAND_LABELS[band].en;
}
