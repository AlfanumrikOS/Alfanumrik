'use client';

/**
 * Cosmic primitives — CosmicButton (.btn), its ghost variant (.btn-ghost),
 * PillButton (.pill-btn), and IconButton (.icon-btn).
 *
 * All are <button> wrappers that layer the cosmic class onto whatever the
 * caller passes. Touch targets: PillButton and IconButton are ≥36px visually;
 * the global `@media (pointer: coarse)` rule in globals.css expands tap area
 * to the 44/48px minimum, so we don't double-apply here.
 *
 * Bilingual: button labels are passed in as children by the caller using the
 * existing isHi pattern — primitives never embed English copy.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type BaseButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode;
  /** Leading icon node. */
  icon?: ReactNode;
};

export interface CosmicButtonProps extends BaseButtonProps {
  /** 'solid' = filled violet (.btn); 'ghost' = bordered translucent (.btn-ghost). */
  variant?: 'solid' | 'ghost';
}

export const CosmicButton = forwardRef<HTMLButtonElement, CosmicButtonProps>(
  function CosmicButton({ variant = 'solid', icon, className, children, type, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cn('cosmic-btn', variant === 'ghost' && 'cosmic-btn-ghost', className)}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export interface PillButtonProps extends BaseButtonProps {
  /** Visually marks the pill as the selected option in a group. */
  active?: boolean;
}

export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  function PillButton({ active = false, icon, className, children, type, ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        data-active={active ? 'true' : undefined}
        aria-pressed={active}
        className={cn('cosmic-pill-btn', className)}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode;
  /** Required for a11y — icon-only buttons must announce their purpose. */
  'aria-label': string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton({ className, children, type, ...rest }, ref) {
    return (
      <button ref={ref} type={type ?? 'button'} className={cn('cosmic-icon-btn', className)} {...rest}>
        {children}
      </button>
    );
  },
);
