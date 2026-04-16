'use client';

import { useState, useEffect, useCallback } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import DataTable, { Column } from '../_components/DataTable';
import StatCard from '../_components/StatCard';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

// ── Types ──

interface SLATargets {
  uptime_pct: number;
  api_p95_ms: number;
  api_p99_ms: number;
  quiz_submit_p95_ms: number;
  cache_hit_pct: number;
}

interface UptimeData {
  current_pct: number;
  target_pct: number;
  health_checks_total: number;
  health_checks_failed: number;
  avg_response_ms: number;
  status: string;
}

interface ErrorData {
  count_24h: number;
  total_requests_estimate: number;
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

interface SchoolSLA {
  school_id: string;
  school_name: string;
  uptime_pct: number;
  avg_latency_ms: number;
  compliant: boolean;
  [key: string]: unknown;
}

interface SLAData {
  targets: SLATargets;
  uptime: UptimeData;
  errors: ErrorData;
  latencies: EndpointLatency[];
  school_sla: SchoolSLA[];
  overall_status: string;
}

// ── Helpers ──

function statusVariant(status: string): 'success' | 'warning' | 'danger' {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'danger';
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
        <button onClick={fetchData} style={S.secondaryBtn}>Retry</button>
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
        <span style={{ fontWeight: 600, color: r.uptime_pct >= data.targets.uptime_pct ? colors.success : colors.danger }}>
          {r.uptime_pct}%
        </span>
      ),
    },
    {
      key: 'avg_latency_ms', label: 'Avg Latency (ms)',
      render: r => (
        <span style={{ fontWeight: 600, color: r.avg_latency_ms > 0 ? msColor(r.avg_latency_ms, data.targets.api_p95_ms) : colors.text3 }}>
          {r.avg_latency_ms > 0 ? `${r.avg_latency_ms}ms` : 'N/A'}
        </span>
      ),
    },
    {
      key: 'compliant', label: 'SLA Compliant',
      render: r => <StatusBadge label={r.compliant ? 'Compliant' : 'Breached'} variant={r.compliant ? 'success' : 'danger'} />,
    },
  ];

  const errorRate = data.errors.total_requests_estimate > 0
    ? ((data.errors.count_24h / data.errors.total_requests_estimate) * 100).toFixed(2)
    : '0.00';

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h1 style={S.h1}>SLA Monitoring</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Platform uptime, API latency, and per-school SLA compliance
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge
            label={`Overall: ${data.overall_status.toUpperCase()}`}
            variant={statusVariant(data.overall_status)}
          />
          <button onClick={fetchData} style={S.secondaryBtn}>&#8635; Refresh</button>
        </div>
      </div>

      {/* Uptime Gauge & Key Metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard
          label="Platform Uptime"
          value={`${data.uptime.current_pct}%`}
          icon="^"
          accentColor={data.uptime.current_pct >= data.targets.uptime_pct ? colors.success : colors.danger}
          subtitle={`Target: ${data.targets.uptime_pct}%`}
        />
        <StatCard
          label="Avg Response Time"
          value={`${data.uptime.avg_response_ms}ms`}
          icon="~"
          accentColor={data.uptime.avg_response_ms <= 200 ? colors.success : data.uptime.avg_response_ms <= 500 ? colors.warning : colors.danger}
        />
        <StatCard
          label="Error Rate (24h)"
          value={`${errorRate}%`}
          icon="!"
          accentColor={parseFloat(errorRate) <= 1 ? colors.success : colors.danger}
          subtitle={`${data.errors.count_24h} errors`}
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
                width: `${data.uptime.current_pct}%`,
                height: '100%',
                background: data.uptime.current_pct >= data.targets.uptime_pct ? colors.success : colors.danger,
                borderRadius: 4,
                opacity: 0.7,
              }} />
              <span style={{
                position: 'absolute', right: 8, top: 4, fontSize: 11, fontWeight: 700,
                color: data.uptime.current_pct >= data.targets.uptime_pct ? colors.success : colors.danger,
              }}>
                {data.uptime.current_pct}%
              </span>
            </div>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: colors.text3, textAlign: 'center' }}>
            {data.uptime.current_pct >= data.targets.uptime_pct
              ? 'Uptime target met. Platform is operating within SLA.'
              : `Uptime below target by ${(data.targets.uptime_pct - data.uptime.current_pct).toFixed(3)}%. Investigation required.`}
          </div>
        </div>
      </div>

      {/* Latency Table */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>API Latency by Endpoint</h2>
        <div style={{ fontSize: 11, color: colors.text3, marginBottom: 8 }}>
          Targets: P95 &lt; {data.targets.api_p95_ms}ms | P99 &lt; {data.targets.api_p99_ms}ms
        </div>
        <DataTable
          columns={latencyColumns}
          data={data.latencies}
          keyField="endpoint"
          emptyMessage="No latency data available"
        />
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
                  <StatusBadge
                    label={data.uptime.current_pct >= data.targets.uptime_pct ? 'Met' : 'Breached'}
                    variant={data.uptime.current_pct >= data.targets.uptime_pct ? 'success' : 'danger'}
                  />
                </td>
              </tr>
              <tr>
                <td style={S.td}>API Response P95</td>
                <td style={S.td}><strong>&lt; {data.targets.api_p95_ms}ms</strong></td>
                <td style={S.td}>
                  <StatusBadge
                    label={data.latencies.every(l => l.p95 <= data.targets.api_p95_ms) ? 'Met' : 'Breached'}
                    variant={data.latencies.every(l => l.p95 <= data.targets.api_p95_ms) ? 'success' : 'danger'}
                  />
                </td>
              </tr>
              <tr>
                <td style={S.td}>API Response P99</td>
                <td style={S.td}><strong>&lt; {data.targets.api_p99_ms}ms</strong></td>
                <td style={S.td}>
                  <StatusBadge
                    label={data.latencies.every(l => l.p99 <= data.targets.api_p99_ms) ? 'Met' : 'Breached'}
                    variant={data.latencies.every(l => l.p99 <= data.targets.api_p99_ms) ? 'success' : 'danger'}
                  />
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
