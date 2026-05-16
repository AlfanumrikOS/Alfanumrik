'use client';

/**
 * /super-admin/health — Per-school health dashboard (Phase E.6).
 *
 * One screen for "how is each school doing right now". Replaces hopping
 * between Supabase queries, Sentry, and PostHog when triaging a pilot.
 *
 * Read-only — no state mutations, no events emitted server-side. Pure
 * projection from the schools table + activity tables. PostHog event
 * `super_admin_health_dashboard_viewed` fires once on mount for ops
 * usage analytics (operator-side, not learner state).
 *
 * ADR-005 compliance: no canonical writes, no journey changes, no
 * state_events registry imports.
 *
 * Styling: design tokens via Tailwind classes (no raw hex in style={{}})
 * per Phase 5B sweep.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { DataTable, StatusBadge, type Column } from '@/components/admin-ui';
import { track } from '@/lib/posthog/client';

/* ------------------------------------------------------------------ */
/*  Types — mirror src/app/api/super-admin/health/route.ts            */
/* ------------------------------------------------------------------ */

type WhiteLabelStatus = 'green' | 'yellow' | 'red' | 'none' | 'na';
type SchoolLifecycleStatus = 'active' | 'trial' | 'paused';

interface SchoolHealthRow extends Record<string, unknown> {
  id: string;
  name: string;
  slug: string | null;
  status: SchoolLifecycleStatus;
  pilot_start: string | null;
  active_users_7d: number;
  last_activity: string | null;
  subscription_plan: string | null;
  white_label: WhiteLabelStatus;
  custom_domain: string | null;
  errors_24h: string;
}

interface HealthDashboardResponse {
  schools: SchoolHealthRow[];
  synthetic_monitor_degraded: boolean;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Format an ISO timestamp as a relative string ("2h ago", "3d ago"). */
function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  return `${month}mo ago`;
}

const LIFECYCLE_VARIANT: Record<
  SchoolLifecycleStatus,
  'success' | 'info' | 'warning'
> = {
  active: 'success',
  trial: 'info',
  paused: 'warning',
};

/**
 * White-label dot mapping uses Tailwind semantic-token classes (success /
 * warning / danger / muted) instead of raw hex so the Phase 5B sweep
 * lint rule stays happy. The dot is small (8x8) and purely visual; the
 * label text carries the actual meaning for assistive tech.
 */
const WHITE_LABEL_DOT_CLASS: Record<WhiteLabelStatus, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  red: 'bg-danger',
  none: 'bg-muted-foreground',
  na: 'bg-muted-foreground',
};

const WHITE_LABEL_LABEL: Record<WhiteLabelStatus, string> = {
  green: 'Healthy',
  yellow: 'Degraded',
  red: 'Down',
  none: 'Not configured',
  na: 'n/a',
};

/* ------------------------------------------------------------------ */
/*  Inline dot for white-label column                                  */
/* ------------------------------------------------------------------ */

