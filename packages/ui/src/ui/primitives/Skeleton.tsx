'use client';

import { cn } from '@alfanumrik/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Skeleton — canonical composable primitive (Phase 2 Batch A)

   Composable, NOT a fixed set of hardcoded shapes:
     - <Skeleton>        one shimmer block; size via passthrough classes
     - <SkeletonText>    N stacked text lines (last line shorter)
     - <SkeletonCircle>  round avatar/icon placeholder
   Shimmer honours prefers-reduced-motion (no pulse when reduced).
   All are aria-hidden (decorative); pair with an accessible loading label
   at the container level.
   ═══════════════════════════════════════════════════════════════ */

const BASE = 'animate-pulse bg-surface-2 motion-reduce:animate-none';

const RADIUS = {
  sm: 'rounded',
  md: 'rounded-lg',
  lg: 'rounded-xl',
  full: 'rounded-full',
} as const;

export interface SkeletonProps {
  /** Corner rounding token. */
  radius?: keyof typeof RADIUS;
  /** Sizing / spacing via Tailwind utilities (e.g. "h-4 w-32"). */
  className?: string;
}

export function Skeleton({ radius = 'md', className }: SkeletonProps) {
  return <div aria-hidden="true" className={cn(BASE, RADIUS[radius], 'h-4 w-full', className)} />;
}

export interface SkeletonTextProps {
  /** Number of text lines. */
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: Math.max(1, lines) }, (_, i) => (
        <div
          key={i}
          className={cn(BASE, 'h-3 rounded', i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full')}
        />
      ))}
    </div>
  );
}

const CIRCLE_SIZE = {
  sm: 'h-8 w-8',
  md: 'h-12 w-12',
  lg: 'h-16 w-16',
} as const;

export interface SkeletonCircleProps {
  size?: keyof typeof CIRCLE_SIZE;
  className?: string;
}

export function SkeletonCircle({ size = 'md', className }: SkeletonCircleProps) {
  return <div aria-hidden="true" className={cn(BASE, 'rounded-full', CIRCLE_SIZE[size], className)} />;
}
