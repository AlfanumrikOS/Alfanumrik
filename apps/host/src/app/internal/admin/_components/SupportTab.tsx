'use client';

/**
 * SupportTab — internal-admin Support Tickets tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 *   - GET   /api/internal/admin/support?status=&page=&limit=25 — paginated list
 *   - GET   /api/internal/admin/support?ticket_id=<uuid>       — one ticket + FULL thread
 *   - PATCH /api/internal/admin/support                        — set status='resolved'
 *   - POST  /api/internal/admin/support                        — post a reply / internal note
 *
 * ── THE VISIBILITY TOGGLE IS THE SAFETY-CRITICAL CONTROL ───────────────────
 * `is_internal: true`  → private operator note. The student route filters it
 *                        out (`.eq('is_internal', false)`) and RLS excludes it.
 * `is_internal: false` → SENT TO THE STUDENT. Irreversible; there is no
 *                        unsend. A mis-click here ships operator-internal text
 *                        to a child's account.
 * Three deliberate mitigations, do not weaken any of them:
 *   1. The composer DEFAULTS to internal note on open.
 *   2. It RESETS to internal after every successful send, so student-visible
 *      mode is never silently inherited by the next message.
 *   3. Mode is signalled redundantly — segmented control state, composer
 *      border+background colour, a full-width banner naming the audience, and
 *      the send-button label/colour. Internal notes in the thread carry the
 *      same lock styling so the two can never be confused when read back.
 *
 * Language: the internal-admin console is English-only by convention (no
 * `isHi` anywhere under app/internal/admin). P7 governs student-facing
 * surfaces; do not invent bilingual copy here.
 *
 * P13: reply/note bodies are never logged or written to analytics from this
 * component. Only ids and the visibility flag travel anywhere but the request.
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { SupportTicket } from '../_lib/internal-admin-types';

const C = {
  bg3: '#161b22',
  bg4: '#0d1117',
  border: '#21262d',
  text2: '#8b949e',
  text3: '#484f58',
  orange: '#E8581C',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#f59e0b',
  red: '#ef4444',
  purple: '#a855f7',
};

/** Mirrors the support_ticket_replies body CHECK (non-blank, <= 5000). */
const REPLY_MAX_LENGTH = 5000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const S: Record<string, any> = {
  card: { padding: 16, borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg3 },
  badge: (color: string, bg?: string): React.CSSProperties => ({
    fontSize: 10, padding: '2px 8px', borderRadius: 10,
    background: bg || `${color}18`, color,
    fontWeight: 600, whiteSpace: 'nowrap' as const,
  }),
  btn: (color: string = C.orange): React.CSSProperties => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer',
    background: `${color}15`, color, border: `1px solid ${color}30`,
    transition: 'all 0.15s',
  }),
};

interface TicketReply {
  id: string;
  author_role: string;
  author_user_id?: string | null;
  body: string;
  is_internal: boolean;
  created_at: string;
}

interface ThreadResponse {
  ticket: SupportTicket;
  replies: TicketReply[];
}

export interface SupportTabProps {
  onToast?: (msg: string) => void;
}

