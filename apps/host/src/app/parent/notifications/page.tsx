'use client';

/**
 * /parent/notifications — Phase C.5
 *
 * In-app notification center for parents. Paired with three API routes
 * under /api/parent/notifications/*. Polling-only (30s) — Supabase
 * Realtime hooks land in C.6.
 *
 * UX:
 *   - All / Unread filter tabs (URL ?filter=unread).
 *   - Mark all as read CTA (disabled while no unread rows).
 *   - Per-row expand to show full message body.
 *   - Empty state ("you're all caught up").
 *   - Bilingual (English / Hindi) via AuthContext.isHi.
 *   - Mobile responsive: stacks single-column under md:.
 */

import { useState, useCallback, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';
import { Alert } from '@alfanumrik/ui/ui/primitives';
import type { ParentNotificationRow } from '@/app/api/parent/notifications/route';

const POLL_MS = 30_000;

interface ListResponse {
  success: boolean;
  items: ParentNotificationRow[];
  nextCursor: string | null;
  unreadCount: number;
  error?: string;
}

async function authedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`;
  } catch {
    // Anonymous request — server will respond 401.
  }
  return fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
}

const fetcher = async (url: string): Promise<ListResponse> => {
  const res = await authedFetch(url);
  if (!res.ok) throw new Error(`parent-notifications.fetch_failed:${res.status}`);
  const json = (await res.json()) as ListResponse;
  if (!json.success) throw new Error(json.error || 'parent-notifications.invalid_body');
  return json;
};

function t(isHi: boolean, en: string, hi: string) {
  return isHi ? hi : en;
}

function relativeTime(iso: string, isHi: boolean): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return t(isHi, 'just now', 'अभी');
  if (min < 60) return t(isHi, `${min}m ago`, `${min} मिनट पहले`);
  const hr = Math.floor(min / 60);
  if (hr < 24) return t(isHi, `${hr}h ago`, `${hr} घंटे पहले`);
  const day = Math.floor(hr / 24);
  if (day < 7) return t(isHi, `${day}d ago`, `${day} दिन पहले`);
  return new Date(iso).toLocaleDateString(isHi ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'short',
  });
}

function ParentNotificationsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isHi } = useAuth();
  const filter = searchParams?.get('filter') === 'unread' ? 'unread' : 'all';
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);

  const key = `/api/parent/notifications?filter=${filter}`;
  const { data, error, isLoading, mutate } = useSWR<ListResponse>(key, fetcher, {
    refreshInterval: POLL_MS,
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const unreadCount = data?.unreadCount ?? 0;

  const setFilter = useCallback(
    (next: 'all' | 'unread') => {
      const sp = new URLSearchParams(searchParams?.toString() ?? '');
      if (next === 'all') sp.delete('filter');
      else sp.set('filter', 'unread');
      const qs = sp.toString();
      router.replace(qs ? `/parent/notifications?${qs}` : '/parent/notifications');
    },
    [router, searchParams],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const markOne = useCallback(
    async (id: string) => {
      // Optimistic — flip is_read locally, then revalidate.
      await mutate(
        prev => {
          if (!prev) return prev;
          return {
            ...prev,
            items: prev.items.map(it =>
              it.id === id ? { ...it, is_read: true, read_at: new Date().toISOString() } : it,
            ),
            unreadCount: Math.max(0, prev.unreadCount - 1),
          };
        },
        { revalidate: false },
      );
      try {
        const res = await authedFetch(`/api/parent/notifications/${id}/read`, { method: 'PATCH' });
        if (!res.ok) throw new Error(`mark_read_failed:${res.status}`);
      } finally {
        mutate();
      }
    },
    [mutate],
  );

  const markAll = useCallback(async () => {
    if (marking || unreadCount === 0) return;
    setMarking(true);
    try {
      await authedFetch('/api/parent/notifications/mark-all-read', { method: 'POST' });
      await mutate();
    } finally {
      setMarking(false);
    }
  }, [marking, unreadCount, mutate]);

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 md:pt-10">
      <header className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground md:text-2xl">
            {t(isHi, 'Notifications', 'सूचनाएँ')}
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              isHi,
              "Updates about your child's learning",
              'आपके बच्चे की पढ़ाई से जुड़ी सूचनाएँ',
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={markAll}
          disabled={unreadCount === 0 || marking}
          aria-label={t(isHi, 'Mark all as read', 'सभी को पढ़ा हुआ चिह्नित करें')}
          data-testid="mark-all-read"
          className="self-start rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 md:self-auto"
        >
          {marking
            ? t(isHi, 'Marking…', 'चिह्नित कर रहे हैं…')
            : t(isHi, 'Mark all as read', 'सभी पढ़ा हुआ चिह्नित करें')}
        </button>
      </header>

      <div role="tablist" className="mb-4 flex gap-1 border-b border-surface-3">
        <FilterTab
          label={t(isHi, 'All', 'सभी')}
          active={filter === 'all'}
          onClick={() => setFilter('all')}
          testId="filter-all"
        />
        <FilterTab
          label={
            unreadCount > 0
              ? `${t(isHi, 'Unread', 'अपठित')} (${unreadCount})`
              : t(isHi, 'Unread', 'अपठित')
          }
          active={filter === 'unread'}
          onClick={() => setFilter('unread')}
          testId="filter-unread"
        />
      </div>

      {isLoading && !data ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {t(isHi, 'Loading…', 'लोड हो रहा है…')}
        </div>
      ) : error ? (
        <Alert tone="danger">
          {t(isHi, "Couldn't load notifications. Please refresh.", 'सूचनाएँ लोड नहीं हो सकीं। कृपया रिफ्रेश करें।')}
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState isHi={isHi} filter={filter} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="notifications-list">
          {items.map(item => (
            <NotificationRow
              key={item.id}
              item={item}
              expanded={expanded.has(item.id)}
              onToggle={() => {
                toggleExpand(item.id);
                if (!item.is_read) {
                  // Mark-read on first expand so a parent who simply reads
                  // their queue doesn't have to also tap "mark read".
                  void markOne(item.id);
                }
              }}
              onMarkRead={() => markOne(item.id)}
              isHi={isHi}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Subcomponents ───────────────────────────────────────────────────────

function FilterTab({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      data-testid={testId}
      onClick={onClick}
      className={[
        'border-b-2 px-3 py-2 text-sm font-medium transition-colors',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      ].join(' ')}
    >
      {label}
    </button>
  );
}

function EmptyState({ isHi, filter }: { isHi: boolean; filter: 'all' | 'unread' }) {
  return (
    <div
      data-testid="notifications-empty"
      className="rounded-lg border border-dashed border-surface-3 bg-surface-1 px-6 py-12 text-center"
    >
      <div className="mb-2 text-2xl" aria-hidden="true">
        ✓
      </div>
      <div className="text-base font-semibold text-foreground">
        {filter === 'unread'
          ? t(isHi, "You're all caught up", 'सब कुछ पढ़ लिया है')
          : t(isHi, 'No notifications yet', 'अभी कोई सूचना नहीं')}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(
          isHi,
          "We'll let you know when something needs your attention.",
          'जब भी कुछ ध्यान देने योग्य होगा, हम आपको बता देंगे।',
        )}
      </p>
    </div>
  );
}

function NotificationRow({
  item,
  expanded,
  onToggle,
  onMarkRead,
  isHi,
}: {
  item: ParentNotificationRow;
  expanded: boolean;
  onToggle: () => void;
  onMarkRead: () => void;
  isHi: boolean;
}) {
  const longBody = item.body && item.body.length > 0 ? item.body : item.message;
  return (
    <li
      data-testid={`notification-row-${item.id}`}
      data-unread={!item.is_read}
      className={[
        'rounded-lg border bg-surface-1 px-4 py-3 transition-colors',
        item.is_read ? 'border-surface-3' : 'border-primary bg-surface-2',
      ].join(' ')}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start gap-3 text-left"
        aria-expanded={expanded}
      >
        <span
          aria-hidden="true"
          className={[
            'mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full',
            item.is_read ? 'bg-transparent' : 'bg-primary',
          ].join(' ')}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <div
              className={[
                'truncate text-sm',
                item.is_read ? 'font-medium text-[color-mix(in_srgb,var(--text-1)_80%,transparent)]' : 'font-semibold text-foreground',
              ].join(' ')}
            >
              {item.title}
            </div>
            <div className="flex-shrink-0 text-2xs text-muted-foreground">
              {relativeTime(item.created_at, isHi)}
            </div>
          </div>
          {!expanded && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {item.message}
            </div>
          )}
        </div>
      </button>

      {expanded && (
        <div className="mt-2 pl-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-[color-mix(in_srgb,var(--text-1)_90%,transparent)]">
            {longBody}
          </p>
          {!item.is_read && (
            <button
              type="button"
              onClick={onMarkRead}
              data-testid={`mark-read-${item.id}`}
              className="mt-2 text-2xs font-medium text-primary hover:text-primary"
            >
              {t(isHi, 'Mark as read', 'पढ़ा हुआ चिह्नित करें')}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

export default function ParentNotificationsPage() {
  return (
    <Suspense>
      <ParentNotificationsContent />
    </Suspense>
  );
}
