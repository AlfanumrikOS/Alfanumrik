'use client';

/**
 * Cosmic primitives — CosmicButton (.btn), its ghost variant (.btn-ghost),
 * and PillButton (.pill-btn).
 *
 * Both are <button> wrappers that layer the cosmic class onto whatever the
 * caller passes. Touch targets: PillButton is ≥36px visually; the global
 * `@media (pointer: coarse)` rule in globals.css expands tap area to the
 * 44/48px minimum, so we don't double-apply here.
 *
 * For an icon-only action use { IconButton } from '@alfanumrik/ui/ui/primitives'
 * — the cosmic twin was deleted 2026-08-09 (see note below).
 *
 * Bilingual: button labels are passed in as children by the caller using the
 * existing isHi pattern — primitives never embed English copy.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';

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

/* IconButton was removed from this file on 2026-08-09. It was a second
   component named `IconButton`, colliding with the canonical
   packages/ui/src/ui/primitives/IconButton.tsx, and it had no caller outside
   /dev/cosmic-preview. The primitive is strictly better: `label` is a required
   prop (this copy relied on the caller remembering `aria-label`), every size
   is a >= 44px square target in its own classes rather than depending on the
   global `@media (pointer: coarse)` expansion, and it has disabled/loading
   states. Import it from '@alfanumrik/ui/ui/primitives'. */
