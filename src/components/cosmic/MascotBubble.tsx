'use client';

/**
 * Cosmic primitive — MascotBubble (.mascot-bubble).
 *
 * A speech bubble for Foxy's tips/encouragement, with the tail on the bottom-
 * left. Copy is passed in by the caller (already localized via isHi) so the
 * primitive stays bilingual-agnostic.
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface MascotBubbleProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export function MascotBubble({ className, children, ...rest }: MascotBubbleProps) {
  return (
    <div className={cn('cosmic-mascot-bubble', className)} {...rest}>
      {children}
    </div>
  );
}