export default function SupportTab({ onToast }: SupportTabProps) {
  const apiFetch = useAdminFetch();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketStatus, setTicketStatus] = useState('open');
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // ── Thread state (one ticket expanded at a time) ─────────────────────
  const [openId, setOpenId] = useState<string | null>(null);
  const [replies, setReplies] = useState<TicketReply[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  // ── Composer state ───────────────────────────────────────────────────
  const [draft, setDraft] = useState('');
  // SAFER DEFAULT: internal note. See the header comment before changing.
  const [isInternal, setIsInternal] = useState(true);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const d = await apiFetch<{ data: SupportTicket[]; total: number }>(
        `/api/internal/admin/support?status=${ticketStatus}&page=${ticketPage}&limit=25`,
      );
      setTickets(d.data || []);
      setTicketTotal(d.total || 0);
    } catch {
      // Previously swallowed ("if (res.ok)" silent failure), which rendered a
      // load failure as an empty queue — i.e. tickets look answered when they
      // are merely unfetched. Surface it instead.
      setTickets([]);
      setTicketTotal(0);
      setListError('Could not load tickets. This is a load failure, not an empty queue.');
    }
    setLoading(false);
  }, [apiFetch, ticketStatus, ticketPage]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const loadThread = useCallback(async (id: string) => {
    setThreadLoading(true);
    setThreadError(null);
    try {
      const d = await apiFetch<ThreadResponse>(`/api/internal/admin/support?ticket_id=${id}`);
      setReplies(Array.isArray(d.replies) ? d.replies : []);
    } catch {
      setReplies([]);
      setThreadError('Could not load this conversation. Retry before assuming it is empty.');
    }
    setThreadLoading(false);
  }, [apiFetch]);

  const toggleThread = useCallback((id: string) => {
    setPostError(null);
    setDraft('');
    setIsInternal(true); // never carry student-visible mode across tickets
    if (openId === id) {
      setOpenId(null);
      setReplies([]);
      setThreadError(null);
      return;
    }
    setOpenId(id);
    setReplies([]);
    loadThread(id);
  }, [openId, loadThread]);

  const resolveTicket = async (id: string) => {
    try {
      await apiFetch('/api/internal/admin/support', {
        method: 'PATCH',
        body: JSON.stringify({ id, status: 'resolved' }),
      });
      onToast?.('Ticket resolved');
      fetchTickets();
    } catch {
      onToast?.('Could not resolve ticket — try again');
    }
  };

  const sendReply = async () => {
    if (!openId) return;
    const body = draft.trim();
    if (!body || body.length > REPLY_MAX_LENGTH) return;

    setPosting(true);
    setPostError(null);
    try {
      const res = await apiFetch<{ success: boolean; reply: TicketReply; ticket_status: string }>(
        '/api/internal/admin/support',
        {
          method: 'POST',
          body: JSON.stringify({ ticket_id: openId, body, is_internal: isInternal }),
        },
      );
      if (res?.reply) setReplies(prev => [...prev, res.reply]);
      if (res?.ticket_status) {
        setTickets(prev => prev.map(t => (t.id === openId ? { ...t, status: res.ticket_status } : t)));
      }
      onToast?.(isInternal ? 'Internal note saved (not sent to student)' : 'Reply sent to student');
      setDraft('');
      // Reset to the safe mode so the next message is never accidentally public.
      setIsInternal(true);
    } catch {
      setPostError(
        isInternal
          ? 'Could not save the internal note. Nothing was sent to the student.'
          : 'Could not send the reply. The student did NOT receive it — try again.',
      );
    }
    setPosting(false);
  };

  const trimmed = draft.trim();
  const tooLong = trimmed.length > REPLY_MAX_LENGTH;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Support Tickets</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['open', 'pending', 'resolved', 'all'].map(s => (
            <button key={s} onClick={() => { setTicketStatus(s); setTicketPage(1); setOpenId(null); }}
              style={{ ...S.btn(), ...(ticketStatus === s ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
              {s}
            </button>
          ))}
          <button onClick={fetchTickets} style={S.btn()}>↻</button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: C.text3, marginBottom: 10 }}>{ticketTotal} tickets</div>

      {/* LIST — loading / error / empty are three distinct states */}
      {loading && tickets.length === 0 && !listError && (
        <div style={{ color: C.text3, fontSize: 12, padding: 20, textAlign: 'center' }}>Loading tickets…</div>
      )}

      {listError && (
        <div style={{ ...S.card, borderColor: `${C.red}55`, background: `${C.red}10`, marginBottom: 10 }} role="alert">
          <div style={{ fontSize: 12, color: C.red, fontWeight: 700, marginBottom: 4 }}>⚠️ {listError}</div>
          <button onClick={fetchTickets} style={S.btn(C.red)}>Retry</button>
        </div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {tickets.map(t => {
          const isOpen = openId === t.id;
          return (
            <div key={t.id} style={{ ...S.card, borderLeft: `3px solid ${t.status === 'open' ? C.red : t.status === 'pending' ? C.yellow : C.green}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>{t.subject || 'No subject'}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={S.badge(t.status === 'open' ? C.red : t.status === 'pending' ? C.yellow : C.green)}>{t.status}</span>
                  <button
                    onClick={() => toggleThread(t.id)}
                    style={S.btn(C.blue)}
                    aria-expanded={isOpen}
                  >
                    {isOpen ? '× Close thread' : '💬 Thread & reply'}
                  </button>
                  {t.status !== 'resolved' && (
                    <button onClick={() => resolveTicket(t.id)} style={S.btn(C.green)}>✓ Resolve</button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 12, color: C.text2, marginBottom: 6, whiteSpace: 'pre-wrap' }}>{t.message}</div>
              <div style={{ fontSize: 10, color: C.text3 }}>{new Date(t.created_at).toLocaleString()}</div>
              {t.admin_notes && <div style={{ fontSize: 11, color: C.blue, marginTop: 6, padding: '4px 8px', background: `${C.blue}10`, borderRadius: 4 }}>Note: {t.admin_notes}</div>}

              {/* ── THREAD + COMPOSER ─────────────────────────────── */}
              {isOpen && (
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: C.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
                    Conversation
                  </div>

                  {/* Thread: loading / error / empty are three distinct states */}
                  {threadLoading && (
                    <div style={{ fontSize: 12, color: C.text3, padding: '10px 0' }}>Loading conversation…</div>
                  )}

                  {!threadLoading && threadError && (
                    <div style={{ padding: 10, borderRadius: 8, background: `${C.red}10`, border: `1px solid ${C.red}55` }} role="alert">
                      <div style={{ fontSize: 12, color: C.red, marginBottom: 6 }}>⚠️ {threadError}</div>
                      <button onClick={() => loadThread(t.id)} style={S.btn(C.red)}>Retry</button>
                    </div>
                  )}

                  {!threadLoading && !threadError && replies.length === 0 && (
                    <div style={{ fontSize: 12, color: C.text3, padding: '10px 0' }}>
                      No replies yet. Nothing has been sent to this student.
                    </div>
                  )}

                  {!threadLoading && !threadError && replies.length > 0 && (
                    <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                      {replies.map(r => {
                        const internal = r.is_internal === true;
                        const fromOperator = !['student', 'parent', 'teacher', 'guest'].includes(r.author_role);
                        return (
                          <div
                            key={r.id}
                            style={{
                              padding: 10,
                              borderRadius: 8,
                              background: internal ? `${C.yellow}0d` : C.bg4,
                              // Internal notes get a DASHED amber border; student-visible
                              // messages get a solid one. Visually unmistakable on read-back.
                              border: internal ? `1px dashed ${C.yellow}66` : `1px solid ${C.border}`,
                            }}
                          >
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 5, flexWrap: 'wrap' }}>
                              <span style={S.badge(fromOperator ? C.orange : C.blue)}>
                                {fromOperator ? 'Support' : `Requester (${r.author_role})`}
                              </span>
                              {internal
                                ? <span style={S.badge(C.yellow)}>🔒 INTERNAL — student cannot see this</span>
                                : <span style={S.badge(C.green)}>👁 Visible to student</span>}
                              <span style={{ fontSize: 10, color: C.text3 }}>{new Date(r.created_at).toLocaleString()}</span>
                            </div>
                            <div style={{ fontSize: 12, color: C.text2, whiteSpace: 'pre-wrap' }}>{r.body}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Composer ───────────────────────────────────── */}
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: 8,
                      background: isInternal ? `${C.yellow}0a` : `${C.green}0a`,
                      border: isInternal ? `1px dashed ${C.yellow}66` : `2px solid ${C.green}88`,
                    }}
                  >
                    {/* Mode toggle — segmented, radio semantics */}
                    <div role="radiogroup" aria-label="Reply visibility" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      <button
                        role="radio"
                        aria-checked={isInternal}
                        onClick={() => setIsInternal(true)}
                        style={{
                          ...S.btn(C.yellow),
                          flex: 1,
                          ...(isInternal
                            ? { background: `${C.yellow}28`, borderColor: C.yellow, color: C.yellow }
                            : { background: 'transparent', color: C.text3, borderColor: C.border }),
                        }}
                      >
                        🔒 Internal note
                      </button>
                      <button
                        role="radio"
                        aria-checked={!isInternal}
                        onClick={() => setIsInternal(false)}
                        style={{
                          ...S.btn(C.green),
                          flex: 1,
                          ...(!isInternal
                            ? { background: `${C.green}28`, borderColor: C.green, color: C.green }
                            : { background: 'transparent', color: C.text3, borderColor: C.border }),
                        }}
                      >
                        📤 Reply to student
                      </button>
                    </div>

                    {/* Audience banner — names the recipient in plain words */}
                    <div
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        padding: '6px 10px',
                        borderRadius: 6,
                        marginBottom: 8,
                        background: isInternal ? `${C.yellow}18` : `${C.green}18`,
                        color: isInternal ? C.yellow : C.green,
                      }}
                    >
                      {isInternal
                        ? '🔒 PRIVATE — this text stays inside the admin console. The student will NOT see it.'
                        : '📤 THIS WILL BE SENT TO THE STUDENT and appears in their support thread. It cannot be unsent.'}
                    </div>

                    <textarea
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      rows={4}
                      maxLength={REPLY_MAX_LENGTH + 1}
                      disabled={posting}
                      placeholder={isInternal
                        ? 'Private working note for other operators…'
                        : 'Write the answer the student will read…'}
                      style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: 10,
                        borderRadius: 7,
                        fontSize: 12,
                        fontFamily: 'inherit',
                        resize: 'vertical',
                        minHeight: 80,
                        background: C.bg4,
                        color: '#e6edf3',
                        border: `1px solid ${isInternal ? `${C.yellow}55` : `${C.green}66`}`,
                      }}
                    />

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 8 }}>
                      <span style={{ fontSize: 10, color: tooLong ? C.red : C.text3 }}>
                        {trimmed.length}/{REPLY_MAX_LENGTH}
                      </span>
                      <button
                        onClick={sendReply}
                        disabled={posting || !trimmed || tooLong}
                        style={{
                          ...S.btn(isInternal ? C.yellow : C.green),
                          opacity: posting || !trimmed || tooLong ? 0.45 : 1,
                          cursor: posting || !trimmed || tooLong ? 'not-allowed' : 'pointer',
                          fontWeight: 800,
                        }}
                      >
                        {posting
                          ? 'Sending…'
                          : isInternal ? '🔒 Save internal note' : '📤 Send to student'}
                      </button>
                    </div>

                    {tooLong && (
                      <div style={{ fontSize: 11, color: C.red, marginTop: 6 }} role="alert">
                        Message cannot exceed {REPLY_MAX_LENGTH} characters.
                      </div>
                    )}

                    {postError && (
                      <div style={{ fontSize: 11, color: C.red, marginTop: 6 }} role="alert">⚠️ {postError}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {tickets.length === 0 && !loading && !listError && (
          <div style={{ color: C.text3, fontSize: 12, padding: 20, textAlign: 'center' }}>No tickets in this queue</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
        <button disabled={ticketPage <= 1} onClick={() => { setTicketPage(p => p - 1); setOpenId(null); }} style={S.btn()}>← Prev</button>
        <span style={{ fontSize: 12, color: C.text3 }}>Page {ticketPage} / {Math.max(1, Math.ceil(ticketTotal / 25))}</span>
        <button disabled={tickets.length < 25} onClick={() => { setTicketPage(p => p + 1); setOpenId(null); }} style={S.btn()}>Next →</button>
      </div>
    </div>
  );
}
