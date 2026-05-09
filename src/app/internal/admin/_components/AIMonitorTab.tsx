'use client';

/**
 * AIMonitorTab — internal-admin AI Monitor tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/ai-monitor — { summary, hourly[], top_subjects[] }
 *   - StatCards: total requests, errors, error rate
 *   - Inline hourly bar chart + top-subjects horizontal bars
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { StatCard } from '@/components/admin-ui';
import { useAdminFetch } from '../_hooks/useAdminFetch';

const C = {
  bg3: '#161b22',
  border: '#21262d',
  text3: '#484f58',
  purple: '#a855f7',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  card: { padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg3 },
  btn: (color: string = C.purple): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
  h2: { fontSize: 11, fontWeight: 700, color: C.text3, textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 14 },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  gridAuto: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 },
};

export interface AIMonitorTabProps {
  secret: string;
}

export default function AIMonitorTab({ secret }: AIMonitorTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [aiData, setAiData] = useState<Record<string, unknown> | null>(null);

  const fetchAI = useCallback(async () => {
    try {
      const d = await apiFetch<Record<string, unknown>>('/api/internal/admin/ai-monitor');
      setAiData(d);
    } catch { /* preserve pre-refactor "if (res.ok)" silent failure */ }
  }, [apiFetch]);

  useEffect(() => {
    fetchAI();
  }, [fetchAI]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>AI Monitor</div>
        <button onClick={fetchAI} style={S.btn(C.purple)}>↻ Refresh</button>
      </div>

      {aiData && (
        <>
          <div style={{ ...S.gridAuto, marginBottom: 20 }}>
            <StatCard label="Total Requests (24h)" value={(aiData.summary as Record<string, number>)?.total_requests_24h ?? 0} accentColor="#a855f7" />
            <StatCard label="Errors (24h)" value={(aiData.summary as Record<string, number>)?.total_errors_24h ?? 0} accentColor="#ef4444" />
            <StatCard label="Error Rate" value={`${(aiData.summary as Record<string, number>)?.error_rate_pct ?? 0}%`} accentColor="#f59e0b" />
          </div>

          <div style={S.grid2}>
            {/* Hourly chart */}
            <div style={S.card}>
              <div style={S.h2}>Hourly Requests — Last 24h</div>
              <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 60 }}>
                {((aiData.hourly as Array<Record<string, unknown>>) || []).map((h, i) => {
                  const maxReq = Math.max(...((aiData.hourly as Array<Record<string, unknown>>) || []).map(x => Number(x.requests)), 1);
                  const barH = Math.max(3, Math.round((Number(h.requests) / maxReq) * 56));
                  return (
                    <div key={i} style={{ flex: 1, height: barH, background: `${C.purple}70`, borderRadius: 1 }}
                      title={`${h.requests} calls at ${h.hour}`} />
                  );
                })}
              </div>
            </div>

            {/* Subject heat-map */}
            <div style={S.card}>
              <div style={S.h2}>Top Subjects (24h)</div>
              {((aiData.top_subjects as Array<{ subject: string; count: number }>) || []).map((s, i) => {
                const max = ((aiData.top_subjects as Array<{ count: number }>) || [])[0]?.count || 1;
                return (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
                      <span>{s.subject}</span><span style={{ color: C.purple, fontWeight: 600 }}>{s.count}</span>
                    </div>
                    <div style={{ height: 4, borderRadius: 2, background: C.border }}>
                      <div style={{ height: '100%', width: `${(s.count / max) * 100}%`, background: C.purple, borderRadius: 2 }} />
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
