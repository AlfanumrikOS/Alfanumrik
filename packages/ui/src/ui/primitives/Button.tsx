'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';
import type { ActionVariant, ControlSize } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Button — canonical primitive (Phase 2 Batch A)

   Token-driven only. Variants: primary (AA-correct warm CTA gradient
   via --btn-primary-from/to), secondary, ghost, danger. Sizes sm/md/lg
   with >= 44px touch targets. Loading + disabled states, optional
   leading/trailing icon slots, full-width option. Bilingual-safe:
   all copy comes from `children` (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ActionVariant;
  size?: ControlSize;
  /** Shows a spinner, sets aria-busy, and disables interaction. */
  loading?: boolean;
  /** Stretch to the container width. */
  fullWidth?: boolean;
  /** Decorative icon before the label (aria-hidden). */
  leadingIcon?: ReactNode;
  /** Decorative icon after the label (aria-hidden). */
  trailingIcon?: ReactNode;
  children: ReactNode;
}

/** Height classes give a >= 44px (sm) / 48px (md) / 56px (lg) touch target. */
const SIZE: Record<ControlSize, string> = {
  sm: 'h-11 px-4 gap-1.5 text-fluid-sm rounded-lg',
  md: 'h-12 px-5 gap-2 text-fluid-base rounded-lg',
  lg: 'h-14 px-7 gap-2.5 text-fluid-md rounded-xl',
};

/** Non-gradient variants map to semantic Tailwind color utilities. */
const VARIANT: Record<ActionVariant, string> = {
  // primary is handled via inline gradient (see below) + white text.
  primary: 'text-white hover:brightness-95',
  secondary:
    'bg-surface-2 text-foreground border border-surface-3 hover:bg-surface-3',
  ghost: 'bg-transparent text-foreground hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-95',
};

const SPINNER = (
  <span
    aria-hidden="true"
    className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
  />
);

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    disabled,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center whitespace-nowrap font-semibold',
        'transition duration-150 ease-out',
        'active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        SIZE[size],
        VARIANT[variant],
        fullWidth && 'w-full',
        className,
      )}
      // Primary uses the AA-verified warm gradient tokens (design-system.md §8).
      style={
        variant === 'primary'
          ? { backgroundImage: 'linear-gradient(135deg, var(--btn-primary-from), var(--btn-primary-to))' }
          : undefined
      }
      {...props}
    >
      {loading ? SPINNER : leadingIcon != null && <span aria-hidden="true" className="inline-flex shrink-0">{leadingIcon}</span>}
      <span className="min-w-0">{children}</span>
      {!loading && trailingIcon != null && <span aria-hidden="true" className="inline-flex shrink-0">{trailingIcon}</span>}
    </button>
  );
});
