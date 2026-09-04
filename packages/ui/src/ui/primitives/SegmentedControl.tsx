'use client';

import { type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';

/* ═══════════════════════════════════════════════════════════════
   SegmentedControl — canonical primitive (Gate-2 B2)

   A single-select button group for a small, fixed set of mutually
   exclusive options (2-5) — e.g. billing period, view mode. Generalizes
   the hand-rolled pattern already shipped in
   packages/ui/src/landing/v3/PricingHeroV3.tsx's Monthly/Yearly toggle:
   role="group" + a button per option with aria-pressed, NOT role="tablist"
   — a segmented control selects a VALUE (like a radio group), it does not
   switch between panels of different content the way Tabs does. Use Tabs
   (Tabs.tsx) when the options control which content panel is shown; use
   this when they just pick a value.

   Controlled (`value` + `onValueChange`) or uncontrolled (`defaultValue`),
   matching Tabs' API shape. Copy comes from each option's `label`
   (bilingual-safe, P7).
   ═══════════════════════════════════════════════════════════════ */

export interface SegmentedControlOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Accessible name for the group (P7). */
  'aria-label': string;
  className?: string;
}

export function SegmentedControl({
  options,
  value: controlled,
  defaultValue,
  onValueChange,
  className,
  ...props
}: SegmentedControlProps) {
  const isControlled = controlled !== undefined;
  const resolved = isControlled ? controlled : (defaultValue ?? options[0]?.value);

  return (
    <div
      role="group"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-lg border border-surface-3 bg-surface-2 p-0.5',
        className,
      )}
      {...props}
    >
      {options.map((opt) => {
        const selected = resolved === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={selected}
            disabled={opt.disabled}
            onClick={() => {
              if (opt.disabled) return;
              onValueChange?.(opt.value);
            }}
            className={cn(
              'inline-flex h-9 items-center justify-center rounded-md px-3.5 text-fluid-sm font-semibold whitespace-nowrap',
              'transition-colors duration-150 ease-out motion-reduce:transition-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'bg-surface-1 text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
