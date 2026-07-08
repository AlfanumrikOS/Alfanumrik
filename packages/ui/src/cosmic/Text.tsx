'use client';

/**
 * Cosmic primitives — typography helpers (.h-display / .tab-num / .float
 * / .fade-up wrappers).
 *
 *  HDisplay   — Space Grotesk display heading (tight tracking).
 *  TabNum     — tabular-figures span for numbers that shouldn't jitter.
 *  FadeUp     — wrapper applying the .fade-up entrance (disabled in reduced
 *               motion via CSS).
 *  Float      — wrapper applying the gentle .float idle bob (disabled in
 *               reduced motion via CSS).
 *
 * None embed copy — children are passed by the caller (bilingual-ready).
 */
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';

interface PolymorphicProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  children?: ReactNode;
}

export function HDisplay({ as, className, children, ...rest }: PolymorphicProps) {
  const Tag = (as ?? 'h2') as ElementType;
  return (
    <Tag className={cn('cosmic-h-display', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function TabNum({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) {
  return (
    <span className={cn('cosmic-tab-num', className)} {...rest}>
      {children}
    </span>
  );
}

export function FadeUp({ as, className, children, ...rest }: PolymorphicProps) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={cn('cosmic-fade-up', className)} {...rest}>
      {children}
    </Tag>
  );
}

export function Float({ as, className, children, ...rest }: PolymorphicProps) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={cn('cosmic-float', className)} {...rest}>
      {children}
    </Tag>
  );
}
