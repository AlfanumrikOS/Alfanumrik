'use client';

/**
 * RevenueTab — internal-admin Revenue & Subscriptions tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/revenue?period= — { total_revenue_inr, premium_count,
 *     plan_distribution, daily_revenue[] }
 *   - Period chips: 7d / 30d / 90d
 *   - StatCards + inline daily-revenue bar chart
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { StatCard } from '@alfanumrik/ui/admin-ui';
import { useAdminFetch } from '../_hooks/useAdminFetch';

const C = {
  bg3: '#161b22',
  border: '#21262d',
  text3: '#484f58',
  green: '#22c55e',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  card: { padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg3 },
  btn: (color: string = C.green): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
  h2: { fontSize: 11, fontWeight: 700, color: C.text3, textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 14 },
  gridAuto: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 },
};

export interface RevenueTabProps {
  secret: string;
}

export default function RevenueTab({ secret }: RevenueTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [revenue, setRevenue] = useState<Record<string, unknown> | null>(null);
  const [revPeriod, setRevPeriod] = useState('30d');

  const fetchRevenue = useCallback(async () => {
    try {
      const d = await apiFetch<Record<string, unknown>>(`/api/internal/admin/revenue?period=${revPeriod}`);
      setRevenue(d);
    } catch { /* preserve pre-refactor "if (res.ok)" silent failure */ }
  }, [apiFetch, revPeriod]);

  useEffect(() => {
    fetchRevenue();
  }, [fetchRevenue]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Revenue & Subscriptions</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['7d', '30d', '90d'] as const).map(p => (
            <button key={p} onClick={() => setRevPeriod(p)}
              style={{ ...S.btn(C.green), ...(revPeriod === p ? { background: `${C.green}20`, borderColor: C.green } : {}) }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {revenue && (
        <>
          <div style={{ ...S.gridAuto, marginBottom: 20 }}>
            <StatCard label={`Revenue (${revPeriod})`} value={`₹${Math.round(revenue.total_revenue_inr as number).toLocaleString()}`} accentColor="#22c55e" />
            <StatCard label="Premium Users" value={revenue.premium_count as number} accentColor="#f59e0b" />
            {Object.entries((revenue.plan_distribution as Record<string, number>) || {}).map(([plan, count]) => (
              <StatCard key={plan} label={`${plan} plan`} value={count} accentColor={plan === 'premium' ? '#f59e0b' : plan === 'basic' ? '#3b82f6' : '#484f58'} />
            ))}
          </div>

          {/* Bar chart of daily revenue */}
          <div style={{ ...S.card }}>
            <div style={{ ...S.h2 }}>Daily Revenue — {revPeriod}</div>
            <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 80, overflowX: 'auto' }}>
              {((revenue.daily_revenue as Array<{ date: string; amount_inr: number }>) || []).map((d, i) => {
                const maxAmt = Math.max(...((revenue.daily_revenue as Array<{ amount_inr: number }>) || []).map(x => x.amount_inr), 1);
                const barH = Math.max(4, Math.round((d.amount_inr / maxAmt) * 72));
                return (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, minWidth: 20, flex: 1 }}>
                    <div style={{ width: '80%', height: barH, background: `${C.green}80`, borderRadius: 2 }} title={`₹${d.amount_inr} on ${d.date}`} />
                    <div style={{ fontSize: 8, color: C.text3, transform: 'rotate(-45deg)', transformOrigin: 'center', whiteSpace: 'nowrap' }}>
                      {d.date.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
