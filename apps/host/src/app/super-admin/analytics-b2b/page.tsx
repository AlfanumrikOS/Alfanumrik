'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { DataTable, StatCard, StatusBadge, type Column } from '@alfanumrik/ui/admin-ui';

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
    return <div className="p-10 text-center text-muted-foreground">Loading B2B analytics...</div>;
  }

  if (error) {
    return (
      <div className="p-10 text-center">
        <div className="mb-3 text-sm text-danger">{error}</div>
        <button
          onClick={fetchData}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const schoolColumns: Column<SchoolMetric>[] = [
    {
      key: 'name', label: 'School',
      render: r => (
        <div>
          <strong className="text-foreground">{r.name}</strong>
          <div className="text-[11px] text-muted-foreground">{r.city}{r.state ? `, ${r.state}` : ''}</div>
        </div>
      ),
    },
    { key: 'enrolled_students', label: 'Students', render: r => <span className="font-semibold">{r.enrolled_students}/{r.max_students || '?'}</span> },
    {
      key: 'engagement_rate', label: 'Engagement',
      render: r => <StatusBadge label={`${r.engagement_rate}%`} variant={r.engagement_rate >= 60 ? 'success' : r.engagement_rate >= 30 ? 'warning' : 'danger'} />,
    },
    { key: 'avg_score', label: 'Avg Score', render: r => <span className="font-semibold">{r.avg_score}%</span> },
    { key: 'quiz_completion', label: 'Quizzes', render: r => <span>{r.quiz_completion.toLocaleString()}</span> },
    {
      key: 'seat_utilization', label: 'Seat Util.',
      render: r => <StatusBadge label={`${r.seat_utilization}%`} variant={r.seat_utilization >= 80 ? 'success' : r.seat_utilization >= 50 ? 'warning' : 'neutral'} />,
    },
    {
      key: 'monthly_revenue', label: 'MRR',
      render: r => (
        <span className={['font-semibold', r.monthly_revenue > 0 ? 'text-success' : 'text-muted-foreground'].join(' ')}>
          {r.monthly_revenue > 0 ? `INR ${formatINR(r.monthly_revenue)}` : '--'}
        </span>
      ),
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
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground">B2B Analytics</h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            School performance, revenue, growth, and churn signals
          </p>
        </div>
        <button
          onClick={fetchData}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
        >
          &#8635; Refresh
        </button>
      </div>

      {/* Revenue Cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <StatCard
          label="MRR"
          value={`INR ${formatINR(data.revenue.mrr)}`}
          icon="$"
          accentColor="var(--success)"
          subtitle="Monthly Recurring Revenue"
        />
        <StatCard
          label="ARR"
          value={`INR ${formatINR(data.revenue.arr)}`}
          icon="$"
          accentColor="var(--info)"
          subtitle="Annual Run Rate"
        />
        <StatCard
          label="Avg Rev / Student"
          value={`INR ${data.revenue.avg_revenue_per_student}`}
          icon="@"
          accentColor="var(--warning)"
        />
        <StatCard
          label="Total Seats"
          value={data.revenue.total_seats}
          icon="#"
          accentColor="var(--text-2)"
          subtitle={`${data.revenue.total_enrolled} enrolled`}
        />
      </div>

      {/* Growth Cards */}
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Growth</h2>
      <div className="mb-6 grid grid-cols-4 gap-3">
        <StatCard
          label="Schools This Month"
          value={data.growth.schools_this_month}
          accentColor="var(--info)"
          trend={{ value: data.growth.school_growth_rate, label: '% vs last month' }}
        />
        <StatCard
          label="Schools Last Month"
          value={data.growth.schools_last_month}
          accentColor="var(--text-3)"
        />
        <StatCard
          label="Students This Month"
          value={data.growth.students_this_month}
          accentColor="var(--success)"
          trend={{ value: data.growth.student_growth_rate, label: '% vs last month' }}
        />
        <StatCard
          label="Students Last Month"
          value={data.growth.students_last_month}
          accentColor="var(--text-3)"
        />
      </div>

      {/* Cohort Table */}
      {data.cohorts.length > 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">School Cohorts by Month</h2>
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
            {(() => {
              const maxCount = Math.max(...data.cohorts.map(d => d.count), 1);
              return data.cohorts.map(d => (
                <div
                  key={d.month}
                  className="mb-2 flex items-center gap-3"
                >
                  <span className="w-20 flex-shrink-0 text-xs font-semibold text-muted-foreground">
                    {d.month}
                  </span>
                  <div className="h-[18px] flex-1 overflow-hidden rounded bg-surface-2">
                    <div
                      className="h-full rounded transition-[width] duration-300"
                      style={{
                        width: `${(d.count / maxCount) * 100}%`,
                        background: 'var(--info)',
                        opacity: 0.7,
                        minWidth: d.count > 0 ? 4 : 0,
                      }}
                    />
                  </div>
                  <span className="w-[30px] text-right text-xs font-bold text-foreground">
                    {d.count}
                  </span>
                </div>
              ));
            })()}
          </div>
        </div>
      )}

      {/* School Comparison Table */}
      <div className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="m-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">School Comparison</h2>
          <div className="flex gap-1.5">
            {(['health_score', 'engagement_rate', 'monthly_revenue'] as const).map(field => (
              <button
                key={field}
                onClick={() => setSortField(field)}
                className={[
                  'rounded-md border px-3.5 py-1.5 text-xs font-medium',
                  sortField === field
                    ? 'border-foreground bg-foreground text-surface-1'
                    : 'border-surface-3 bg-surface-1 text-muted-foreground hover:bg-surface-2',
                ].join(' ')}
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
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Churn Risk (3+ Weeks Declining)</h2>
          <DataTable
            columns={churnColumns}
            data={data.churn_risks}
            keyField="school_id"
            emptyMessage="No churn signals detected"
          />
        </div>
      )}

      {data.churn_risks.length === 0 && (
        <div className="mb-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Churn Risk</h2>
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-6 text-center text-success">
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
