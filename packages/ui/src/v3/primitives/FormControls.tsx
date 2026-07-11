'use client';

import { forwardRef, useId, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

interface FieldShellProps {
  id?: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

function FieldShell({ id, label, hint, error, required, children }: FieldShellProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="v3-field">
      <label htmlFor={id} className="v3-field__label">
        {label}{required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {hint ? <span id={hintId} className="v3-field__hint">{hint}</span> : null}
      {error ? <span id={errorId} className="v3-field__error" role="alert">{error}</span> : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, required, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id || props.name || generatedId;
  const describedBy = [props['aria-describedby'], hint && `${fieldId}-hint`, error && `${fieldId}-error`]
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <input
        {...props}
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={`v3-input ${className}`.trim()}
      />
    </FieldShell>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id, required, className = '', ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id || props.name || generatedId;
  const describedBy = [props['aria-describedby'], hint && `${fieldId}-hint`, error && `${fieldId}-error`]
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <textarea
        {...props}
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={`v3-input v3-textarea ${className}`.trim()}
      />
    </FieldShell>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  hint?: string;
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, id, required, className = '', children, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id || props.name || generatedId;
  const describedBy = [props['aria-describedby'], hint && `${fieldId}-hint`, error && `${fieldId}-error`]
    .filter(Boolean)
    .join(' ') || undefined;
  return (
    <FieldShell id={fieldId} label={label} hint={hint} error={error} required={required}>
      <select
        {...props}
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={describedBy}
        className={`v3-input v3-select ${className}`.trim()}
      >
        {children}
      </select>
    </FieldShell>
  );
});
