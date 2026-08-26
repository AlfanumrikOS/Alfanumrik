'use client';

/**
 * /today — the default student route and the first screen after login.
 *
 * This module owns the STATE MACHINE. `TodayHomeV2`
 * (packages/ui/src/today/v2/TodayHomeV2.tsx) owns the loaded content tree.
 * Both were rebuilt in place in Phase 4 (2026-08-11); there is deliberately no
 * V3 fork of either.
 *
 * ── Flag ──────────────────────────────────────────────────────────────────
 * `ff_today_home_v1` gates BOTH halves: this page redirects to /dashboard when
 * the client read says OFF, and `GET /api/v2/today` independently returns 404
 * when its server-side read says OFF
 * (apps/host/src/app/api/v2/today/route.ts). Those two reads can disagree
 * (different evaluation contexts, cached client flags, a mid-rollout flip), and
 * the disagreement is exactly the `locked` state below: the page is reachable
 * but the endpoint refuses. That case used to render as "You're all caught
 * up ✅" — telling a student they had finished their day when in fact the
 * server had switched the surface off. It now renders an honest locked state
 * with a working route back to the dashboard.
 *
 * ── The nine states ───────────────────────────────────────────────────────
 *   gate-loading  auth / flags unresolved, or a redirect is imminent
 *   loading       queue in flight, nothing cached          [today-loading]
 *   loaded        a queue with a primary                   [today-loaded]
 *   stale         loaded, but SWR is revalidating over it  (inside TodayHomeV2)
 *   empty         queue resolved to nothing, nothing done today   [today-empty]
 *   complete      queue resolved to nothing, already practised    [today-complete]
 *   insufficient  a queue exists but the model has no signal yet
 *                                                  [today-insufficient-evidence]
 *   error         recoverable fetch failure, with retry    [today-error]
 *   offline       no connection and no cached queue        [today-offline]
 *   locked        endpoint says the surface is off for you [today-locked]
 *
 * `empty` vs `complete` vs `insufficient` are three genuinely different
 * situations and get three different screens: "there is nothing to do",
 * "you already did it", and "we don't know you well enough to say yet".
 * Collapsing them (as the previous single `today-empty` branch did) is what
 * makes a surface feel like it is guessing.
 *
 * ── Telemetry ─────────────────────────────────────────────────────────────
 * /today emitted ZERO analytics events before this phase, which meant there
 * was no evidence on which to ramp its flag. Every state entry now emits
 * `today_state_shown` exactly once, and the loaded surface emits view / CTA /
 * plan / reminder / Foxy events from TodayHomeV2. P13: enums and counts only —
 * never a student id, a deep link, or a chapter title.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useFeatureFlags, useNotifications } from '@alfanumrik/lib/swr';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { useTodayQueue } from '@alfanumrik/lib/today/use-today-queue';
import { useExamSchedule } from '@alfanumrik/lib/exams/use-exam-schedule';
import { deepLinkToHref, todayCopy } from '@alfanumrik/lib/today/copy';
import { track } from '@alfanumrik/lib/analytics';
import { EmptyState, Skeleton } from '@alfanumrik/ui/ui/primitives';
import DashboardGreeting from '@alfanumrik/ui/dashboard/os/DashboardGreeting';
import { Touchable } from '@alfanumrik/ui/responsive/Touchable';

// The loaded-state presentation is split out of first paint — the page chrome
// (greeting + the eight non-loaded states) is all that ships in the initial
// bundle (P10).
const TodayHomeV2 = dynamic(() => import('@alfanumrik/ui/today/v2/TodayHomeV2'), {
  loading: () => <Skeleton className="h-60 w-full" radius="lg" />,
});

/** The state identifiers `today_state_shown` reports. */
type TodayState =
  | 'loading'
  | 'error'
  | 'empty'
  | 'insufficient_evidence'
  | 'offline'
  | 'locked'
  | 'complete';

/** DD-16: `--on-accent` ink is AA-safe on `--accent-warm-strong` only. */
const CTA_SURFACE = { background: 'var(--accent-warm-strong)', color: 'var(--on-accent)' } as const;

/* ── Connectivity ─────────────────────────────────────────────────────────
 * Deliberately NOT `useOfflineState` from packages/lib/src/offline: that hook
 * additionally opens IndexedDB and replays the pending-write queue, which is a
 * meaningful dependency chain to pull into first paint on a read-only surface
 * that only needs to know whether the fetch can succeed.
 *
 * `useSyncExternalStore` rather than useState+useEffect, because the effect
 * version is wrong in a way that matters: it renders one frame believing it is
 * online, so an offline student's first committed state is `error`, and the
 * `today_state_shown` telemetry records a phantom error before correcting
 * itself to `offline`. Every offline session would have looked like a
 * server-side failure in the funnel. uSES reads the real value on the first
 * client render; `getServerSnapshot` keeps SSR/hydration consistent. */
