'use client';

/**
 * /super-admin/alfabot/[sessionId] — Session detail (forensic review).
 *
 * Surfaces the full message thread for a single AlfaBot session so an
 * admin can investigate an abuse complaint, a missed-answer report, or a
 * latency spike. RBAC-gated by the NEW permission `alfabot.read_messages`
 * (proposed for the next RBAC migration). When the caller lacks the
 * permission the underlying API returns 403 and we render a help banner
 * with a link to request it.
 *
 * Every successful page load creates an `alfabot.admin_message_read` audit
 * row server-side, capturing { adminUserId, sessionId } so message-read
 * access is itself auditable (per architect's PR 2 plan).
 *
 * P13: this page DOES show message content — but only to an admin who
 * explicitly holds the `alfabot.read_messages` permission. The aggregate
 * dashboard (parent page) shows counts only.
 *
 * Owner: ops
 * Reviewers: architect (RBAC + audit), frontend (UX), testing
 */

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import AdminShell, { useAdmin } from '../../_components/AdminShell';
import { StatCard } from '@alfanumrik/ui/admin-ui/StatCard';
import Link from 'next/link';

interface SessionMeta {
  id: string;
  anonId: string;
  audience: string;
  lang: string;
  ipHashTruncated: string | null;
  startedAt: string;
  lastMessageAt: string;
  messageCount: number;
  rateLimitHit: boolean;
}

interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources: unknown;
  tokensUsed: number | null;
  latencyMs: number | null;
  degradedMode: boolean;
  model: string | null;
  createdAt: string;
}

interface AbuseEvent {
  action: string;
  createdAt: string;
  reason: string | null;
}

interface SessionDetailResponse {
  session: SessionMeta;
  messages: SessionMessage[];
  abuseEvents: AbuseEvent[];
}

function SessionDetailInner() {
  const { apiFetch } = useAdmin();
  const params = useParams();
  const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : '';

  const [data, setData] = useState<SessionDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/super-admin/alfabot/sessions/${sessionId}`);
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch {
          /* ignore */
        }
        setError({ status: res.status, message: msg });
        return;
      }
      const body = await res.json();
      if (body?.success) setData(body.data);
      else setError({ status: 500, message: 'API returned success=false' });
    } catch (e) {
      setError({ status: 0, message: e instanceof Error ? e.message : 'fetch_failed' });
    } finally {
      setLoading(false);
    }
  }, [apiFetch, sessionId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  if (!sessionId) {
    return <p className="text-danger">Missing sessionId in URL.</p>;
  }

  if (loading && !data) {
    return <p className="text-muted-foreground">Loading session…</p>;
  }

  if (error) {
    // 403 carries a distinct UX — permission gate.
    if (error.status === 403) {
      return (
        <div className="rounded-lg border border-warning bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] p-6 text-[13px] text-warning">
          <h2 className="mb-1 text-base font-bold">Permission required</h2>
          <p className="mb-2">
            Forensic message review requires the <code>alfabot.read_messages</code>{' '}
            permission. Your current role does not have it.
          </p>
          <p className="m-0">
            Request access from a super_admin or open the{' '}
            <Link href="/super-admin/rbac" className="underline-offset-2 hover:underline">
              RBAC page
            </Link>{' '}
            to elevate.
          </p>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4 text-[13px] text-danger">
        Failed to load session: {error.message}
      </div>
    );
  }

  if (!data) {
    return <p className="text-muted-foreground">No data.</p>;
  }

  const { session, messages, abuseEvents } = data;

  return (
    <div>
      <div className="mb-4">
        <Link
          href="/super-admin/alfabot"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          &larr; All sessions
        </Link>
      </div>

      <h1 className="text-xl font-bold text-foreground">
        AlfaBot session{' '}
        <span className="font-mono text-[14px] text-muted-foreground">{session.id.slice(0, 8)}…</span>
      </h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Forensic message thread. Reading this page emits an{' '}
        <code>alfabot.admin_message_read</code> audit row tied to your admin id.
      </p>

      {/* Session metadata */}
      <section className="mb-6 grid grid-cols-4 gap-3">
        <StatCard label="Audience" value={session.audience} />
        <StatCard label="Language" value={session.lang.toUpperCase()} />
        <StatCard label="Messages" value={session.messageCount} />
        <StatCard
          label="Rate-limited"
          value={session.rateLimitHit ? 'YES' : 'no'}
          accentColor={session.rateLimitHit ? '#F59E0B' : undefined}
        />
      </section>

      <section className="mb-6 rounded-lg border border-surface-3 bg-surface-1 p-4 text-[12px] text-muted-foreground">
        <div>anon_id: <span className="font-mono">{session.anonId}</span></div>
        <div>ip_hash (truncated): <span className="font-mono">{session.ipHashTruncated ?? '—'}</span></div>
        <div>Started: {new Date(session.startedAt).toLocaleString()}</div>
        <div>Last message: {new Date(session.lastMessageAt).toLocaleString()}</div>
      </section>

      {/* Abuse events */}
      {abuseEvents.length > 0 && (
        <section className="mb-6 rounded-lg border border-danger bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-danger">
            Abuse events for this session
          </h2>
          <ul className="space-y-1 text-[12px]">
            {abuseEvents.map((e, idx) => (
              <li key={idx} className="font-mono">
                <span className="text-danger">{e.action}</span>{' '}
                <span className="text-muted-foreground">
                  {e.reason ? `(${e.reason})` : ''} · {new Date(e.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Message thread */}
      <section className="mb-6">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Thread ({messages.length} messages)
        </h2>
        {messages.length === 0 ? (
          <div className="rounded-lg border border-surface-3 bg-surface-1 p-4 text-[13px] text-muted-foreground">
            No messages persisted.
          </div>
        ) : (
          <ol className="space-y-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border p-4 ${
                  m.role === 'user'
                    ? 'border-surface-3 bg-surface-1'
                    : m.role === 'assistant'
                      ? 'border-purple-500/30 bg-purple-500/5'
                      : 'border-surface-3 bg-surface-2'
                }`}
              >
                <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                  <div>
                    <span className="font-semibold uppercase">{m.role}</span>
                    {' · '}
                    <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                    {m.model && (
                      <>
                        {' · '}
                        <span className="font-mono">{m.model}</span>
                      </>
                    )}
                  </div>
                  <div>
                    {m.tokensUsed !== null && <span>{m.tokensUsed} tokens · </span>}
                    {m.latencyMs !== null && <span>{m.latencyMs} ms</span>}
                    {m.degradedMode && (
                      <span className="ml-2 rounded-md bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] px-1.5 py-0.5 text-warning">
                        degraded
                      </span>
                    )}
                  </div>
                </div>
                <div className="whitespace-pre-wrap text-[13px] text-foreground">{m.content}</div>
                {m.sources !== null && m.sources !== undefined && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground">
                      sources ({Array.isArray(m.sources) ? m.sources.length : 'inline'})
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded-md bg-surface-2 p-2 text-[11px] text-muted-foreground">
                      {JSON.stringify(m.sources, null, 2)}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <p className="m-0 text-[11px] text-muted-foreground">
        Reading this page emits an audit row at the API layer. Suspected abuse?{' '}
        <Link href="/super-admin/alfabot" className="text-purple-500 underline-offset-2 hover:underline">
          Back to dashboard
        </Link>{' '}
        to add this anon_id to the denylist.
      </p>
    </div>
  );
}

export default function SessionDetailPage() {
  return (
    <AdminShell>
      <SessionDetailInner />
    </AdminShell>
  );
}
