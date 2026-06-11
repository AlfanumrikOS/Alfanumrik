'use client';

/**
 * ScoreBar — plain-CSS micro-bar for in-cell pillar / composite score display
 * (Education Intelligence Cloud). Intentionally NOT a Recharts component: it is
 * a single inline-block sparkline-style bar cheap enough to render dozens of
 * times inside a DataTable cell without any chart-library overhead.
 *
 * 0-100 score bands (matches the EIC ops spec):
 *   >= 80  success  (green)
 *   60-79  info     (blue)
 *   40-59  warning  (amber)
 *   < 40   danger   (red)
 *   null   neutral  (muted track, no fill) — "no score yet"
 *
 * Accessibility: never color-only. The numeric value is rendered as text next
 * to the bar, and the bar itself carries role="meter" + aria-valuenow/min/max
 * and a descriptive aria-label, so screen-reader and color-blind users get the
 * value without relying on the fill color.
 */

export type ScoreBand = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

/** Resolve the 0-100 band for a score. null/undefined → 'neutral'. */
export function scoreBand(score: number | null | undefined): ScoreBand {
  if (score == null || !Number.isFinite(score)) return 'neutral';
  if (score >= 80) return 'success';
  if (score >= 60) return 'info';
  if (score >= 40) return 'warning';
  return 'danger';
}

// CSS-variable token per band (token-driven, theme-aware).
const BAND_COLOR: Record<ScoreBand, string> = {
  success: 'var(--success)',
  info: 'var(--info)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  neutral: 'var(--surface-3)',
};

export interface ScoreBarProps {
  /** 0-100 score. null/undefined renders an empty (neutral) track. */
  score: number | null | undefined;
  /** Accessible label prefix, e.g. "Composite" or "Engagement". */
  label?: string;
  /** Show the numeric value as text alongside the bar. Default true. */
  showValue?: boolean;
  /** Track width in px. Default 56. */
  width?: number;
  /** Bar height in px. Default 8. */
  height?: number;
}

export function ScoreBar({
  score,
  label,
  showValue = true,
  width = 56,
  height = 8,
}: ScoreBarProps) {
  const band = scoreBand(score);
  const clamped = score == null || !Number.isFinite(score)
    ? 0
    : Math.max(0, Math.min(100, score));
  const display = score == null || !Number.isFinite(score) ? '—' : Math.round(score);
  const aria = `${label ? `${label}: ` : ''}${
    score == null || !Number.isFinite(score) ? 'no score' : `${Math.round(score)} of 100`
  }`;

  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      <span
        role="meter"
        aria-label={aria}
        aria-valuenow={score == null || !Number.isFinite(score) ? undefined : Math.round(score)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="inline-block flex-shrink-0 overflow-hidden rounded-full"
        style={{ width, height, background: 'var(--surface-3)' }}
      >
        <span
          aria-hidden="true"
          className="block h-full rounded-full"
          style={{
            width: `${clamped}%`,
            background: BAND_COLOR[band],
            minWidth: clamped > 0 ? 2 : 0,
          }}
        />
      </span>
      {showValue && (
        <span className="text-[11px] font-semibold tabular-nums text-foreground">
          {display}
        </span>
      )}
    </span>
  );
}

export default ScoreBar;
