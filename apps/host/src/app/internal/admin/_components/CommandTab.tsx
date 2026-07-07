'use client';

/**
 * CommandTab — internal-admin Command Center tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/command-center — totals / activity / ai / revenue
 *     / support / sparkline (CommandData)
 *   - StatCards for platform scale + today's activity
 *   - 3-column bottom row: AI engine, Revenue, Support queue
 *   - 7-day quiz-activity bar chart (sparkline)
 *   - "View Queue →" button on Support card now uses onNavigate('support')
 *     (parent owns active-tab state).
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { StatCard } from '@alfanumrik/ui/admin-ui';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { CommandData, Tab } from '../_lib/internal-admin-types';

const C = {
  bg3: '#161b22',
  border: '#21262d',
  text2: '#8b949e',
  text3: '#484f58',
  orange: '#E8581C',
  green: '#22c55e',
  red: '#ef4444',
  purple: '#a855f7',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  card: { padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg3 },
  btn: (color: string = C.orange): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
  h2: { fontSize: 11, fontWeight: 700, color: C.text3, textTransform: 'uppercase' as const, letterSpacing: 1.5, marginBottom: 14 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 },
  gridAuto: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 },
};

export interface CommandTabProps {
  secret: string;
  onNavigate?: (tab: Tab) => void;
}

export default function CommandTab({ secret, onNavigate }: CommandTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [command, setCommand] = useState<CommandData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchCommand = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<CommandData>('/api/internal/admin/command-center');
      setCommand(d);
    } catch { /* preserve pre-refactor "if (res.ok)" silent failure */ }
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => {
    fetchCommand();
  }, [fetchCommand]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Command Center</div>
          <div style={{ fontSize: 11, color: C.text3 }}>Live platform health — refreshes on tab visit</div>
        </div>
        <button onClick={fetchCommand} style={S.btn()}>↻ Refresh</button>
      </div>

      {command ? (
        <>
          {/* KPI Row 1 — Platform */}
          <div style={S.h2}>Platform Scale</div>
          <div style={{ ...S.gridAuto, marginBottom: 20 }}>
            <StatCard label="Active Students" value={command.totals.students} accentColor="#E8581C" />
            <StatCard label="Teachers" value={command.totals.teachers} accentColor="#3b82f6" />
            <StatCard label="Parents" value={command.totals.guardians} accentColor="#22c55e" />
            <StatCard label="Schools" value={command.totals.schools} accentColor="#a855f7" />
            <StatCard label="Premium Users" value={command.totals.premium_students} accentColor="#f59e0b" subtitle={`${command.totals.basic_students} Basic`} />
          </div>

          {/* KPI Row 2 — Activity */}
          <div style={S.h2}>Today&#39;s Activity</div>
          <div style={{ ...S.gridAuto, marginBottom: 20 }}>
            <StatCard label="DAU" value={command.activity.dau} accentColor="#E8581C" />
            <StatCard label="WAU" value={command.activity.wau} accentColor="#3b82f6" />
            <StatCard label="New Signups (24h)" value={command.activity.new_students_24h} accentColor="#22c55e" subtitle={`+${command.activity.new_students_7d} this week`} />
            <StatCard label="Quiz Sessions (24h)" value={command.activity.quiz_sessions_24h} accentColor="#f59e0b" />
            <StatCard label="AI Chats (24h)" value={command.activity.chat_sessions_24h} accentColor="#a855f7" />
          </div>

          {/* Bottom row — AI + Revenue + Support */}
          <div style={S.grid3}>
            <div style={S.card}>
              <div style={S.h2}>AI Engine</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.purple }}>{command.ai.calls_last_1h}</div>
              <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>CALLS THIS HOUR</div>
              <div style={{ fontSize: 12, color: C.text2, marginTop: 8 }}>{command.ai.calls_last_24h.toLocaleString()} in last 24h</div>
            </div>
            <div style={S.card}>
              <div style={S.h2}>Revenue</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: C.green }}>₹{Math.round(command.revenue.today_inr).toLocaleString()}</div>
              <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>TODAY</div>
              <div style={{ fontSize: 12, color: C.text2, marginTop: 8 }}>
                ₹{Math.round(command.revenue.last_7d_inr).toLocaleString()} (7d) · ₹{Math.round(command.revenue.last_30d_inr).toLocaleString()} (30d)
              </div>
            </div>
            <div style={S.card}>
              <div style={S.h2}>Support Queue</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: command.support.open_tickets > 5 ? C.red : C.green }}>
                {command.support.open_tickets}
              </div>
              <div style={{ fontSize: 10, color: C.text3, marginTop: 2 }}>OPEN TICKETS</div>
              <button onClick={() => onNavigate?.('support')} style={{ ...S.btn(), marginTop: 10, fontSize: 11 }}>View Queue →</button>
            </div>
          </div>

          {/* Sparkline chart */}
          {command.sparkline.length > 0 && (
            <div style={{ ...S.card, marginTop: 16 }}>
              <div style={{ ...S.h2, marginBottom: 10 }}>Quiz Activity — Last 7 Days</div>
              <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 60 }}>
                {command.sparkline.map((s, i) => {
                  const max = Math.max(...command.sparkline.map(x => x.quizzes), 1);
                  const h = Math.max(4, Math.round((s.quizzes / max) * 56));
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ width: '100%', height: h, background: `${C.orange}80`, borderRadius: 3, minHeight: 4 }} title={`${s.quizzes} quizzes`} />
                      <div style={{ fontSize: 9, color: C.text3 }}>{s.date.slice(5)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: 60, color: C.text3 }}>
          {loading ? '⟳ Loading metrics...' : 'No data. Click Refresh.'}
        </div>
      )}
    </div>
  );
}
