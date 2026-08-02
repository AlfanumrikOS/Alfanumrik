'use client';

/**
 * /tests — the full "Tests & deadlines" surface (Wave B).
 *
 * Flag-gated by `ff_exam_schedule_v1`, the same shape `/today` uses for
 * `ff_today_home_v1` (client read via useFeatureFlags; while the flag is off
 * we `router.replace('/today')` and render nothing). `/today` is this route's
 * closest analog in this repo — a single top-level `page.tsx` with no
 * `layout.tsx`/`loading.tsx`/`error.tsx`, loading/error/empty handled inline
 * — so this file mirrors that structure rather than the `layout.tsx`-per-route
 * pattern `/dive` and `/synthesis` use.
 *
 * `GET /api/v2/exam-schedule` independently 404s when the flag is off, so
 * this page has no real data to show even if reached directly; `useExamSchedule`
 * resolves that 404 to empty `thisWeek`/`later` arrays rather than an error.
 *
 * `onAdd` / `onEdit` are wired to a dismissible inline "coming soon" message,
 * not a real form: the write path for `student_exam_entries` was never built
 * in this pass (the handoff only ever shipped the GET read route) — building
 * a full add/edit form is new scope beyond what was reviewed. This mirrors
 * the existing hand-rolled "temporary banner + setTimeout" convention already
 * used for this exact kind of transient message elsewhere in the app (e.g.
 * `/dive`'s `pickerError`, `/super-admin/institutions`' `pauseToast`) rather
 * than the separate `<ToastProvider>`/`useToast()` primitive, which today has
 * no real (non-dev-page) callers in this codebase and would need its own
 * provider mounted per-tree to introduce here.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { useFeatureFlags } from '@alfanumrik/lib/swr';
import { useExamSchedule } from '@alfanumrik/lib/exams/use-exam-schedule';
import { Skeleton, Button, EmptyState } from '@alfanumrik/ui/ui';
import { ExamScheduleList } from '@alfanumrik/ui/exams/v2/ExamSchedule';

function TestsPageInner() {
  const router = useRouter();
  const { isHi, isLoading, isLoggedIn, student } = useAuth();
  const { data: flags, isLoading: flagsLoading } = useFeatureFlags();
  const [comingSoon, setComingSoon] = useState(false);

  const flagOn = flags?.ff_exam_schedule_v1 === true;

  // Auth + flag gate — same shape as /today's own gate.
  useEffect(() => {
    if (isLoading || flagsLoading) return;
    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }
    if (!flagOn) {
      router.replace('/today');
    }
  }, [isLoading, flagsLoading, isLoggedIn, flagOn, router]);

  // Only fetch once we know the flag is ON and the user is logged in.
  const {
    thisWeek,
    later,
    error,
    isLoading: scheduleLoading,
    mutate,
  } = useExamSchedule(flagOn && isLoggedIn ? student?.id : null, isHi);

  // ── Pre-gate render: while resolving auth/flags, or about to redirect. ──
  if (isLoading || flagsLoading || !isLoggedIn || !flagOn) {
    return (
      <main className="app-container py-6" data-testid="tests-gate-loading">
        <Skeleton height={28} width="40%" className="mb-4" />
        <Skeleton height={96} rounded="rounded-2xl" className="mb-3" />
        <Skeleton height={96} rounded="rounded-2xl" />
      </main>
    );
  }

  const showComingSoon = () => {
    setComingSoon(true);
    setTimeout(() => setComingSoon(false), 4000);
  };

  // ── Loading the schedule ──
  if (scheduleLoading) {
    return (
      <main className="app-container py-6" data-testid="tests-loading">
        <Skeleton height={28} width="50%" className="mb-4" />
        <div className="flex flex-col gap-3">
          <Skeleton height={96} rounded="rounded-2xl" />
          <Skeleton height={96} rounded="rounded-2xl" />
        </div>
      </main>
    );
  }

  // ── Error ──
  if (error) {
    return (
      <main className="app-container py-6" data-testid="tests-error">
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

  // ── Loaded. Empty state (no entries at all) is handled inside
  //    ExamScheduleList itself (data-testid="exam-schedule-empty"). ──
  return (
    <main className="app-container py-6" data-testid="tests-loaded">
      {comingSoon && (
        <div
          role="status"
          className="rounded-2xl px-4 py-3 text-sm font-semibold mb-3"
          style={{
            background: 'rgb(var(--orange-rgb) / 0.08)',
            border: '1px solid rgb(var(--orange-rgb) / 0.2)',
            color: 'var(--orange)',
          }}
          data-testid="tests-coming-soon"
        >
          {isHi
            ? 'अपनी तारीख जोड़ना/बदलना जल्द आ रहा है।'
            : 'Adding or editing your own dates is coming soon.'}
        </div>
      )}
      <ExamScheduleList
        thisWeek={thisWeek}
        later={later}
        isHi={isHi}
        onAdd={showComingSoon}
        onEdit={showComingSoon}
      />
    </main>
  );
}

export default function TestsPage() {
  return <TestsPageInner />;
}
