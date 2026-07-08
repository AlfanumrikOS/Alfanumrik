'use client';

import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';
import {
  CONTROL_TEXT_BASE,
  CONTROL_TEXT_SIZE,
  CONTROL_INVALID,
  type ControlSize,
} from './tokens';
import { useFieldControl } from './Field';

/* ═══════════════════════════════════════════════════════════════
   Input — canonical primitive (Phase 2 Batch B1)

   Native <input> styled to tokens. text/email/password/number/search…
   Sizes sm/md/lg (md = 48px touch target). Auto-consumes Field context
   for id / aria-describedby / aria-invalid / required / disabled, so it
   "just works" inside <Field>. Optional leading/trailing adornment slots
   (decorative icon or a unit like "kg"). Bilingual-safe: no baked copy —
   placeholder is passed in (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: ControlSize;
  /** Decorative leading adornment (icon / unit). Non-interactive. */
  leadingAdornment?: ReactNode;
  /** Decorative trailing adornment (icon / unit). Non-interactive. */
  trailingAdornment?: ReactNode;
}

/** Horizontal padding per size (kept off the shared map so adornment math is local). */
const PAD_X: Record<ControlSize, string> = {
  sm: 'px-3',
  md: 'px-3.5',
  lg: 'px-4',
};

/** Extra inner padding when an adornment occupies the edge. */
const PAD_ADORNED: Record<ControlSize, { lead: string; trail: string }> = {
  sm: { lead: 'pl-9', trail: 'pr-9' },
  md: { lead: 'pl-10', trail: 'pr-10' },
  lg: { lead: 'pl-11', trail: 'pr-11' },
};

const ADORN_POS: Record<ControlSize, { lead: string; trail: string }> = {
  sm: { lead: 'left-3', trail: 'right-3' },
  md: { lead: 'left-3.5', trail: 'right-3.5' },
  lg: { lead: 'left-4', trail: 'right-4' },
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    size = 'md',
    leadingAdornment,
    trailingAdornment,
    className,
    type = 'text',
    ...props
  },
  ref,
) {
  const field = useFieldControl(props);
  const invalid = field['aria-invalid'] === true;
  const hasLead = leadingAdornment != null;
  const hasTrail = trailingAdornment != null;

  const control = (
    <input
      ref={ref}
      type={type}
      {...props}
      {...field}
      className={cn(
        CONTROL_TEXT_BASE,
        CONTROL_TEXT_SIZE[size],
        hasLead ? PAD_ADORNED[size].lead : PAD_X[size],
        hasTrail ? PAD_ADORNED[size].trail : PAD_X[size],
        invalid && CONTROL_INVALID,
        className,
      )}
    />
  );

  if (!hasLead && !hasTrail) return control;

  return (
    <div className="relative">
      {hasLead && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 inline-flex items-center text-fluid-sm text-muted-foreground',
            ADORN_POS[size].lead,
          )}
        >
          {leadingAdornment}
        </span>
      )}
      {control}
      {hasTrail && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute top-1/2 -translate-y-1/2 inline-flex items-center text-fluid-sm text-muted-foreground',
            ADORN_POS[size].trail,
          )}
        >
          {trailingAdornment}
        </span>
      )}
    </div>
  );
});
