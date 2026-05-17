'use client';

import { useCallback, useEffect, useState } from 'react';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { StatCard } from '@/components/admin-ui';
import { toast } from '@/components/ui/toast';

/**
 * Grounding Verification Queue — super-admin page (Task 3.17b)
 *
 * Surfaces question_bank verification pipeline state. Shows counts per
 * state, per-pair verified_ratio, failed-rows sample for triage, and an
 * "enable enforcement" toggle per pair (requires ratio >= 0.9).
 *
 * Actions POST to the verification-queue API when the operator clicks
 * re-verify / soft-delete / enable-enforcement. The API endpoints for
 * actions ship in this PR — the server route
 * `/api/super-admin/grounding/verification-queue` handles all three
 * actions with super-admin auth, audit logging, and a server-side
 * `verified_ratio >= 0.9` precondition on enable-enforcement so the
 * client cannot bypass with a stale value. Toast feedback surfaces
 * success/failure to ops.
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
const TH = 'sticky top-0 z-10 border-b-2 border-surface-3 bg-surface-2 px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const TD = 'border-b border-surface-3 px-3.5 py-2.5 text-[13px] text-foreground';
const H2 = 'mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground';

// ── Action contract — kebab-case matches the server route's PostAction
// union in src/app/api/super-admin/grounding/verification-queue/route.ts.
type QueueAction = 're-verify' | 'soft-delete' | 'enable-enforcement';

const ACTION_SUCCESS_MSG: Record<QueueAction, string> = {
  're-verify': 'Re-verification queued',
  'soft-delete': 'Question soft-deleted',
  'enable-enforcement': 'Enforcement enabled for pair',
};

function VerificationQueueContent() {
  const { apiFetch } = useAdmin();
  const [data, setData] = useState<QueueResponse['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks the currently-running action so we can disable buttons / show
  // a spinner without re-rendering the whole table on every toast.
  const [pending, setPending] = useState<string | null>(null);

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
    async (action: QueueAction, payload: Record<string, unknown>, pendingKey: string) => {
      if (pending) return; // single-flight; ignore double-clicks
      setPending(pendingKey);
      try {
        // Server expects { action, payload: {...} } (kebab-case action,
        // nested payload). See route.ts top-of-file contract block.
        const res = await apiFetch('/api/super-admin/grounding/verification-queue', {
          method: 'POST',
          body: JSON.stringify({ action, payload }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(body.error || `Action failed (HTTP ${res.status})`);
          return;
        }
        toast.success(ACTION_SUCCESS_MSG[action]);
        // Refetch after action so counts / ratios reflect the new state.
        fetchQueue();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setPending(null);
      }
    },
    [apiFetch, fetchQueue, pending],
  );

  return (
    <div data-testid="grounding-verification-queue-page">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Verification Queue</h1>
          <p className="m-0 text-[13px] text-muted-foreground">
            question_bank verification pipeline state + per-pair enforcement controls
          </p>
        </div>
        <button
          onClick={fetchQueue}
          className="rounded-md border border-surface-3 bg-surface-1 px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-2"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div
          data-testid="grounding-queue-error"
          className="mb-4 rounded-md bg-danger/10 p-3 text-[13px] text-danger"
        >
          Error: {error}
        </div>
      )}

      {loading && !data && (
        <div className="p-8 text-center text-[13px] text-muted-foreground">
          Loading verification queue...
        </div>
      )}

      {data && (
        <>
          {/* Counts */}
          <h2 className={H2}>Counts by state</h2>
          <div data-testid="queue-counts-section" className="mb-6 grid grid-cols-4 gap-3">
            <StatCard label="Legacy unverified" value={data.counts.legacy_unverified} accentColor="#D97706" />
            <StatCard label="Pending" value={data.counts.pending} accentColor="#2563EB" />
            <StatCard label="Verified" value={data.counts.verified} accentColor="#16A34A" />
            <StatCard label="Failed" value={data.counts.failed} accentColor="#DC2626" />
          </div>

          {/* Throughput */}
          <h2 className={H2}>Throughput (last 24h)</h2>
          <div className="mb-6 grid grid-cols-2 gap-3">
            <StatCard
              label="Verified / hour"
              value={data.throughputLast24h.verified_per_hour}
              subtitle={`${data.throughputLast24h.verified_total} total in 24h`}
              accentColor="#16A34A"
            />
            <StatCard
              label="Failed / hour"
              value={data.throughputLast24h.failed_per_hour}
              subtitle={`${data.throughputLast24h.failed_total} total in 24h`}
              accentColor="#DC2626"
            />
          </div>

          {/* By pair */}
          <h2 className={H2}>Per grade-subject pair</h2>
          <div className="mb-6 overflow-hidden rounded-lg border border-surface-3">
            <table className="w-full border-collapse text-[13px]" data-testid="queue-bypair-table">
              <thead>
                <tr>
                  <th className={TH}>Grade</th>
                  <th className={TH}>Subject</th>
                  <th className={TH}>Legacy</th>
                  <th className={TH}>Pending</th>
                  <th className={TH}>Verified</th>
                  <th className={TH}>Failed</th>
                  <th className={TH}>Ratio</th>
                  <th className={TH}>Enforcement</th>
                </tr>
              </thead>
              <tbody>
                {data.byPair.length === 0 && (
                  <tr>
                    <td colSpan={8} className={`${TD} text-center text-muted-foreground`}>
                      No pairs found.
                    </td>
                  </tr>
                )}
                {data.byPair.map((p) => {
                  const canEnforce = p.verified_ratio >= ENFORCEMENT_THRESHOLD;
                  return (
                    <tr key={`${p.grade}-${p.subject}`}>
                      <td className={TD}>{p.grade}</td>
                      <td className={TD}>{p.subject}</td>
                      <td className={TD}>{p.legacy_unverified}</td>
                      <td className={TD}>{p.pending}</td>
                      <td className={TD}>{p.verified}</td>
                      <td className={TD}>{p.failed}</td>
                      <td className={TD}>
                        <b className={canEnforce ? 'text-success' : 'text-warning'}>
                          {(p.verified_ratio * 100).toFixed(1)}%
                        </b>
                      </td>
                      <td className={TD}>
                        <button
                          disabled={!canEnforce || pending !== null}
                          onClick={() =>
                            runAction(
                              'enable-enforcement',
                              { grade: p.grade, subject_code: p.subject },
                              `enforce:${p.grade}-${p.subject}`,
                            )
                          }
                          className={`rounded-md border border-surface-3 bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-2 ${
                            canEnforce && pending === null ? 'cursor-pointer' : 'cursor-not-allowed opacity-40'
                          }`}
                          title={canEnforce ? 'Flip ff_grounded_ai_enforced for this pair' : 'Needs >= 90% verified'}
                          data-testid={`enable-enforcement-${p.grade}-${p.subject}`}
                        >
                          {pending === `enforce:${p.grade}-${p.subject}` ? 'Enabling…' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Failed sample */}
          <h2 className={H2}>Failed rows (most recent 20)</h2>
          <div className="overflow-hidden rounded-lg border border-surface-3">
            <table className="w-full border-collapse text-[13px]" data-testid="queue-failed-sample">
              <thead>
                <tr>
                  <th className={TH}>Grade</th>
                  <th className={TH}>Subject</th>
                  <th className={TH}>Chapter</th>
                  <th className={TH}>Question (preview)</th>
                  <th className={TH}>Reason</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.failedSample.length === 0 && (
                  <tr>
                    <td colSpan={6} className={`${TD} text-center text-muted-foreground`}>
                      No failed rows.
                    </td>
                  </tr>
                )}
                {data.failedSample.map((f) => (
                  <tr key={f.id}>
                    <td className={TD}>{f.grade}</td>
                    <td className={TD}>{f.subject}</td>
                    <td className={TD}>
                      <span className="mr-1 text-muted-foreground">Ch {f.chapter_number}</span>
                      {f.chapter_title}
                    </td>
                    <td className={`${TD} max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap`}>
                      {f.question_text}
                    </td>
                    <td className={TD}>
                      <code className="text-[11px] text-muted-foreground">
                        {f.verifier_failure_reason ?? 'unknown'}
                      </code>
                    </td>
                    <td className={TD}>
                      <button
                        onClick={() => runAction('re-verify', { id: f.id }, `reverify:${f.id}`)}
                        disabled={pending !== null}
                        className={`mr-1.5 rounded-md border border-surface-3 bg-transparent px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-2 ${
                          pending !== null ? 'cursor-not-allowed opacity-40' : ''
                        }`}
                        data-testid={`reverify-${f.id}`}
                      >
                        {pending === `reverify:${f.id}` ? 'Re-verifying…' : 'Re-verify'}
                      </button>
                      <button
                        onClick={() => runAction('soft-delete', { id: f.id }, `delete:${f.id}`)}
                        disabled={pending !== null}
                        className={`rounded-md border border-danger bg-transparent px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger/10 ${
                          pending !== null ? 'cursor-not-allowed opacity-40' : ''
                        }`}
                        data-testid={`soft-delete-${f.id}`}
                      >
                        {pending === `delete:${f.id}` ? 'Deleting…' : 'Soft-delete'}
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
