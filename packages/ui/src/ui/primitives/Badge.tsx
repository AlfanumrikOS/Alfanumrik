'use client';

import { type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@alfanumrik/lib/utils';
import { TONE_VAR, TONE_SOLID_FG, type Tone } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Badge — canonical primitive (Phase 2 Batch A)

   Tones: neutral / success / warning / danger / info / brand.
   Variants:
     - soft  pale tone tint + INK text (always AA) + tone hairline
     - solid tone fill + AA foreground (white on danger/brand, ink on the
       light tones). Warning never renders gold-as-text (design §2/§8).

   Non-interactive status label. Copy comes from `children` (P7).
   ═══════════════════════════════════════════════════════════════ */

export type BadgeVariant = 'soft' | 'solid';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  variant?: BadgeVariant;
  /** Optional decorative leading glyph (aria-hidden). */
  icon?: ReactNode;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', variant = 'soft', icon, className, children, ...props }: BadgeProps) {
  const toneVar = TONE_VAR[tone];

  const style =
    variant === 'solid'
      ? { backgroundColor: toneVar, color: TONE_SOLID_FG[tone] }
      : {
          // Pale tint mixed with the opaque surface so text stays crisp;
          // ink foreground guarantees AA on every tone.
          backgroundColor: `color-mix(in srgb, ${toneVar} 14%, var(--surface-1))`,
          color: 'var(--text-1)',
          borderColor: `color-mix(in srgb, ${toneVar} 34%, transparent)`,
        };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-fluid-xs font-semibold leading-normal',
        variant === 'soft' && 'border',
        className,
      )}
      style={style}
      {...props}
    >
      {icon != null && <span aria-hidden="true" className="inline-flex">{icon}</span>}
      {children}
    </span>
  );
}
