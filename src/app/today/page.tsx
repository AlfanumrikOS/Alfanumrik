'use client';

/**
 * /today — the adaptive "Today" home (Consumer Minimalism Wave A).
 *
 * Flag-gated by `ff_today_home_v1` (client read via useFeatureFlags). When the
 * flag is OFF we `router.replace('/dashboard')` and render nothing — /today is
 * invisible to current users. When ON we fetch the ordered queue from
 * `GET /api/v2/today` and render:
 *   - a greeting strip with streak + total XP (reuses the SAME AuthContext
 *     snapshot the dashboard hero reads — no new stats endpoint),
 *   - the primary "Today's focus" card,
 *   - the rest of the queue as compact rows.
 *
 * States: loading (Skeleton), error (retry), empty (today.empty + free-practice
 * CTA → /quiz). The heavy item components are code-split (next/dynamic) to keep
 * the page within the P10 bundle budget. No PII in any client log (P13).
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useAuth } from '@/lib/AuthContext';
import { useFeatureFlags } from '@/lib/swr';
import { useAllowedSubjects } from '@/lib/useAllowedSubjects';
import { authHeader } from '@/lib/api/auth-header';
import { Skeleton, Button, EmptyState } from '@/components/ui';
import { calculateLevel } from '@/lib/xp-config';
import { todayCopy } from '@/lib/today/copy';
import type { TodayResponse } from '@/lib/today/types';

// Item cards are split out of first paint — the page chrome (greeting strip +
// states) is the only thing in the initial bundle.
const TodayFocusCard = dynamic(() => import('@/components/today/TodayFocusCard'), {
  loading: () => <Skeleton height={140} rounded="rounded-2xl" />,
});
const TodayQueueItem = dynamic(() => import('@/components/today/TodayQueueItem'), {
  loading: () => <Skeleton height={68} rounded="rounded-2xl" />,
});

/** SWR fetcher for the Today BFF. 404 = flag off / no profile → null (caller
 *  routes to /dashboard). Other non-OK = throw so SWR surfaces the error state. */
async function fetchToday(): Promise<TodayResponse | null> {
  const res = await fetch('/api/v2/today', {
    credentials: 'same-origin',
    headers: { ...(await authHeader()) },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const error = new Error('today.fetch_failed') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return (await res.json()) as TodayResponse;
}

export default function TodayPage() {
  const router = useRouter();
  const { isHi, isLoading, isLoggedIn, snapshot } = useAuth();
  const { data: flags, isLoading: flagsLoading } = useFeatureFlags();
  const { subjects } = useAllowedSubjects();

  const flagOn = flags?.ff_today_home_v1 === true;

  // Auth + flag gate. While auth/flags resolve we hold (skeleton below).
  useEffect(() => {
    if (isLoading || flagsLoading) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    if (!flagOn) {
      router.replace('/dashboard');
    }
  }, [isLoading, flagsLoading, isLoggedIn, flagOn, router]);

  // Only fetch once we know the flag is ON and the user is logged in.
  const { data, error, isLoading: todayLoading, mutate } = useSWR<TodayResponse | null>(
    flagOn && isLoggedIn ? 'v2/today' : null,
    fetchToday,
    { revalidateOnFocus: false, dedupingInterval: 5000 },
  );

  // ── Pre-gate render: while resolving auth/flags, or about to redirect. ──
  if (isLoading || flagsLoading || !isLoggedIn || !flagOn) {
    return (
      <main className="app-container py-6" data-testid="today-gate-loading">
        <Skeleton height={28} width="40%" className="mb-4" />
        <Skeleton height={64} rounded="rounded-2xl" className="mb-4" />
        <Skeleton height={140} rounded="rounded-2xl" />
      </main>
    );
  }

  const streak = snapshot?.current_streak ?? 0;
  const totalXp = snapshot?.total_xp ?? 0;
  const level = calculateLevel(totalXp);

  // ── Greeting strip — same snapshot source the dashboard hero uses. ──
  const greetingStrip = (
    <header className="mb-5" data-testid="today-greeting">
      <h1
        className="text-2xl font-bold"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
      >
        {todayCopy('today.heading', isHi)}
      </h1>
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <span
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold"
          style={{
            background: streak > 0 ? 'rgb(var(--orange-rgb) / 0.08)' : 'var(--surface-2)',
            border: `1px solid ${streak > 0 ? 'rgb(var(--orange-rgb) / 0.2)' : 'var(--border)'}`,
            color: streak > 0 ? 'var(--orange)' : 'var(--text-3)',
          }}
        >
          <span aria-hidden="true">🔥</span>
          {streak}
          <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'दिन' : streak === 1 ? 'day' : 'days'}
          </span>
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          {totalXp.toLocaleString('en-IN')}
          <span className="text-xs font-medium" style={{ color: 'var(--text-3)' }}>XP</span>
        </span>
        <span
          className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-bold"
          style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', color: 'var(--text-1)' }}
        >
          {isHi ? 'स्तर' : 'Level'} {level}
        </span>
      </div>
    </header>
  );

  // ── Loading the queue ──
  if (todayLoading) {
    return (
      <main className="app-container py-6" data-testid="today-loading">
        {greetingStrip}
        <Skeleton height={140} rounded="rounded-2xl" className="mb-3" />
        <div className="flex flex-col gap-2">
          <Skeleton height={68} rounded="rounded-2xl" />
          <Skeleton height={68} rounded="rounded-2xl" />
          <Skeleton height={68} rounded="rounded-2xl" />
        </div>
      </main>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <main className="app-container py-6" data-testid="today-error">
        {greetingStrip}
        <EmptyState
          icon="😕"
          title={isHi ? 'अभी लोड नहीं हो पाया' : "Couldn't load this right now"}
          description={isHi ? 'थोड़ी देर में फिर कोशिश करें।' : 'Please try again in a moment.'}
          action={
            <Button variant="soft" onClick={() => mutate()}>
              {isHi ? 'फिर कोशिश करें' : 'Retry'}
            </Button>
          }
        />
      </main>
    );
  }

  // ── Empty — no items in the queue (data null OR empty queue). ──
  const queue = data?.queue ?? [];
  if (!data || queue.length === 0) {
    return (
      <main className="app-container py-6" data-testid="today-empty">
        {greetingStrip}
        <EmptyState
          icon="✅"
          title={todayCopy('today.empty', isHi)}
          action={
            <Button variant="primary" onClick={() => router.push('/quiz')} data-testid="today-empty-practice">
              {isHi ? 'मुफ़्त अभ्यास शुरू करें' : 'Start free practice'}
            </Button>
          }
        />
      </main>
    );
  }

  // ── Loaded — primary focus card + the rest of the queue. ──
  const primary = data.primary;
  const rest = queue.slice(1);

  return (
    <main className="app-container py-6" data-testid="today-loaded">
      {greetingStrip}

      <div className="mb-4">
        <TodayFocusCard item={primary} subjects={subjects} isHi={isHi} />
      </div>

      {rest.length > 0 && (
        <section aria-label={todayCopy('today.heading', isHi)} className="flex flex-col gap-2">
          {rest.map((item) => (
            <TodayQueueItem
              key={`${item.rank}-${item.type}`}
              item={item}
              subjects={subjects}
              isHi={isHi}
            />
          ))}
        </section>
      )}
    </main>
  );
}
