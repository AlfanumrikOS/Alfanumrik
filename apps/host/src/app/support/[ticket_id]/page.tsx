'use client';

/**
 * /support/[ticket_id] — read one support thread the user owns, and reply to it.
 *
 * Audit F22 (frontend portion) + the 2026-08 support-black-hole SEV1 fix.
 * Consumes GET/POST /api/support/tickets/[id].
 *
 * ── FIELD NAMES (canonical) ────────────────────────────────────────────────
 * This page reads `ticket.id`, `ticket.message`, and the TOP-LEVEL
 * `data.replies`. Those are the DB/route-native names and the same ones the
 * list route returns. The route currently also emits three additive aliases
 * (`ticket_id`, `description`, and a nested `ticket.replies`) that were added
 * so the previously-broken version of this page would work; nothing here reads
 * them any more, so backend can drop all three. Do NOT reintroduce a second
 * accepted name for the same field — the last time this page and the route
 * disagreed on `ticket_id` vs `id`, every load threw a synthetic 404 and
 * silently bounced the student back to /support.
 *
 * ── AUTHORSHIP (P13) ───────────────────────────────────────────────────────
 * `author_role` is the ONLY authorship signal the API returns — there is
 * deliberately no name, email, or author_user_id. Requester-side roles render
 * as "You", operator-side as "Alfanumrik Support". Never add a name field here.
 *
 * ── replies_unavailable ────────────────────────────────────────────────────
 * When the thread read fails the route returns the ticket plus
 * `replies_unavailable: true`. That MUST render as an explicit "couldn't load
 * the conversation" state with a retry — never as an empty thread. Rendering
 * silence there is precisely the defect this page exists to fix.
 *
 * P7 — bilingual via AuthContext.isHi.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import {
  Card,
  Button,
  LoadingFoxy,
  Badge,
  Avatar,
} from '@alfanumrik/ui/ui';
import { supportSlaLine } from '@alfanumrik/lib/support/response-sla';

/* ── Contract types (mirror /api/support/tickets/[id]) ────────── */
const REPLY_MAX_LENGTH = 5000;

/** Roles whose messages are the requester's own → rendered as "You". */
const REQUESTER_ROLES = new Set(['student', 'parent', 'teacher', 'guest']);

interface Reply {
  id: string;
  /** 'student' | 'parent' | 'teacher' | 'guest' | 'operator' | 'admin' | 'system' */
  author_role: string;
  body: string;
  created_at: string;
}

interface Ticket {
  id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  message: string;
  created_at: string;
  updated_at?: string | null;
  resolved_at?: string | null;
}

/** Normalised page state — one object so the three parts can never drift. */
interface TicketThread {
  ticket: Ticket;
  replies: Reply[];
  /** true ⇒ the thread read FAILED. Never render this as "no replies". */
  repliesUnavailable: boolean;
}

interface HttpError extends Error {
  status?: number;
  retryAfterMs?: number;
  code?: string;
}

/* ── Auth helpers ────────────────────────────────────────────── */
async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  } catch { /* fall through to cookie auth */ }
  return headers;
}

function httpError(message: string, status: number, extra?: Partial<HttpError>): HttpError {
  const e = new Error(message) as HttpError;
  e.status = status;
  Object.assign(e, extra);
  return e;
}

async function fetchThread(url: string): Promise<TicketThread> {
  const res = await fetch(url, { headers: await authHeaders(), credentials: 'include' });
  if (!res.ok) throw httpError(`Request failed: ${res.status}`, res.status);

  const json = await res.json().catch(() => null);
  const payload = json?.data ?? null;
  const ticket = payload?.ticket as Ticket | undefined;

  // A response without a ticket id is indistinguishable from "not yours".
  if (!ticket?.id) throw httpError('Ticket not found', 404);

  const rawReplies = Array.isArray(payload?.replies) ? (payload.replies as Reply[]) : [];

  return {
    ticket,
    // Server orders ascending; sort defensively so the conversation can never
    // render out of order if that ever changes.
    replies: [...rawReplies].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    ),
    repliesUnavailable: payload?.replies_unavailable === true,
  };
}

