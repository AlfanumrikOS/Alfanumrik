'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Switch — canonical primitive (Phase 2 Batch B1)

   A native <input type="checkbox" role="switch"> styled as a sliding
   toggle. Using the native input keeps keyboard (space) toggle, form
   participation and correct on/off announcement for free; role="switch"
   makes assistive tech read it as a switch, not a checkbox. The whole
   <label> is a 44px hit target. Thumb travel respects reduced-motion.
   State is native (aria-checked derived from checked) — not colour only.
   Copy from props (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface SwitchProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'role'> {
  /** Associated label copy (caller localises — P7). */
  label: ReactNode;
  /** Place the label before the switch instead of after. */
  labelPosition?: 'start' | 'end';
}

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, labelPosition = 'end', id, className, disabled, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  const track = (
    <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
      <input
        ref={ref}
        id={inputId}
        type="checkbox"
        role="switch"
        disabled={disabled}
        {...props}
        className={cn(
          'peer h-6 w-11 shrink-0 appearance-none rounded-full bg-surface-3',
          'transition-colors duration-150 ease-out motion-reduce:transition-none',
          'checked:bg-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
          'disabled:cursor-not-allowed',
        )}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface-1 shadow-sm',
          'transition-transform duration-150 ease-out motion-reduce:transition-none',
          'peer-checked:translate-x-5',
        )}
      />
    </span>
  );

  const text = <span>{label}</span>;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex min-h-11 items-center gap-3 text-fluid-sm text-foreground',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      {labelPosition === 'start' ? (
        <>
          {text}
          {track}
        </>
      ) : (
        <>
          {track}
          {text}
        </>
      )}
    </label>
  );
});
