'use client';

/**
 * Cosmic primitive — HeatCell (.heatcell).
 *
 * A single square cell for mastery / activity heatmaps. The `intensity` 0–1
 * tints the cell with the accent color (violet by default); 0 leaves the base
 * translucent surface. Purely presentational — heatmap data semantics live in
 * the consuming feature, not here.
 */
import type { CSSProperties } from 'react';
import { cn } from '@alfanumrik/lib/utils';

export interface HeatCellProps {
  /** 0 (empty) → 1 (full accent). Clamped. */
  intensity?: number;
  /** Accent color to tint toward. Default var(--violet). */
  color?: string;
  /** Accessible label (bilingual string from caller), e.g. "Mon: 3 sessions". */
  label?: string;
  className?: string;
}

export function HeatCell({ intensity = 0, color = 'var(--violet)', label, className }: HeatCellProps) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0));
  // Blend toward the accent via color-mix; fall back to base when intensity 0.
  const style: CSSProperties =
    clamped > 0
      ? { background: `color-mix(in srgb, ${color} ${Math.round(clamped * 100)}%, transparent)` }
      : {};
  return (
    <div
      className={cn('cosmic-heatcell', className)}
      style={style}
      title={label}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}
