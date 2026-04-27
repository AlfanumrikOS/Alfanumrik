'use client';

/**
 * /support/[ticket_id] — view a single ticket the user owns.
 *
 * Audit F22 (frontend portion). Fetches GET /api/support/tickets/[id].
 * 404 / RLS-blocked → redirect to /support with a toast.
 *
 * P7 — bilingual via AuthContext.isHi.
 */

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useParams } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  LoadingFoxy,
  Badge,
  BottomNav,
  Avatar,
} from '@/components/ui';

/* ── Types ───────────────────────────────────────────────────── */
interface Reply {
  id: string;
  author_role: 'user' | 'agent' | 'system' | string;
  author_name?: string | null;
  body: string;
  created_at: string;
}

interface TicketDetail {
  ticket_id: string;
  subject: string;
  category: string;
  priority: string;
  status: string;
  description: string;
  created_at: string;
  updated_at?: string;
  replies?: Reply[];
}

interface DetailResponse {
  ticket?: TicketDetail;
  data?: TicketDetail | { ticket?: TicketDetail };
  success?: boolean;
}

/* ── Authenticated fetcher ───────────────────────────────────── */
async function authFetch(url: string): Promise<TicketDetail> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  } catch { /* fall through to cookie auth */ }

  const res = await fetch(url, { headers, credentials: 'include' });
  if (!res.ok) {
    const error = new Error(`Request failed: ${res.status}`) as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  const json: DetailResponse = await res.json();

  // Accept multiple shapes: { ticket }, { data: ticket }, { data: { ticket } }, or root ticket.
  const candidate =
    (json as { ticket?: TicketDetail }).ticket
    ?? ((json.data as { ticket?: TicketDetail })?.ticket)
    ?? (json.data as TicketDetail | undefined)
    ?? (json as unknown as TicketDetail);
  if (!candidate || !candidate.ticket_id) {
    const e = new Error('Ticket not found') as Error & { status: number };
    e.status = 404;
    throw e;
  }
  return candidate;
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

/* ── Page ────────────────────────────────────────────────────── */
export default function SupportTicketDetailPage() {
  const { isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();
  const params = useParams<{ ticket_id: string }>();
  const ticketId = params?.ticket_id;
  const [redirected, setRedirected] = useState(false);

  // Auth gate
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  const { data, error, isLoading: swrLoading, mutate } = useSWR<TicketDetail>(
    isLoggedIn && ticketId ? `/api/support/tickets/${ticketId}` : null,
    authFetch,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  // 404 / unauthorized → bounce to list with a toast.
  useEffect(() => {
    if (redirected) return;
    const status = (error as (Error & { status?: number }) | undefined)?.status;
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

  if (isLoading) return <LoadingFoxy />;
  if (!isLoggedIn) return <LoadingFoxy />;

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
            {data?.ticket_id && (
              <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>
                #{String(data.ticket_id).slice(0, 8)}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="app-container py-4 space-y-3">
        {/* Loading */}
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

        {/* Generic error (not 404 — that redirects). */}
        {error && !redirected && (error as Error & { status?: number }).status !== 404 && (error as Error & { status?: number }).status !== 403 && (
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

        {/* Ticket */}
        {data && !error && (
          <>
            <Card>
              <div className="space-y-3">
                <div>
                  <h2 className="text-base font-bold leading-snug">
                    {data.subject}
                  </h2>
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'बनाया गया' : 'Created'} {formatDateTime(data.created_at, isHi)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge color={categoryColor(data.category)} size="sm">
                    {categoryLabel(data.category, isHi)}
                  </Badge>
                  <Badge color={statusColor(data.status)} size="sm">
                    {statusLabel(data.status, isHi)}
                  </Badge>
                  <Badge color={priorityColor(data.priority)} size="sm">
                    {priorityLabel(data.priority, isHi)}
                  </Badge>
                </div>

                <div className="pt-3 mt-1" style={{ borderTop: '1px solid var(--border)' }}>
                  <h3 className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>
                    {isHi ? 'विवरण' : 'Description'}
                  </h3>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)' }}>
                    {data.description}
                  </p>
                </div>
              </div>
            </Card>

            {/* Replies (if API returns any) */}
            {Array.isArray(data.replies) && data.replies.length > 0 && (
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-2 ml-1" style={{ color: 'var(--text-3)' }}>
                  {isHi ? 'जवाब' : 'Replies'} ({data.replies.length})
                </h3>
                <ul className="space-y-2" aria-label={isHi ? 'जवाब' : 'Replies'}>
                  {data.replies.map((r) => {
                    const isAgent = r.author_role === 'agent' || r.author_role === 'system';
                    return (
                      <li key={r.id}>
                        <div
                          className="rounded-2xl p-3"
                          style={{
                            background: isAgent ? 'rgb(var(--orange-rgb) / 0.06)' : 'var(--surface-1)',
                            border: `1px solid ${isAgent ? 'rgb(var(--orange-rgb) / 0.2)' : 'var(--border)'}`,
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <Avatar name={r.author_name || (isAgent ? 'Support' : 'You')} size={28} />
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold truncate">
                                {r.author_name || (isAgent
                                  ? (isHi ? 'सपोर्ट टीम' : 'Support team')
                                  : (isHi ? 'आप' : 'You'))}
                              </p>
                              <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                                {formatDateTime(r.created_at, isHi)}
                              </p>
                            </div>
                          </div>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--text-2)' }}>
                            {r.body}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <div className="pt-2">
              <Button variant="ghost" fullWidth onClick={() => router.push('/support')}>
                ← {isHi ? 'सभी टिकट' : 'All tickets'}
              </Button>
            </div>
          </>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
