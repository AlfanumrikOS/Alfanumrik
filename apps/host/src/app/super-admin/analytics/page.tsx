'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatCard } from '@alfanumrik/ui/admin-ui';
import { BarChart, type ChartSeries } from '@alfanumrik/ui/admin-ui/charts';

interface StatsData {
  totals: { students: number };
}

interface V2Data {
  active_today: number;
  active_week: number;
  total_foxy_all_time: number;
  grade_distribution: { grade: string; count: number }[];
  feature_usage: {
    foxy: { today: number; week: number; total: number };
    quizzes: { today: number; week: number; total: number };
    stem_lab: { today: number; week: number; total: number };
    study_plans: { today: number; week: number; total: number };
  };
  subscription_distribution: Record<string, number>;
  recent_signups: {
    id: string; name: string; grade: string; board: string;
    created_at: string; subscription_plan: string;
    quiz_count: number; foxy_count: number;
  }[];
  top_active: {
    id: string; name: string; grade: string;
    foxy_sessions: number; quiz_sessions: number;
  }[];
}

// Hex literal palette (matches deprecated admin-styles.ts colors).
const C = {
  text1: '#111827',
  text2: '#6B7280',
  text3: '#9CA3AF',
  accent: '#2563EB',
  success: '#16A34A',
  warning: '#D97706',
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function planColor(plan: string): string {
  if (plan === 'unlimited') return C.warning;
  if (plan === 'pro') return '#7C3AED';
  if (plan === 'starter') return C.accent;
  return C.text3;
}

function AnalyticsContent() {
  const { apiFetch } = useAdmin();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [v2, setV2] = useState<V2Data | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [sRes, vRes] = await Promise.all([
      apiFetch('/api/super-admin/stats'),
      apiFetch('/api/super-admin/analytics-v2'),
    ]);
    if (sRes.ok) setStats(await sRes.json());
    if (vRes.ok) setV2(await vRes.json());
    setLoading(false);
  }, [apiFetch]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  if (loading && !v2) {
    return <div className="p-10 text-center text-muted-foreground">Loading analytics...</div>;
  }

  const features = [
    { label: 'Foxy AI Tutor', icon: '🦊', key: 'foxy' as const },
    { label: 'Quizzes', icon: '⚡', key: 'quizzes' as const },
    { label: 'STEM Lab', icon: '🔬', key: 'stem_lab' as const },
    { label: 'Study Plans', icon: '📋', key: 'study_plans' as const },
  ];

  const thCls = 'border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
  const tdCls = 'border-b border-surface-2 px-3.5 py-2.5 text-[13px] text-foreground';

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">Analytics Dashboard</h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            Student activity, feature usage, signups, and subscriptions
          </p>
        </div>
        <button onClick={fetchAll} className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2">&#8635; Refresh</button>
      </div>

      {/* Row 1: KPI Cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <StatCard
          label="Total Students"
          value={stats?.totals?.students ?? 0}
          icon="👥"
          accentColor={C.accent}
        />
        <StatCard
          label="Active Today"
          value={v2?.active_today ?? 0}
          icon="🟢"
          accentColor={C.success}
        />
        <StatCard
          label="Active This Week"
          value={v2?.active_week ?? 0}
          icon="📅"
          accentColor={C.warning}
        />
        <StatCard
          label="Total Foxy Sessions"
          value={v2?.total_foxy_all_time ?? 0}
          icon="🦊"
          accentColor="#EC4899"
        />
      </div>

      {/* Row 2: Grade Engagement Bar Chart */}
      {v2 && v2.grade_distribution.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Student Engagement by Grade (Last 7 Days)</h2>
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
            {(() => {
              const series: ChartSeries[] = [
                {
                  name: 'Active students',
                  data: v2.grade_distribution.map(d => ({
                    x: `Grade ${d.grade}`,
                    y: d.count,
                  })),
                },
              ];
              return <BarChart series={series} yLabel="Students" height={240} />;
            })()}
          </div>
        </div>
      )}

      {/* Row 3: Feature Usage Table */}
      {v2 && (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Feature Usage</h2>
          <div className="overflow-hidden rounded-lg border border-surface-3">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={thCls}>Feature</th>
                  <th className={`${thCls} text-right`}>Today</th>
                  <th className={`${thCls} text-right`}>This Week</th>
                  <th className={`${thCls} text-right`}>All Time</th>
                </tr>
              </thead>
              <tbody>
                {features.map(f => {
                  const usage = v2.feature_usage[f.key];
                  return (
                    <tr key={f.key}>
                      <td className={tdCls}>
                        <span className="mr-2">{f.icon}</span>
                        <strong>{f.label}</strong>
                      </td>
                      <td className={`${tdCls} text-right font-semibold`}>
                        {(usage?.today ?? 0).toLocaleString()}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        {(usage?.week ?? 0).toLocaleString()}
                      </td>
                      <td className={`${tdCls} text-right text-muted-foreground`}>
                        {(usage?.total ?? 0).toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 4: Recent Signups */}
      {v2 && v2.recent_signups.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Signups (Last 10)</h2>
          <div className="overflow-hidden rounded-lg border border-surface-3">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={thCls}>Name</th>
                  <th className={thCls}>Grade</th>
                  <th className={thCls}>Board</th>
                  <th className={thCls}>Signed Up</th>
                  <th className={thCls}>Plan</th>
                  <th className={`${thCls} text-right`}>Quizzes</th>
                  <th className={`${thCls} text-right`}>Foxy</th>
                </tr>
              </thead>
              <tbody>
                {v2.recent_signups.map(s => (
                  <tr key={s.id}>
                    <td className={tdCls}><strong>{s.name || 'Unknown'}</strong></td>
                    <td className={tdCls}>{s.grade || '—'}</td>
                    <td className={tdCls}>{s.board || '—'}</td>
                    <td className={`${tdCls} text-muted-foreground`}>{timeAgo(s.created_at)}</td>
                    <td className={tdCls}>
                      <span
                        className="inline-block rounded px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                        style={{
                          color: planColor(s.subscription_plan || 'free'),
                          border: `1px solid ${planColor(s.subscription_plan || 'free')}`,
                        }}
                      >
                        {s.subscription_plan || 'free'}
                      </span>
                    </td>
                    <td className={`${tdCls} text-right`}>{s.quiz_count}</td>
                    <td className={`${tdCls} text-right`}>{s.foxy_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 5: Top Active Students */}
      {v2 && v2.top_active.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Top Active Students (Last 7 Days)</h2>
          <div className="overflow-hidden rounded-lg border border-surface-3">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={thCls}>Rank</th>
                  <th className={thCls}>Name</th>
                  <th className={thCls}>Grade</th>
                  <th className={`${thCls} text-right`}>Foxy Sessions</th>
                  <th className={`${thCls} text-right`}>Quizzes</th>
                  <th className={`${thCls} text-right`}>Total</th>
                </tr>
              </thead>
              <tbody>
                {v2.top_active.map((s, i) => (
                  <tr key={s.id}>
                    <td className={tdCls}>
                      <span className={`font-bold ${i < 3 ? 'text-warning' : 'text-muted-foreground'}`}>
                        #{i + 1}
                      </span>
                    </td>
                    <td className={tdCls}><strong>{s.name}</strong></td>
                    <td className={tdCls}>{s.grade}</td>
                    <td className={`${tdCls} text-right`}>{s.foxy_sessions}</td>
                    <td className={`${tdCls} text-right`}>{s.quiz_sessions}</td>
                    <td className={`${tdCls} text-right font-bold text-foreground`}>
                      {s.foxy_sessions + s.quiz_sessions}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 6: Subscription Distribution */}
      {v2 && (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Subscription Distribution</h2>
          <div className="grid grid-cols-4 gap-3">
            <StatCard
              label="Free"
              value={v2.subscription_distribution?.free ?? 0}
              icon="○"
              accentColor={C.text3}
            />
            <StatCard
              label="Starter"
              value={v2.subscription_distribution?.starter ?? 0}
              icon="◈"
              accentColor={C.accent}
            />
            <StatCard
              label="Pro"
              value={v2.subscription_distribution?.pro ?? 0}
              icon="◉"
              accentColor="#7C3AED"
            />
            <StatCard
              label="Unlimited"
              value={v2.subscription_distribution?.unlimited ?? 0}
              icon="★"
              accentColor={C.warning}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  return <AdminShell><AnalyticsContent /></AdminShell>;
}
