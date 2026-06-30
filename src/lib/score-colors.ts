/**
 * ALFANUMRIK — Performance Score color bands (shared, single source of truth)
 *
 * Returns the display color for a Performance Score (0-100). Color bands match
 * the CBSE-style grade boundaries used across the gamification surfaces.
 *
 * Extracted (Alfa Momentum Wave 4b) from the duplicated `getScoreColor` helpers
 * in `src/components/score/ScoreCard.tsx` and `src/app/leaderboard/page.tsx` so
 * the band thresholds and colors live in ONE place. Both consumers import this.
 *
 * PRESENTATION-ONLY: the band THRESHOLDS (90 / 75 / 50 / 35) are byte-identical
 * to the originals — only the returned values changed from hardcoded brand hex
 * to design tokens so the colors track the active theme (light / cosmic).
 *
 * Token rationale:
 *  - >= 90 exceptional  → --purple        (deliberate violet "elite" accent)
 *  - >= 75 proficient   → --green
 *  - >= 50 developing   → --gold
 *  - >= 35 needs work   → --accent-warm   (STABLE warm channel: stays burnt-
 *                                           orange even under the cosmic remap
 *                                           where --orange becomes violet)
 *  -  < 35 at risk      → --red
 */
export function getScoreColor(score: number): string {
  if (score >= 90) return 'var(--purple)';       // exceptional
  if (score >= 75) return 'var(--green)';         // proficient
  if (score >= 50) return 'var(--gold)';          // developing
  if (score >= 35) return 'var(--accent-warm)';   // needs work (stable warm)
  return 'var(--red)';                            // at risk
}
