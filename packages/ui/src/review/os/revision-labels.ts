/**
 * revision-labels — pure, presentation-only label helpers for the Alfa OS
 * Revision Center (ff_revision_os_v1, Tier 1).
 *
 * NO scoring/XP/mastery computation. masteryProbability is a value the engine
 * already produced; here it is mapped ONLY to a qualitative review-impact
 * label and is NEVER rendered as a number (it is not a quiz score). A lower
 * mastery probability means revising the topic now has higher impact.
 */

/**
 * Format a subject code (e.g. "social_science") into a display name. Pure
 * string-casing only — no academic logic. Hindi falls back to the same cased
 * label (subject names like "Science"/"Mathematics" are treated as proper
 * nouns at this surface; the per-item topic title carries the bilingual text).
 */
export function formatSubject(code: string): string {
  if (!code) return '';
  return code
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export type ImpactLevel = 'high' | 'medium' | 'low';

/**
 * Map a 0..1 mastery probability to a qualitative revision-impact level.
 * Low mastery ⇒ high impact (revising now matters most). Thresholds are a
 * presentation heuristic, not a scoring formula.
 */
export function masteryImpact(masteryProbability: number): ImpactLevel {
  if (masteryProbability < 0.5) return 'high';
  if (masteryProbability < 0.8) return 'medium';
  return 'low';
}

/**
 * Average-impact level for a bucket of items (used for the per-subject load
 * row). Averages the underlying probabilities, then buckets — still purely
 * qualitative output.
 */
export function averageImpact(probs: number[]): ImpactLevel {
  if (probs.length === 0) return 'low';
  const avg = probs.reduce((s, p) => s + p, 0) / probs.length;
  return masteryImpact(avg);
}

interface ImpactMeta {
  /** Text-encoded (not colour-alone) glyph for WCAG 1.4.1. */
  glyph: string;
  label: string;
  /** Token used for emphasis ONLY alongside the glyph + text. */
  color: string;
}

export function impactMeta(level: ImpactLevel, isHi: boolean): ImpactMeta {
  switch (level) {
    case 'high':
      return {
        glyph: '▲',
        label: isHi ? 'ज़्यादा असर' : 'High impact',
        color: 'var(--danger)',
      };
    case 'medium':
      return {
        glyph: '◆',
        label: isHi ? 'मध्यम असर' : 'Medium impact',
        color: 'var(--warning)',
      };
    case 'low':
    default:
      return {
        glyph: '○',
        label: isHi ? 'कम असर' : 'Low impact',
        color: 'var(--success)',
      };
  }
}

/**
 * Format a YYYY-MM-DD string into a short weekday + day-of-month label.
 * Locale-light (en/hi) and timezone-stable (parses as UTC midnight).
 */
export function formatShortDay(
  date: string,
  isHi: boolean
): { weekday: string; day: string; isoLabel: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const weekday = d.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  const day = String(d.getUTCDate());
  const isoLabel = d.toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return { weekday, day, isoLabel };
}
