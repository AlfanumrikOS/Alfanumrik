'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { ActionVariant, ControlSize } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   IconButton — canonical primitive (Phase 2 Batch A)

   Square, single-icon action. An accessible label is REQUIRED
   (`label`, rendered as aria-label) — there is no visible text.
   Same variants/sizes as Button; every size is a >= 44px touch target.
   ═══════════════════════════════════════════════════════════════ */

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'children'> {
  /** REQUIRED accessible name (there is no visible label). */
  label: string;
  icon: ReactNode;
  variant?: ActionVariant;
  size?: ControlSize;
  loading?: boolean;
}

const SIZE: Record<ControlSize, string> = {
  sm: 'h-11 w-11 rounded-lg',
  md: 'h-12 w-12 rounded-lg',
  lg: 'h-14 w-14 rounded-xl',
};

const VARIANT: Record<ActionVariant, string> = {
  primary: 'text-white hover:brightness-95',
  secondary: 'bg-surface-2 text-foreground border border-surface-3 hover:bg-surface-3',
  ghost: 'bg-transparent text-foreground hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-95',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'secondary', size = 'md', loading = false, disabled, className, type = 'button', ...props },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex shrink-0 items-center justify-center',
        'transition duration-150 ease-out',
        'active:scale-95 motion-reduce:transition-none motion-reduce:active:scale-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        SIZE[size],
        VARIANT[variant],
        className,
      )}
      style={
        variant === 'primary'
          ? { backgroundImage: 'linear-gradient(135deg, var(--btn-primary-from), var(--btn-primary-to))' }
          : undefined
      }
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
        />
      ) : (
        <span aria-hidden="true" className="inline-flex">{icon}</span>
      )}
    </button>
  );
});
