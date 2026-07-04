'use client';

import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Checkbox — canonical primitive (Phase 2 Batch B1)

   Native <input type="checkbox"> with a token-styled box. Accessibility:
     - the whole <label> is the hit target and clears 44px (min-h-11)
       even though the visual box is 20px
     - real native semantics + keyboard (space) toggle
     - focus-visible ring on the box
     - indeterminate support (set on the DOM node + a dash glyph)
     - own hint/error wired via aria-describedby
   State is carried by the native checked/indeterminate — never colour
   only. Copy comes from props (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Associated label copy (caller localises — P7). */
  label: ReactNode;
  /** Helper text below the control. Wired into aria-describedby. */
  hint?: ReactNode;
  /** Error message. Sets aria-invalid + role="alert". */
  error?: ReactNode;
  /** Tri-state: renders the dash glyph and sets node.indeterminate. */
  indeterminate?: boolean;
}

const CheckGlyph = (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m3.5 8.5 3 3 6-7" />
  </svg>
);

const DashGlyph = (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
    <path d="M4 8h8" />
  </svg>
);

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox(
    { label, hint, error, indeterminate = false, id, className, disabled, ...props },
    ref,
  ) {
    const autoId = useId();
    const inputId = id ?? autoId;
    const hintId = `${inputId}-hint`;
    const errorId = `${inputId}-error`;
    const invalid = error != null && error !== false;
    const describedBy =
      [hint != null ? hintId : null, invalid ? errorId : null].filter(Boolean).join(' ') || undefined;

    const innerRef = useRef<HTMLInputElement | null>(null);
    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    const setRefs = (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    };

    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <label
          htmlFor={inputId}
          className={cn(
            'inline-flex min-h-11 items-center gap-2.5 text-fluid-sm text-foreground',
            disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
          )}
        >
          <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
            <input
              ref={setRefs}
              id={inputId}
              type="checkbox"
              disabled={disabled}
              aria-invalid={invalid || undefined}
              aria-describedby={describedBy}
              {...props}
              className={cn(
                'peer h-5 w-5 shrink-0 appearance-none rounded-md border border-surface-3 bg-surface-1',
                'transition-colors duration-150 ease-out motion-reduce:transition-none',
                'checked:border-primary checked:bg-primary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
                'disabled:cursor-not-allowed',
                invalid && 'border-danger',
                indeterminate && 'border-primary bg-primary',
              )}
            />
            {/* Check: shown when checked (peer). */}
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white opacity-0 peer-checked:opacity-100">
              {CheckGlyph}
            </span>
            {/* Dash: shown when indeterminate (JS). */}
            {indeterminate && (
              <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-white">
                {DashGlyph}
              </span>
            )}
          </span>
          <span>{label}</span>
        </label>

        {hint != null && (
          <p id={hintId} className="pl-8 text-fluid-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {invalid && (
          <p id={errorId} role="alert" className="pl-8 text-fluid-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    );
  },
);
