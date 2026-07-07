'use client';

/**
 * Cosmic primitive — CardElev (.card-elev) and a plain Card (.card).
 *
 * CardElev is the standard raised, frosted surface for content blocks.
 * Card is the lighter, more translucent variant with a hover border lift.
 */
import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';

export interface CardElevProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  /** Use the lighter translucent `.card` styling instead of `.card-elev`. */
  flat?: boolean;
  children?: ReactNode;
}

export function CardElev({ as, flat = false, className, children, ...rest }: CardElevProps) {
  const Tag = (as ?? 'div') as ElementType;
  return (
    <Tag className={cn(flat ? 'cosmic-card' : 'cosmic-card-elev', className)} {...rest}>
      {children}
    </Tag>
  );
}
