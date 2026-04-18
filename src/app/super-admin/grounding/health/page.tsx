'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';
import StatCard from '../../_components/StatCard';

/**
 * Grounding Health — super-admin page (Task 3.16)
 *
 * Live operational state of the grounded-answer service. Polls
 * /api/super-admin/grounding/health every 30s (SWR via setInterval —
 * avoids pulling the swr lib just for this).
 *
 * Response shape is defined by the Batch 3C route and documented in
 * spec §4.3. Display is intentionally read-only — actions are on the
 * sister pages (verification-queue, ai-issues).
 */

const CALLERS = ['foxy', 'ncert-solver', 'quiz-generator', 'concept-engine', 'diagnostic'] as const;
type Caller = (typeof CALLERS)[number];

const ABSTAIN_REASONS = [
  'chapter_not_ready',
  'no_chunks_retrieved',
  'low_similarity',
  'no_supporting_chunks',
  'scope_mismatch',
  'upstream_error',
  'circuit_open',
] as const;

const ABSTAIN_COLORS: Record<string, string> = {
  chapter_not_ready: '#F59E0B',
  no_chunks_retrieved: '#F97316',
  low_similarity: '#FB923C',
  no_supporting_chunks: '#FBBF24',
  scope_mismatch: '#A855F7',
  upstream_error: '#DC2626',
  circuit_open: '#B91C1C',
};

interface HealthData {
  callsPerMin: Record<Caller, number>;
  groundedRate: Record<Caller, number>;
  abstainBreakdown: Record<string, number>;
  latency: { p50: number; p95: number; p99: number };
  circuitStates: Record<string, 'closed' | 'degraded' | 'open'>;
  voyageErrorRate: number;
  claudeErrorRate: number;
  /**
   * Study-path fallback activity in the last hour.
   * High volume during drain days 1-2 is expected; post-pilot should trend
   * to zero. Stable non-zero = ingestion problem (see scoring-integrity-epoch
   * runbook + ddc41f8 commit message).
   */
  studyPathFallback?: {
    totalLastHour: number;
    subjectsLastHour: number;
    chaptersLastHour: number;
  };
  generated_at: string;
}

const POLL_MS = 30_000;

function pct(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '0%';
  return `${Math.round(x * 100)}%`;
}

function circuitColor(state?: string): { bg: string; fg: string; label: string } {
  switch (state) {
    case 'closed':
      return { bg: colors.successLight, fg: colors.success, label: 'Closed' };
    case 'degraded':
      return { bg: colors.warningLight, fg: colors.warning, label: 'Degraded' };
    case 'open':
      return { bg: colors.dangerLight, fg: colors.danger, label: 'Open' };
    default:
      return { bg: colors.surface, fg: colors.text3, label: 'Unknown' };
  }
}

function gaugeColor(rate: number): string {
  if (rate >= 0.05) return colors.danger;
  if (rate >= 0.01) return colors.warning;
  return colors.success;
}

function GroundingHealthContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await apiFetch('/api/super-admin/grounding/health');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Request failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as { success: boolean; data: HealthData; error?: string };
      if (!body.success) {
        setError(body.error || 'Request failed');
        return;
      }
      setData(body.data);
      setError(null);
      setLastFetched(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchHealth();
    timerRef.current = setInterval(fetchHealth, POLL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchHealth]);

  const abstainTotal = data
    ? Object.values(data.abstainBreakdown).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div data-testid="grounding-health-page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Grounding Health</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            Live state of the grounded-answer service — polls every 30s
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {lastFetched && (
            <span style={{ fontSize: 11, color: colors.text3 }}>
              Last updated: {lastFetched.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchHealth} style={S.secondaryBtn}>Refresh</button>
        </div>
      </div>

      {error && (
        <div
          data-testid="grounding-health-error"
          style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: colors.dangerLight, color: colors.danger, fontSize: 13 }}
        >
          Error loading health: {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
          Loading grounding health...
        </div>
      )}

      {data && (
        <>
          {/* Calls per minute — one tile per caller */}
          <h2 style={S.h2}>Calls per minute (last 1 min)</h2>
          <div
            data-testid="calls-per-min-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}
          >
            {CALLERS.map((caller) => (
              <StatCard
                key={caller}
                label={caller}
                value={data.callsPerMin[caller] ?? 0}
                accentColor={colors.accent}
              />
            ))}
          </div>

          {/* Grounded rate per caller */}
          <h2 style={S.h2}>Grounded rate (last hour)</h2>
          <div
            data-testid="grounded-rate-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}
          >
            {CALLERS.map((caller) => {
              const rate = data.groundedRate[caller] ?? 0;
              const accent = rate >= 0.9 ? colors.success : rate >= 0.7 ? colors.warning : colors.danger;
              return (
                <StatCard
                  key={caller}
                  label={caller}
                  value={pct(rate)}
                  accentColor={accent}
                />
              );
            })}
          </div>

          {/* Abstain reasons stacked bar */}
          <h2 style={S.h2}>Abstain reasons (last hour)</h2>
          <div
            data-testid="abstain-breakdown"
            style={{ ...S.card, marginBottom: 24 }}
          >
            {abstainTotal === 0 ? (
              <div style={{ fontSize: 12, color: colors.text3 }}>
                No abstains in the last hour.
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    height: 24,
                    borderRadius: 4,
                    overflow: 'hidden',
                    border: `1px solid ${colors.border}`,
                    background: colors.surface,
                  }}
                >
                  {ABSTAIN_REASONS.map((r) => {
                    const count = data.abstainBreakdown[r] ?? 0;
                    const width = abstainTotal === 0 ? 0 : (count / abstainTotal) * 100;
                    if (width === 0) return null;
                    return (
                      <div
                        key={r}
                        title={`${r}: ${count}`}
                        data-testid={`abstain-bar-${r}`}
                        style={{
                          width: `${width}%`,
                          background: ABSTAIN_COLORS[r] ?? colors.text3,
                        }}
                      />
                    );
                  })}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
                  {ABSTAIN_REASONS.map((r) => (
                    <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: ABSTAIN_COLORS[r] ?? colors.text3,
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ color: colors.text2 }}>
                        {r}: <b style={{ color: colors.text1 }}>{data.abstainBreakdown[r] ?? 0}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Latency */}
          <h2 style={S.h2}>Latency (ms, last hour)</h2>
          <div
            data-testid="latency-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}
          >
            <StatCard label="p50" value={`${data.latency.p50} ms`} accentColor={colors.success} />
            <StatCard label="p95" value={`${data.latency.p95} ms`} accentColor={colors.warning} />
            <StatCard label="p99" value={`${data.latency.p99} ms`} accentColor={colors.danger} />
          </div>

          {/* Circuit states */}
          <h2 style={S.h2}>Circuit breakers</h2>
          <div
            data-testid="circuit-states-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}
          >
            {(['voyage', 'claude', 'retrieval'] as const).map((name) => {
              const state = data.circuitStates[name];
              const color = circuitColor(state);
              return (
                <div
                  key={name}
                  data-testid={`circuit-tile-${name}`}
                  style={{
                    padding: 16,
                    borderRadius: 8,
                    border: `1px solid ${colors.border}`,
                    borderLeft: `3px solid ${color.fg}`,
                    background: color.bg,
                  }}
                >
                  <div style={{ fontSize: 11, color: colors.text3, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>
                    {name}
                  </div>
                  <div style={{ fontSize: 20, color: color.fg, fontWeight: 700, marginTop: 4 }}>
                    {color.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Error rates */}
          <h2 style={S.h2}>Upstream error rates (last 5 min)</h2>
          <div
            data-testid="error-rates-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}
          >
            <StatCard
              label="Voyage error rate"
              value={pct(data.voyageErrorRate)}
              accentColor={gaugeColor(data.voyageErrorRate)}
            />
            <StatCard
              label="Claude error rate"
              value={pct(data.claudeErrorRate)}
              accentColor={gaugeColor(data.claudeErrorRate)}
            />
          </div>

          {/* Study-path fallback telemetry (ddc41f8 hotfix) */}
          <h2 style={S.h2}>
            Study-path fallback (last hour)
          </h2>
          <p style={{ ...S.small, marginBottom: 12 }}>
            Number of times <code>/api/student/subjects</code> or{' '}
            <code>/api/student/chapters</code> fell back to GRADE_SUBJECTS /
            chapters-catalog because the v2 RPC returned empty or errored.
            High during drain days 1-2 is expected; post-pilot should trend to
            zero. Stable non-zero indicates an ingestion problem — see{' '}
            <code>docs/runbooks/grounding/scoring-integrity-epoch.md</code>.
          </p>
          <div
            data-testid="study-path-fallback-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 24 }}
          >
            <StatCard
              label="Total fallback events"
              value={String(data.studyPathFallback?.totalLastHour ?? 0)}
              accentColor={
                (data.studyPathFallback?.totalLastHour ?? 0) === 0
                  ? colors.success
                  : (data.studyPathFallback?.totalLastHour ?? 0) > 100
                    ? colors.danger
                    : colors.warning
              }
            />
            <StatCard
              label="Subjects route"
              value={String(data.studyPathFallback?.subjectsLastHour ?? 0)}
              accentColor={colors.text3}
            />
            <StatCard
              label="Chapters route"
              value={String(data.studyPathFallback?.chaptersLastHour ?? 0)}
              accentColor={colors.text3}
            />
          </div>
        </>
      )}
    </div>
  );
}

export default function GroundingHealthPage() {
  return (
    <AdminShell>
      <GroundingHealthContent />
    </AdminShell>
  );
}