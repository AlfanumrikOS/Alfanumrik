'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatCard from '../_components/StatCard';
import { colors, S } from '../_components/admin-styles';

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

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

function planColor(plan: string): string {
  if (plan === 'unlimited') return colors.warning;
  if (plan === 'pro') return '#7C3AED';
  if (plan === 'starter') return colors.accent;
  return colors.text3;
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
    return <div style={{ color: colors.text3, padding: 40, textAlign: 'center' }}>Loading analytics...</div>;
  }

  const features = [
    { label: 'Foxy AI Tutor', icon: '🦊', key: 'foxy' as const },
    { label: 'Quizzes', icon: '⚡', key: 'quizzes' as const },
    { label: 'STEM Lab', icon: '🔬', key: 'stem_lab' as const },
    { label: 'Study Plans', icon: '📋', key: 'study_plans' as const },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>Analytics Dashboard</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Student activity, feature usage, signups, and subscriptions
          </p>
        </div>
        <button onClick={fetchAll} style={S.secondaryBtn}>&#8635; Refresh</button>
      </div>

      {/* Row 1: KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard
          label="Total Students"
          value={stats?.totals?.students ?? 0}
          icon="👥"
          accentColor={colors.accent}
        />
        <StatCard
          label="Active Today"
          value={v2?.active_today ?? 0}
          icon="🟢"
          accentColor={colors.success}
        />
        <StatCard
          label="Active This Week"
          value={v2?.active_week ?? 0}
          icon="📅"
          accentColor={colors.warning}
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
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Student Engagement by Grade (Last 7 Days)</h2>
          <div style={S.card}>
            {(() => {
              const maxCount = Math.max(...v2.grade_distribution.map(d => d.count), 1);
              return v2.grade_distribution.map(d => (
                <div
                  key={d.grade}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}
                >
                  <span style={{ fontSize: 13, color: colors.text2, width: 60, flexShrink: 0, fontWeight: 600 }}>
                    Grade {d.grade}
                  </span>
                  <div style={{ flex: 1, height: 20, background: colors.surface, borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${(d.count / maxCount) * 100}%`,
                        height: '100%',
                        background: colors.accent,
                        borderRadius: 4,
                        opacity: 0.7,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: colors.text1, width: 40, textAlign: 'right' }}>
                    {d.count}
                  </span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* Row 3: Feature Usage Table */}
      {v2 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Feature Usage</h2>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Feature</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>Today</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>This Week</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>All Time</th>
                </tr>
              </thead>
              <tbody>
                {features.map(f => {
                  const usage = v2.feature_usage[f.key];
                  return (
                    <tr key={f.key}>
                      <td style={S.td}>
                        <span style={{ marginRight: 8 }}>{f.icon}</span>
                        <strong>{f.label}</strong>
                      </td>
                      <td style={{ ...S.td, textAlign: 'right' as const, fontWeight: 600 }}>
                        {(usage?.today ?? 0).toLocaleString()}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right' as const }}>
                        {(usage?.week ?? 0).toLocaleString()}
                      </td>
                      <td style={{ ...S.td, textAlign: 'right' as const, color: colors.text2 }}>
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
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Recent Signups (Last 10)</h2>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Name</th>
                  <th style={S.th}>Grade</th>
                  <th style={S.th}>Board</th>
                  <th style={S.th}>Signed Up</th>
                  <th style={S.th}>Plan</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>Quizzes</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>Foxy</th>
                </tr>
              </thead>
              <tbody>
                {v2.recent_signups.map(s => (
                  <tr key={s.id}>
                    <td style={S.td}><strong>{s.name || 'Unknown'}</strong></td>
                    <td style={S.td}>{s.grade || '—'}</td>
                    <td style={S.td}>{s.board || '—'}</td>
                    <td style={{ ...S.td, color: colors.text2 }}>{timeAgo(s.created_at)}</td>
                    <td style={S.td}>
                      <span style={{
                        display: 'inline-block',
                        padding: '2px 8px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase' as const,
                        letterSpacing: 0.5,
                        color: planColor(s.subscription_plan || 'free'),
                        border: `1px solid ${planColor(s.subscription_plan || 'free')}`,
                      }}>
                        {s.subscription_plan || 'free'}
                      </span>
                    </td>
                    <td style={{ ...S.td, textAlign: 'right' as const }}>{s.quiz_count}</td>
                    <td style={{ ...S.td, textAlign: 'right' as const }}>{s.foxy_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Row 5: Top Active Students */}
      {v2 && v2.top_active.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Top Active Students (Last 7 Days)</h2>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Rank</th>
                  <th style={S.th}>Name</th>
                  <th style={S.th}>Grade</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>Foxy Sessions</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>Quizzes</th>
                  <th style={{ ...S.th, textAlign: 'right' as const }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {v2.top_active.map((s, i) => (
                  <tr key={s.id}>
                    <td style={S.td}>
                      <span style={{ fontWeight: 700, color: i < 3 ? colors.warning : colors.text2 }}>
                        #{i + 1}
                      </span>
                    </td>
                    <td style={S.td}><strong>{s.name}</strong></td>
                    <td style={S.td}>{s.grade}</td>
                    <td style={{ ...S.td, textAlign: 'right' as const }}>{s.foxy_sessions}</td>
                    <td style={{ ...S.td, textAlign: 'right' as const }}>{s.quiz_sessions}</td>
                    <td style={{ ...S.td, textAlign: 'right' as const, fontWeight: 700, color: colors.text1 }}>
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
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Subscription Distribution</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            <StatCard
              label="Free"
              value={v2.subscription_distribution?.free ?? 0}
              icon="○"
              accentColor={colors.text3}
            />
            <StatCard
              label="Starter"
              value={v2.subscription_distribution?.starter ?? 0}
              icon="◈"
              accentColor={colors.accent}
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
              accentColor={colors.warning}
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
