'use client';

import { getLevelFromScore } from '@/lib/score-config';
import { ProgressBar } from '@/components/ui';

/* ─── Score Color Mapping ───────────────────────────────── */

/**
 * Returns the display color for a Performance Score (0-100).
 * Color bands match CBSE-style grade boundaries.
 */
function getScoreColor(score: number): string {
  if (score >= 90) return '#7C3AED'; // purple — exceptional
  if (score >= 75) return '#10B981'; // green — proficient
  if (score >= 50) return '#F59E0B'; // yellow — developing
  if (score >= 35) return '#F97316'; // orange — needs work
  return '#EF4444';                  // red — at risk
}

/* ─── Trend Arrow ───────────────────────────────────────── */

function TrendArrow({ delta }: { delta: number }) {
  if (delta === 0) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-xs font-semibold"
        style={{ color: 'var(--text-3)' }}
        aria-label="No change"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <line x1="2" y1="6" x2="10" y2="6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        0
      </span>
    );
  }

  const isUp = delta > 0;
  const color = isUp ? '#10B981' : '#EF4444';
  const label = isUp ? `Up ${delta} points` : `Down ${Math.abs(delta)} points`;

  return (
    <span
      className="inline-flex items-center gap-0.5 text-xs font-semibold"
      style={{ color }}
      aria-label={label}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        aria-hidden="true"
        style={{ transform: isUp ? 'none' : 'rotate(180deg)' }}
      >
        <path d="M6 2L10 7H2L6 2Z" fill="currentColor" />
      </svg>
      {isUp ? '+' : ''}{delta}
    </span>
  );
}

/* ─── Props ─────────────────────────────────────────────── */

interface ScoreCardProps {
  subject: string;
  subjectHi: string;
  score: number;           // 0-100
  previousScore?: number;  // for trend arrow
  isHi: boolean;
}

/* ─── Component ─────────────────────────────────────────── */

export default function ScoreCard({
  subject,
  subjectHi,
  score,
  previousScore,
  isHi,
}: ScoreCardProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const color = getScoreColor(clamped);
  const levelName = getLevelFromScore(clamped);

  const delta =
    previousScore !== undefined
      ? clamped - Math.max(0, Math.min(100, Math.round(previousScore)))
      : 0;
  const hasTrend = previousScore !== undefined;

  return (
    <div
      className="rounded-2xl p-4 relative overflow-hidden animate-fade-in"
      style={{
        background: 'var(--surface-1)',
        border: '1px solid var(--border)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
      }}
    >
      {/* Subtle accent glow */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at top right, ${color}20 0%, transparent 70%)`,
        }}
        aria-hidden="true"
      />

      <div className="relative">
        {/* Header: subject name + trend */}
        <div className="flex items-center justify-between mb-2">
          <h3
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--text-2)' }}
          >
            {isHi ? subjectHi : subject}
          </h3>
          {hasTrend && <TrendArrow delta={delta} />}
        </div>

        {/* Score number + level */}
        <div className="flex items-end gap-2 mb-3">
          <span
            className="text-3xl font-bold leading-none"
            style={{
              color,
              fontFamily: 'var(--font-display)',
            }}
          >
            {clamped}
          </span>
          <span
            className="text-xs font-medium pb-0.5"
            style={{ color: 'var(--text-3)' }}
          >
            / 100
          </span>
        </div>

        {/* Level badge */}
        <div className="mb-3">
          <span
            className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: `${color}12`,
              border: `1px solid ${color}25`,
              color,
            }}
          >
            {levelName}
          </span>
        </div>

        {/* Progress bar */}
        <ProgressBar value={clamped} color={color} height={6} />
      </div>
    </div>
  );
}

export { getScoreColor };