function subscribeToConnectivity(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
const readOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;
const readOfflineOnServer = () => false;

function useIsOffline(): boolean {
  return useSyncExternalStore(subscribeToConnectivity, readOffline, readOfflineOnServer);
}

/** Emit `today_state_shown` once per state ENTRY (not per render). */
function useStateTelemetry(state: TodayState | null) {
  const last = useRef<TodayState | null>(null);
  useEffect(() => {
    if (state === null || last.current === state) return;
    last.current = state;
    track('today_state_shown', { state });
  }, [state]);
}

/** The compact greeting, shared by every state so the page never jumps. */
function Greeting({ isHi }: { isHi: boolean }) {
  return (
    <header className="mb-4" data-testid="today-greeting">
      <h1
        className="text-xl font-bold leading-tight"
        style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
      >
        {todayCopy('today.heading', isHi)}
      </h1>
    </header>
  );
}

/** Greeting + a single centred state block. */
function StateShell({
  testId,
  isHi,
  children,
}: {
  testId: string;
  isHi: boolean;
  children: ReactNode;
}) {
  return (
    <main className="app-container py-6" data-testid={testId}>
      <Greeting isHi={isHi} />
      {children}
    </main>
  );
}

export default function TodayPage() {
  const router = useRouter();
  const { isHi, isLoading, isLoggedIn, snapshot, student } = useAuth();
  const { data: flags, isLoading: flagsLoading } = useFeatureFlags();
  const { subjects } = useAllowedSubjects();
  const isOffline = useIsOffline();

  const flagOn = flags?.ff_today_home_v1 === true;
  const gated = flagOn && isLoggedIn;

  // Auth + flag gate. While auth/flags resolve we hold (skeleton below).
  useEffect(() => {
    if (isLoading || flagsLoading) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    if (!flagOn) router.replace('/dashboard');
  }, [isLoading, flagsLoading, isLoggedIn, flagOn, router]);

  // studentId in the SWR key keeps two students on one device apart (P13).
  const {
    data,
    error,
    isLoading: todayLoading,
    isValidating,
    mutate,
  } = useTodayQueue(gated ? student?.id : null);

  // The next test inside seven days. Independent flag (ff_exam_schedule_v1,
  // default OFF) — the hook resolves a 404 to no entries, so this is simply
  // absent when off and the reminder falls through to the next candidate.
  const { thisWeek } = useExamSchedule(gated ? student?.id : null, isHi);
  const nextExam = thisWeek[0] ?? null;

  // Unread updates feed the lowest-priority reminder. A FAILED read must not
  // become "0 unread" — `useNotifications` surfaces failure as `error`, so we
  // pass null in that case and the reminder is omitted rather than fabricated.
  const { data: notifications, error: notificationsError } = useNotifications(
    gated ? student?.id : undefined,
  );
  const unreadCount =
    notificationsError || !notifications ? null : (notifications.unread_count ?? null);

  const retry = useCallback(
    (from: 'error' | 'offline') => {
      track('today_retry_clicked', { state: from });
      void mutate();
    },
    [mutate],
  );

  // ── Resolve the state ONCE, so telemetry and rendering can never disagree.
  const preGate = isLoading || flagsLoading || !isLoggedIn || !flagOn;
  const hasQueue = !!data && data.queue.length > 0;

  let state: TodayState | null = null;
  if (!preGate) {
    if (todayLoading && !data) state = 'loading';
    else if (isOffline && !data) state = 'offline';
    else if (error) state = 'error';
    else if (data === null || data === undefined) state = 'locked';
    else if (!hasQueue) state = data.meta.practicedToday ? 'complete' : 'empty';
    else if (data.meta.masterySubjectCount === 0 && data.primary.type === 'cold_start_diagnostic')
      state = 'insufficient_evidence';
  }
  useStateTelemetry(state);

  // ── Pre-gate: resolving auth/flags, or a redirect is imminent. ──
  if (preGate) {
    return (
      <main className="app-container py-6" data-testid="today-gate-loading">
        <Skeleton className="mb-4 h-7 w-2/5" radius="lg" />
        <Skeleton className="mb-4 h-40 w-full" radius="lg" />
        <Skeleton className="h-16 w-full" radius="lg" />
      </main>
    );
  }

  // ── Loading the queue. ──
  if (state === 'loading') {
    return (
      <main className="app-container py-6" data-testid="today-loading">
        <Greeting isHi={isHi} />
        <p className="sr-only" role="status">
          {todayCopy('today.state.loading', isHi)}
        </p>
        <Skeleton className="mb-3 h-44 w-full" radius="lg" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16 w-full" radius="lg" />
          <Skeleton className="h-16 w-full" radius="lg" />
          <Skeleton className="h-16 w-full" radius="lg" />
        </div>
      </main>
    );
  }

  // ── Offline / interrupted — no connection AND no cached queue. ──
  if (state === 'offline') {
    return (
      <StateShell testId="today-offline" isHi={isHi}>
        <EmptyState
          role="alert"
          icon="📡"
          title={todayCopy('today.state.offline.title', isHi)}
          description={todayCopy('today.state.offline.body', isHi)}
          action={
            <Touchable
              onClick={() => retry('offline')}
              className="gap-1.5 rounded-xl px-4 text-base font-bold"
              style={CTA_SURFACE}
              data-testid="today-offline-retry"
            >
              <span aria-hidden="true">🔄</span>
              {todayCopy('today.state.offline.cta', isHi)}
            </Touchable>
          }
        />
      </StateShell>
    );
  }

  // ── Recoverable error, with a retry that actually retries. ──
  if (state === 'error') {
    return (
      <StateShell testId="today-error" isHi={isHi}>
        <EmptyState
          role="alert"
          icon="⚠️"
          title={todayCopy('today.state.error.title', isHi)}
          description={todayCopy('today.state.error.body', isHi)}
          action={
            <Touchable
              onClick={() => retry('error')}
              className="gap-1.5 rounded-xl px-4 text-base font-bold"
              style={CTA_SURFACE}
              data-testid="today-error-retry"
            >
              <span aria-hidden="true">🔄</span>
              {todayCopy('today.state.error.cta', isHi)}
            </Touchable>
          }
        />
      </StateShell>
    );
  }

  // ── Locked / unavailable — the endpoint 404s (flag off server-side). ──
  if (state === 'locked' || !data) {
    return (
      <StateShell testId="today-locked" isHi={isHi}>
        <EmptyState
          role="alert"
          icon="🔒"
          title={todayCopy('today.state.locked.title', isHi)}
          description={todayCopy('today.state.locked.body', isHi)}
          action={
            <Touchable
              as="a"
              href="/dashboard"
              className="gap-1.5 rounded-xl px-4 text-base font-bold"
              style={CTA_SURFACE}
              data-testid="today-locked-cta"
            >
              {todayCopy('today.state.locked.cta', isHi)}
            </Touchable>
          }
        />
      </StateShell>
    );
  }

  // ── Completion — the plan resolved to nothing BECAUSE it was finished. ──
  if (state === 'complete') {
    return (
      <StateShell testId="today-complete" isHi={isHi}>
        <EmptyState
          icon="✅"
          title={todayCopy('today.state.complete.title', isHi)}
          description={todayCopy('today.state.complete.body', isHi)}
          action={
            <Touchable
              as="a"
              href="/quiz"
              className="gap-1.5 rounded-xl px-4 text-base font-bold"
              style={CTA_SURFACE}
              data-testid="today-complete-cta"
            >
              {todayCopy('today.state.complete.cta', isHi)}
            </Touchable>
          }
        />
      </StateShell>
    );
  }

  // ── Empty — nothing queued, and nothing done today either. ──
  if (state === 'empty') {
    return (
      <StateShell testId="today-empty" isHi={isHi}>
        <EmptyState
          icon="🗂️"
          title={todayCopy('today.empty', isHi)}
          action={
            <Touchable
              as="a"
              href="/quiz"
              className="gap-1.5 rounded-xl px-4 text-base font-bold"
              style={CTA_SURFACE}
              data-testid="today-empty-practice"
            >
              {todayCopy('today.empty.cta', isHi)}
            </Touchable>
          }
        />
      </StateShell>
    );
  }

  // ── Insufficient evidence — DISTINCT from empty. There is an action, but
  //    the model has no signal for this learner yet, so we say so instead of
  //    dressing a cold-start diagnostic up as a personalised recommendation.
  if (state === 'insufficient_evidence') {
    return (
      <StateShell testId="today-insufficient-evidence" isHi={isHi}>
        <EmptyState
          icon="🧭"
          title={todayCopy('today.state.insufficient.title', isHi)}
          description={todayCopy('today.state.insufficient.body', isHi)}
          action={
            <Touchable
              onClick={() => {
                track('today_primary_cta_clicked', {
                  type: data.primary.type,
                  reason: data.primary.reason,
                });
                router.push(deepLinkToHref(data.primary.deepLink));
              }}
              className="gap-1.5 rounded-xl px-4 text-base font-bold"
              style={CTA_SURFACE}
              data-testid="today-insufficient-cta"
            >
              {todayCopy('today.state.insufficient.cta', isHi)}
            </Touchable>
          }
        />
      </StateShell>
    );
  }

  // ── Loaded. `isValidating` over existing data is the partial/stale case;
  //    TodayHomeV2 shows the notice rather than silently serving an old plan.
  return (
    <main className="app-container py-6" data-testid="today-loaded">
      <DashboardGreeting
        studentName={student?.name ?? ''}
        streak={snapshot?.current_streak ?? 0}
        totalXp={snapshot?.total_xp ?? 0}
        isHi={isHi}
      />
      <TodayHomeV2
        data={data}
        subjects={subjects}
        isHi={isHi}
        streak={snapshot?.current_streak ?? 0}
        totalXp={snapshot?.total_xp ?? 0}
        nextExam={nextExam}
        unreadCount={unreadCount}
        isStale={isValidating}
      />
    </main>
  );
}
