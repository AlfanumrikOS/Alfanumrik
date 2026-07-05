'use client';

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Radio / RadioGroup — canonical primitives (Phase 2 Batch B1)

   Native <input type="radio"> under the hood → real roving focus,
   arrow-key navigation and screen-reader grouping for free. RadioGroup
   wraps the set in a <fieldset> + <legend> (the group label) and wires a
   shared name + hint/error via aria-describedby on the fieldset. Each
   Radio has a 44px hit target (min-h-11 label) though the dot is 20px.
   Selection is native (not colour only). Copy from props (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface RadioProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Associated option label (caller localises — P7). */
  label: ReactNode;
}

export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
  { label, id, className, disabled, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex min-h-11 items-center gap-2.5 text-fluid-sm text-foreground',
        disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
        <input
          ref={ref}
          id={inputId}
          type="radio"
          disabled={disabled}
          {...props}
          className={cn(
            'peer h-5 w-5 shrink-0 appearance-none rounded-full border border-surface-3 bg-surface-1',
            'transition-colors duration-150 ease-out motion-reduce:transition-none',
            'checked:border-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
            'disabled:cursor-not-allowed',
          )}
        />
        <span className="pointer-events-none absolute h-2.5 w-2.5 rounded-full bg-primary opacity-0 peer-checked:opacity-100" />
      </span>
      <span>{label}</span>
    </label>
  );
});

export interface RadioGroupOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Shared input name — required to group native radios. */
  name: string;
  /** Group label rendered as the fieldset <legend>. */
  label: ReactNode;
  options: RadioGroupOption[];
  /** Controlled selected value. */
  value?: string;
  /** Uncontrolled initial value. */
  defaultValue?: string;
  onChange?: (value: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Stack (default) or inline the options. */
  orientation?: 'vertical' | 'horizontal';
  /** SR-only word for the required marker (default "required"). */
  requiredText?: string;
  className?: string;
}

export function RadioGroup({
  name,
  label,
  options,
  value,
  defaultValue,
  onChange,
  hint,
  error,
  required = false,
  disabled = false,
  orientation = 'vertical',
  requiredText = 'required',
  className,
}: RadioGroupProps) {
  const groupId = useId();
  const hintId = `${groupId}-hint`;
  const errorId = `${groupId}-error`;
  const invalid = error != null && error !== false;
  const describedBy =
    [hint != null ? hintId : null, invalid ? errorId : null].filter(Boolean).join(' ') || undefined;
  const isControlled = value !== undefined;

  return (
    <fieldset
      className={cn('flex flex-col gap-1.5', className)}
      aria-describedby={describedBy}
      aria-invalid={invalid || undefined}
      aria-required={required || undefined}
      disabled={disabled}
    >
      <legend className="flex items-center gap-1.5 text-fluid-sm font-semibold text-foreground">
        <span>{label}</span>
        {required && (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only">{requiredText}</span>}
      </legend>

      <div
        className={cn(
          'flex gap-x-5 gap-y-1',
          orientation === 'vertical' ? 'flex-col' : 'flex-row flex-wrap',
        )}
      >
        {options.map((opt) => (
          <Radio
            key={opt.value}
            name={name}
            value={opt.value}
            label={opt.label}
            disabled={opt.disabled}
            {...(isControlled
              ? { checked: value === opt.value }
              : { defaultChecked: defaultValue === opt.value })}
            onChange={onChange ? () => onChange(opt.value) : undefined}
          />
        ))}
      </div>

      {hint != null && (
        <p id={hintId} className="text-fluid-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {invalid && (
        <p id={errorId} role="alert" className="text-fluid-xs font-medium text-danger">
          {error}
        </p>
      )}
    </fieldset>
  );
}
