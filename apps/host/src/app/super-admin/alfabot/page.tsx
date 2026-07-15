'use client';

/**
 * /super-admin/alfabot — AlfaBot operational dashboard (PR 4).
 *
 * Surfaces the observability layer for the bilingual landing-page chat bot.
 * 12 sections: today-at-a-glance, 30-day trend, cost monitor, abuse monitor,
 * lead funnel, latency, audience mix, lang mix, denylist management, feature
 * flag links, recent sessions, top-questions placeholder.
 *
 * P13: this page NEVER renders message content, email/phone/name from leads,
 * full IPs, or anything that would identify a specific visitor. Aggregate
 * counts only. The session-detail drill-in lives at
 * /super-admin/alfabot/[sessionId] and is gated by a NEW permission
 * (`alfabot.read_messages`) — proposed for the next RBAC migration.
 *
 * Owner: ops
 * Reviewers: frontend (UX), quality (P13 + a11y), testing
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import AdminShell, { useAdmin } from '../_components/AdminShell';
import { StatCard } from '@alfanumrik/ui/admin-ui/StatCard';
import { StatusBadge } from '@alfanumrik/ui/admin-ui';
import Link from 'next/link';

// ─── Response types (mirror the stats route) ────────────────────────────────

interface BucketRollup {
  sessions: number;
  messages: number;
  spendUsd: number;
}

interface TrendDay extends BucketRollup {
  day: string;
}

interface AudienceMix {
  parent: number;
  student: number;
  teacher: number;
  school: number;
}

interface LangMix {
  en: number;
  hi: number;
}

interface LeadsFunnel {
  today: number;
  last7d: number;
  last30d: number;
  byAudience: AudienceMix;
  webhookDeliveredPct: number;
}

interface StatsResponse {
  generatedAt: string;
  today: {
    sessions: number;
    messages: number;
    spendUsd: number;
    rateLimitHitPct: number;
    degradedMessages: number;
  };
  cap: { dailyUsdCap: number; percentUsed: number };
  abuse: {
    blockedToday: number;
    denylistSize: number;
    topReasons: Array<{ reason: string; count: number }>;
  };
  leads: LeadsFunnel;
  latency: { p50ms: number | null; p95ms: number | null; model: string; samples: number };
  audienceMix: AudienceMix;
  langMix: LangMix;
  trend30d: TrendDay[];
  empty: boolean;
}

interface SessionListItem {
  id: string;
  audience: string;
  lang: string;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  ipHashTruncated: string | null;
  rateLimitHit: boolean;
}

interface DenylistEntry {
  anon_id: string;
  reason: string;
  added_by: string | null;
  created_at: string;
}

// ─── Style tokens (match foxy-quality page) ─────────────────────────────────

const TH = 'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TH_R = `${TH} text-right`;
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const TD_R = `${TD} text-right`;

function formatUsd(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

// ─── Cost monitor band ──────────────────────────────────────────────────────

function costBandClass(percentUsed: number): string {
  if (percentUsed >= 0.8) return 'border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] text-danger';
  if (percentUsed >= 0.5) return 'border-warning bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] text-warning';
  return 'border-success bg-[color-mix(in_srgb,var(--success)_10%,transparent)] text-success';
}

// ─── Sparkline (tiny inline SVG, no recharts dep) ───────────────────────────
//
// Most super-admin pages in this codebase use a mix of inline SVG and the
// shared admin-ui primitives; we keep the implementation tiny so it doesn't
// bloat the bundle (P10). If the codebase later standardises on Recharts in
// admin pages, swap this for a thin wrapper.

interface SparklineProps {
  values: number[];
  height?: number;
  width?: number;
  stroke: string;
}

function Sparkline({ values, height = 40, width = 240, stroke }: SparklineProps) {
  if (values.length === 0) return null;
  const max = Math.max(1, ...values);
  const step = width / Math.max(1, values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(2)},${(height - (v / max) * (height - 4) - 2).toFixed(2)}`)
    .join(' ');
  return (
    <svg width={width} height={height} aria-hidden="true">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

// ─── Donut (audience mix) ───────────────────────────────────────────────────

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

function Donut({ segments, size = 100 }: { segments: DonutSegment[]; size?: number }) {
  const total = segments.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center text-[11px] text-muted-foreground" style={{ height: size }}>
        no data
      </div>
    );
  }
  const radius = size / 2 - 8;
  const cx = size / 2;
  const cy = size / 2;
  let cumulative = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-label="distribution">
      {segments.map((seg, idx) => {
        if (seg.value === 0) return null;
        const startAngle = (cumulative / total) * Math.PI * 2;
        cumulative += seg.value;
        const endAngle = (cumulative / total) * Math.PI * 2;
        const x1 = cx + radius * Math.cos(startAngle - Math.PI / 2);
        const y1 = cy + radius * Math.sin(startAngle - Math.PI / 2);
        const x2 = cx + radius * Math.cos(endAngle - Math.PI / 2);
        const y2 = cy + radius * Math.sin(endAngle - Math.PI / 2);
        const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
        return (
          <path
            key={idx}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`}
            fill={seg.color}
            opacity={0.85}
          />
        );
      })}
      <circle cx={cx} cy={cy} r={radius * 0.55} fill="var(--surface-1, #fff)" />
    </svg>
  );
}

// ─── Main inner page ────────────────────────────────────────────────────────

function AlfabotDashboardInner() {
  const { apiFetch } = useAdmin();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [denylist, setDenylist] = useState<DenylistEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Denylist add form
  const [newAnonId, setNewAnonId] = useState('');
  const [newReason, setNewReason] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, sessionsRes, denyRes] = await Promise.all([
        apiFetch('/api/super-admin/alfabot/stats'),
        apiFetch('/api/super-admin/alfabot/sessions?limit=50'),
        apiFetch('/api/super-admin/alfabot/denylist'),
      ]);

      if (!statsRes.ok) {
        setError(`stats HTTP ${statsRes.status}`);
        return;
      }
      const statsBody = await statsRes.json();
      if (statsBody.success) setStats(statsBody.data);

      if (sessionsRes.ok) {
        const sBody = await sessionsRes.json();
        if (sBody.success) setSessions(sBody.data);
      }

      if (denyRes.ok) {
        const dBody = await denyRes.json();
        if (dBody.success) setDenylist(dBody.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fetch_failed');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleAddDenylist = useCallback(async () => {
    if (!newAnonId.trim() || !newReason.trim()) {
      setAddError('Both anon_id and reason are required.');
      return;
    }
    setAdding(true);
    setAddError(null);
    try {
      const res = await apiFetch('/api/super-admin/alfabot/denylist', {
        method: 'POST',
        body: JSON.stringify({ anonId: newAnonId.trim(), reason: newReason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setAddError(body?.error ?? `HTTP ${res.status}`);
        return;
      }
      setNewAnonId('');
      setNewReason('');
      await fetchAll();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'add_failed');
    } finally {
      setAdding(false);
    }
  }, [apiFetch, newAnonId, newReason, fetchAll]);

  const handleRemoveDenylist = useCallback(
    async (anonId: string) => {
      if (!confirm(`Remove ${anonId} from the AlfaBot denylist?`)) return;
      const res = await apiFetch('/api/super-admin/alfabot/denylist', {
        method: 'DELETE',
        body: JSON.stringify({ anonId }),
      });
      if (res.ok) await fetchAll();
    },
    [apiFetch, fetchAll],
  );

  const audienceSegments = useMemo((): DonutSegment[] => {
    if (!stats) return [];
    return [
      { label: 'Parent', value: stats.audienceMix.parent, color: '#7C3AED' },
      { label: 'Student', value: stats.audienceMix.student, color: '#E8581C' },
      { label: 'Teacher', value: stats.audienceMix.teacher, color: '#22C55E' },
      { label: 'School', value: stats.audienceMix.school, color: '#3B82F6' },
    ];
  }, [stats]);

  if (loading && !stats) {
    return <p className="text-muted-foreground">Loading AlfaBot metrics…</p>;
  }
  if (error || !stats) {
    return <p className="text-danger">{error ?? 'No data'}</p>;
  }

  const trendSessions = stats.trend30d.map((d) => d.sessions);
  const trendMessages = stats.trend30d.map((d) => d.messages);

  return (
    <div>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">AlfaBot</h1>
          <p className="mb-1.5 text-sm text-muted-foreground">
            Landing-page chat bot ops. Model: <strong>{stats.latency.model}</strong> (OpenAI).
            Lives at <code className="text-xs">/welcome</code> for anonymous visitors only.
          </p>
          <p className="m-0 text-xs text-muted-foreground">
            Last refreshed {new Date(stats.generatedAt).toLocaleString()}.
            {stats.empty && (
              <span className="ml-1 text-warning">
                No sessions yet — flip <code>ff_alfabot_v1</code> on to start.
              </span>
            )}
          </p>
        </div>
        <button
          onClick={fetchAll}
          className="rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-surface-2"
        >
          Refresh
        </button>
      </div>

      {/* ── 1. Today at a glance ──────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-4 gap-3">
        <StatCard label="Sessions today" value={stats.today.sessions} accentColor="#7C3AED" />
        <StatCard label="Messages today" value={stats.today.messages} accentColor="#E8581C" />
        <StatCard
          label="Estimated spend"
          value={formatUsd(stats.today.spendUsd)}
          subtitle={`${formatPct(stats.cap.percentUsed * 100, 1)} of $${stats.cap.dailyUsdCap.toFixed(2)} cap`}
          accentColor="#22C55E"
        />
        <StatCard
          label="Rate-limit hit"
          value={formatPct(stats.today.rateLimitHitPct, 1)}
          subtitle={`${stats.today.degradedMessages} degraded msgs`}
          accentColor="#3B82F6"
        />
      </section>

      {/* ── 2. Cost monitor banner ────────────────────────────────────── */}
      <section
        className={`mb-6 rounded-lg border p-4 text-[13px] ${costBandClass(stats.cap.percentUsed)}`}
      >
        <div className="flex items-center justify-between">
          <div>
            <strong>Cost monitor:</strong> {formatUsd(stats.today.spendUsd)} of $
            {stats.cap.dailyUsdCap.toFixed(2)} ({formatPct(stats.cap.percentUsed * 100, 1)}).
            {stats.cap.percentUsed >= 0.8 && ' Bot is degraded — answers shortened.'}
            {stats.today.degradedMessages > 0 && (
              <span className="ml-2">
                {stats.today.degradedMessages} message{stats.today.degradedMessages === 1 ? '' : 's'}{' '}
                served in degraded mode today.
              </span>
            )}
          </div>
          <Link
            href="/super-admin/flags?search=ff_alfabot"
            className="rounded-md border border-current px-3 py-1 text-[11px] font-medium hover:bg-surface-2"
          >
            Flags
          </Link>
        </div>
      </section>

      {/* ── 3. 30-day trend ───────────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sessions / day — last 30d
          </div>
          <Sparkline values={trendSessions} stroke="#7C3AED" width={260} height={40} />
          <div className="mt-1 text-[11px] text-muted-foreground">
            Peak {Math.max(0, ...trendSessions).toLocaleString()} · today {stats.today.sessions.toLocaleString()}
          </div>
        </div>
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Messages / day — last 30d
          </div>
          <Sparkline values={trendMessages} stroke="#E8581C" width={260} height={40} />
          <div className="mt-1 text-[11px] text-muted-foreground">
            Peak {Math.max(0, ...trendMessages).toLocaleString()} · today {stats.today.messages.toLocaleString()}
          </div>
        </div>
      </section>

      {/* ── 4. Latency ────────────────────────────────────────────────── */}
      <section className="mb-6 grid grid-cols-3 gap-3">
        <StatCard
          label="p50 latency"
          value={stats.latency.p50ms !== null ? `${stats.latency.p50ms} ms` : '—'}
          subtitle={`Last 24h · ${stats.latency.samples} samples`}
        />
        <StatCard
          label="p95 latency"
          value={stats.latency.p95ms !== null ? `${stats.latency.p95ms} ms` : '—'}
          subtitle={`Model = ${stats.latency.model}`}
        />
        <StatCard
          label="Sessions / lang"
          value={`${stats.langMix.en} EN · ${stats.langMix.hi} HI`}
          subtitle="Last 7 days"
        />
      </section>

      {/* ── 5. Abuse monitor + audience donut ─────────────────────────── */}
      <section className="mb-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Abuse monitor (today)
          </h2>
          <div className="mb-3 grid grid-cols-2 gap-2 text-[13px]">
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Blocked</div>
              <div className="text-2xl font-bold text-danger">{stats.abuse.blockedToday}</div>
            </div>
            <div>
              <div className="text-[11px] uppercase text-muted-foreground">Denylist size</div>
              <div className="text-2xl font-bold text-foreground">{stats.abuse.denylistSize}</div>
            </div>
          </div>
          <div className="text-[11px] font-semibold uppercase text-muted-foreground">
            Top reasons
          </div>
          {stats.abuse.topReasons.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">None today.</div>
          ) : (
            <ul className="mt-1 space-y-1 text-[12px]">
              {stats.abuse.topReasons.map((r) => (
                <li key={r.reason} className="flex items-center justify-between">
                  <span className="font-mono text-foreground">{r.reason}</span>
                  <span className="text-muted-foreground">{r.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-lg border border-surface-3 bg-surface-1 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Audience mix — last 7d
          </h2>
          <div className="flex items-center gap-4">
            <Donut segments={audienceSegments} size={120} />
            <ul className="space-y-1 text-[12px]">
              {audienceSegments.map((s) => (
                <li key={s.label} className="flex items-center gap-2">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  <span className="font-medium text-foreground">{s.label}</span>
                  <span className="text-muted-foreground">{s.value}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── 6. Lead funnel ────────────────────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-surface-3 bg-surface-1 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Lead funnel — gated by ff_alfabot_lead_capture_v1
        </h2>
        <div className="grid grid-cols-5 gap-3 text-[13px]">
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">Today</div>
            <div className="text-2xl font-bold text-foreground">{stats.leads.today}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">Last 7d</div>
            <div className="text-2xl font-bold text-foreground">{stats.leads.last7d}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">Last 30d</div>
            <div className="text-2xl font-bold text-foreground">{stats.leads.last30d}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">Webhook delivered</div>
            <div className="text-2xl font-bold text-foreground">
              {formatPct(stats.leads.webhookDeliveredPct, 1)}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-muted-foreground">By audience (30d)</div>
            <div className="mt-1 text-[12px] text-muted-foreground">
              P {stats.leads.byAudience.parent} · S {stats.leads.byAudience.student} · T{' '}
              {stats.leads.byAudience.teacher} · Sch {stats.leads.byAudience.school}
            </div>
          </div>
        </div>
        <p className="m-0 mt-2 text-[11px] text-muted-foreground">
          P13: lead emails / phones / names are never surfaced here. Counts only.
        </p>
      </section>

      {/* ── 7. Denylist management ────────────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-surface-3 bg-surface-1 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Denylist
        </h2>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] uppercase text-muted-foreground">anon_id</label>
            <input
              type="text"
              value={newAnonId}
              onChange={(e) => setNewAnonId(e.target.value)}
              placeholder="alf-xxxxxxxxxxxxxxxx"
              className="mt-0.5 w-full rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-[12px] font-mono"
            />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="block text-[11px] uppercase text-muted-foreground">Reason</label>
            <input
              type="text"
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="e.g. repeated prompt-injection probes"
              className="mt-0.5 w-full rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-[12px]"
            />
          </div>
          <button
            onClick={handleAddDenylist}
            disabled={adding}
            className="rounded-md border border-surface-3 bg-purple-600 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-purple-700 disabled:opacity-60"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
        {addError && <p className="m-0 mb-2 text-[12px] text-danger">{addError}</p>}

        {denylist.length === 0 ? (
          <p className="m-0 text-[12px] text-muted-foreground">Denylist is empty.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>anon_id</th>
                  <th className={TH}>Reason</th>
                  <th className={TH}>Added</th>
                  <th className={TH_R}>—</th>
                </tr>
              </thead>
              <tbody>
                {denylist.map((row) => (
                  <tr key={row.anon_id}>
                    <td className={`${TD} font-mono text-[11px]`}>{row.anon_id}</td>
                    <td className={TD}>{row.reason}</td>
                    <td className={`${TD} text-[11px] text-muted-foreground`}>
                      {new Date(row.created_at).toLocaleString()}
                    </td>
                    <td className={TD_R}>
                      <button
                        onClick={() => handleRemoveDenylist(row.anon_id)}
                        className="text-[11px] font-medium text-danger underline-offset-2 hover:underline"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 8. Feature flag links ─────────────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-surface-3 bg-surface-1 p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Feature flags
        </h2>
        <p className="m-0 mb-2 text-[12px] text-muted-foreground">
          Manage rollout via the flags page — search prefix <code>ff_alfabot</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          {(['ff_alfabot_v1', 'ff_alfabot_lead_capture_v1', 'ff_alfabot_streaming'] as const).map((name) => (
            <Link
              key={name}
              href={`/super-admin/flags?search=${name}`}
              className="rounded-md border border-surface-3 bg-surface-2 px-3 py-1.5 text-[11px] font-mono hover:bg-surface-1"
            >
              {name}
            </Link>
          ))}
        </div>
      </section>

      {/* ── 9. Recent sessions ────────────────────────────────────────── */}
      <section className="mb-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Recent sessions (last 50)
        </h2>
        {sessions.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4 text-[13px] text-muted-foreground">
            No sessions yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Started</th>
                  <th className={TH}>Audience</th>
                  <th className={TH}>Lang</th>
                  <th className={TH_R}>Messages</th>
                  <th className={TH}>IP hash</th>
                  <th className={TH}>Rate-limited?</th>
                  <th className={TH_R}>—</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className={`${TD} text-[11px] text-muted-foreground`}>
                      {new Date(s.startedAt).toLocaleString()}
                    </td>
                    <td className={TD}>{s.audience}</td>
                    <td className={TD}>{s.lang.toUpperCase()}</td>
                    <td className={TD_R}>{s.messageCount}</td>
                    <td className={`${TD} font-mono text-[11px] text-muted-foreground`}>
                      {s.ipHashTruncated ?? '—'}
                    </td>
                    <td className={TD}>
                      {s.rateLimitHit ? <StatusBadge variant="warning" label="limited" /> : '—'}
                    </td>
                    <td className={TD_R}>
                      <Link
                        href={`/super-admin/alfabot/${s.id}`}
                        className="text-[11px] font-medium text-purple-500 underline-offset-2 hover:underline"
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── 10. Top questions placeholder ─────────────────────────────── */}
      <section className="mb-6 rounded-lg border border-dashed border-surface-3 bg-surface-1 p-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Top questions (30d)
        </h2>
        <p className="m-0 text-[12px] text-muted-foreground">
          Coming in v1.1 (requires offline clustering job). For now, see audit log entries via{' '}
          <Link
            href="/super-admin/logs?action=alfabot.respond"
            className="text-purple-500 underline-offset-2 hover:underline"
          >
            /super-admin/logs?action=alfabot.respond
          </Link>
          .
        </p>
      </section>

      <p className="m-0 text-[11px] text-muted-foreground">
        P13: this page never surfaces message content, IPs, emails, phones, or names.{' '}
        For forensic message review, use the{' '}
        <Link
          href={sessions.length > 0 ? `/super-admin/alfabot/${sessions[0].id}` : '#'}
          className="text-purple-500"
        >
          session detail
        </Link>{' '}
        page (separate permission).
      </p>
    </div>
  );
}

export default function AlfabotDashboardPage() {
  return (
    <AdminShell>
      <AlfabotDashboardInner />
    </AdminShell>
  );
}
