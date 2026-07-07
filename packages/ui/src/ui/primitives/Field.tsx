'use client';

import {
  createContext,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';
import { cn } from '@alfanumrik/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   Field — canonical primitive (Phase 2 Batch B1)

   The accessibility backbone for every text-entry control. Renders a
   <label> + control (children) + optional hint + error, and auto-wires
   the ids so the control receives:
     - id                (matched by the label's htmlFor)
     - aria-describedby   (hint id + error id, space-joined)
     - aria-invalid       (true when `error` is set)
     - required           (from `required`)
   Wiring is delivered through FieldContext: Input / Textarea / Select
   consume it via `useFieldControl()`, so `<Field><Input/></Field>` just
   works with zero prop threading. Explicit props on the control always
   win over the context (escape hatch).

   Required is signalled with a shape (asterisk glyph) + a screen-reader
   word — never colour alone (P-a11y). All copy is passed in (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/**
 * Merge Field context wiring into a control's own props. Explicit props
 * on the control take precedence; context fills the gaps. Returns the
 * a11y-critical props ready to spread onto a native form control.
 */
export function useFieldControl(
  props: Pick<
    InputHTMLAttributes<HTMLElement>,
    'id' | 'aria-describedby' | 'aria-invalid' | 'required' | 'disabled'
  > = {},
): {
  id: string | undefined;
  'aria-describedby': string | undefined;
  'aria-invalid': boolean | undefined;
  required: boolean | undefined;
  disabled: boolean | undefined;
} {
  const ctx = useContext(FieldContext);
  const describedBy =
    [props['aria-describedby'], ctx?.describedBy].filter(Boolean).join(' ') ||
    undefined;
  const invalidExplicit =
    props['aria-invalid'] === true || props['aria-invalid'] === 'true';
  return {
    id: props.id ?? ctx?.id,
    'aria-describedby': describedBy,
    'aria-invalid': invalidExplicit || ctx?.invalid || undefined,
    required: props.required ?? ctx?.required,
    disabled: props.disabled ?? ctx?.disabled,
  };
}

export interface FieldProps {
  /** Visible, associated label copy (caller localises — P7). */
  label: ReactNode;
  /** Explicit control id. Auto-generated with useId when omitted. */
  htmlFor?: string;
  /** Helper text below the label. Wired into aria-describedby. */
  hint?: ReactNode;
  /** Error message. Presence sets aria-invalid + role="alert". */
  error?: ReactNode;
  /** Marks the control required (asterisk + SR word + required attr). */
  required?: boolean;
  /** Renders an "(optional)" affordance beside the label. */
  optional?: boolean;
  /** Disables the wrapped control via context. */
  disabled?: boolean;
  /** SR-only word announced for the required marker (default "required"). */
  requiredText?: string;
  /** Visible "(optional)" copy (bilingual — caller localises). */
  optionalText?: ReactNode;
  /** Optional decorative leading icon for the error line. */
  errorIcon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const DEFAULT_ERROR_ICON = (
  <svg viewBox="0 0 16 16" width="1em" height="1em" fill="currentColor" aria-hidden="true">
    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 3.25a.9.9 0 0 1 .9.9v3.2a.9.9 0 1 1-1.8 0v-3.2a.9.9 0 0 1 .9-.9Zm0 6.1a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />
  </svg>
);

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  requiredText = 'required',
  optionalText,
  errorIcon,
  children,
  className,
}: FieldProps) {
  const autoId = useId();
  const id = htmlFor ?? autoId;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const invalid = error != null && error !== false;

  const describedBy =
    [hint != null ? hintId : null, invalid ? errorId : null]
      .filter(Boolean)
      .join(' ') || undefined;

  const ctx: FieldContextValue = { id, describedBy, invalid, required, disabled };

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={id}
        className={cn(
          'flex items-center gap-1.5 text-fluid-sm font-semibold text-foreground',
          disabled && 'opacity-60',
        )}
      >
        <span>{label}</span>
        {required && (
          <span className="text-danger" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only">{requiredText}</span>}
        {optional && optionalText != null && (
          <span className="font-normal text-muted-foreground">{optionalText}</span>
        )}
      </label>

      <FieldContext.Provider value={ctx}>{children}</FieldContext.Provider>

      {hint != null && (
        <p id={hintId} className="text-fluid-xs text-muted-foreground">
          {hint}
        </p>
      )}

      {invalid && (
        <p
          id={errorId}
          role="alert"
          className="flex items-center gap-1 text-fluid-xs font-medium text-danger"
        >
          <span aria-hidden="true" className="inline-flex shrink-0">
            {errorIcon ?? DEFAULT_ERROR_ICON}
          </span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
