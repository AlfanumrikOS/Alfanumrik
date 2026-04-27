'use client';

/**
 * /support — list the current user's support tickets and offer a CTA to file a new one.
 *
 * Audit F22 (frontend portion): paid product cannot run without an in-product
 * way for end users to file tickets. Backend implements GET/POST /api/support/tickets;
 * this page consumes that contract.
 *
 * P7 — bilingual: every user-facing string has EN/HI variants via AuthContext.isHi.
 * P10 — bundle: page is small (no heavy deps), uses existing UI primitives.
 */

import { useEffect, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  Card,
  Button,
  LoadingFoxy,
  EmptyState,
  Badge,
  BottomNav,
} from '@/components/ui';
import { CardListSkeleton } from '@/components/Skeleton';

/* ── Types matching backend contract ─────────────────────────── */
type TicketCategory = 'bug' | 'billing' | 'content' | 'account' | 'other';
type TicketPriority = 'low' | 'normal' | 'high';
type TicketStatus = 'open' | 'pending' | 'in_progress' | 'resolved' | 'closed';

interface Ticket {
  ticket_id: string;
  subject: string;
  category: TicketCategory | string;
  priority: TicketPriority | string;
  status: TicketStatus | string;
  created_at: string;
}

interface ListResponse {
  tickets: Ticket[];
  total: number;
}

/* ── Authenticated fetch helper ──────────────────────────────── */
async function authFetch(url: string): Promise<ListResponse> {
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
  const json = await res.json();
  // Accept both `{ tickets, total }` and `{ success, data: { tickets, total } }` shapes.
  if (json?.data?.tickets) return json.data as ListResponse;
  return { tickets: json?.tickets ?? [], total: json?.total ?? 0 };
}

/* ── Display helpers ─────────────────────────────────────────── */
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

function timeAgo(dateStr: string, isHi: boolean): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (Number.isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return isHi ? 'अभी' : 'Just now';
  if (mins < 60) return isHi ? `${mins} मिनट पहले` : `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return isHi ? `${hrs} घंटे पहले` : `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return isHi ? 'कल' : 'Yesterday';
  if (days < 7) return isHi ? `${days} दिन पहले` : `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

/* ── Page ────────────────────────────────────────────────────── */
export default function SupportListPage() {
  const { isLoggedIn, isLoading, isHi } = useAuth();
  const router = useRouter();

  // Auth gate: redirect to /login when unauthenticated.
  useEffect(() => {
    if (!isLoading && !isLoggedIn) router.replace('/login');
  }, [isLoading, isLoggedIn, router]);

  const { data, error, isLoading: swrLoading, mutate } = useSWR<ListResponse>(
    isLoggedIn ? '/api/support/tickets' : null,
    authFetch,
    { revalidateOnFocus: true, dedupingInterval: 5000 },
  );

  // Cross-navigation toast (e.g. "Ticket created" from /support/new, or "Ticket not found" from a 404 detail).
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('alfanumrik_support_toast');
      if (raw) {
        const parsed = JSON.parse(raw) as { type: 'success' | 'error'; message: string };
        if (parsed?.message) setToast(parsed);
        sessionStorage.removeItem('alfanumrik_support_toast');
      }
    } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleRetry = useCallback(() => { mutate(); }, [mutate]);

  if (isLoading) return <LoadingFoxy />;
  if (!isLoggedIn) return <LoadingFoxy />;

  const tickets = data?.tickets ?? [];

  return (
    <div className="mesh-bg min-h-dvh pb-nav">
      <header className="page-header">
        <div className="page-header-inner flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="text-sm"
              style={{ color: 'var(--text-3)' }}
              aria-label={isHi ? 'वापस' : 'Back'}
            >
              ←
            </button>
            <div>
              <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>
                {isHi ? 'सहायता' : 'Support'}
              </h1>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {isHi ? 'आपके सपोर्ट टिकट' : 'Your support tickets'}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            onClick={() => router.push('/support/new')}
            data-testid="support-new-cta"
          >
            + {isHi ? 'नया टिकट' : 'New ticket'}
          </Button>
        </div>
      </header>

      <main className="app-container py-4 space-y-3">
        {toast && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl p-3 text-sm"
            style={{
              background: toast.type === 'success' ? 'rgba(22,163,74,0.08)' : 'rgba(220,38,38,0.08)',
              border: `1px solid ${toast.type === 'success' ? 'rgba(22,163,74,0.25)' : 'rgba(220,38,38,0.25)'}`,
              color: toast.type === 'success' ? '#16A34A' : '#DC2626',
            }}
            data-testid="support-list-toast"
          >
            {toast.message}
          </div>
        )}

        {/* Loading */}
        {swrLoading && !data && (
          <div data-testid="support-loading">
            <CardListSkeleton count={4} />
          </div>
        )}

        {/* Error */}
        {error && !swrLoading && (
          <Card>
            <div className="text-center py-6 px-2">
              <div className="text-3xl mb-2" aria-hidden="true">⚠️</div>
              <h3 className="text-sm font-bold mb-1">
                {isHi ? 'टिकट लोड नहीं हो सके' : 'Could not load tickets'}
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

        {/* Empty */}
        {!swrLoading && !error && tickets.length === 0 && (
          <EmptyState
            icon="📨"
            title={isHi ? 'अभी तक कोई टिकट नहीं' : 'No tickets yet'}
            description={
              isHi
                ? 'मदद चाहिए तो एक बनाएँ।'
                : "Create one if you need help."
            }
            action={
              <Button onClick={() => router.push('/support/new')}>
                {isHi ? 'नया टिकट बनाएँ' : 'Create new ticket'}
              </Button>
            }
          />
        )}

        {/* Ticket list */}
        {!swrLoading && !error && tickets.length > 0 && (
          <ul className="space-y-2" aria-label={isHi ? 'टिकट सूची' : 'Ticket list'}>
            {tickets.map((t) => (
              <li key={t.ticket_id}>
                <button
                  onClick={() => router.push(`/support/${t.ticket_id}`)}
                  className="w-full rounded-2xl p-4 text-left transition-all active:scale-[0.99] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--orange)] focus-visible:ring-offset-2"
                  style={{
                    background: 'var(--surface-1)',
                    border: '1px solid var(--border)',
                  }}
                  data-testid="support-ticket-row"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-1)' }}>
                        {t.subject}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge color={categoryColor(t.category)} size="sm">
                          {categoryLabel(t.category, isHi)}
                        </Badge>
                        <Badge color={statusColor(t.status)} size="sm">
                          {statusLabel(t.status, isHi)}
                        </Badge>
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
                          {timeAgo(t.created_at, isHi)}
                        </span>
                      </div>
                    </div>
                    <span
                      className="text-xs flex-shrink-0 mt-1"
                      style={{ color: 'var(--text-3)' }}
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
