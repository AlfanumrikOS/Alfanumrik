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
import { useAuth } from '@alfanumrik/lib/AuthContext';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatusBadge } from '@alfanumrik/ui/admin-ui';

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
    <div className="rounded-lg border border-surface-3 bg-surface-1 px-[18px] py-5">
      <div className="mb-3 flex gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-danger" />
          {isHi ? 'Reject rate' : 'Reject rate'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-warning" />
          {isHi ? 'Ambiguous rate' : 'Ambiguous rate'}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {isHi ? 'Y-axis: 0–100%' : 'Y-axis: 0–100%'}
        </span>
      </div>

      {/* Bars: one column per bucket; two stacked mini-bars per column */}
      <div
        className="flex items-end gap-px border-b border-surface-3 pb-0.5"
        style={{ height: HEIGHT }}
      >
        {buckets.map((b, i) => {
          const rejectH = Math.max(b.reject_rate * HEIGHT, b.reject_rate > 0 ? 1 : 0);
          const ambigH = Math.max(b.ambiguous_rate * HEIGHT, b.ambiguous_rate > 0 ? 1 : 0);
          const tooltip = `${formatHourLabel(b.hour)}\nreject: ${formatPct(b.reject_rate)} | ambig: ${formatPct(b.ambiguous_rate)} | events: ${b.total_events}`;
          return (
            <div
              key={`${b.hour}-${i}`}
              className="relative flex min-w-[2px] flex-1 flex-col-reverse gap-px"
              title={tooltip}
            >
              <div className="w-full bg-danger opacity-80" style={{ height: rejectH }} />
              <div className="w-full bg-warning opacity-60" style={{ height: ambigH }} />
            </div>
          );
        })}
      </div>

      {/* X-axis labels (sparse) */}
      <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
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
    <div className="rounded-lg border border-surface-3 bg-surface-1 px-4 py-3.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          {isHi ? 'कुल Oracle decision events' : 'Total Oracle decision events'}
        </span>
        <span className="text-[13px] font-bold text-foreground">
          {total.toLocaleString()}
        </span>
      </div>
      <div className="flex items-end gap-px" style={{ height: HEIGHT }}>
        {buckets.map((b, i) => {
          const h = max > 0 ? Math.max((b.total_events / max) * HEIGHT, b.total_events > 0 ? 1 : 0) : 0;
          return (
            <div
              key={`evt-${b.hour}-${i}`}
              className="min-w-[2px] flex-1 bg-info opacity-60"
              style={{ height: h }}
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
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            {isHi ? 'Oracle Health (पिछले 7 दिन)' : 'Oracle Health (last 7d)'}
          </h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            {isHi
              ? 'Quiz-grading oracle की reject और ambiguous rate की hourly निगरानी।'
              : 'Hourly reject and ambiguous rates for the quiz-grading oracle.'}
          </p>
        </div>
        <button
          onClick={() => mutate()}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2 disabled:opacity-60"
          disabled={isLoading}
        >
          {isLoading ? (isHi ? 'लोड हो रहा है...' : 'Loading...') : 'Refresh'}
        </button>
      </div>

      {/* Alert banner */}
      {data?.alert && (
        <div
          className="mb-5 flex items-center gap-3 rounded-lg border border-danger px-4 py-3 text-[13px] text-danger"
          style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}
          role="alert"
        >
          <span className="text-lg leading-none">⚠</span>
          <div className="flex-1">
            <strong>{isHi ? 'Oracle alert active' : 'Oracle alert active'}</strong>
            <div className="mt-1 text-xs">
              {data.alert_reason || (isHi ? 'कारण उपलब्ध नहीं।' : 'No reason provided.')}
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && !data && (
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-10 text-center text-[13px] text-muted-foreground">
          {isHi ? 'Oracle metrics लोड हो रहे हैं...' : 'Loading Oracle metrics...'}
        </div>
      )}

      {/* Error state */}
      {error && !isLoading && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-danger p-5 text-[13px] text-danger" style={{ backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)' }}>
          <div>
            <strong>{isHi ? 'Oracle health load नहीं हुआ।' : 'Failed to load Oracle health data.'}</strong>
            <div className="mt-1 text-xs opacity-85">
              {isHi
                ? 'PostHog API रेट-लिमिट हो सकता है, या backend cache miss।'
                : 'PostHog API may be rate-limited, or backend cache missed.'}
            </div>
          </div>
          <button
            onClick={() => mutate()}
            className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
          >
            {isHi ? 'दोबारा कोशिश' : 'Retry'}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !error && buckets.length === 0 && (
        <div className="rounded-lg border border-surface-3 p-10 text-center text-[13px] text-muted-foreground">
          {isHi
            ? 'Oracle के पास अभी तक कोई decision events नहीं हैं — data ingestion का इंतज़ार करें।'
            : 'Oracle has no decision events yet — wait for data ingestion.'}
        </div>
      )}

      {/* Charts */}
      {!isLoading && !error && buckets.length > 0 && (
        <div className="mb-4 grid gap-4">
          <DualLineChart buckets={buckets} isHi={isHi} />
          <EventsSparkline buckets={buckets} isHi={isHi} />
        </div>
      )}

      {/* Footer: cache info */}
      {data && (
        <div className="mt-4 flex items-center justify-between border-t border-surface-3 px-3.5 py-2.5 text-[11px] text-muted-foreground">
          <span>
            {isHi ? 'अंतिम update:' : 'Last updated:'}{' '}
            <strong className="text-muted-foreground">{formatCachedAt(data.cached_at)}</strong>
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
