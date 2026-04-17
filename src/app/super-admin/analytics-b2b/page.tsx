'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

// ── Types ──

interface RevenueData {
  mrr: number;
  arr: number;
  avg_revenue_per_student: number;
  total_seats: number;
  total_enrolled: number;
}

interface GrowthData {
  schools_this_month: number;
  schools_last_month: number;
  school_growth_rate: number;
  students_this_month: number;
  students_last_month: number;
  student_growth_rate: number;
}

interface SchoolMetric {
  id: string;
  name: string;
  code: string;
  city: string;
  state: string;
  board: string;
  is_active: boolean;
  subscription_plan: string;
  enrolled_students: number;
  max_students: number;
  active_students: number;
  engagement_rate: number;
  avg_score: number;
  quiz_completion: number;
  seat_utilization: number;
  monthly_revenue: number;
  health_score: number;
  created_at: string;
  [key: string]: unknown;
}

interface CohortEntry {
  month: string;
  count: number;
}

interface ChurnRisk {
  school_id: string;
  school_name: string;
  week1_activity: number;
  week2_activity: number;
  week3_activity: number;
  decline_pct: number;
  [key: string]: unknown;
}

interface B2BData {
  revenue: RevenueData;
  growth: GrowthData;
  schools: SchoolMetric[];
  cohorts: CohortEntry[];
  churn_risks: ChurnRisk[];
}

// ── Helpers ──

function formatINR(amount: number): string {
  if (amount >= 100000) return `${(amount / 100000).toFixed(1)}L`;
  if (amount >= 1000) return `${(amount / 1000).toFixed(1)}K`;
  return amount.toLocaleString('en-IN');
}

function healthVariant(score: number): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score >= 70) return 'success';
  if (score >= 40) return 'warning';
  if (score > 0) return 'danger';
  return 'neutral';
}

// ── Content ──

