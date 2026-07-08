'use client';

/**
 * Cosmic primitive — Chip (.chip + .chip-{violet,cyan,mint,pink,saffron}).
 *
 * A small rounded badge. The `tone` prop picks the accent variant. Bilingual-
 * ready: callers pass already-localized strings (or nodes) as children — the
 * primitive never hardcodes copy.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';

export type ChipTone = 'neutral' | 'violet' | 'cyan' | 'mint' | 'pink' | 'saffron';

const TONE_CLASS: Record<ChipTone, string> = {
  neutral: '',
  violet: 'cosmic-chip-violet',
  cyan: 'cosmic-chip-cyan',
  mint: 'cosmic-chip-mint',
  pink: 'cosmic-chip-pink',
  saffron: 'cosmic-chip-saffron',
};

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: ChipTone;
  /** Optional leading icon / dot node. */
  icon?: ReactNode;
  children?: ReactNode;
}

export function Chip({ tone = 'neutral', icon, className, children, ...rest }: ChipProps) {
  return (
    <span className={cn('cosmic-chip', TONE_CLASS[tone], className)} {...rest}>
      {icon}
      {children}
    </span>
  );
}
