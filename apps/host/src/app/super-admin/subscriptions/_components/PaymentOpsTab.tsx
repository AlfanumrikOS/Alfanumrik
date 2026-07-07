'use client';

import { useState, useCallback } from 'react';
import { useAdmin } from '../../_components/AdminShell';
import StatCard from '../../_components/StatCard';
import StatusBadge from '../../_components/StatusBadge';
import useSWR, { mutate as globalMutate } from 'swr';

// ─── Types ────────────────────────────────────────────────

interface StuckPayment {
  paymentId: string;
  studentId: string;
  paidPlan: string;
  billingCycle: string;
  razorpayPaymentId: string;
  razorpayOrderId: string | null;
  amount: number;
  paymentStatus: string;
  paymentDate: string;
  currentPlan: string | null;
  subscriptionExpiry: string | null;
  studentName: string | null;
  studentEmail: string | null;
}

interface StuckResponse {
  success: boolean;
  data: StuckPayment[];
  count: number;
}

interface StatsData {
  stuckCount: number;
  failureCount24h: number;
  activationTiming: {
    median: number;
    p95: number;
    max: number;
    sampleSize: number;
  };
}

interface StatsResponse {
  success: boolean;
  data: StatsData;
}

interface ReconcileResult {
  success: boolean;
  data?: {
    reconciled: number;
    results: Array<{ studentId: string; plan: string; ok: boolean; error?: string }>;
    failed?: number;
    total?: number;
    message?: string;
  };
  error?: string;
}

interface PaymentEvent {
  id: string;
  occurred_at: string;
  category: string;
  source: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  subject_type: string | null;
  subject_id: string | null;
  message: string;
}

// ─── File-local style constants ───

const S: Record<string, React.CSSProperties> = {
  card: {
    padding: 16,
    borderRadius: 8,
    border: '1px solid #E5E7EB',
    background: '#FFFFFF',
  },
  h2: {
    fontSize: 12,
    fontWeight: 600,
    color: '#6B7280',
    textTransform: 'uppercase' as const,
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: 13,
  },
  th: {
    textAlign: 'left' as const,
    padding: '10px 14px',
    borderBottom: '2px solid #E5E7EB',
    color: '#6B7280',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    background: '#F9FAFB',
    position: 'sticky' as const,
    top: 0,
    zIndex: 1,
  },
  td: {
    padding: '10px 14px',
    borderBottom: '1px solid #F3F4F6',
    color: '#111827',
    fontSize: 13,
  },
  primaryBtn: {
    padding: '8px 16px',
    borderRadius: 6,
    border: 'none',
    background: '#111827',
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    letterSpacing: 0.2,
  },
  actionBtn: {
    background: 'none',
    border: '1px solid #E5E7EB',
    borderRadius: 5,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
    fontWeight: 500,
    color: '#6B7280',
  },
};

// ─── Helpers ──────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatEventTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  } catch {
    return iso;
  }
}

function severityDotColor(severity: string): string {
  switch (severity) {
    case 'warning': return '#D97706';
    case 'error': return '#DC2626';
    case 'critical': return '#DC2626';
    default: return '#9CA3AF';
  }
}

function formatSeconds(sec: number): string {
  if (sec < 1) return '<1s';
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const mins = Math.floor(sec / 60);
  const remainder = Math.round(sec % 60);
  return `${mins}m ${remainder}s`;
}

// ─── SWR Keys ─────────────────────────────────────────────

const STATS_KEY = '/api/super-admin/payment-ops/stats';
const STUCK_KEY = '/api/super-admin/payment-ops/stuck';
const EVENTS_KEY = '/api/super-admin/observability/events?category=payment&severity=error,critical&range=24h&limit=10';

// ─── Component ────────────────────────────────────────────

