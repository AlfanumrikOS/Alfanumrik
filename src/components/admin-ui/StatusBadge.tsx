'use client';

/**
 * StatusBadge — shared admin-ui primitive (lifted from
 * src/app/super-admin/_components/StatusBadge.tsx in Plan 0 Task 3).
 *
 * Built on Tailwind semantic tokens (success/danger/warning/info) defined in
 * tailwind.config.js. Uses a variant→class map so JIT picks up every class.
 */

export type StatusBadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

const variantClasses: Record<StatusBadgeVariant, string> = {
  success: 'bg-success/10 text-success',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  info: 'bg-info/10 text-info',
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
