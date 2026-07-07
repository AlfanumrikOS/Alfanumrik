'use client';

import { forwardRef, type SelectHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';
import {
  CONTROL_TEXT_BASE,
  CONTROL_TEXT_SIZE,
  CONTROL_INVALID,
  type ControlSize,
} from './tokens';
import { useFieldControl } from './Field';

/* ═══════════════════════════════════════════════════════════════
   Select — canonical primitive (Phase 2 Batch B1)

   A NATIVE <select> styled to tokens. Native is the mobile-correct and
   a11y-safe choice (real OS picker, keyboard + screen-reader support);
   a custom listbox is deliberately out of scope this batch. Auto-consumes
   Field context. Optional `placeholder` renders a disabled hidden first
   option (so an empty select shows prompt text but can't be "selected").
   Chevron is a decorative token-coloured glyph. Bilingual-safe (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  size?: ControlSize;
  /** Prompt text shown when no value is selected (non-selectable). */
  placeholder?: string;
  /** Convenience options list. Ignored if `children` are provided. */
  options?: SelectOption[];
}

const PAD_L: Record<ControlSize, string> = {
  sm: 'pl-3',
  md: 'pl-3.5',
  lg: 'pl-4',
};

const Chevron = (
  <svg
    viewBox="0 0 16 16"
    width="1em"
    height="1em"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="m4 6 4 4 4-4" />
  </svg>
);

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { size = 'md', placeholder, options, className, children, defaultValue, value, ...props },
  ref,
) {
  const field = useFieldControl(props);
  const invalid = field['aria-invalid'] === true;
  // When a placeholder is present and the caller hasn't set a value, default
  // to the empty sentinel so the prompt shows.
  const isControlled = value !== undefined;
  const resolvedDefault =
    !isControlled && defaultValue === undefined && placeholder ? '' : defaultValue;

  return (
    <div className="relative">
      <select
        ref={ref}
        value={value}
        defaultValue={resolvedDefault}
        {...props}
        {...field}
        className={cn(
          CONTROL_TEXT_BASE,
          CONTROL_TEXT_SIZE[size],
          PAD_L[size],
          'appearance-none pr-10',
          invalid && CONTROL_INVALID,
          className,
        )}
      >
        {placeholder && (
          <option value="" disabled hidden>
            {placeholder}
          </option>
        )}
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 inline-flex text-muted-foreground"
      >
        {Chevron}
      </span>
    </div>
  );
});
