'use client';

/**
 * Super Admin — Oracle Health (last 7d)
 *
 * Renders hourly oracle reject_rate / ambiguous_rate / total_events from the
 * backend's PostHog proxy (server-side cached). Never calls PostHog from the
 * browser — admin tier only, server-to-server with API key.
 *
 * Backend contract: GET /api/super-admin/oracle-health
 *   => { hourly: HourlyBucket[], alert: boolean, alert_reason: string|null,
 *        cached: boolean, cached_at: string|null }
 *
 * Bundle note: charts are plain Tailwind/CSS divs (no recharts). Keeps the
 * page well under 100 kB gzip per P10.
 */

import { useMemo, useCallback } from 'react';
import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import StatusBadge from '../_components/StatusBadge';
import { colors, S } from '../_components/admin-styles';

/* ── Types ─────────────────────────────────────────────── */

interface HourlyBucket {
  hour: string;             // ISO timestamp (start of hour)
  reject_rate: number;      // 0..1
  ambiguous_rate: number;   // 0..1
  total_events: number;
}

interface OracleHealthResponse {
  hourly: HourlyBucket[];
  alert: boolean;
  alert_reason: string | null;
  cached: boolean;
  cached_at: string | null;
}

/* ── Helpers ───────────────────────────────────────────── */

function formatHourLabel(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    return `${mm}/${dd} ${hh}:00`;
  } catch {
    return iso;
  }
}

function formatPct(rate: number): string {
  if (!Number.isFinite(rate)) return '0%';
  return `${(rate * 100).toFixed(1)}%`;
}

function formatCachedAt(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return iso;
  }
}

/* ── Time-series chart (Tailwind divs, no library) ────── */

