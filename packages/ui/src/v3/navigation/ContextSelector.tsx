'use client';

export interface ContextOption {
  value: string;
  label: string;
  description?: string;
}

export interface ContextSelectorProps {
  label: string;
  value: string;
  options: ContextOption[];
  onChange?: (value: string) => void;
  name?: string;
  disabled?: boolean;
}

export function ContextSelector({ label, value, options, onChange, name = 'v3-context', disabled }: ContextSelectorProps) {
  return (
    <label className="v3-context-selector">
      <span className="v3-context-selector__label">{label}</span>
      <select name={name} value={value} disabled={disabled} onChange={(event) => onChange?.(event.currentTarget.value)} aria-label={label}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}
