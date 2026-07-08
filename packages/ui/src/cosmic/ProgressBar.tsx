'use client';

/**
 * Cosmic primitive — ProgressBar (.bar with a violet→cyan fill).
 *
 * Display-only horizontal progress. Exposes role="progressbar" so the value
 * is announced. The `percent` is a presentational input — never a scoring
 * computation (P1 belongs to the assessment domain, not this primitive).
 */
import type { CSSProperties } from 'react';
import { cn } from '@alfanumrik/lib/utils';

export interface ProgressBarProps {
  /** 0–100, clamped defensively. */
  percent: number;
  /** Accessible label, e.g. "Daily goal". Bilingual string from caller. */
  label?: string;
  className?: string;
}

export function ProgressBar({ percent, label, className }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  return (
    <div
      className={cn('cosmic-bar', className)}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span style={{ width: `${clamped}%` } as CSSProperties} />
    </div>
  );
}