function DualLineChart({ buckets, isHi }: { buckets: HourlyBucket[]; isHi: boolean }) {
  // Chart constants — chosen to keep component lightweight.
  const HEIGHT = 180;

  return (
    <div style={{ ...S.card, padding: '20px 18px' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 12, color: colors.text2 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colors.danger }} />
          {isHi ? 'Reject rate' : 'Reject rate'}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: colors.warning }} />
          {isHi ? 'Ambiguous rate' : 'Ambiguous rate'}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: colors.text3 }}>
          {isHi ? 'Y-axis: 0–100%' : 'Y-axis: 0–100%'}
        </span>
      </div>

      {/* Bars: one column per bucket; two stacked mini-bars per column */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: HEIGHT, borderBottom: `1px solid ${colors.border}`, paddingBottom: 2 }}>
        {buckets.map((b, i) => {
          const rejectH = Math.max(b.reject_rate * HEIGHT, b.reject_rate > 0 ? 1 : 0);
          const ambigH = Math.max(b.ambiguous_rate * HEIGHT, b.ambiguous_rate > 0 ? 1 : 0);
          const tooltip = `${formatHourLabel(b.hour)}\nreject: ${formatPct(b.reject_rate)} | ambig: ${formatPct(b.ambiguous_rate)} | events: ${b.total_events}`;
          return (
            <div
              key={`${b.hour}-${i}`}
              style={{ flex: 1, minWidth: 2, display: 'flex', flexDirection: 'column-reverse', gap: 1, position: 'relative' }}
              title={tooltip}
            >
              <div style={{ width: '100%', height: rejectH, background: colors.danger, opacity: 0.8 }} />
              <div style={{ width: '100%', height: ambigH, background: colors.warning, opacity: 0.6 }} />
            </div>
          );
        })}
      </div>

      {/* X-axis labels (sparse) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, color: colors.text3 }}>
        {buckets.length > 0 && (
          <>
            <span>{formatHourLabel(buckets[0].hour)}</span>
            {buckets.length > 2 && (
              <span>{formatHourLabel(buckets[Math.floor(buckets.length / 2)].hour)}</span>
            )}
            <span>{formatHourLabel(buckets[buckets.length - 1].hour)}</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Total-events sparkline ───────────────────────────── */

function EventsSparkline({ buckets, isHi }: { buckets: HourlyBucket[]; isHi: boolean }) {
  const max = Math.max(...buckets.map(b => b.total_events), 1);
  const HEIGHT = 50;
  const total = buckets.reduce((acc, b) => acc + b.total_events, 0);

  return (
    <div style={{ ...S.card, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: colors.text2, fontWeight: 600 }}>
          {isHi ? 'कुल Oracle decision events' : 'Total Oracle decision events'}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.text1 }}>
          {total.toLocaleString()}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 1, height: HEIGHT }}>
        {buckets.map((b, i) => {
          const h = max > 0 ? Math.max((b.total_events / max) * HEIGHT, b.total_events > 0 ? 1 : 0) : 0;
          return (
            <div
              key={`evt-${b.hour}-${i}`}
              style={{ flex: 1, minWidth: 2, height: h, background: colors.accent, opacity: 0.6 }}
              title={`${formatHourLabel(b.hour)}: ${b.total_events.toLocaleString()} events`}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ── Main Content ─────────────────────────────────────── */

function OracleHealthContent() {
  const { isHi } = useAuth();
  const { apiFetch } = useAdmin();

  const fetcher = useCallback(
    async (url: string): Promise<OracleHealthResponse> => {
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    [apiFetch],
  );

  const { data, error, isLoading, mutate } = useSWR<OracleHealthResponse>(
    '/api/super-admin/oracle-health',
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );

  const buckets = useMemo(() => data?.hourly ?? [], [data]);

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>
            {isHi ? 'Oracle Health (पिछले 7 दिन)' : 'Oracle Health (last 7d)'}
          </h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            {isHi
              ? 'Quiz-grading oracle की reject और ambiguous rate की hourly निगरानी।'
              : 'Hourly reject and ambiguous rates for the quiz-grading oracle.'}
          </p>
        </div>
        <button onClick={() => mutate()} style={S.secondaryBtn} disabled={isLoading}>
          {isLoading ? (isHi ? 'लोड हो रहा है...' : 'Loading...') : 'Refresh'}
        </button>
      </div>

      {/* Alert banner */}
      {data?.alert && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            background: colors.dangerLight,
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            fontSize: 13,
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
          role="alert"
        >
          <span style={{ fontSize: 18, lineHeight: 1 }}>⚠</span>
          <div style={{ flex: 1 }}>
            <strong>{isHi ? 'Oracle alert active' : 'Oracle alert active'}</strong>
            <div style={{ marginTop: 4, fontSize: 12 }}>
              {data.alert_reason || (isHi ? 'कारण उपलब्ध नहीं।' : 'No reason provided.')}
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && !data && (
        <div style={{ ...S.card, padding: 40, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
          {isHi ? 'Oracle metrics लोड हो रहे हैं...' : 'Loading Oracle metrics...'}
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div
          style={{
            padding: 20,
            borderRadius: 8,
            background: colors.dangerLight,
            border: `1px solid ${colors.danger}`,
            color: colors.danger,
            fontSize: 13,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div>
            <strong>{isHi ? 'Oracle health load नहीं हुआ।' : 'Failed to load Oracle health data.'}</strong>
            <div style={{ marginTop: 4, fontSize: 12, opacity: 0.85 }}>
              {isHi
                ? 'PostHog API रेट-लिमिट हो सकता है, या backend cache miss।'
                : 'PostHog API may be rate-limited, or backend cache missed.'}
            </div>
          </div>
          <button onClick={() => mutate()} style={S.secondaryBtn}>
            {isHi ? 'दोबारा कोशिश' : 'Retry'}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && buckets.length === 0 && (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            color: colors.text3,
            fontSize: 13,
          }}
        >
          {isHi
            ? 'Oracle के पास अभी तक कोई decision events नहीं हैं — data ingestion का इंतज़ार करें।'
            : 'Oracle has no decision events yet — wait for data ingestion.'}
        </div>
      )}

      {/* Charts */}
      {!isLoading && !error && buckets.length > 0 && (
        <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
          <DualLineChart buckets={buckets} isHi={isHi} />
          <EventsSparkline buckets={buckets} isHi={isHi} />
        </div>
      )}

      {/* Footer: cache info */}
      {data && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            padding: '10px 14px',
            borderTop: `1px solid ${colors.borderLight}`,
            fontSize: 11,
            color: colors.text3,
          }}
        >
          <span>
            {isHi ? 'अंतिम update:' : 'Last updated:'} <strong style={{ color: colors.text2 }}>{formatCachedAt(data.cached_at)}</strong>
          </span>
          <StatusBadge
            label={data.cached ? (isHi ? 'Cached: yes' : 'Cached: yes') : (isHi ? 'Cached: no' : 'Cached: no')}
            variant={data.cached ? 'info' : 'neutral'}
          />
        </div>
      )}
    </div>
  );
}

export default function OracleHealthPage() {
  return (
    <AdminShell>
      <OracleHealthContent />
    </AdminShell>
  );
}
