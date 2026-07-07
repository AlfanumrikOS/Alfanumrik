/**
 * mastery-band-labels — the single source of truth for the growth-mindset
 * band labels the student reads on EVERY dashboard MasteryRing.
 *
 * Cutoffs match the canonical mastery bands (design-system.md §2) and the
 * MasteryRing primitive's `bandForValue`:  <40 low · 40–69 mid · >=70 high.
 *
 * IMPORTANT (assessment condition C1): the value passed to `bandForValue`
 * here is ACCURACY % (calculateScorePercent(correct, total)), NOT the BKT
 * mastery-probability. BKT may drive bucketing / roadmap-node fill, but the
 * headline number and its band label are read off accuracy so they reconcile
 * with quiz results (P1 trust).
 *
 * Copy is deliberately growth-mindset / non-harsh — NO "Weak" / "Beginner" /
 * "मेहनत चाहिए". P7 bilingual.
 *
 *   high (>=70):  Strong        / मज़बूत पकड़
 *   mid  (40–69): Building it    / आगे बढ़ रहे हैं
 *   low  (<40):   Getting started / अभी शुरुआत है
 *
 * Presentation only — no scoring logic lives here.
 */

/** Matches the MasteryRing primitive's `MasteryBandKey`. */
export type MasteryBand = 'low' | 'mid' | 'high';

export const MASTERY_BAND_LABELS: Record<MasteryBand, { en: string; hi: string }> = {
  high: { en: 'Strong', hi: 'मज़बूत पकड़' },
  mid: { en: 'Building it', hi: 'आगे बढ़ रहे हैं' },
  low: { en: 'Getting started', hi: 'अभी शुरुआत है' },
};

/** Band for an ACCURACY % (0–100). Cutoffs: <40 low · 40–69 mid · >=70 high. */
export function bandForValue(accuracyPct: number): MasteryBand {
  if (accuracyPct >= 70) return 'high';
  if (accuracyPct >= 40) return 'mid';
  return 'low';
}

/** Localized band label from an explicit band key (P7). */
export function bandLabel(band: MasteryBand, isHi: boolean): string {
  const l = MASTERY_BAND_LABELS[band];
  return isHi ? l.hi : l.en;
}

/** Convenience: localized band label straight from an accuracy % (P7). */
export function bandLabelForValue(accuracyPct: number, isHi: boolean): string {
  return bandLabel(bandForValue(accuracyPct), isHi);
}
