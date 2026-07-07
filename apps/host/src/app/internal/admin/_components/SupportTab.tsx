'use client';

/**
 * SupportTab — internal-admin Support Tickets tab.
 *
 * Extracted from src/app/internal/admin/page.tsx as part of Plan 5 Task 7.
 * Behaviour preserved verbatim:
 *   - GET /api/internal/admin/support?status=&page=&limit=25 — paginated list
 *   - PATCH /api/internal/admin/support — set status='resolved' on a ticket
 *   - Filter chips: open / pending / resolved / all
 *
 * Visual styling kept on the legacy `S.*` / `C.*` dark-theme tokens.
 */

import { useState, useEffect, useCallback } from 'react';
import { adminHeaders } from '@alfanumrik/lib/admin-session';
import { useAdminFetch } from '../_hooks/useAdminFetch';
import type { SupportTicket } from '../_lib/internal-admin-types';

const C = {
  bg3: '#161b22',
  border: '#21262d',
  text2: '#8b949e',
  text3: '#484f58',
  orange: '#E8581C',
  green: '#22c55e',
  blue: '#3b82f6',
  yellow: '#f59e0b',
  red: '#ef4444',
};

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

export interface SupportTabProps {
  secret: string;
  onToast?: (msg: string) => void;
}

export default function SupportTab({ secret, onToast }: SupportTabProps) {
  const apiFetch = useAdminFetch(secret);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketStatus, setTicketStatus] = useState('open');
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketTotal, setTicketTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchTickets = useCallback(async () => {
    setLoading(true);
    try {
      const d = await apiFetch<{ data: SupportTicket[]; total: number }>(
        `/api/internal/admin/support?status=${ticketStatus}&page=${ticketPage}&limit=25`,
      );
      setTickets(d.data || []);
      setTicketTotal(d.total || 0);
    } catch { /* preserve pre-refactor "if (res.ok)" silent failure */ }
    setLoading(false);
  }, [apiFetch, ticketStatus, ticketPage]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const resolveTicket = async (id: string) => {
    await fetch('/api/internal/admin/support', {
      method: 'PATCH',
      headers: adminHeaders(secret),
      body: JSON.stringify({ id, status: 'resolved' }),
    });
    onToast?.('Ticket resolved');
    fetchTickets();
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Support Tickets</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {['open', 'pending', 'resolved', 'all'].map(s => (
            <button key={s} onClick={() => { setTicketStatus(s); setTicketPage(1); }}
              style={{ ...S.btn(), ...(ticketStatus === s ? { background: `${C.orange}20`, borderColor: C.orange } : {}) }}>
              {s}
            </button>
          ))}
          <button onClick={fetchTickets} style={S.btn()}>↻</button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: C.text3, marginBottom: 10 }}>{ticketTotal} tickets</div>

      <div style={{ display: 'grid', gap: 10 }}>
        {tickets.map(t => (
          <div key={t.id} style={{ ...S.card, borderLeft: `3px solid ${t.status === 'open' ? C.red : t.status === 'pending' ? C.yellow : C.green}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{t.subject || 'No subject'}</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={S.badge(t.status === 'open' ? C.red : t.status === 'pending' ? C.yellow : C.green)}>{t.status}</span>
                {t.status !== 'resolved' && (
                  <button onClick={() => resolveTicket(t.id)} style={S.btn(C.green)}>✓ Resolve</button>
                )}
              </div>
            </div>
            <div style={{ fontSize: 12, color: C.text2, marginBottom: 6 }}>{t.message}</div>
            <div style={{ fontSize: 10, color: C.text3 }}>{new Date(t.created_at).toLocaleString()}</div>
            {t.admin_notes && <div style={{ fontSize: 11, color: C.blue, marginTop: 6, padding: '4px 8px', background: `${C.blue}10`, borderRadius: 4 }}>Note: {t.admin_notes}</div>}
          </div>
        ))}
        {tickets.length === 0 && !loading && (
          <div style={{ color: C.text3, fontSize: 12, padding: 20, textAlign: 'center' }}>No tickets in this queue</div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'center' }}>
        <button disabled={ticketPage <= 1} onClick={() => setTicketPage(p => p - 1)} style={S.btn()}>← Prev</button>
        <span style={{ fontSize: 12, color: C.text3 }}>Page {ticketPage} / {Math.max(1, Math.ceil(ticketTotal / 25))}</span>
        <button disabled={tickets.length < 25} onClick={() => setTicketPage(p => p + 1)} style={S.btn()}>Next →</button>
      </div>
    </div>
  );
}
