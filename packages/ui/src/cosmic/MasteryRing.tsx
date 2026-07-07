'use client';

/**
 * Cosmic primitive — MasteryRing (.ring with conic-gradient progress).
 *
 * A circular progress ring driven by CSS custom properties (--p percent,
 * --s pixel size, --c1/--c2 colors), matching __styles.css `.ring`. The center
 * is punched out by the ::before pseudo-element so children (a percentage,
 * an icon) sit in the hole.
 *
 * Accessibility: exposes role="progressbar" with aria-valuenow so screen
 * readers announce mastery without relying on the visual ring. The numeric
 * label uses tabular figures so it doesn't jitter as it animates.
 */
import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';

export interface MasteryRingProps {
  /** Progress 0–100. Clamped defensively; this is display-only, not scoring. */
  percent: number;
  /** Diameter in px. Default 56 (matches the prototype default). */
  size?: number;
  /** Start color of the conic gradient. Default var(--violet). */
  fromColor?: string;
  /** End color (currently decorative; the conic uses --c1 as the swept color). */
  toColor?: string;
  /** Content rendered in the punched-out center (e.g. a "%" label). */
  children?: ReactNode;
  /** Accessible label, e.g. "Algebra mastery". Bilingual string from caller. */
  label?: string;
  className?: string;
}

export function MasteryRing({
  percent,
  size = 56,
  fromColor = 'var(--violet)',
  toColor = 'var(--cyan)',
  children,
  label,
  className,
}: MasteryRingProps) {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(percent) ? percent : 0));
  const style = {
    '--p': clamped,
    '--s': size,
    '--c1': fromColor,
    '--c2': toColor,
  } as CSSProperties;

  return (
    <div
      className={cn('cosmic-ring', className)}
      style={style}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <span className="cosmic-tab-num">{children}</span>
    </div>
  );
}
