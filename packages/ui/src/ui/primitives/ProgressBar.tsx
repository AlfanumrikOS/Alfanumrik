'use client';

import { type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';
import { TONE_VAR, type Tone } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   ProgressBar — canonical primitive (Phase 2 Batch A)

   Determinate, tone-aware. Accessible: role=progressbar with
   aria-valuenow / valuemin / valuemax and an aria-label. Optional
   caller-supplied label + percentage read-out. Copy from props (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface ProgressBarProps {
  /** 0–100. Clamped internally. */
  value: number;
  tone?: Tone;
  size?: 'sm' | 'md';
  /** Optional visible label (bilingual — caller localizes). */
  label?: ReactNode;
  /** Show the numeric percentage next to the label. */
  showValue?: boolean;
  /** Accessible name when no visible `label` is given. */
  ariaLabel?: string;
  className?: string;
}

const TRACK_H: Record<'sm' | 'md', string> = {
  sm: 'h-2',
  md: 'h-3',
};

export function ProgressBar({
  value,
  tone = 'brand',
  size = 'md',
  label,
  showValue = false,
  ariaLabel,
  className,
}: ProgressBarProps) {
  // Non-finite input coerces to 0 BEFORE clamping. Without the isFinite guard
  // a NaN `value` survives Math.round/max/min and renders literal "NaN%" as the
  // fill width and aria-valuenow. This guard came from the cosmic ProgressBar
  // that this primitive replaced (deleted 2026-08-09) — it is display-only
  // defensiveness and derives no number (P1/P2 stay in the assessment domain).
  const safe = Number.isFinite(value) ? value : 0;
  const pct = Math.min(100, Math.max(0, Math.round(safe)));

  return (
    <div className={className}>
      {(label != null || showValue) && (
        <div className="mb-1.5 flex items-center justify-between text-fluid-xs font-semibold text-muted-foreground">
          {label != null ? <span className="min-w-0 truncate">{label}</span> : <span />}
          {showValue && <span className="tabular-nums">{pct}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={typeof label === 'string' ? label : ariaLabel ?? `${pct}%`}
        className={cn('w-full overflow-hidden rounded-full bg-surface-2', TRACK_H[size])}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%`, backgroundColor: TONE_VAR[tone] }}
        />
      </div>
    </div>
  );
}
