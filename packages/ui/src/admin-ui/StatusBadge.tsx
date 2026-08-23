'use client';

/**
 * StatusBadge — shared admin-ui primitive (lifted from
 * src/app/super-admin/_components/StatusBadge.tsx in Plan 0 Task 3).
 *
 * Built on Tailwind semantic tokens defined in tailwind.config.js. Uses a
 * variant→class map so JIT picks up every class.
 *
 * ── Contrast contract (repaired 2026-08-15) ──────────────────────────────
 * This badge previously painted the tone as its OWN text colour on a 10% tint
 * of that same tone. Every variant failed WCAG AA, some catastrophically:
 *   warning #F5A623 1.89:1 · success #16A34A 2.95:1 · info #0891B2 3.27:1 ·
 *   danger #DC2626 4.14:1
 * — and it contradicted the rule the sibling primitive states in a comment
 * (primitives/Badge.tsx: "Warning never renders gold-as-text").
 *
 * Two things were wrong, and both are fixed here:
 *
 *  1. The tint mixed into `transparent`, so the composited backdrop was
 *     whatever happened to paint behind the badge — the contrast was
 *     literally undefined, and on --surface-3 even a corrected foreground
 *     dropped to 3.67:1. It now mixes into the OPAQUE var(--surface-1),
 *     which is the recipe primitives/Badge.tsx:37 already uses. The tint is
 *     now backdrop-independent, so the ratios below hold everywhere.
 *
 *  2. The foreground now comes from the `*-strong` family (globals.css
 *     :root) instead of the raw fill hue. Verified against the exact tint
 *     each one sits on:
 *       success #166534 on #E8F6ED = 6.38:1
 *       warning #B45309 on #FEF6E9 = 4.68:1
 *       info    #0E7490 on #E6F4F7 = 4.76:1
 *       danger  #B91C1C on #FCE9E9 = 5.54:1
 *       neutral --text-3 on --surface-2 = 5.4:1 (unchanged, already passing)
 *
 * Keep both halves. Reverting either one re-breaks AA.
 */

export type StatusBadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

const variantClasses: Record<StatusBadgeVariant, string> = {
  success: 'bg-[color-mix(in_srgb,var(--success)_10%,var(--surface-1))] text-success-strong',
  danger: 'bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface-1))] text-danger-strong',
  warning: 'bg-[color-mix(in_srgb,var(--warning)_10%,var(--surface-1))] text-warning-strong',
  info: 'bg-[color-mix(in_srgb,var(--info)_10%,var(--surface-1))] text-info-strong',
  neutral: 'bg-surface-2 text-muted-foreground',
};

export interface StatusBadgeProps {
  label: string;
  variant?: StatusBadgeVariant;
}

export function StatusBadge({ label, variant = 'neutral' }: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-xl px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${variantClasses[variant]}`}
    >
      {label}
    </span>
  );
}

export default StatusBadge;
