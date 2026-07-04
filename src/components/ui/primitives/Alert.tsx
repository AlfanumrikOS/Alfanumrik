'use client';

import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { IconButton } from './IconButton';
import { TONE_VAR } from './tokens';

/* ═══════════════════════════════════════════════════════════════
   Alert — canonical primitive (Phase 2 Batch B3)

   Inline (NOT floating) status banner. A11y contract:
     - tone info / success / warning / danger, each with a DISTINCT
       default glyph (non-colour signal) that callers can override.
     - danger + warning render role="alert" (assertive — the user
       should be interrupted); info + success render role="status".
     - ink text on a pale tone tint (mixed against the opaque surface,
       like Badge soft) so copy is AA on every tone — the tone hue is
       an accent (icon + hairline border), never warning-gold-as-text.
     - optional title + description (children) + action slot + a
       dismiss IconButton (aria-label via `dismissLabel` — P7).

   All copy comes through props/children — bilingual-safe (P7).
   ═══════════════════════════════════════════════════════════════ */

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

/** Distinct default glyph per tone — a non-colour signal. */
const TONE_GLYPH: Record<AlertTone, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  danger: '✕',
};

/** Assertive tones interrupt; the calmer tones are polite. */
const TONE_ROLE: Record<AlertTone, 'alert' | 'status'> = {
  info: 'status',
  success: 'status',
  warning: 'alert',
  danger: 'alert',
};

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: AlertTone;
  /** Optional heading line. */
  title?: ReactNode;
  /** Override the default tone glyph (decorative, aria-hidden). */
  icon?: ReactNode;
  /** Optional trailing action node (e.g. a <Button>). */
  action?: ReactNode;
  /** Fires the dismiss control; omit for a non-dismissible banner. */
  onDismiss?: () => void;
  /** Required aria-label for the dismiss button when `onDismiss` is set (P7). */
  dismissLabel?: string;
  /** Body copy. */
  children?: ReactNode;
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { tone = 'info', title, icon, action, onDismiss, dismissLabel, className, children, ...props },
  ref,
) {
  const toneVar = TONE_VAR[tone];

  return (
    <div
      ref={ref}
      role={TONE_ROLE[tone]}
      className={cn(
        'flex items-start gap-3 rounded-xl border px-4 py-3 text-foreground',
        className,
      )}
      style={{
        // Pale tint over the opaque surface → ink text stays AA on every tone.
        backgroundColor: `color-mix(in srgb, ${toneVar} 12%, var(--surface-1))`,
        borderColor: `color-mix(in srgb, ${toneVar} 34%, transparent)`,
      }}
      {...props}
    >
      <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-fluid-base font-bold" style={{ color: toneVar }}>
        {icon ?? TONE_GLYPH[tone]}
      </span>
      <div className="min-w-0 flex-1">
        {title != null && <p className="text-fluid-sm font-bold text-foreground">{title}</p>}
        {children != null && (
          <div className={cn('text-fluid-sm text-muted-foreground', title != null && 'mt-0.5')}>{children}</div>
        )}
        {action != null && <div className="mt-2.5">{action}</div>}
      </div>
      {onDismiss != null && (
        <IconButton
          variant="ghost"
          size="sm"
          label={dismissLabel ?? ''}
          icon={<span aria-hidden="true">✕</span>}
          onClick={onDismiss}
          className="-me-1.5 -mt-1 shrink-0"
        />
      )}
    </div>
  );
});
