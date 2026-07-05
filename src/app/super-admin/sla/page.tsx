'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { DataTable, StatCard, StatusBadge, NoDataState, type Column, type NoDataStateReason } from '@/components/admin-ui';

const colors = {
  bg: 'var(--surface-1)',
  text1: 'var(--text-1)',
  text2: 'var(--text-2)',
  text3: 'var(--text-3)',
  border: 'var(--border)',
  surface: 'var(--surface-2)',
  accent: 'var(--info)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
} as const;

const tdStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  color: colors.text1,
  fontSize: 13,
};
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 14px',
  borderBottom: `2px solid ${colors.border}`,
  color: colors.text2,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 1,
  background: colors.surface,
  position: 'sticky',
  top: 0,
  zIndex: 1,
};

const S = {
  card: {
    padding: 16,
    borderRadius: 8,
    border: `1px solid ${colors.border}`,
    background: colors.bg,
  } as React.CSSProperties,
  h2: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.text2,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 12,
  } as React.CSSProperties,
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 } as React.CSSProperties,
  th: thStyle,
  td: tdStyle,
};

// ── Types ──

interface SLATargets {
  uptime_pct: number;
  api_p95_ms: number;
  api_p99_ms: number;
  quiz_submit_p95_ms: number;
  cache_hit_pct: number;
}

// Phase F.5 / H.2 (2026-05-17): nullable fields + state markers so the UI can
// distinguish "tables missing" from "live but healthy". UI renders <NoDataState>
// when state !== 'live' instead of fabricating green numbers.
type DataState = 'live' | 'no_data' | 'table_missing' | 'pending_instrumentation' | 'partial';

interface UptimeData {
  state: DataState;
  current_pct: number | null;
  target_pct: number;
  health_checks_total: number;
  health_checks_failed: number;
  avg_response_ms: number;
  status: string | null;
}

interface ErrorData {
  count_24h: number;
  requests_estimate_24h_heuristic: number;
  estimate_method: string;
}

interface EndpointLatency {
  endpoint: string;
  p50: number;
  p95: number;
  p99: number;
  sample_count: number;
  status: string;
  [key: string]: unknown;
}

interface LatencyData {
  state: DataState;
  endpoints: EndpointLatency[];
}

interface SchoolSLA {
  school_id: string;
  school_name: string;
  uptime_pct: number | null;
  avg_latency_ms: number | null;
  compliant: boolean | null;
  state: DataState;
  [key: string]: unknown;
}

interface SLAData {
  targets: SLATargets;
  uptime: UptimeData;
  errors: ErrorData;
  latency: LatencyData;
  school_sla: SchoolSLA[];
  overall_status: string | null;
  instrumentation_note: string | null;
}

// ── Helpers ──

function statusVariant(status: string | null | undefined): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  if (status === 'critical') return 'danger';
  return 'neutral';
}

// Map API state to NoDataState reason
function stateToReason(state: 'live' | 'no_data' | 'table_missing' | 'pending_instrumentation' | 'partial'): NoDataStateReason {
  if (state === 'table_missing') return 'table_missing';
  if (state === 'partial') return 'partial';
  if (state === 'pending_instrumentation') return 'pending_instrumentation';
  return 'no_data';
}

function msColor(ms: number, target: number): string {
  if (ms <= target) return colors.success;
  if (ms <= target * 1.5) return colors.warning;
  return colors.danger;
}

// ── Content ──

function SLAContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<SLAData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/sla');
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

  if (loading && !data) {
    return <div style={{ color: colors.text3, padding: 40, textAlign: 'center' }}>Loading SLA metrics...</div>;
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ color: colors.danger, fontSize: 14, marginBottom: 12 }}>{error}</div>
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

  const latencyColumns: Column<EndpointLatency>[] = [
    {
      key: 'endpoint', label: 'Endpoint',
      render: r => <code style={{ fontSize: 12, color: colors.text1, fontWeight: 600 }}>{r.endpoint}</code>,
    },
    {
      key: 'p50', label: 'P50 (ms)',
      render: r => <span style={{ fontWeight: 600, color: msColor(r.p50, data.targets.api_p95_ms * 0.5) }}>{r.p50}</span>,
    },
    {
      key: 'p95', label: 'P95 (ms)',
      render: r => <span style={{ fontWeight: 700, color: msColor(r.p95, data.targets.api_p95_ms) }}>{r.p95}</span>,
    },
    {
      key: 'p99', label: 'P99 (ms)',
      render: r => <span style={{ fontWeight: 600, color: msColor(r.p99, data.targets.api_p99_ms) }}>{r.p99}</span>,
    },
    {
      key: 'sample_count', label: 'Samples',
      render: r => <span style={{ color: colors.text3 }}>{r.sample_count > 0 ? r.sample_count : 'est.'}</span>,
    },
    {
      key: 'status', label: 'Status',
      render: r => <StatusBadge label={r.status} variant={statusVariant(r.status)} />,
    },
  ];

  const schoolSlaColumns: Column<SchoolSLA>[] = [
    {
      key: 'school_name', label: 'School',
      render: r => <strong style={{ color: colors.text1 }}>{r.school_name}</strong>,
    },
    {
      key: 'uptime_pct', label: 'Uptime',
      render: r => (
        r.uptime_pct == null ? (
          <span style={{ color: colors.text3 }}>—</span>
        ) : (
          <span style={{ fontWeight: 600, color: r.uptime_pct >= data.targets.uptime_pct ? colors.success : colors.danger }}>
            {r.uptime_pct}%
          </span>
        )
      ),
    },
    {
      key: 'avg_latency_ms', label: 'Avg Latency (ms)',
      render: r => (
        r.avg_latency_ms == null || r.avg_latency_ms <= 0 ? (
          <span style={{ color: colors.text3 }}>N/A</span>
        ) : (
          <span style={{ fontWeight: 600, color: msColor(r.avg_latency_ms, data.targets.api_p95_ms) }}>
            {r.avg_latency_ms}ms
          </span>
        )
      ),
    },
    {
      key: 'compliant', label: 'SLA Compliant',
      render: r => (
        r.compliant == null ? (
          <StatusBadge label="No data" variant="neutral" />
        ) : (
          <StatusBadge label={r.compliant ? 'Compliant' : 'Breached'} variant={r.compliant ? 'success' : 'danger'} />
        )
      ),
    },
  ];

  const errorRate = data.errors.requests_estimate_24h_heuristic > 0
    ? ((data.errors.count_24h / data.errors.requests_estimate_24h_heuristic) * 100).toFixed(2)
    : '0.00';
  const uptimePct = data.uptime.current_pct;
  const uptimeLive = data.uptime.state === 'live' && typeof uptimePct === 'number';
  const latencyLive = data.latency.state === 'live' && data.latency.endpoints.length > 0;

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-foreground mb-1">SLA Monitoring</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Platform uptime, API latency, and per-school SLA compliance
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge
            label={`Overall: ${(data.overall_status ?? 'unknown').toUpperCase()}`}
            variant={statusVariant(data.overall_status)}
          />
          <button
            onClick={fetchData}
            className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            &#8635; Refresh
          </button>
        </div>
      </div>

      {/* Phase H.2 (2026-05-17): instrumentation banner — surface upstream
          "no data / table missing" state so operators don't read green where
          green means "no measurement happened". */}
      {data.instrumentation_note && (
        <div style={{ marginBottom: 16 }}>
          <NoDataState
            reason={data.uptime.state === 'table_missing' || data.latency.state === 'table_missing' ? 'table_missing' : 'no_data'}
            title="SLO instrumentation pending"
            message={data.instrumentation_note}
            learnMoreHref="https://github.com/AlfanumrikOS/Alfanumrik/blob/main/docs/runbooks/super-admin-sla.md"
          />
        </div>
      )}

      {/* Uptime Gauge & Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard
          label="Platform Uptime"
          value={uptimeLive ? `${uptimePct}%` : '—'}
          icon="^"
          accentColor={uptimeLive && uptimePct! >= data.targets.uptime_pct ? colors.success : uptimeLive ? colors.danger : colors.text3}
          subtitle={uptimeLive ? `Target: ${data.targets.uptime_pct}%` : 'No data'}
        />
        <StatCard
          label="Avg Response Time"
          value={uptimeLive && data.uptime.avg_response_ms > 0 ? `${data.uptime.avg_response_ms}ms` : '—'}
          icon="~"
          accentColor={uptimeLive && data.uptime.avg_response_ms <= 200 ? colors.success : uptimeLive && data.uptime.avg_response_ms <= 500 ? colors.warning : uptimeLive ? colors.danger : colors.text3}
        />
        <StatCard
          label="Error Rate (24h)"
          value={`${errorRate}%`}
          icon="!"
          accentColor={parseFloat(errorRate) <= 1 ? colors.success : colors.danger}
          subtitle={`${data.errors.count_24h} errors · ${data.errors.estimate_method}`}
        />
        <StatCard
          label="Health Checks"
          value={data.uptime.health_checks_total}
          icon="#"
          accentColor={colors.accent}
          subtitle={`${data.uptime.health_checks_failed} failed`}
        />
      </div>

      {/* Uptime Target vs Actual */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Uptime Target vs Actual</h2>
        {uptimeLive ? (
          <div style={S.card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.text2, width: 80 }}>Target</span>
              <div style={{ flex: 1, height: 24, background: colors.surface, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  width: `${data.targets.uptime_pct}%`,
                  height: '100%',
                  background: colors.border,
                  borderRadius: 4,
                }} />
                <span style={{ position: 'absolute', right: 8, top: 4, fontSize: 11, fontWeight: 700, color: colors.text2 }}>
                  {data.targets.uptime_pct}%
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: colors.text2, width: 80 }}>Actual</span>
              <div style={{ flex: 1, height: 24, background: colors.surface, borderRadius: 4, overflow: 'hidden', position: 'relative' }}>
                <div style={{
                  width: `${uptimePct}%`,
                  height: '100%',
                  background: uptimePct! >= data.targets.uptime_pct ? colors.success : colors.danger,
                  borderRadius: 4,
                  opacity: 0.7,
                }} />
                <span style={{
                  position: 'absolute', right: 8, top: 4, fontSize: 11, fontWeight: 700,
                  color: uptimePct! >= data.targets.uptime_pct ? colors.success : colors.danger,
                }}>
                  {uptimePct}%
                </span>
              </div>
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: colors.text3, textAlign: 'center' }}>
              {uptimePct! >= data.targets.uptime_pct
                ? 'Uptime target met. Platform is operating within SLA.'
                : `Uptime below target by ${(data.targets.uptime_pct - uptimePct!).toFixed(3)}%. Investigation required.`}
            </div>
          </div>
        ) : (
          <NoDataState
            reason={stateToReason(data.uptime.state)}
            title="No uptime data"
            message={data.uptime.state === 'table_missing'
              ? 'The health_check_log table is not migrated in this environment.'
              : 'No health-check probes have landed yet. Will populate once the synthetic-host-monitor cron runs.'}
            learnMoreHref="https://github.com/AlfanumrikOS/Alfanumrik/blob/main/docs/runbooks/super-admin-sla.md"
          />
        )}
      </div>

      {/* Latency Table */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>API Latency by Endpoint</h2>
        <div style={{ fontSize: 11, color: colors.text3, marginBottom: 8 }}>
          Targets: P95 &lt; {data.targets.api_p95_ms}ms | P99 &lt; {data.targets.api_p99_ms}ms
        </div>
        {latencyLive ? (
          <DataTable
            columns={latencyColumns}
            data={data.latency.endpoints}
            keyField="endpoint"
            emptyMessage="No latency data available"
          />
        ) : (
          <NoDataState
            reason={stateToReason(data.latency.state)}
            title="No latency data"
            message={data.latency.state === 'table_missing'
              ? 'The school_slo table is not migrated in this environment.'
              : 'No latency samples have been aggregated yet. Will populate once the SLO aggregator cron runs.'}
            learnMoreHref="https://github.com/AlfanumrikOS/Alfanumrik/blob/main/docs/runbooks/super-admin-sla.md"
          />
        )}
      </div>

      {/* SLA Targets Reference */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>SLA Targets</h2>
        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Metric</th>
                <th style={S.th}>Target</th>
                <th style={S.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={S.td}>Platform Uptime</td>
                <td style={S.td}><strong>{data.targets.uptime_pct}%</strong></td>
                <td style={S.td}>
                  {uptimeLive ? (
                    <StatusBadge
                      label={uptimePct! >= data.targets.uptime_pct ? 'Met' : 'Breached'}
                      variant={uptimePct! >= data.targets.uptime_pct ? 'success' : 'danger'}
                    />
                  ) : (
                    <StatusBadge label="No data" variant="neutral" />
                  )}
                </td>
              </tr>
              <tr>
                <td style={S.td}>API Response P95</td>
                <td style={S.td}><strong>&lt; {data.targets.api_p95_ms}ms</strong></td>
                <td style={S.td}>
                  {latencyLive ? (
                    <StatusBadge
                      label={data.latency.endpoints.every(l => l.p95 <= data.targets.api_p95_ms) ? 'Met' : 'Breached'}
                      variant={data.latency.endpoints.every(l => l.p95 <= data.targets.api_p95_ms) ? 'success' : 'danger'}
                    />
                  ) : (
                    <StatusBadge label="No data" variant="neutral" />
                  )}
                </td>
              </tr>
              <tr>
                <td style={S.td}>API Response P99</td>
                <td style={S.td}><strong>&lt; {data.targets.api_p99_ms}ms</strong></td>
                <td style={S.td}>
                  {latencyLive ? (
                    <StatusBadge
                      label={data.latency.endpoints.every(l => l.p99 <= data.targets.api_p99_ms) ? 'Met' : 'Breached'}
                      variant={data.latency.endpoints.every(l => l.p99 <= data.targets.api_p99_ms) ? 'success' : 'danger'}
                    />
                  ) : (
                    <StatusBadge label="No data" variant="neutral" />
                  )}
                </td>
              </tr>
              <tr>
                <td style={S.td}>Cache Hit Rate</td>
                <td style={S.td}><strong>&gt; {data.targets.cache_hit_pct}%</strong></td>
                <td style={S.td}>
                  <StatusBadge label="No data" variant="neutral" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-School SLA */}
      {data.school_sla.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={S.h2}>Per-School SLA Compliance</h2>
          <DataTable
            columns={schoolSlaColumns}
            data={data.school_sla}
            keyField="school_id"
            emptyMessage="No school SLA data"
          />
        </div>
      )}
    </div>
  );
}

export default function SLAPage() {
  return <AdminShell><SLAContent /></AdminShell>;
}
