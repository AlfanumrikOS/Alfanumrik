'use client';

import { type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';
import { TONE_VAR, type Tone } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   ProgressRing / MasteryRing — canonical primitives (Phase 2 Batch A)

   ProgressRing: circular determinate progress. Tone-aware. Accessible
   value via role=img + aria-label (and role=progressbar semantics on the
   wrapper). Stroke animation honours prefers-reduced-motion.

   MasteryRing: mastery variant mapping low / mid / high bands. Colour is
   NEVER the sole signal — every band carries a REQUIRED icon + text label
   (deuteranopia-safe, design-system.md §2):
     low  (< 40)   ▲  "At risk"     --mastery-low
     mid  (40–69)  ◐  "Developing"  --mastery-mid
     high (>= 70)  ●  "Strong"      --mastery-high
   ═══════════════════════════════════════════════════════════════ */

export interface ProgressRingProps {
  /** 0–100. Clamped internally. */
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: Tone;
  /** Center content override (e.g. "1,240 XP"). Defaults to "{value}%". */
  children?: ReactNode;
  /** Accessible name; defaults to "{value}%". */
  ariaLabel?: string;
  className?: string;
}

function Ring({
  value,
  size,
  strokeWidth,
  stroke,
  center,
  ariaLabel,
  className,
}: {
  value: number;
  size: number;
  strokeWidth: number;
  stroke: string;
  center: ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-700 ease-out motion-reduce:transition-none"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{center}</div>
    </div>
  );
}

export function ProgressRing({
  value,
  size = 72,
  strokeWidth = 6,
  tone = 'brand',
  children,
  ariaLabel,
  className,
}: ProgressRingProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <Ring
      value={value}
      size={size}
      strokeWidth={strokeWidth}
      stroke={TONE_VAR[tone]}
      ariaLabel={ariaLabel ?? `${pct}%`}
      center={
        children ?? (
          <span className="text-fluid-sm font-bold tabular-nums text-foreground">{pct}%</span>
        )
      }
      className={className}
    />
  );
}

/* ── MasteryRing ─────────────────────────────────────────────── */

export type MasteryBandKey = 'low' | 'mid' | 'high';

interface Band {
  key: MasteryBandKey;
  /** Non-colour backup glyph (shape differs per band). */
  icon: string;
  /** Default English label; override via `bandLabel` for Hindi (P7). */
  label: string;
  stroke: string;
}

const BANDS: Record<MasteryBandKey, Band> = {
  low: { key: 'low', icon: '▲', label: 'At risk', stroke: 'var(--mastery-low)' },
  mid: { key: 'mid', icon: '◐', label: 'Developing', stroke: 'var(--mastery-mid)' },
  high: { key: 'high', icon: '●', label: 'Strong', stroke: 'var(--mastery-high)' },
};

export function bandForValue(value: number): MasteryBandKey {
  if (value < 40) return 'low';
  if (value < 70) return 'mid';
  return 'high';
}

export interface MasteryRingProps {
  /** 0–100 mastery. */
  value: number;
  size?: number;
  strokeWidth?: number;
  /** Render the band label + percentage beneath the ring. Default true. */
  showLabel?: boolean;
  /**
   * Localized band label override (P7). Receives the band key so the caller
   * can supply Hindi copy, e.g. `(k) => isHi ? HI[k] : undefined`.
   */
  bandLabel?: (band: MasteryBandKey) => string | undefined;
  className?: string;
}

export function MasteryRing({
  value,
  size = 72,
  strokeWidth = 6,
  showLabel = true,
  bandLabel,
  className,
}: MasteryRingProps) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  const band = BANDS[bandForValue(pct)];
  const label = bandLabel?.(band.key) ?? band.label;

  return (
    <div className={cn('inline-flex flex-col items-center gap-1.5', className)}>
      <Ring
        value={pct}
        size={size}
        strokeWidth={strokeWidth}
        stroke={band.stroke}
        // Icon + numeric value = the non-colour backup INSIDE the ring.
        ariaLabel={`${label}: ${pct}%`}
        center={
          <span className="flex flex-col items-center leading-none">
            <span aria-hidden="true" className="text-fluid-sm" style={{ color: band.stroke }}>
              {band.icon}
            </span>
            <span className="text-fluid-xs font-bold tabular-nums text-foreground">{pct}%</span>
          </span>
        }
      />
      {showLabel && (
        <span className="inline-flex items-center gap-1 text-fluid-xs font-semibold text-muted-foreground">
          <span aria-hidden="true" style={{ color: band.stroke }}>{band.icon}</span>
          {label}
        </span>
      )}
    </div>
  );
}
