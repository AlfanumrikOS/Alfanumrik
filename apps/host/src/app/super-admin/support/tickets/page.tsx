'use client';

/**
 * /super-admin/support/tickets — Phase 2 (console merge) in-console ticket
 * queue. Achieves full capability parity with the legacy operator console
 * `apps/host/src/app/internal/admin/_components/SupportTab.tsx`, consuming
 * the SAME existing, tested, actor-attributed API
 * (`/api/internal/admin/support`) verbatim — no new route.
 *
 * Spec: docs/superpowers/specs/2026-08-16-phase2-support-console-parity.md
 *
 * ── ACCESS-SCOPE BOUNDARY (spec §2) ─────────────────────────────────────────
 * `apps/host/src/proxy.ts`'s Layer 2.1 hard-gates `/api/internal/admin/*` to a
 * literal `super_admin` session, independent of RBAC — UNCHANGED by this page.
 * This page lives at a `/super-admin/*` URL reachable by lower
 * `authorizeAdmin`/`authorizeOperator` tiers (support/analyst/content_manager/
 * finance/admin), but every fetch to `/api/internal/admin/support` still
 * correctly 401/403s a non-`super_admin` session. That is handled as a
 * DISTINCT "requires Super Admin access" state (`accessDenied`), never routed
 * through AdminShell's generic session-expired banner — see
 * `_lib/ticket-api.ts` for why `ticketFetch` doesn't use AdminShell's
 * `apiFetch`/`apiFetchJson`.
 *
 * ── THE VISIBILITY TOGGLE IS THE SAFETY-CRITICAL CONTROL (unchanged from
 *    SupportTab.tsx — read that file's header before touching the composer) ──
 * `is_internal: true`  → private operator note, filtered from the student route.
 * `is_internal: false` → SENT TO THE STUDENT. Irreversible.
 * The composer DEFAULTS to internal, RESETS to internal after every
 * successful send, and never carries its mode across tickets.
 *
 * P13: reply/note bodies are never logged or sent to analytics from this file.
 * P7: bilingual throughout via useAuth().isHi (the legacy console is
 * English-only by convention; this new /super-admin surface is not).
 */

import { useState, useEffect, useCallback } from 'react';
import AdminShell from '../../_components/AdminShell';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import {
  DataTable,
  StatusBadge,
  DetailDrawer,
  AdminErrorState,
  type Column,
  type StatusBadgeVariant,
} from '@alfanumrik/ui/admin-ui';
import { toast } from '@alfanumrik/ui/ui/toast';
import {
  ticketFetch,
  REPLY_MAX_LENGTH,
  type SupportTicket,
  type TicketReply,
  type ThreadResponse,
  type TicketListResponse,
  type ReplyPostResponse,
} from './_lib/ticket-api';