export default function PaymentOpsTab() {
  const { apiFetch } = useAdmin();

  // Row-level reconcile feedback
  const [reconcilingIds, setReconcilingIds] = useState<Set<string>>(new Set());
  const [reconcileResults, setReconcileResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [batchReconciling, setBatchReconciling] = useState(false);
  const [batchResult, setBatchResult] = useState<{ ok: boolean; text: string } | null>(null);

  // SWR fetchers
  const fetcher = useCallback(async (url: string) => {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }, [apiFetch]);

  const { data: statsRes, error: statsError, isLoading: statsLoading } = useSWR<StatsResponse>(
    STATS_KEY, fetcher, { refreshInterval: 30000, dedupingInterval: 5000 }
  );
  const { data: stuckRes, error: stuckError, isLoading: stuckLoading } = useSWR<StuckResponse>(
    STUCK_KEY, fetcher, { refreshInterval: 30000, dedupingInterval: 5000 }
  );
  const { data: eventsRes, error: eventsError, isLoading: eventsLoading } = useSWR<{ success: boolean; data: PaymentEvent[] }>(
    EVENTS_KEY, fetcher, { refreshInterval: 30000, dedupingInterval: 5000 }
  );

  const stats = statsRes?.data;
  const stuck = stuckRes?.data || [];
  const events = eventsRes?.data || [];

  // ─── Reconcile Single ───────────────────────────────────

  const reconcileSingle = useCallback(async (studentId: string, paymentId: string) => {
    setReconcilingIds(prev => new Set(prev).add(paymentId));
    setReconcileResults(prev => {
      const next = { ...prev };
      delete next[paymentId];
      return next;
    });

    try {
      const res = await apiFetch('/api/super-admin/payment-ops/reconcile', {
        method: 'POST',
        body: JSON.stringify({ studentId, paymentId }),
      });
      const json: ReconcileResult = await res.json();

      if (json.success) {
        setReconcileResults(prev => ({ ...prev, [paymentId]: { ok: true, text: 'Reconciled' } }));
      } else {
        setReconcileResults(prev => ({ ...prev, [paymentId]: { ok: false, text: json.error || 'Failed' } }));
      }
    } catch {
      setReconcileResults(prev => ({ ...prev, [paymentId]: { ok: false, text: 'Network error' } }));
    }

    setReconcilingIds(prev => {
      const next = new Set(prev);
      next.delete(paymentId);
      return next;
    });

    // Refresh stuck list and stats
    globalMutate(STUCK_KEY);
    globalMutate(STATS_KEY);
  }, [apiFetch]);

  // ─── Reconcile All ─────────────────────────────────────

  const reconcileAll = useCallback(async () => {
    setBatchReconciling(true);
    setBatchResult(null);

    try {
      const res = await apiFetch('/api/super-admin/payment-ops/reconcile', {
        method: 'POST',
        body: JSON.stringify({ all: true }),
      });
      const json: ReconcileResult = await res.json();

      if (json.success && json.data) {
        const failed = json.data.failed ?? 0;
        if (failed === 0) {
          setBatchResult({ ok: true, text: `${json.data.reconciled} payment(s) reconciled successfully.` });
        } else {
          setBatchResult({ ok: false, text: `${json.data.reconciled} reconciled, ${failed} failed.` });
        }
      } else {
        setBatchResult({ ok: false, text: json.error || 'Batch reconciliation failed.' });
      }
    } catch {
      setBatchResult({ ok: false, text: 'Network error during batch reconciliation.' });
    }

    setBatchReconciling(false);
    globalMutate(STUCK_KEY);
    globalMutate(STATS_KEY);
  }, [apiFetch]);

  // ─── Render ─────────────────────────────────────────────

  return (
    <div>
      {/* ── Health Strip ─────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
        {statsLoading ? (
          <>
            <div style={{ ...S.card, height: 80, background: '#F9FAFB' }} />
            <div style={{ ...S.card, height: 80, background: '#F9FAFB' }} />
            <div style={{ ...S.card, height: 80, background: '#F9FAFB' }} />
          </>
        ) : statsError ? (
          <div style={{ ...S.card, gridColumn: '1 / -1', color: '#DC2626', fontSize: 13 }}>
            Failed to load payment stats.
          </div>
        ) : stats ? (
          <>
            <StatCard
              label="Stuck Payments"
              value={stats.stuckCount}
              accentColor={stats.stuckCount > 0 ? '#D97706' : '#16A34A'}
              subtitle={stats.stuckCount > 0 ? 'Needs attention' : 'All clear'}
            />
            <StatCard
              label="Failed Webhooks (24h)"
              value={stats.failureCount24h >= 0 ? stats.failureCount24h : '?'}
              accentColor={stats.failureCount24h > 0 ? '#DC2626' : '#16A34A'}
              subtitle={stats.failureCount24h < 0 ? 'Query unavailable' : undefined}
            />
            <StatCard
              label="Avg Activation"
              value={stats.activationTiming.sampleSize > 0 ? formatSeconds(stats.activationTiming.median) : 'N/A'}
              accentColor="#2563EB"
              subtitle={stats.activationTiming.sampleSize > 0
                ? `P95: ${formatSeconds(stats.activationTiming.p95)} (n=${stats.activationTiming.sampleSize})`
                : 'No recent payments'}
            />
          </>
        ) : null}

        {/* Reconcile All button */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <button
            onClick={reconcileAll}
            disabled={batchReconciling || !stats || stats.stuckCount === 0}
            style={{
              ...S.primaryBtn,
              opacity: (batchReconciling || !stats || stats.stuckCount === 0) ? 0.5 : 1,
              cursor: (batchReconciling || !stats || stats.stuckCount === 0) ? 'not-allowed' : 'pointer',
              width: '100%',
            }}
          >
            {batchReconciling ? 'Reconciling...' : 'Reconcile All'}
          </button>
        </div>
      </div>

      {/* Batch result message */}
      {batchResult && (
        <div style={{
          marginBottom: 16,
          padding: '8px 14px',
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 600,
          background: batchResult.ok ? '#F0FDF4' : '#FEF2F2',
          color: batchResult.ok ? '#16A34A' : '#DC2626',
          border: `1px solid ${batchResult.ok ? '#16A34A' : '#DC2626'}30`,
        }}>
          {batchResult.text}
        </div>
      )}

      {/* ── Stuck Payments Table ────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Stuck Payments</h2>
        {stuckLoading ? (
          <div style={{ ...S.card, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading stuck payments...</div>
        ) : stuckError ? (
          <div style={{ ...S.card, padding: 24, color: '#DC2626', fontSize: 13 }}>Failed to load stuck payments.</div>
        ) : stuck.length === 0 ? (
          <div style={{ ...S.card, padding: 24, textAlign: 'center', color: '#16A34A', fontSize: 13, fontWeight: 600 }}>
            No stuck payments -- all clear!
          </div>
        ) : (
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Student</th>
                  <th style={S.th}>Payment ID</th>
                  <th style={S.th}>Plan</th>
                  <th style={S.th}>Amount</th>
                  <th style={S.th}>When</th>
                  <th style={S.th}>Mismatch</th>
                  <th style={S.th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {stuck.map(p => {
                  const isReconciling = reconcilingIds.has(p.paymentId);
                  const result = reconcileResults[p.paymentId];

                  return (
                    <tr key={p.paymentId}>
                      <td style={S.td}>
                        <div>
                          <strong style={{ fontSize: 13 }}>{p.studentName || 'Unknown'}</strong>
                          <div style={{ fontSize: 11, color: '#9CA3AF' }}>{p.studentEmail || p.studentId}</div>
                        </div>
                      </td>
                      <td style={S.td}>
                        <code style={{ fontSize: 11, color: '#6B7280' }}>
                          {p.razorpayPaymentId || p.paymentId.slice(0, 12) + '...'}
                        </code>
                      </td>
                      <td style={S.td}>
                        <StatusBadge label={p.paidPlan?.replace(/_/g, ' ') || '?'} variant="info" />
                        {p.billingCycle && (
                          <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 4 }}>({p.billingCycle})</span>
                        )}
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>
                        {p.amount != null ? `₹${Number(p.amount).toLocaleString('en-IN')}` : '--'}
                      </td>
                      <td style={{ ...S.td, fontSize: 12, color: '#6B7280' }}>
                        {relativeTime(p.paymentDate)}
                      </td>
                      <td style={S.td}>
                        <span style={{ fontSize: 12 }}>
                          <span style={{ color: '#DC2626' }}>Current: {p.currentPlan || 'free'}</span>
                          <span style={{ color: '#9CA3AF' }}>{' → '}</span>
                          <span style={{ color: '#16A34A' }}>Expected: {p.paidPlan}</span>
                        </span>
                      </td>
                      <td style={S.td}>
                        {result ? (
                          <span style={{ fontSize: 12, fontWeight: 600, color: result.ok ? '#16A34A' : '#DC2626' }}>
                            {result.text}
                          </span>
                        ) : (
                          <button
                            onClick={() => reconcileSingle(p.studentId, p.paymentId)}
                            disabled={isReconciling}
                            style={{
                              ...S.actionBtn,
                              color: '#2563EB',
                              borderColor: '#2563EB',
                              opacity: isReconciling ? 0.5 : 1,
                            }}
                          >
                            {isReconciling ? 'Fixing...' : 'Reconcile'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Recent Payment Failures ────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Recent Payment Failures (24h)</h2>
        {eventsLoading ? (
          <div style={{ ...S.card, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading events...</div>
        ) : eventsError ? (
          <div style={{ ...S.card, padding: 24, color: '#DC2626', fontSize: 13 }}>Failed to load payment events.</div>
        ) : events.length === 0 ? (
          <div style={{ ...S.card, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            No payment errors in the last 24 hours.
          </div>
        ) : (
          <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
            {events.map(evt => (
              <div
                key={evt.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 14px',
                  borderBottom: '1px solid #F3F4F6',
                  fontSize: 13,
                }}
              >
                {/* Time */}
                <span style={{ fontSize: 11, color: '#9CA3AF', whiteSpace: 'nowrap', minWidth: 70, fontFamily: 'monospace' }}>
                  {formatEventTime(evt.occurred_at)}
                </span>

                {/* Severity dot */}
                <span style={{
                  display: 'inline-block',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: severityDotColor(evt.severity),
                  flexShrink: 0,
                  boxShadow: evt.severity === 'critical' ? '0 0 4px #DC2626' : 'none',
                }} />

                {/* Message */}
                <span style={{
                  flex: 1,
                  color: evt.severity === 'critical' ? '#DC2626' : '#111827',
                  fontWeight: evt.severity === 'critical' ? 600 : 400,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {evt.message}
                </span>

                {/* Subject ID */}
                {evt.subject_id && (
                  <code style={{
                    fontSize: 10,
                    color: '#9CA3AF',
                    background: '#F9FAFB',
                    padding: '1px 4px',
                    borderRadius: 2,
                    maxWidth: 80,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {evt.subject_id.length > 12 ? evt.subject_id.slice(0, 12) + '...' : evt.subject_id}
                  </code>
                )}
              </div>
            ))}

            {/* Link to observability console */}
            <div style={{ padding: '10px 14px', textAlign: 'right' }}>
              <a
                href="/super-admin/observability?category=payment&severity=error,critical&range=24h"
                style={{ fontSize: 12, color: '#2563EB', textDecoration: 'none', fontWeight: 500 }}
              >
                View in Observability Console &rarr;
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Activation Timing Detail ───────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={S.h2}>Activation Timing</h2>
        {statsLoading ? (
          <div style={{ ...S.card, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>Loading timing data...</div>
        ) : statsError ? (
          <div style={{ ...S.card, padding: 24, color: '#DC2626', fontSize: 13 }}>Failed to load timing data.</div>
        ) : stats && stats.activationTiming.sampleSize === 0 ? (
          <div style={{ ...S.card, padding: 24, textAlign: 'center', color: '#9CA3AF', fontSize: 13 }}>
            No recent payments to analyze.
          </div>
        ) : stats ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <StatCard
              label="Median"
              value={formatSeconds(stats.activationTiming.median)}
              accentColor="#16A34A"
            />
            <StatCard
              label="P95"
              value={formatSeconds(stats.activationTiming.p95)}
              accentColor={stats.activationTiming.p95 > 60 ? '#D97706' : '#2563EB'}
            />
            <StatCard
              label="Max"
              value={formatSeconds(stats.activationTiming.max)}
              accentColor={stats.activationTiming.max > 300 ? '#DC2626' : '#D97706'}
            />
            <StatCard
              label="Sample Size"
              value={stats.activationTiming.sampleSize}
              accentColor="#9CA3AF"
              subtitle="Recent captured payments"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
