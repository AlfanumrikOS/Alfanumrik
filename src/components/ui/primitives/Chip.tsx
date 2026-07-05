'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { TONE_VAR, type Tone } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Chip — canonical primitive (Phase 2 Batch A)

   Selectable filter chip. Renders a real <button> with aria-pressed so
   the selected state is exposed to assistive tech (not colour-only).
   Tone-aware selected fill; >= 44px touch target. Copy from `children` (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Pressed / filter-active state (exposed via aria-pressed). */
  selected?: boolean;
  tone?: Tone;
  /** Decorative leading glyph (aria-hidden). */
  icon?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { selected = false, tone = 'brand', icon, disabled, className, children, type = 'button', ...props },
  ref,
) {
  const toneVar = TONE_VAR[tone];

  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(
        'inline-flex h-11 select-none items-center gap-1.5 rounded-full border px-4 text-fluid-sm font-semibold',
        'transition-colors duration-150 ease-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'disabled:pointer-events-none disabled:opacity-50',
        !selected && 'border-surface-3 bg-surface-1 text-muted-foreground hover:bg-surface-2',
        className,
      )}
      // Selected state uses a tone tint + tone border + ink text (AA); the
      // aria-pressed flag is the non-colour signal.
      style={
        selected
          ? {
              backgroundColor: `color-mix(in srgb, ${toneVar} 16%, var(--surface-1))`,
              borderColor: `color-mix(in srgb, ${toneVar} 45%, transparent)`,
              color: 'var(--text-1)',
            }
          : undefined
      }
      {...props}
    >
      {icon != null && <span aria-hidden="true" className="inline-flex">{icon}</span>}
      {children}
    </button>
  );
});
