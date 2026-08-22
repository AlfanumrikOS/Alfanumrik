'use client';

/**
 * StatCard — shared admin-ui primitive (lifted from
 * src/app/super-admin/_components/StatCard.tsx in Plan 0 Task 2).
 *
 * Built on Tailwind semantic tokens (surface-1/2/3, foreground,
 * muted-foreground, success/danger) defined in tailwind.config.js, replacing
 * the previous inline-style hex literals from admin-styles.ts.
 *
 * `accentColor` remains a free-form CSS color string so existing super-admin
 * call sites that pass `colors.accent` etc. continue to work without an
 * import-site sweep.
 */

export interface StatCardProps {
  label: string;
  value: number | string;
  icon?: string;
  accentColor?: string;
  subtitle?: string;
  trend?: { value: number; label: string };
  onClick?: () => void;
}

export function StatCard({ label, value, icon, accentColor, subtitle, trend, onClick }: StatCardProps) {
  const isInteractive = typeof onClick === 'function';
  const trendIsPositive = trend ? trend.value >= 0 : false;

  return (
    <div
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      onKeyDown={isInteractive ? (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      } : undefined}
      style={accentColor ? { borderLeft: `3px solid ${accentColor}` } : undefined}
      className={[
        'rounded-md border border-surface-3 bg-surface-1 px-[18px] py-4 transition-shadow',
        isInteractive ? 'cursor-pointer hover:shadow-sm' : 'cursor-default',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[28px] font-extrabold leading-[1.1] text-foreground">
            {typeof value === 'number' && value >= 0 ? value.toLocaleString() : value}
          </div>
          <div className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</div>
          )}
          {trend && (
            <div
              className={[
                'mt-1 text-[11px] font-semibold',
                trendIsPositive ? 'text-success' : 'text-danger',
              ].join(' ')}
            >
              {trendIsPositive ? '+' : ''}{trend.value} {trend.label}
            </div>
          )}
        </div>
        {icon && <span className="text-[22px] opacity-70">{icon}</span>}
      </div>
    </div>
  );
}

export default StatCard;
