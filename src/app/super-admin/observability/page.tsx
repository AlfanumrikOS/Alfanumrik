'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { colors, S } from '../_components/admin-styles';
import FiltersBar, { type Filters, DEFAULT_FILTERS } from './_components/FiltersBar';
import SystemSnapshot from './_components/SystemSnapshot';
import EventRow, { type TimelineEvent } from './_components/EventRow';
import EventDetailDrawer from './_components/EventDetailDrawer';

/**
 * Observability Console — super-admin page
 *
 * Shows a system snapshot strip, filter controls, reverse-chronological
 * timeline of ops_events, and a detail drawer on click.
 * Filters are read/written to URL query params for shareable links.
 */

// Short ranges auto-refresh every 10s
const AUTO_REFRESH_RANGES = new Set(['15m', '1h']);

function filtersToParams(filters: Filters): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.from && filters.to) {
    p.set('from', filters.from);
    p.set('to', filters.to);
  } else {
    p.set('range', filters.range);
  }
  if (filters.category.length > 0) p.set('category', filters.category.join(','));
  if (filters.severity.length > 0) p.set('severity', filters.severity.join(','));
  if (filters.env !== 'production') p.set('env', filters.env);
  if (filters.q) p.set('q', filters.q);
  return p;
}

function paramsToFilters(search: string): Filters {
  const p = new URLSearchParams(search);
  return {
    range: p.get('range') || (p.get('from') ? 'custom' : '1h'),
    from: p.get('from') || '',
    to: p.get('to') || '',
    category: p.get('category')?.split(',').filter(Boolean) || [],
    severity: p.get('severity')?.split(',').filter(Boolean) || [],
    env: p.get('env') || 'production',
    q: p.get('q') || '',
  };
}

interface SnapshotData {
  breakerState: 'closed' | 'degraded' | 'open';
  breakerReason: string;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  healthAgeSeconds: number | null;
  lastDeploy: { git_sha: string; occurred_at: string; environment: string } | null;
  eventCounts: { info: number; warning: number; error: number; critical: number };
}

function ObservabilityContent() {
  const { apiFetch } = useAdmin();

  // State
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const initRef = useRef(false);

  // Read filters from URL on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const search = window.location.search;
    if (search) {
      setFilters(paramsToFilters(search));
    }
  }, []);

  // Write filters to URL when they change
  useEffect(() => {
    const params = filtersToParams(filters);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  }, [filters]);

  // Fetch snapshot
  const fetchSnapshot = useCallback(async () => {
    setSnapshotLoading(true);
    try {
      const res = await apiFetch('/api/super-admin/observability/snapshot');
      if (res.ok) {
        setSnapshot(await res.json());
      }
    } catch {
      // Snapshot errors are non-fatal
    } finally {
      setSnapshotLoading(false);
    }
  }, [apiFetch]);

  // Fetch events
  const fetchEvents = useCallback(async (cursor?: string) => {
    if (cursor) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const params = filtersToParams(filters);
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '100');

      const res = await apiFetch(`/api/super-admin/observability/events?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to fetch events' }));
        setError(body.error || 'Failed to fetch events');
        return;
      }

      const data = await res.json();
      if (cursor) {
        setEvents(prev => [...prev, ...(data.events || [])]);
      } else {
        setEvents(data.events || []);
      }
      setNextCursor(data.nextCursor || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch events');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [apiFetch, filters]);

  // Fetch on filter change
  useEffect(() => {
    fetchEvents();
    fetchSnapshot();
  }, [fetchEvents, fetchSnapshot]);

  // Auto-refresh for short ranges
  useEffect(() => {
    if (refreshTimerRef.current) {
      clearInterval(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const shouldRefresh = AUTO_REFRESH_RANGES.has(filters.range) && !filters.from && !filters.to;
    if (shouldRefresh) {
      refreshTimerRef.current = setInterval(() => {
        fetchEvents();
        fetchSnapshot();
      }, 10000);
    }

    return () => {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
      }
    };
  }, [filters.range, filters.from, filters.to, fetchEvents, fetchSnapshot]);

  // CSV export
  const handleExport = async () => {
    const params = filtersToParams(filters);
    // Ensure from/to are set for export
    if (!params.has('from') || !params.has('to')) {
      const rangeMs: Record<string, number> = {
        '15m': 15 * 60 * 1000, '1h': 3600000, '4h': 4 * 3600000,
        '24h': 86400000, '7d': 7 * 86400000, '30d': 30 * 86400000,
      };
      const ms = rangeMs[filters.range] || 3600000;
      const now = new Date();
      params.set('from', new Date(now.getTime() - ms).toISOString());
      params.set('to', now.toISOString());
    }

    try {
      const res = await apiFetch(`/api/super-admin/observability/export?${params.toString()}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ops-events-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Export error is non-fatal
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Observability Console</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Unified event timeline across AI, payments, auth, deployments, and admin actions
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleExport} style={S.dlBtn}>Export CSV</button>
          <button onClick={() => { fetchEvents(); fetchSnapshot(); }} style={S.secondaryBtn}>Refresh</button>
        </div>
      </div>

      {/* System Snapshot Strip */}
      <SystemSnapshot data={snapshot} loading={snapshotLoading} />

      {/* Filters */}
      <FiltersBar
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(DEFAULT_FILTERS)}
      />

      {/* Event count */}
      <div style={{ fontSize: 12, color: colors.text3, marginBottom: 6 }}>
        {events.length} events{nextCursor ? '+' : ''}{' '}
        {AUTO_REFRESH_RANGES.has(filters.range) && !filters.from && (
          <span style={{ fontSize: 10 }}>(auto-refresh 10s)</span>
        )}
      </div>

      {/* Timeline */}
      <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
        {/* Loading */}
        {loading && events.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
            Loading events...
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: 16, color: colors.danger, fontSize: 13, background: colors.dangerLight }}>
            {error}
          </div>
        )}

        {/* Empty */}
        {!loading && !error && events.length === 0 && (
          <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
            No events in this range. Try widening the time window.
          </div>
        )}

        {/* Event rows */}
        {events.map(event => (
          <EventRow
            key={event.id}
            event={event}
            onClick={e => setSelectedEventId(e.id)}
            isSelected={selectedEventId === event.id}
          />
        ))}

        {/* Load more */}
        {nextCursor && !loading && (
          <div style={{ padding: 10, textAlign: 'center', borderTop: `1px solid ${colors.borderLight}` }}>
            <button
              onClick={() => fetchEvents(nextCursor)}
              disabled={loadingMore}
              style={{ ...S.actionBtn, fontSize: 12, padding: '6px 16px' }}
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        )}
      </div>

      {/* Event Detail Drawer */}
      <EventDetailDrawer
        eventId={selectedEventId}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  );
}

export default function ObservabilityPage() {
  return (
    <AdminShell>
      <ObservabilityContent />
    </AdminShell>
  );
}
