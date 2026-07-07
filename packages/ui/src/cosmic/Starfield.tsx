'use client';

/**
 * Cosmic primitive — Starfield (.starfield animated background).
 *
 * An absolutely-positioned, pointer-events:none layer of twinkling stars meant
 * to sit behind page content inside a `position: relative` container. The
 * shimmer animation is disabled under prefers-reduced-motion (handled in CSS),
 * and the whole layer is hidden in the light + high-contrast themes (also in
 * CSS) so it can never reduce text contrast.
 *
 * Decorative only → aria-hidden.
 */
import { cn } from '@alfanumrik/lib/utils';

export interface StarfieldProps {
  className?: string;
}

export function Starfield({ className }: StarfieldProps) {
  return <div className={cn('cosmic-starfield', className)} aria-hidden="true" />;
}