function B2BAnalyticsContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<B2BData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'engagement_rate' | 'monthly_revenue' | 'health_score'>('health_score');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/analytics-v2/b2b');
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Request failed' }));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(json.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sortedSchools = useMemo(() => {
    if (!data?.schools) return [];
    return [...data.schools].sort((a, b) => b[sortField] - a[sortField]);
  }, [data?.schools, sortField]);

  if (loading && !data) {
    return <div style={{ color: colors.text3, padding: 40, textAlign: 'center' }}>Loading B2B analytics...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: colors.danger, fontSize: 14, marginBottom: 12 }}>{error}</div>
        <button onClick={fetchData} style={S.secondaryBtn}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const schoolColumns: Column<SchoolMetric>[] = [
    {
      key: 'name', label: 'School',
      render: r => (
        <div>
          <strong style={{ color: colors.text1 }}>{r.name}</strong>
          <div style={{ fontSize: 11, color: colors.text3 }}>{r.city}{r.state ? `, ${r.state}` : ''}</div>
        </div>
      ),
    },
    { key: 'enrolled_students', label: 'Students', render: r => <span style={{ fontWeight: 600 }}>{r.enrolled_students}/{r.max_students || '?'}</span> },
    {
      key: 'engagement_rate', label: 'Engagement',
      render: r => <StatusBadge label={`${r.engagement_rate}%`} variant={r.engagement_rate >= 60 ? 'success' : r.engagement_rate >= 30 ? 'warning' : 'danger'} />,
    },
    { key: 'avg_score', label: 'Avg Score', render: r => <span style={{ fontWeight: 600 }}>{r.avg_score}%</span> },
    { key: 'quiz_completion', label: 'Quizzes', render: r => <span>{r.quiz_completion.toLocaleString()}</span> },
    {
      key: 'seat_utilization', label: 'Seat Util.',
      render: r => <StatusBadge label={`${r.seat_utilization}%`} variant={r.seat_utilization >= 80 ? 'success' : r.seat_utilization >= 50 ? 'warning' : 'neutral'} />,
    },
    {
      key: 'monthly_revenue', label: 'MRR',
      render: r => <span style={{ fontWeight: 600, color: r.monthly_revenue > 0 ? colors.success : colors.text3 }}>{r.monthly_revenue > 0 ? `INR ${formatINR(r.monthly_revenue)}` : '--'}</span>,
    },
    {
      key: 'health_score', label: 'Health',
      render: r => <StatusBadge label={`${r.health_score}`} variant={healthVariant(r.health_score)} />,
    },
  ];

  const churnColumns: Column<ChurnRisk>[] = [
    { key: 'school_name', label: 'School', render: r => <strong>{r.school_name}</strong> },
    { key: 'week1_activity', label: 'Week 1' },
    { key: 'week2_activity', label: 'Week 2' },
    { key: 'week3_activity', label: 'Week 3' },
    {
      key: 'decline_pct', label: 'Decline',
      render: r => <StatusBadge label={`-${r.decline_pct}%`} variant="danger" />,
    },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>B2B Analytics</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            School performance, revenue, growth, and churn signals
          </p>
        </div>
        <button onClick={fetchData} style={S.secondaryBtn}>&#8635; Refresh</button>
      </div>

      {/* Revenue Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard
          label="MRR"
          value={`INR ${formatINR(data.revenue.mrr)}`}
          icon="$"
          accentColor={colors.success}
          subtitle="Monthly Recurring Revenue"
        />
        <StatCard
          label="ARR"
          value={`INR ${formatINR(data.revenue.arr)}`}
          icon="$"
          accentColor={colors.accent}
          subtitle="Annual Run Rate"
        />
        <StatCard
          label="Avg Rev / Student"
          value={`INR ${data.revenue.avg_revenue_per_student}`}
          icon="@"
          accentColor={colors.warning}
        />
        <StatCard
          label="Total Seats"
          value={data.revenue.total_seats}
          icon="#"
          accentColor={colors.text2}
          subtitle={`${data.revenue.total_enrolled} enrolled`}
        />
      </div>

      {/* Growth Cards */}
      <h2 style={S.h2}>Growth</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard
          label="Schools This Month"
          value={data.growth.schools_this_month}
          accentColor={colors.accent}
          trend={{ value: data.growth.school_growth_rate, label: '% vs last month' }}
        />
        <StatCard
          label="Schools Last Month"
          value={data.growth.schools_last_month}
          accentColor={colors.text3}
        />
        <StatCard
          label="Students This Month"
          value={data.growth.students_this_month}
          accentColor={colors.success}
          trend={{ value: data.growth.student_growth_rate, label: '% vs last month' }}
        />
        <StatCard
          label="Students Last Month"
          value={data.growth.students_last_month}
          accentColor={colors.text3}
        />
      </div>

      {/* Cohort Table */}
      {data.cohorts.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>School Cohorts by Month</h2>
          <div style={S.card}>
            {(() => {
              const maxCount = Math.max(...data.cohorts.map(d => d.count), 1);
              return data.cohorts.map(d => (
                <div
                  key={d.month}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}
                >
                  <span style={{ fontSize: 12, color: colors.text2, width: 80, flexShrink: 0, fontWeight: 600 }}>
                    {d.month}
                  </span>
                  <div style={{ flex: 1, height: 18, background: colors.surface, borderRadius: 4, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${(d.count / maxCount) * 100}%`,
                        height: '100%',
                        background: colors.accent,
                        borderRadius: 4,
                        opacity: 0.7,
                        transition: 'width 0.3s',
                        minWidth: d.count > 0 ? 4 : 0,
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: colors.text1, width: 30, textAlign: 'right' }}>
                    {d.count}
                  </span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* School Comparison Table */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ ...S.h2, marginBottom: 0 }}>School Comparison</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['health_score', 'engagement_rate', 'monthly_revenue'] as const).map(field => (
              <button
                key={field}
                onClick={() => setSortField(field)}
                style={{
                  ...S.filterBtn,
                  ...(sortField === field ? S.filterActive : {}),
                }}
              >
                {field === 'health_score' ? 'Health' : field === 'engagement_rate' ? 'Engagement' : 'Revenue'}
              </button>
            ))}
          </div>
        </div>
        <DataTable
          columns={schoolColumns}
          data={sortedSchools}
          keyField="id"
          emptyMessage="No school data available"
        />
      </div>

      {/* Churn Risks */}
      {data.churn_risks.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Churn Risk (3+ Weeks Declining)</h2>
          <DataTable
            columns={churnColumns}
            data={data.churn_risks}
            keyField="school_id"
            emptyMessage="No churn signals detected"
          />
        </div>
      )}

      {data.churn_risks.length === 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Churn Risk</h2>
          <div style={{ ...S.card, textAlign: 'center', padding: 24, color: colors.success }}>
            No schools with 3 consecutive weeks of declining engagement
          </div>
        </div>
      )}
    </div>
  );
}

export default function B2BAnalyticsPage() {
  return <AdminShell><B2BAnalyticsContent /></AdminShell>;
}
