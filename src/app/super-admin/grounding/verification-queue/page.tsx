'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { colors, S } from '../../_components/admin-styles';
import StatCard from '../../_components/StatCard';

/**
 * Grounding Verification Queue — super-admin page (Task 3.17b)
 *
 * Surfaces question_bank verification pipeline state. Shows counts per
 * state, per-pair verified_ratio, failed-rows sample for triage, and an
 * "enable enforcement" toggle per pair (requires ratio >= 0.9).
 *
 * Actions POST to the verification-queue API when the operator clicks
 * re-verify / soft-delete / enable-enforcement. The API endpoints for
 * actions are shared with the existing super-admin action pattern; the
 * handlers are stubbed with clear TODOs where the server route doesn't
 * yet exist (those arrive as a follow-up backend task — Phase 3 ships
 * the UI so ops can inspect state).
 */

interface PairRow {
  grade: string;
  subject: string;
  legacy_unverified: number;
  pending: number;
  verified: number;
  failed: number;
  verified_ratio: number;
}

interface FailedRow {
  id: string;
  grade: string;
  subject: string;
  chapter_number: number;
  chapter_title: string;
  question_text: string;
  correct_answer_index: number;
  verifier_failure_reason: string | null;
  verifier_trace_id: string | null;
  verified_at: string | null;
}

interface QueueResponse {
  success: boolean;
  data: {
    counts: { legacy_unverified: number; pending: number; verified: number; failed: number };
    byPair: PairRow[];
    failedSample: FailedRow[];
    throughputLast24h: {
      verified_per_hour: number;
      failed_per_hour: number;
      verified_total: number;
      failed_total: number;
    };
    generated_at: string;
  };
  error?: string;
}

const ENFORCEMENT_THRESHOLD = 0.9;

function VerificationQueueContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<QueueResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch('/api/super-admin/grounding/verification-queue');
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || `Request failed with status ${res.status}`);
        return;
      }
      const body = (await res.json()) as QueueResponse;
      if (!body.success) {
        setError(body.error || 'Request failed');
        return;
      }
      setData(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const runAction = useCallback(
    async (action: string, payload: Record<string, unknown>) => {
      setActionMsg(null);
      try {
        const res = await apiFetch('/api/super-admin/grounding/verification-queue', {
          method: 'POST',
          body: JSON.stringify({ action, ...payload }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setActionMsg(`Action failed: ${body.error || res.status}`);
          return;
        }
        setActionMsg(`Action "${action}" queued successfully`);
        // Refetch after action
        fetchQueue();
      } catch (err) {
        setActionMsg(err instanceof Error ? err.message : 'Action failed');
      }
    },
    [apiFetch, fetchQueue],
  );

  return (
    <div data-testid="grounding-verification-queue-page">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={S.h1}>Verification Queue</h1>
          <p style={{ fontSize: 13, color: colors.text3, margin: 0 }}>
            question_bank verification pipeline state + per-pair enforcement controls
          </p>
        </div>
        <button onClick={fetchQueue} style={S.secondaryBtn}>Refresh</button>
      </div>

      {error && (
        <div
          data-testid="grounding-queue-error"
          style={{ padding: 12, marginBottom: 16, borderRadius: 6, background: colors.dangerLight, color: colors.danger, fontSize: 13 }}
        >
          Error: {error}
        </div>
      )}

      {actionMsg && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 6,
            background: colors.accentLight,
            color: colors.accent,
            fontSize: 13,
          }}
        >
          {actionMsg}
        </div>
      )}

      {loading && !data && (
        <div style={{ padding: 32, textAlign: 'center', color: colors.text3, fontSize: 13 }}>
          Loading verification queue...
        </div>
      )}

      {data && (
        <>
          {/* Counts */}
          <h2 style={S.h2}>Counts by state</h2>
          <div
            data-testid="queue-counts-section"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}
          >
            <StatCard label="Legacy unverified" value={data.counts.legacy_unverified} accentColor={colors.warning} />
            <StatCard label="Pending" value={data.counts.pending} accentColor={colors.accent} />
            <StatCard label="Verified" value={data.counts.verified} accentColor={colors.success} />
            <StatCard label="Failed" value={data.counts.failed} accentColor={colors.danger} />
          </div>

          {/* Throughput */}
          <h2 style={S.h2}>Throughput (last 24h)</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 24 }}>
            <StatCard
              label="Verified / hour"
              value={data.throughputLast24h.verified_per_hour}
              subtitle={`${data.throughputLast24h.verified_total} total in 24h`}
              accentColor={colors.success}
            />
            <StatCard
              label="Failed / hour"
              value={data.throughputLast24h.failed_per_hour}
              subtitle={`${data.throughputLast24h.failed_total} total in 24h`}
              accentColor={colors.danger}
            />
          </div>

          {/* By pair */}
          <h2 style={S.h2}>Per grade-subject pair</h2>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 24 }}>
            <table style={S.table} data-testid="queue-bypair-table">
              <thead>
                <tr>
                  <th style={S.th}>Grade</th>
                  <th style={S.th}>Subject</th>
                  <th style={S.th}>Legacy</th>
                  <th style={S.th}>Pending</th>
                  <th style={S.th}>Verified</th>
                  <th style={S.th}>Failed</th>
                  <th style={S.th}>Ratio</th>
                  <th style={S.th}>Enforcement</th>
                </tr>
              </thead>
              <tbody>
                {data.byPair.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ ...S.td, textAlign: 'center', color: colors.text3 }}>
                      No pairs found.
                    </td>
                  </tr>
                )}
                {data.byPair.map((p) => {
                  const canEnforce = p.verified_ratio >= ENFORCEMENT_THRESHOLD;
                  return (
                    <tr key={`${p.grade}-${p.subject}`}>
                      <td style={S.td}>{p.grade}</td>
                      <td style={S.td}>{p.subject}</td>
                      <td style={S.td}>{p.legacy_unverified}</td>
                      <td style={S.td}>{p.pending}</td>
                      <td style={S.td}>{p.verified}</td>
                      <td style={S.td}>{p.failed}</td>
                      <td style={S.td}>
                        <b style={{ color: canEnforce ? colors.success : colors.warning }}>
                          {(p.verified_ratio * 100).toFixed(1)}%
                        </b>
                      </td>
                      <td style={S.td}>
                        <button
                          disabled={!canEnforce}
                          onClick={() => runAction('enable_enforcement', { grade: p.grade, subject: p.subject })}
                          style={{
                            ...S.actionBtn,
                            opacity: canEnforce ? 1 : 0.4,
                            cursor: canEnforce ? 'pointer' : 'not-allowed',
                          }}
                          title={canEnforce ? 'Flip ff_grounded_ai_enforced for this pair' : 'Needs >= 90% verified'}
                        >
                          Enable
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Failed sample */}
          <h2 style={S.h2}>Failed rows (most recent 20)</h2>
          <div style={{ border: `1px solid ${colors.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={S.table} data-testid="queue-failed-sample">
              <thead>
                <tr>
                  <th style={S.th}>Grade</th>
                  <th style={S.th}>Subject</th>
                  <th style={S.th}>Chapter</th>
                  <th style={S.th}>Question (preview)</th>
                  <th style={S.th}>Reason</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.failedSample.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ ...S.td, textAlign: 'center', color: colors.text3 }}>
                      No failed rows.
                    </td>
                  </tr>
                )}
                {data.failedSample.map((f) => (
                  <tr key={f.id}>
                    <td style={S.td}>{f.grade}</td>
                    <td style={S.td}>{f.subject}</td>
                    <td style={S.td}>
                      <span style={{ color: colors.text3, marginRight: 4 }}>Ch {f.chapter_number}</span>
                      {f.chapter_title}
                    </td>
                    <td style={{ ...S.td, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.question_text}
                    </td>
                    <td style={S.td}>
                      <code style={{ fontSize: 11, color: colors.text2 }}>
                        {f.verifier_failure_reason ?? 'unknown'}
                      </code>
                    </td>
                    <td style={S.td}>
                      <button
                        onClick={() => runAction('reverify', { id: f.id })}
                        style={{ ...S.actionBtn, marginRight: 6 }}
                      >
                        Re-verify
                      </button>
                      <button
                        onClick={() => runAction('soft_delete', { id: f.id })}
                        style={{ ...S.actionBtn, color: colors.danger, borderColor: colors.danger }}
                      >
                        Soft-delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default function VerificationQueuePage() {
  return (
    <AdminShell>
      <VerificationQueueContent />
    </AdminShell>
  );
}