/* ── Display helpers (mirror /support page) ──────────────────── */
function categoryLabel(cat: string, isHi: boolean): string {
  const map: Record<string, [string, string]> = {
    bug: ['Bug', 'बग'],
    billing: ['Billing', 'बिलिंग'],
    content: ['Content', 'सामग्री'],
    account: ['Account', 'खाता'],
    other: ['Other', 'अन्य'],
  };
  const pair = map[cat];
  return pair ? (isHi ? pair[1] : pair[0]) : cat;
}

function statusLabel(status: string, isHi: boolean): string {
  const map: Record<string, [string, string]> = {
    open: ['Open', 'खुला'],
    pending: ['Pending', 'लंबित'],
    in_progress: ['In Progress', 'चल रहा है'],
    resolved: ['Resolved', 'हल'],
    closed: ['Closed', 'बंद'],
  };
  const pair = map[status];
  return pair ? (isHi ? pair[1] : pair[0]) : status;
}

function priorityLabel(p: string, isHi: boolean): string {
  const map: Record<string, [string, string]> = {
    low: ['Low', 'कम'],
    normal: ['Normal', 'सामान्य'],
    high: ['High', 'उच्च'],
  };
  const pair = map[p];
  return pair ? (isHi ? pair[1] : pair[0]) : p;
}

function statusColor(status: string): string {
  switch (status) {
    case 'open': return '#DC2626';
    case 'pending': return '#D97706';
    case 'in_progress': return '#7C3AED';
    case 'resolved': return '#16A34A';
    case 'closed': return 'var(--text-3)';
    default: return 'var(--text-3)';
  }
}

function categoryColor(cat: string): string {
  switch (cat) {
    case 'bug': return '#DC2626';
    case 'billing': return '#D97706';
    case 'content': return '#0891B2';
    case 'account': return '#7C3AED';
    default: return 'var(--text-3)';
  }
}

function priorityColor(p: string): string {
  switch (p) {
    case 'high': return '#DC2626';
    case 'normal': return '#D97706';
    case 'low': return 'var(--text-3)';
    default: return 'var(--text-3)';
  }
}

