/**
 * AtlasCard — the foundational container for Editorial Atlas surfaces.
 *
 * Three tones map onto the prototype: paper (white), cream (warm
 * background), teal-soft (editorial weight), accent-soft (orange glow).
 * Everything else is composed on top via children — this is intentionally
 * just a styled box.
 */

import type { HTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';

export interface AtlasCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual tone. Default paper (#FFFFFF on cream). */
  tone?: 'paper' | 'cream' | 'teal' | 'accent';
  /** Tighter padding (16px) + smaller radius. Used in side rails. */
  compact?: boolean;
  children: ReactNode;
}

export function AtlasCard({
  tone = 'paper',
  compact = false,
  className,
  children,
  ...rest
}: AtlasCardProps) {
  return (
    <div
      className={clsx(
        'atlas-card',
        compact && 'atlas-card-tight',
        tone === 'cream'  && 'atlas-card-cream',
        tone === 'teal'   && 'atlas-card-teal',
        tone === 'accent' && 'atlas-card-accent',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export default AtlasCard;
