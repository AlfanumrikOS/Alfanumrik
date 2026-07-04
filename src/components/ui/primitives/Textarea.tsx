'use client';

import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { CONTROL_TEXT_BASE, CONTROL_INVALID } from './tokens';
import { useFieldControl } from './Field';

/* ═══════════════════════════════════════════════════════════════
   Textarea — canonical primitive (Phase 2 Batch B1)

   Native <textarea> styled to tokens. Auto-consumes Field context
   (id / aria-describedby / aria-invalid / required / disabled). Sets a
   sensible min height via `minRows`, keeps comfortable line-height, and
   allows vertical resize only (horizontal resize breaks layouts on
   360px). Bilingual-safe: placeholder passed in (P7).
   ═══════════════════════════════════════════════════════════════ */

export interface TextareaProps
  extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Minimum visible rows (drives the initial height). Default 3. */
  minRows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ minRows = 3, rows, className, ...props }, ref) {
    const field = useFieldControl(props);
    const invalid = field['aria-invalid'] === true;

    return (
      <textarea
        ref={ref}
        rows={rows ?? minRows}
        {...props}
        {...field}
        className={cn(
          CONTROL_TEXT_BASE,
          'min-h-24 resize-y px-3.5 py-2.5 text-fluid-base leading-relaxed',
          invalid && CONTROL_INVALID,
          className,
        )}
      />
    );
  },
);