function formatDateTime(iso: string, isHi: boolean): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(isHi ? 'hi-IN' : 'en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Authorship label. `author_role` is the only signal we get (P13) — anything
 * outside the requester set is operator-side by contract, so an unrecognised
 * role renders as support rather than being mistaken for the student's own words.
 */
function isRequesterAuthored(role: string): boolean {
  return REQUESTER_ROLES.has(role);
}

function authorLabel(role: string, isHi: boolean): string {
  if (isRequesterAuthored(role)) return isHi ? 'आप' : 'You';
  return isHi ? 'Alfanumrik सपोर्ट' : 'Alfanumrik Support';
}

function retryAfterText(ms: number, isHi: boolean): string {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  if (isHi) return `${minutes} मिनट`;
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/* ── Message bubble ──────────────────────────────────────────── */
function MessageBubble({
  role,
  body,
  createdAt,
  isHi,
}: {
  role: string;
  body: string;
  createdAt: string;
  isHi: boolean;
}) {
  const fromSupport = !isRequesterAuthored(role);
  const label = authorLabel(role, isHi);
  return (
    <div
      className="rounded-2xl p-3"
      style={{
        background: fromSupport ? 'rgb(var(--orange-rgb) / 0.06)' : 'var(--surface-1)',
        border: `1px solid ${fromSupport ? 'rgb(var(--orange-rgb) / 0.2)' : 'var(--border)'}`,
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <Avatar name={fromSupport ? 'Alfanumrik Support' : 'You'} size={28} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold truncate">{label}</p>
          <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            {formatDateTime(createdAt, isHi)}
          </p>
        </div>
      </div>
      <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)' }}>
        {body}
      </p>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */
export default function SupportTicketDetailPage() {
  const { isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const params = useParams<{ ticket_id: string }>();
  const ticketId = params?.ticket_id;
  const [redirected, setRedirected] = useState(false);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendOk, setSendOk] = useState(false);

  // Auth gate
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  const { data, error, isLoading: swrLoading, mutate } = useSWR<TicketThread>(
    isLoggedIn && ticketId ? `/api/support/tickets/${ticketId}` : null,
    fetchThread,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  // 404 / unauthorized → bounce to list with a toast.
  useEffect(() => {
    if (redirected) return;
    const status = (error as HttpError | undefined)?.status;
    if (status === 404 || status === 403) {
      setRedirected(true);
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem(
            'alfanumrik_support_toast',
            JSON.stringify({
              type: 'error',
              message: isHi ? 'टिकट नहीं मिला' : 'Ticket not found',
            }),
          );
        } catch { /* non-blocking */ }
      }
      router.replace('/support');
    }
  }, [error, isHi, redirected, router]);

  const handleRetry = useCallback(() => { mutate(); }, [mutate]);

  const trimmed = draft.trim();
  const tooLong = trimmed.length > REPLY_MAX_LENGTH;
  const canSend = trimmed.length > 0 && !tooLong && !sending;

  const handleSend = useCallback(async () => {
    if (!ticketId) return;
    const body = draft.trim();
    if (!body || body.length > REPLY_MAX_LENGTH) return;

    setSending(true);
    setSendError(null);
    setSendOk(false);

    try {
      const res = await fetch(`/api/support/tickets/${ticketId}`, {
        method: 'POST',
        headers: await authHeaders(),
        credentials: 'include',
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 429) {
          const headerMs = Number(res.headers.get('Retry-After') ?? '0') * 1000;
          const waitMs = Number(json?.retry_after_ms) || headerMs || 60000;
          setSendError(
            isHi
              ? `आपने बहुत सारे संदेश भेज दिए हैं। कृपया ${retryAfterText(waitMs, true)} बाद फिर से कोशिश करें।`
              : `You've sent a lot of messages. Please try again in ${retryAfterText(waitMs, false)}.`,
          );
        } else if (res.status === 400) {
          setSendError(
            isHi
              ? 'संदेश भेजा नहीं जा सका — कृपया 1 से 5000 अक्षरों के बीच लिखें।'
              : 'Could not send — your message must be between 1 and 5000 characters.',
          );
        } else if (res.status === 401 || res.status === 403) {
          setSendError(
            isHi
              ? 'आपका सत्र समाप्त हो गया है। कृपया फिर से लॉगिन करें।'
              : 'Your session expired. Please log in again.',
          );
        } else if (res.status === 404) {
          setSendError(isHi ? 'यह टिकट अब उपलब्ध नहीं है।' : 'This ticket is no longer available.');
        } else {
          setSendError(
            isHi
              ? 'संदेश भेजा नहीं जा सका। कृपया फिर से कोशिश करें।'
              : 'Your message could not be sent. Please try again.',
          );
        }
        return;
      }

      const reply = json?.data?.reply as Reply | undefined;
      const nextStatus = json?.data?.ticket_status as string | undefined;

      setDraft('');
      setSendOk(true);

      // Optimistic append — but never when the thread read failed, because we
      // would then show one reply and imply the rest do not exist.
      if (reply?.id && data && !data.repliesUnavailable) {
        await mutate(
          {
            ...data,
            ticket: { ...data.ticket, status: nextStatus || data.ticket.status },
            replies: [...data.replies, reply],
          },
          { revalidate: false },
        );
      }
      // Reconcile with the server regardless (also recovers repliesUnavailable).
      mutate();
    } catch {
      setSendError(
        isHi
          ? 'नेटवर्क त्रुटि — कृपया कनेक्शन जाँचकर फिर से कोशिश करें।'
          : 'Network error — check your connection and try again.',
      );
    } finally {
      setSending(false);
    }
  }, [draft, ticketId, isHi, data, mutate]);

  const threadCount = useMemo(
    () => (data ? data.replies.length : 0),
    [data],
  );

  if (isLoading) return <LoadingFoxy />;
  if (!isLoggedIn) return <LoadingFoxy />;

  const swrStatus = (error as HttpError | undefined)?.status;
  const showGenericError = !!error && !redirected && swrStatus !== 404 && swrStatus !== 403;

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center gap-3">
          <button
            onClick={() => router.push('/support')}
            className="text-sm"
            style={{ color: 'var(--text-3)' }}
            aria-label={isHi ? 'वापस' : 'Back'}
          >
            ←
          </button>
          <div>
            <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
              {isHi ? 'टिकट विवरण' : 'Ticket details'}
            </h1>
            {data?.ticket.id && (
              <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
                #{String(data.ticket.id).slice(0, 8)}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-3">
        {/* ── Loading ─────────────────────────────────────────── */}
        {swrLoading && !data && !error && (
          <Card>
            <div className="text-center py-8">
              <div className="text-4xl animate-float mb-3" aria-hidden="true">📨</div>
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'लोड हो रहा है…' : 'Loading…'}
              </p>
            </div>
          </Card>
        )}

        {/* ── Error (not 404/403 — those redirect) ────────────── */}
        {showGenericError && (
          <Card>
            <div className="text-center py-6 px-2">
              <div className="text-3xl mb-2" aria-hidden="true">⚠️</div>
              <h3 className="text-sm font-bold mb-1">
                {isHi ? 'टिकट लोड नहीं हो सका' : 'Could not load ticket'}
              </h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-3)' }}>
                {isHi
                  ? 'इंटरनेट कनेक्शन जाँचें और फिर से कोशिश करें।'
                  : 'Check your connection and try again.'}
              </p>
              <Button size="sm" variant="ghost" onClick={handleRetry}>
                {isHi ? 'पुनः प्रयास करें' : 'Retry'}
              </Button>
            </div>
          </Card>
        )}

        {/* ── Ticket + thread ─────────────────────────────────── */}
        {data && !error && (
          <>
            <Card>
              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-bold leading-snug">
                    {data.ticket.subject}
                  </h2>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'बनाया गया' : 'Created'} {formatDateTime(data.ticket.created_at, isHi)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge color={categoryColor(data.ticket.category)} size="sm">
                    {categoryLabel(data.ticket.category, isHi)}
                  </Badge>
                  <Badge color={statusColor(data.ticket.status)} size="sm">
                    {statusLabel(data.ticket.status, isHi)}
                  </Badge>
                  <Badge color={priorityColor(data.ticket.priority)} size="sm">
                    {priorityLabel(data.ticket.priority, isHi)}
                  </Badge>
                </div>

                <div className="pt-3 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
                  <h3
                    className="text-[11px] font-bold uppercase tracking-wider mb-2"
                    style={{ color: 'var(--text-3)' }}
                  >
                    {isHi ? 'विवरण' : 'Description'}
                  </h3>
                  <p
                    className="text-sm whitespace-pre-wrap leading-relaxed"
                    style={{ color: 'var(--text-2)' }}
                  >
                    {data.ticket.message}
                  </p>
                </div>
              </div>
            </Card>

            {/* ── Conversation ─────────────────────────────────── */}
            <div>
              <h3
                className="text-xs font-bold uppercase tracking-wider mb-2 ml-1"
                style={{ color: 'var(--text-3)' }}
              >
                {isHi ? 'बातचीत' : 'Conversation'}
                {!data.repliesUnavailable && threadCount > 0 ? ` (${threadCount})` : ''}
              </h3>

              {/* ERROR state — the thread read failed. Distinct from empty. */}
              {data.repliesUnavailable && (
                <div
                  className="rounded-2xl p-4 text-center"
                  style={{
                    background: 'rgb(220 38 38 / 0.06)',
                    border: '1px solid rgb(220 38 38 / 0.25)',
                  }}
                  role="alert"
                >
                  <div className="text-2xl mb-2" aria-hidden="true">⚠️</div>
                  <p className="text-sm font-bold mb-1">
                    {isHi ? 'बातचीत लोड नहीं हो सकी' : 'Could not load the conversation'}
                  </p>
                  <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
                    {isHi
                      ? 'इसका मतलब यह नहीं है कि कोई जवाब नहीं आया — हम इसे अभी दिखा नहीं पाए। कृपया फिर से कोशिश करें।'
                      : 'This does not mean there are no replies — we just could not load them. Please try again.'}
                  </p>
                  <Button size="sm" variant="ghost" onClick={handleRetry}>
                    {isHi ? 'पुनः प्रयास करें' : 'Retry'}
                  </Button>
                </div>
              )}

              {/* EMPTY state — read succeeded, genuinely no replies yet. */}
              {!data.repliesUnavailable && threadCount === 0 && (
                <div
                  className="rounded-2xl p-4 text-center"
                  style={{ background: 'var(--surface-1)', border: '1px dashed var(--border-mid)' }}
                >
                  <p className="text-sm font-semibold mb-1">
                    {isHi ? 'अभी तक कोई जवाब नहीं' : 'No replies yet'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                    {isHi
                      ? 'जब हमारी टीम जवाब देगी, वह यहीं दिखेगा। आप नीचे और जानकारी जोड़ सकते हैं।'
                      : 'When our team replies, it will appear here. You can add more details below.'}
                  </p>
                  {/* Published SLA — shown ONLY on the genuinely-empty thread,
                      which is exactly the student waiting to hear back. Not on
                      the repliesUnavailable error state (a promise beside a
                      failure reads as an excuse), and not once replies exist.
                      Numbers live only in @alfanumrik/lib/support/response-sla
                      (CEO-set). No countdown is derived from them. */}
                  <p
                    className="text-[11px] mt-2"
                    style={{ color: 'var(--text-3)' }}
                    data-testid="support-sla-note"
                  >
                    {supportSlaLine(isHi)}
                  </p>
                </div>
              )}

              {/* CONTENT */}
              {!data.repliesUnavailable && threadCount > 0 && (
                <ul className="space-y-2" aria-label={isHi ? 'बातचीत' : 'Conversation'}>
                  {data.replies.map((r) => (
                    <li key={r.id}>
                      <MessageBubble
                        role={r.author_role}
                        body={r.body}
                        createdAt={r.created_at}
                        isHi={isHi}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* ── Reply composer ───────────────────────────────── */}
            <Card>
              <label
                htmlFor="support-reply-body"
                className="text-xs font-bold uppercase tracking-wider block mb-2"
                style={{ color: 'var(--text-3)' }}
              >
                {isHi ? 'जवाब लिखें' : 'Write a reply'}
              </label>
              <textarea
                id="support-reply-body"
                value={draft}
                onChange={(e) => { setDraft(e.target.value); setSendOk(false); }}
                rows={4}
                maxLength={REPLY_MAX_LENGTH + 1}
                disabled={sending}
                placeholder={
                  isHi
                    ? 'अपना संदेश यहाँ लिखें…'
                    : 'Type your message here…'
                }
                className="input-base"
                style={{ resize: 'vertical', minHeight: 96 }}
              />

              <div className="flex items-center justify-between mt-1.5">
                <span
                  className="text-[10px]"
                  style={{ color: tooLong ? '#DC2626' : 'var(--text-3)' }}
                >
                  {trimmed.length}/{REPLY_MAX_LENGTH}
                </span>
                {(data.ticket.status === 'resolved' || data.ticket.status === 'closed') && (
                  <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                    {isHi
                      ? 'जवाब भेजने पर यह टिकट फिर से खुल जाएगा'
                      : 'Replying will re-open this ticket'}
                  </span>
                )}
              </div>

              {tooLong && (
                <p className="text-xs mt-2" style={{ color: '#DC2626' }} role="alert">
                  {isHi
                    ? `संदेश ${REPLY_MAX_LENGTH} अक्षरों से लंबा नहीं हो सकता।`
                    : `Your message cannot be longer than ${REPLY_MAX_LENGTH} characters.`}
                </p>
              )}

              {sendError && (
                <div
                  className="rounded-xl p-3 mt-2"
                  style={{
                    background: 'rgb(220 38 38 / 0.06)',
                    border: '1px solid rgb(220 38 38 / 0.25)',
                  }}
                  role="alert"
                >
                  <p className="text-xs" style={{ color: '#DC2626' }}>{sendError}</p>
                </div>
              )}

              {sendOk && !sendError && (
                <p className="text-xs mt-2" style={{ color: '#16A34A' }} role="status">
                  {isHi ? 'आपका संदेश भेज दिया गया।' : 'Your message was sent.'}
                </p>
              )}

              <div className="mt-3">
                <Button
                  fullWidth
                  onClick={handleSend}
                  disabled={!canSend}
                  loading={sending}
                >
                  {sending
                    ? (isHi ? 'भेजा जा रहा है…' : 'Sending…')
                    : (isHi ? 'जवाब भेजें' : 'Send reply')}
                </Button>
              </div>
            </Card>

            <div className="pt-2">
              <Button variant="ghost" fullWidth onClick={() => router.push('/support')}>
                ← {isHi ? 'सभी टिकट' : 'All tickets'}
              </Button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
