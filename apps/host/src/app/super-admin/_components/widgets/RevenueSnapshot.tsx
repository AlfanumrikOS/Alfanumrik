'use client';

import { StalenessTag } from '@alfanumrik/ui/admin-ui';
import type { AnalyticsData } from './control-room-types';

interface RevenueSnapshotProps {
  analytics: AnalyticsData | null;
  lastUpdated: Date | null;
}

/**
 * Phase 3 Master Control tile — Revenue snapshot.
 *
 * Reuses the plan-distribution block of the already-fetched
 * /api/super-admin/analytics response (`revenue: { plan, count }[]`) — zero
 * additional requests. MRR is intentionally NOT shown: no existing endpoint
 * computes MRR (plan pricing lives server-side in the payments domain), so
 * that half of the tile is deferred to backend (see Phase 3 report).
 */
export default function RevenueSnapshot({ analytics, lastUpdated }: RevenueSnapshotProps) {
  if (!analytics) return null;
  const plans = analytics.revenue ?? [];
  const paid = plans.filter(p => p.plan !== 'free');
  const paidCount = paid.reduce((sum, p) => sum + p.count, 0);
  const totalCount = plans.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="mb-4 rounded-lg border border-surface-3 bg-surface-1 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground">Revenue Snapshot</span>
          <StalenessTag lastUpdated={lastUpdated} thresholdMinutes={5} />
        </div>
        <a
          href="/super-admin/subscriptions"
          className="text-[11px] font-medium text-muted-foreground no-underline hover:text-foreground"
        >
          Subscriptions {'→'}
        </a>
      </div>
      <div className="flex flex-wrap items-center gap-5">
        <div>
          <div className="text-lg font-extrabold leading-tight text-foreground">{paidCount}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Active paid subs
          </div>
        </div>
        <div>
          <div className="text-lg font-extrabold leading-tight text-foreground">{totalCount}</div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Total students
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plans.map(p => (
            <span
              key={p.plan}
              className="rounded-full border border-surface-3 bg-surface-2 px-2 py-0.5 text-[11px] text-foreground"
            >
              <span className="font-semibold">{p.plan}</span>{' '}
              <span className="text-muted-foreground">{p.count}</span>
            </span>
          ))}
          {plans.length === 0 && (
            <span className="text-[11px] text-muted-foreground">No subscription data yet</span>
          )}
        </div>
      </div>
    </div>
  );
}
