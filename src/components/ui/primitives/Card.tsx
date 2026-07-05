'use client';

import {
  forwardRef,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Card — canonical primitive (Phase 2 Batch A)

   Variants:
     - flat        hairline border, no shadow
     - elevated    soft elevation shadow (--shadow-md)
     - interactive hover/press affordance + keyboard focus when `onClick`
   Composition slots: <CardHeader> / <CardBody> / <CardFooter>.
   Defaults to overflow-hidden so media (images, charts) stay clipped
   to the rounded corners.
   ═══════════════════════════════════════════════════════════════ */

export type CardVariant = 'flat' | 'elevated' | 'interactive';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  /** When set on an interactive card, the whole card becomes a button. */
  onClick?: () => void;
  children: ReactNode;
}

const VARIANT: Record<CardVariant, string> = {
  flat: 'border border-surface-3',
  elevated: 'border border-surface-3 shadow-md',
  interactive:
    'border border-surface-3 shadow-sm transition-shadow duration-150 ease-out hover:shadow-md motion-reduce:transition-none',
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = 'flat', onClick, className, children, ...props },
  ref,
) {
  const clickable = variant === 'interactive' && typeof onClick === 'function';

  const handleKeyDown = clickable
    ? (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick!();
        }
      }
    : undefined;

  return (
    <div
      ref={ref}
      onClick={clickable ? onClick : undefined}
      onKeyDown={handleKeyDown}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      className={cn(
        'relative overflow-hidden rounded-xl bg-surface-1',
        VARIANT[variant],
        clickable &&
          'cursor-pointer active:brightness-95 motion-reduce:active:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
});

export function CardHeader({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('border-b border-surface-3 px-5 py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function CardBody({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('px-5 py-4', className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('border-t border-surface-3 px-5 py-4', className)} {...props}>
      {children}
    </div>
  );
}
