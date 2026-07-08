'use client';

/**
 * Cosmic primitive — GlowCard (.glow-card from __styles.css).
 *
 * A violet-tinted gradient card with a cyan corner-glow halo. Used for hero /
 * spotlight surfaces. Only renders its cosmic styling inside the
 * html[data-design="cosmic"] scope; the class is inert otherwise.
 */
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';

export interface GlowCardProps extends HTMLAttributes<HTMLElement> {
  /** Render as a different element (e.g. 'section', 'article'). Default 'div'. */
  as?: ElementType;
  children?: ReactNode;
}

export function GlowCard({ as, className, children, ...rest }: GlowCardProps) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={cn('cosmic-glow-card', className)} {...rest}>
      {children}
    </Tag>
  );
}