function WhiteLabelDot({ status }: { status: WhiteLabelStatus }) {
  return (
    <span
      title={WHITE_LABEL_LABEL[status]}
      className="inline-flex items-center gap-1.5 text-xs text-foreground"
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${WHITE_LABEL_DOT_CLASS[status]}`}
        aria-hidden="true"
      />
      {WHITE_LABEL_LABEL[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Main content                                                       */
/* ------------------------------------------------------------------ */

function HealthDashboardContent() {
  const { apiFetch } = useAdmin();

  const [rows, setRows] = useState<SchoolHealthRow[]>([]);
  const [degraded, setDegraded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Guard rail: fire PostHog event ONCE per mount, not on every fetch. */
  const trackedMount = useRef(false);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/health');
      if (!res.ok) {
        setError(`Failed to load health (HTTP ${res.status})`);
        setRows([]);
        return;
      }
      const data: HealthDashboardResponse = await res.json();
      setRows(data.schools ?? []);
      setDegraded(Boolean(data.synthetic_monitor_degraded));

      // Fire the operator-usage event exactly once per mount, on the
      // first successful render. We don't want refresh-on-interval to
      // double-count.
      if (!trackedMount.current) {
        trackedMount.current = true;
        const total = data.schools?.length ?? 0;
        const active7d = (data.schools ?? []).filter(
          r => r.active_users_7d > 0,
        ).length;
        track('super_admin_health_dashboard_viewed', {
          total_schools: total,
          active_in_last_7d: active7d,
          synthetic_monitor_degraded: Boolean(data.synthetic_monitor_degraded),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  // Default sort: last_activity desc. DataTable does its own sort once a
  // header is clicked; we pre-sort the data we pass in so the initial
  // render matches the spec.
  const sortedRows = [...rows].sort((a, b) => {
    const av = a.last_activity ?? '';
    const bv = b.last_activity ?? '';
    if (av && bv) return bv.localeCompare(av);
    if (av) return -1;
    if (bv) return 1;
    return 0;
  });

  const totalSchools = rows.length;
  const activeInLast7d = rows.filter(r => r.active_users_7d > 0).length;

  /* ----- columns ----- */
  const columns: Column<SchoolHealthRow>[] = [
    {
      key: 'name',
      label: 'School',
      sortable: true,
      render: r => (
        <div>
          <strong className="text-sm text-foreground">{r.name || '—'}</strong>
          {r.slug && (
            <div className="text-[11px] text-muted-foreground">{r.slug}</div>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      render: r => (
        <StatusBadge label={r.status} variant={LIFECYCLE_VARIANT[r.status]} />
      ),
    },
    {
      key: 'pilot_start',
      label: 'Pilot start',
      sortable: true,
      render: r => (
        <span className="text-xs text-foreground">{r.pilot_start ?? '—'}</span>
      ),
    },
    {
      key: 'active_users_7d',
      label: 'Active users (7d)',
      sortable: true,
      render: r => (
        <span
          className={`text-sm font-semibold ${r.active_users_7d > 0 ? 'text-foreground' : 'text-muted-foreground'}`}
        >
          {r.active_users_7d}
        </span>
      ),
    },
    {
      key: 'last_activity',
      label: 'Last activity',
      sortable: true,
      render: r => (
        <span className="text-xs text-foreground">
          {formatRelativeTime(r.last_activity)}
        </span>
      ),
    },
    {
      key: 'subscription_plan',
      label: 'Subscription',
      sortable: true,
      render: r => (
        <span className="text-xs text-foreground">
          {r.subscription_plan ?? '—'}
        </span>
      ),
    },
    {
      key: 'white_label',
      label: 'White-label',
      sortable: true,
      render: r => <WhiteLabelDot status={r.white_label} />,
    },
    {
      key: 'errors_24h',
      label: 'Errors (24h)',
      sortable: false,
      render: r => (
        <span className="text-xs text-muted-foreground">{r.errors_24h}</span>
      ),
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">School Health</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Per-school operational signal — status, active users (last 7 days),
          last activity, subscription, white-label, errors (24h).
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between rounded-md bg-danger/10 px-4 py-2.5 text-sm text-danger"
        >
          <span>{error}</span>
          <button
            onClick={() => setError(null)}
            className="cursor-pointer border-none bg-transparent text-sm font-semibold text-danger"
          >
            x
          </button>
        </div>
      )}

      {/* Synthetic-monitor degraded banner — appears only when E.5 is missing.
          Stays sticky-at-top of the table so ops knows the dot is incomplete. */}
      {degraded && (
        <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          White-label health is partial — synthetic-monitor table not yet
          present (Phase E.5). Configured domains show <em>n/a</em>.
        </div>
      )}

      {/* Summary count */}
      <div className="mb-3 text-sm text-foreground">
        <strong>{totalSchools}</strong> total schools,{' '}
        <strong>{activeInLast7d}</strong> active in last 7d
      </div>

      {/* Data Table */}
      <DataTable
        columns={columns}
        data={sortedRows}
        keyField="id"
        loading={loading}
        emptyMessage="No schools onboarded yet"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page export                                                        */
/* ------------------------------------------------------------------ */

export default function HealthDashboardPage() {
  return (
    <AdminShell>
      <HealthDashboardContent />
    </AdminShell>
  );
}