const STATUS_TABS = ['open', 'pending', 'resolved', 'all'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

const STATUS_LABELS: Record<StatusTab, { en: string; hi: string }> = {
  open: { en: 'Open', hi: 'खुला' },
  pending: { en: 'Pending', hi: 'लंबित' },
  resolved: { en: 'Resolved', hi: 'हल किया गया' },
  all: { en: 'All', hi: 'सभी' },
};

// Author roles a ticket reply can be attributed to (mirrors the `fromOperator`
// membership check below). Falls back to the raw role string for anything
// outside this set rather than rendering nothing.
const AUTHOR_ROLE_LABELS: Record<string, { en: string; hi: string }> = {
  student: { en: 'Student', hi: 'छात्र' },
  parent: { en: 'Parent', hi: 'अभिभावक' },
  teacher: { en: 'Teacher', hi: 'शिक्षक' },
  guest: { en: 'Guest', hi: 'अतिथि' },
};

const PAGE_SIZE = 25;

function statusVariant(status: string): StatusBadgeVariant {
  if (status === 'open') return 'danger';
  if (status === 'pending') return 'warning';
  if (status === 'resolved') return 'success';
  return 'neutral';
}

// Same lookup the filter tabs already use (STATUS_LABELS), reused for badge
// render sites so ticket status never leaks raw English under isHi. Falls
// back to the raw value for any status outside the known set.
function statusLabel(status: string, isHi: boolean): string {
  const entry = (STATUS_LABELS as Record<string, { en: string; hi: string }>)[status];
  if (!entry) return status;
  return isHi ? entry.hi : entry.en;
}

function authorRoleLabel(role: string, isHi: boolean): string {
  const entry = AUTHOR_ROLE_LABELS[role];
  if (!entry) return role;
  return isHi ? entry.hi : entry.en;
}

function fmtDate(iso: string, isHi: boolean): string {
  return new Date(iso).toLocaleString(isHi ? 'hi-IN' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function TicketsContent() {
  const { isHi } = useAuth();

  // ── List state ──────────────────────────────────────────────────────
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [statusTab, setStatusTab] = useState<StatusTab>('open');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Distinct from listError: the API 401/403'd because the session isn't
  // literal super_admin. Never conflate with a generic load failure.
  const [accessDenied, setAccessDenied] = useState(false);

  // ── Thread state (exactly one ticket open at a time — DetailDrawer) ───
  const [selected, setSelected] = useState<SupportTicket | null>(null);
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // ── Composer state ──────────────────────────────────────────────────
  const [draft, setDraft] = useState('');
  // SAFER DEFAULT: internal note. See the file header before changing.
  const [isInternal, setIsInternal] = useState(true);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const result = await ticketFetch<TicketListResponse>(
      `/api/internal/admin/support?status=${statusTab}&page=${page}&limit=${PAGE_SIZE}`,
    );
    if (result.ok) {
      setAccessDenied(false);
      setTickets(result.data.data || []);
      setTotal(result.data.total || 0);
    } else if (result.error.kind === 'access_denied') {
      setAccessDenied(true);
      setTickets([]);
      setTotal(0);
    } else {
      // A load failure must never render as an empty queue — tickets would
      // look answered when they are merely unfetched.
      setTickets([]);
      setTotal(0);
      setListError(
        isHi
          ? 'टिकट लोड नहीं हो सके। यह लोड विफलता है, खाली कतार नहीं।'
          : 'Could not load tickets. This is a load failure, not an empty queue.',
      );
    }
    setLoading(false);
  }, [statusTab, page, isHi]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const loadThread = useCallback(
    async (id: string) => {
      setThreadLoading(true);
      setThreadError(null);
      const result = await ticketFetch<ThreadResponse>(`/api/internal/admin/support?ticket_id=${id}`);
      if (result.ok) {
        setReplies(Array.isArray(result.data.replies) ? result.data.replies : []);
      } else if (result.error.kind === 'access_denied') {
        setAccessDenied(true);
      } else {
        setReplies([]);
        setThreadError(
          isHi
            ? 'यह बातचीत लोड नहीं हो सकी। इसे खाली मानने से पहले पुनः प्रयास करें।'
            : 'Could not load this conversation. Retry before assuming it is empty.',
        );
      }
      setThreadLoading(false);
    },
    [isHi],
  );

  const closeThread = useCallback(() => {
    setSelected(null);
    setReplies([]);
    setThreadError(null);
    setPostError(null);
  }, []);

  const openThread = useCallback(
    (ticket: SupportTicket) => {
      // Re-clicking the ALREADY-open ticket collapses it (matches SupportTab's
      // toggle behaviour); clicking a different ticket switches straight over.
      if (selected?.id === ticket.id) {
        closeThread();
        return;
      }
      setPostError(null);
      setDraft('');
      setIsInternal(true); // never carry student-visible mode across tickets
      setSelected(ticket);
      setReplies([]);
      setThreadError(null);
      loadThread(ticket.id);
    },
    [selected, loadThread, closeThread],
  );

  const resolveTicket = useCallback(
    async (id: string) => {
      setResolvingId(id);
      const result = await ticketFetch('/api/internal/admin/support', {
        method: 'PATCH',
        body: JSON.stringify({ id, status: 'resolved' }),
      });
      if (result.ok) {
        toast.success(isHi ? 'टिकट हल हो गया' : 'Ticket resolved');
        setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, status: 'resolved' } : t)));
        setSelected((prev) => (prev && prev.id === id ? { ...prev, status: 'resolved' } : prev));
      } else if (result.error.kind === 'access_denied') {
        setAccessDenied(true);
      } else {
        toast.error(isHi ? 'टिकट हल नहीं हो सका — पुनः प्रयास करें' : 'Could not resolve ticket — try again');
      }
      setResolvingId(null);
    },
    [isHi],
  );

  const sendReply = useCallback(async () => {
    if (!selected) return;
    const body = draft.trim();
    if (!body || body.length > REPLY_MAX_LENGTH) return;

    setPosting(true);
    setPostError(null);
    const result = await ticketFetch<ReplyPostResponse>('/api/internal/admin/support', {
      method: 'POST',
      body: JSON.stringify({ ticket_id: selected.id, body, is_internal: isInternal }),
    });
    if (result.ok) {
      if (result.data.reply) setReplies((prev) => [...prev, result.data.reply]);
      if (result.data.ticket_status) {
        const nextStatus = result.data.ticket_status;
        setTickets((prev) => prev.map((t) => (t.id === selected.id ? { ...t, status: nextStatus } : t)));
        setSelected((prev) => (prev ? { ...prev, status: nextStatus } : prev));
      }
      toast.success(
        isInternal
          ? isHi
            ? 'आंतरिक नोट सहेजा गया (छात्र को नहीं भेजा गया)'
            : 'Internal note saved (not sent to student)'
          : isHi
            ? 'छात्र को उत्तर भेजा गया'
            : 'Reply sent to student',
      );
      setDraft('');
      // Reset to the safe mode so the next message is never accidentally public.
      setIsInternal(true);
    } else if (result.error.kind === 'access_denied') {
      setAccessDenied(true);
    } else {
      setPostError(
        isInternal
          ? isHi
            ? 'आंतरिक नोट सहेजा नहीं जा सका। छात्र को कुछ नहीं भेजा गया।'
            : 'Could not save the internal note. Nothing was sent to the student.'
          : isHi
            ? 'उत्तर नहीं भेजा जा सका। छात्र को यह नहीं मिला — पुनः प्रयास करें।'
            : 'Could not send the reply. The student did NOT receive it — try again.',
      );
    }
    setPosting(false);
  }, [selected, draft, isInternal, isHi]);

  const trimmed = draft.trim();
  const tooLong = trimmed.length > REPLY_MAX_LENGTH;

  // ── Access-scope boundary: distinct from a generic session-expired state.
  // Per spec §2.2 — a non-super_admin admin session (support/analyst/
  // content_manager/finance/admin tier) gets a clear "insufficient tier"
  // message, never the "sign in again" banner AdminShell shows elsewhere.
  if (accessDenied) {
    return (
      <div>
        <h1 className="mb-4 text-xl font-bold tracking-tight text-foreground">
          {isHi ? 'सहायता टिकट' : 'Support Tickets'}
        </h1>
        <AdminErrorState
          isHi={isHi}
          title={isHi ? 'इस सुविधा के लिए सुपर एडमिन एक्सेस आवश्यक है' : 'This feature requires Super Admin access'}
          message={
            isHi
              ? 'टिकट कतार केवल सुपर एडमिन सत्रों के लिए उपलब्ध है। यह आपके सत्र की समाप्ति नहीं है — यदि आपको लगता है कि आपके पास एक्सेस होना चाहिए, तो किसी एडमिनिस्ट्रेटर से संपर्क करें।'
              : 'The ticket queue is available only to Super Admin sessions. This is not a session expiry — contact an administrator if you believe you should have access.'
          }
          onRetry={fetchTickets}
        />
      </div>
    );
  }

  const columns: Column<SupportTicket>[] = [
    {
      key: 'subject',
      label: isHi ? 'विषय' : 'Subject',
      sortable: false,
      render: (t) => (
        <span className="font-semibold text-foreground">{t.subject || (isHi ? 'कोई विषय नहीं' : 'No subject')}</span>
      ),
    },
    {
      key: 'status',
      label: isHi ? 'स्थिति' : 'Status',
      sortable: false,
      render: (t) => <StatusBadge label={statusLabel(t.status, isHi)} variant={statusVariant(t.status)} />,
    },
    {
      key: 'message',
      label: isHi ? 'संदेश' : 'Message',
      sortable: false,
      width: '38%',
      render: (t) => (
        <div>
          <span className="line-clamp-2 whitespace-pre-wrap text-muted-foreground">{t.message}</span>
          {t.admin_notes && (
            <div className="mt-1 rounded bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-2 py-0.5 text-[10px] text-info-strong">
              {isHi ? 'नोट: ' : 'Note: '}
              {t.admin_notes}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'created_at',
      label: isHi ? 'बनाया गया' : 'Created',
      sortable: false,
      render: (t) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(t.created_at, isHi)}</span>
      ),
    },
    {
      key: 'actions',
      label: isHi ? 'क्रिया' : 'Actions',
      sortable: false,
      render: (t) => (
        // Stop propagation so a button click doesn't also fire onRowClick.
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => openThread(t)}
            className="rounded-md border border-[color-mix(in_srgb,var(--primary)_40%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-[color-mix(in_srgb,var(--primary)_20%,transparent)]"
          >
            {isHi ? '💬 थ्रेड और उत्तर' : '💬 Thread & reply'}
          </button>
          {t.status !== 'resolved' && (
            <button
              type="button"
              onClick={() => resolveTicket(t.id)}
              disabled={resolvingId === t.id}
              className="rounded-md border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-success-strong hover:bg-[color-mix(in_srgb,var(--success)_20%,transparent)] disabled:opacity-50"
            >
              {resolvingId === t.id ? (isHi ? 'हल हो रहा है…' : 'Resolving…') : isHi ? '✓ हल करें' : '✓ Resolve'}
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          {isHi ? 'सहायता टिकट' : 'Support Tickets'}
        </h1>
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setStatusTab(s);
                setPage(1);
                closeThread();
              }}
              className={[
                'rounded-md border px-3 py-1.5 text-xs font-semibold capitalize',
                statusTab === s
                  ? 'border-[color-mix(in_srgb,var(--primary)_10%,transparent)] bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-primary'
                  : 'border-surface-3 bg-surface-1 text-muted-foreground hover:bg-surface-2',
              ].join(' ')}
            >
              {isHi ? STATUS_LABELS[s].hi : STATUS_LABELS[s].en}
            </button>
          ))}
          <button
            type="button"
            onClick={fetchTickets}
            aria-label={isHi ? 'ताज़ा करें' : 'Refresh'}
            title={isHi ? 'ताज़ा करें' : 'Refresh'}
            className="rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-2"
          >
            ↻
          </button>
        </div>
      </div>

      <div className="mb-3 text-[11px] text-muted-foreground">
        {isHi ? `${total} टिकट` : `${total} tickets`}
      </div>

      {/* LIST — loading / error / empty are three distinct states */}
      {listError ? (
        <AdminErrorState compact isHi={isHi} title={listError} onRetry={fetchTickets} />
      ) : (
        <DataTable<SupportTicket>
          columns={columns}
          data={tickets}
          keyField="id"
          onRowClick={openThread}
          loading={loading}
          emptyMessage={isHi ? 'इस कतार में कोई टिकट नहीं' : 'No tickets in this queue'}
        />
      )}

      <div className="mt-4 flex items-center justify-center gap-3">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => {
            setPage((p) => p - 1);
            closeThread();
          }}
          className="rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2 disabled:opacity-40"
        >
          {isHi ? '← पिछला' : '← Prev'}
        </button>
        <span className="text-xs text-muted-foreground">
          {isHi
            ? `पृष्ठ ${page} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`
            : `Page ${page} / ${Math.max(1, Math.ceil(total / PAGE_SIZE))}`}
        </span>
        <button
          type="button"
          disabled={tickets.length < PAGE_SIZE}
          onClick={() => {
            setPage((p) => p + 1);
            closeThread();
          }}
          className="rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-surface-2 disabled:opacity-40"
        >
          {isHi ? 'अगला →' : 'Next →'}
        </button>
      </div>

      {/* ── Thread & reply panel ──────────────────────────────────────── */}
      <DetailDrawer
        open={!!selected}
        onClose={closeThread}
        title={selected?.subject || (isHi ? 'टिकट थ्रेड' : 'Ticket thread')}
        width={520}
      >
        {selected && (
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <StatusBadge label={statusLabel(selected.status, isHi)} variant={statusVariant(selected.status)} />
              {selected.status !== 'resolved' && (
                <button
                  type="button"
                  onClick={() => resolveTicket(selected.id)}
                  disabled={resolvingId === selected.id}
                  className="rounded-md border border-[color-mix(in_srgb,var(--success)_40%,transparent)] bg-[color-mix(in_srgb,var(--success)_10%,transparent)] px-3 py-1.5 text-xs font-semibold text-success-strong hover:bg-[color-mix(in_srgb,var(--success)_20%,transparent)] disabled:opacity-50"
                >
                  {resolvingId === selected.id
                    ? isHi
                      ? 'हल हो रहा है…'
                      : 'Resolving…'
                    : isHi
                      ? '✓ हल करें'
                      : '✓ Resolve'}
                </button>
              )}
            </div>

            <div className="mb-1.5 whitespace-pre-wrap text-sm text-foreground">{selected.message}</div>
            <div className="mb-3 text-[11px] text-muted-foreground">{fmtDate(selected.created_at, isHi)}</div>

            {selected.admin_notes && (
              <div className="mb-4 rounded-md bg-[color-mix(in_srgb,var(--info)_10%,transparent)] px-3 py-2 text-xs text-info-strong">
                {isHi ? 'नोट: ' : 'Note: '}
                {selected.admin_notes}
              </div>
            )}

            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {isHi ? 'बातचीत' : 'Conversation'}
            </div>

            {/* THREAD — loading / error / empty are three distinct states */}
            {threadLoading && (
              <div className="py-3 text-xs text-muted-foreground">
                {isHi ? 'बातचीत लोड हो रही है…' : 'Loading conversation…'}
              </div>
            )}

            {!threadLoading && threadError && (
              <AdminErrorState compact isHi={isHi} title={threadError} onRetry={() => loadThread(selected.id)} />
            )}

            {!threadLoading && !threadError && replies.length === 0 && (
              <div className="py-3 text-xs text-muted-foreground">
                {isHi
                  ? 'अभी तक कोई उत्तर नहीं। इस छात्र को कुछ नहीं भेजा गया है।'
                  : 'No replies yet. Nothing has been sent to this student.'}
              </div>
            )}

            {!threadLoading && !threadError && replies.length > 0 && (
              <div className="mb-4 grid gap-2">
                {replies.map((r) => {
                  const internal = r.is_internal === true;
                  const fromOperator = !['student', 'parent', 'teacher', 'guest'].includes(r.author_role);
                  return (
                    <div
                      key={r.id}
                      className={[
                        'rounded-md p-2.5 text-xs',
                        internal
                          ? 'border border-dashed border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_5%,transparent)]'
                          : 'border border-surface-3 bg-surface-2',
                      ].join(' ')}
                    >
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge
                          label={
                            fromOperator
                              ? isHi
                                ? 'सहायता'
                                : 'Support'
                              : `${isHi ? 'अनुरोधकर्ता' : 'Requester'} (${authorRoleLabel(r.author_role, isHi)})`
                          }
                          variant={fromOperator ? 'info' : 'neutral'}
                        />
                        {internal ? (
                          <StatusBadge
                            label={isHi ? '🔒 आंतरिक — छात्र नहीं देख सकता' : '🔒 INTERNAL — student cannot see this'}
                            variant="warning"
                          />
                        ) : (
                          <StatusBadge
                            label={isHi ? '👁 छात्र को दिखाई देता है' : '👁 Visible to student'}
                            variant="success"
                          />
                        )}
                        <span className="text-[10px] text-muted-foreground">{fmtDate(r.created_at, isHi)}</span>
                      </div>
                      <div className="whitespace-pre-wrap text-foreground">{r.body}</div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Composer ─────────────────────────────────────────────── */}
            <div
              className={[
                'rounded-md p-3',
                isInternal ? 'border border-dashed border-[color-mix(in_srgb,var(--warning)_50%,transparent)] bg-[color-mix(in_srgb,var(--warning)_5%,transparent)]' : 'border-2 border-[color-mix(in_srgb,var(--success)_50%,transparent)] bg-[color-mix(in_srgb,var(--success)_5%,transparent)]',
              ].join(' ')}
            >
              <div role="radiogroup" aria-label={isHi ? 'उत्तर दृश्यता' : 'Reply visibility'} className="mb-2.5 flex gap-2">
                <button
                  type="button"
                  role="radio"
                  aria-checked={isInternal}
                  onClick={() => setIsInternal(true)}
                  className={[
                    'flex-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold',
                    isInternal
                      ? 'border-[color-mix(in_srgb,var(--warning)_100%,transparent)] bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning-strong'
                      : 'border-surface-3 bg-transparent text-muted-foreground',
                  ].join(' ')}
                >
                  {isHi ? '🔒 आंतरिक नोट' : '🔒 Internal note'}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!isInternal}
                  onClick={() => setIsInternal(false)}
                  className={[
                    'flex-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold',
                    !isInternal
                      ? 'border-[color-mix(in_srgb,var(--success)_100%,transparent)] bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-success-strong'
                      : 'border-surface-3 bg-transparent text-muted-foreground',
                  ].join(' ')}
                >
                  {isHi ? '📤 छात्र को उत्तर' : '📤 Reply to student'}
                </button>
              </div>

              <div
                className={[
                  'mb-2 rounded-md px-2.5 py-1.5 text-[11px] font-semibold',
                  isInternal ? 'bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] text-warning-strong' : 'bg-[color-mix(in_srgb,var(--success)_15%,transparent)] text-success-strong',
                ].join(' ')}
              >
                {isInternal
                  ? isHi
                    ? '🔒 निजी — यह टेक्स्ट केवल एडमिन कंसोल में रहता है। छात्र इसे नहीं देखेगा।'
                    : '🔒 PRIVATE — this text stays inside the admin console. The student will NOT see it.'
                  : isHi
                    ? '📤 यह छात्र को भेजा जाएगा और उनके सहायता थ्रेड में दिखाई देगा। इसे वापस नहीं लिया जा सकता।'
                    : '📤 THIS WILL BE SENT TO THE STUDENT and appears in their support thread. It cannot be unsent.'}
              </div>

              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={4}
                maxLength={REPLY_MAX_LENGTH + 1}
                disabled={posting}
                aria-label={isHi ? 'उत्तर संदेश' : 'Reply message'}
                placeholder={
                  isInternal
                    ? isHi
                      ? 'अन्य ऑपरेटरों के लिए निजी कार्यशील नोट…'
                      : 'Private working note for other operators…'
                    : isHi
                      ? 'छात्र जो उत्तर पढ़ेगा उसे लिखें…'
                      : 'Write the answer the student will read…'
                }
                className="w-full resize-y rounded-md border border-surface-3 bg-surface-1 p-2.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className={`text-[10px] ${tooLong ? 'text-danger' : 'text-muted-foreground'}`}>
                  {trimmed.length}/{REPLY_MAX_LENGTH}
                </span>
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={posting || !trimmed || tooLong}
                  className={[
                    'rounded-md px-3 py-1.5 text-xs font-bold',
                    isInternal ? 'bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-warning-strong' : 'bg-[color-mix(in_srgb,var(--success)_20%,transparent)] text-success-strong',
                    posting || !trimmed || tooLong ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
                  ].join(' ')}
                >
                  {posting
                    ? isHi
                      ? 'भेजा जा रहा है…'
                      : 'Sending…'
                    : isInternal
                      ? isHi
                        ? '🔒 आंतरिक नोट सहेजें'
                        : '🔒 Save internal note'
                      : isHi
                        ? '📤 छात्र को भेजें'
                        : '📤 Send to student'}
                </button>
              </div>

              {tooLong && (
                <div role="alert" className="mt-1.5 text-[11px] text-danger">
                  {isHi
                    ? `संदेश ${REPLY_MAX_LENGTH} अक्षरों से अधिक नहीं हो सकता।`
                    : `Message cannot exceed ${REPLY_MAX_LENGTH} characters.`}
                </div>
              )}

              {postError && (
                <div role="alert" className="mt-1.5 text-[11px] text-danger">
                  ⚠️ {postError}
                </div>
              )}
            </div>
          </div>
        )}
      </DetailDrawer>
    </div>
  );
}

export default function SupportTicketsPage() {
  return (
    <AdminShell>
      <TicketsContent />
    </AdminShell>
  );
}
