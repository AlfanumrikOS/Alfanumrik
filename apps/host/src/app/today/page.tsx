'use client';

/**
 * /today — the adaptive "Today" home.
 *
 * Flag-gated by `ff_today_home_v1` (client read via useFeatureFlags). When the
 * flag is OFF we `router.replace('/dashboard')` and render nothing — /today is
 * invisible to current users. When ON we fetch the ordered queue from
 * `GET /api/v2/today` and render `TodayHomeV2` — the sole loaded-state
 * presentation (greeting, resume/focus hero, exam-schedule card, and the rest
 * of the queue as compact rows; see packages/ui/src/today/v2/TodayHomeV2.tsx).
 *
 * The `ff_today_home_v2` flag that used to gate TodayHomeV2 as an additive
 * second render path (alongside an older greeting-strip + focus-card render)
 * has been retired — TodayHomeV2 is unconditional now, gated only by the
 * pre-existing `ff_today_home_v1` reachability flag above.
 *
 * States: loading (Skeleton), error (retry), empty (today.empty + free-practice
 * CTA → /quiz). TodayHomeV2 is code-split (next/dynamic) to keep the page
 * within the P10 bundle budget. No PII in any client log (P13).
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { useAllowedSubjects } from '@alfanumrik/lib/useAllowedSubjects';
import { useTodayQueue } from '@alfanumrik/lib/today/use-today-queue';
import { useExamSchedule } from '@alfanumrik/lib/exams/use-exam-schedule';
import { Skeleton, Button, EmptyState } from '@alfanumrik/ui/ui';
import { calculateLevel } from '@alfanumrik/lib/xp-config';
import { todayCopy } from '@alfanumrik/lib/today/copy';

// The loaded-state presentation is split out of first paint — the page chrome
// (greeting strip + loading/error/empty states) is the only thing in the
// initial bundle.
const TodayHomeV2 = dynamic(() => import('@alfanumrik/ui/today/v2/TodayHomeV2'), {
  loading: () => <Skeleton height={240} rounded="rounded-2xl" />,
});

function LegacyTodayPage() {
  const router = useRouter();
  const { isHi, isLoading, isLoggedIn, snapshot, student } = useAuth();
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
  // studentId in the key ensures different students on the same device get
  // separate cache entries (P13).
  const { data, error, isLoading: todayLoading, mutate } = useTodayQueue(
    flagOn && isLoggedIn ? student?.id : null,
  );

  // Wave B (ff_exam_schedule_v1, default OFF — an independent flag). Fetched
  // under the same gate as the queue itself (flagOn && isLoggedIn) now that
  // TodayHomeV2 is the unconditional loaded-state render. The hook itself
  // already resolves a 404 (flag off server-side too) to `next: null`, so this
  // is harmless when ff_exam_schedule_v1 is off — ExamScheduleCard just
  // renders nothing.
  const { next: nextExam } = useExamSchedule(flagOn && isLoggedIn ? student?.id : null, isHi);

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
      <div className="flex items-start justify-between gap-3">
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {todayCopy('today.heading', isHi)}
        </h1>
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold whitespace-nowrap"
          style={{
            background: 'var(--surface-2)',
            border: '1px solid var(--border)',
            color: 'var(--text-2)',
            minHeight: 44,
          }}
          data-testid="today-view-full-dashboard"
        >
          {isHi ? 'पूरा डैशबोर्ड देखें' : 'Full dashboard'}
        </button>
      </div>
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
  // NOTE (Wave B reconciliation, 2026-08-02): the loading/error/empty states
  // keep this pre-existing `greetingStrip` chrome rather than swapping in
  // TodayHomeV2's own greeting header. The only visual difference from
  // TodayHomeV2's header is the "Full dashboard" button + Level chip
  // (TodayHomeV2 drops both) — not worth a new branch for transient states
  // that resolve in well under a second.
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
        <div role="status">
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
        </div>
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

  // ── Loaded — TodayHomeV2 is the sole /today home presentation. ──
  return (
    <main className="app-container py-6" data-testid="today-loaded">
      <TodayHomeV2
        data={data}
        subjects={subjects}
        isHi={isHi}
        streak={streak}
        totalXp={totalXp}
        nextExam={nextExam}
      />
    </main>
  );
}

export default function TodayPage() {
  return <LegacyTodayPage />;
}
