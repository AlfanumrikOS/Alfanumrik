'use client';

/**
 * TodayHomeV2 — Wave B presentation for the /today home.
 *
 * PRESENTATION ONLY. It renders a `TodayResponse` that the page already
 * fetched with the existing `useTodayQueue` hook (GET /api/v2/today). No new
 * endpoint, no new hook, no scoring/XP/schema change. Every value on screen is
 * derived from the render DTO in `@alfanumrik/lib/today/types` or from the
 * AuthContext snapshot the page passes in.
 *
 * What changes vs Wave A (deliberate, from the student-side design review):
 *   1. RESUME IS FIRST. When `primary.type === 'resume_in_progress'` the hero
 *      is a dark, high-contrast "you left off" card with the continue action as
 *      the only primary button. Interruption recovery outranks everything else.
 *   2. ONE primary action per screen. Non-primary queue rows stay as the
 *      existing compact `TodayQueueItem` rows (reused unchanged).
 *   3. No raw mastery numbers in the hero — the loop's own copy keys are used.
 *   4. Streak is demoted to a quiet chip; the streak-at-risk alert is kept
 *      because it is actionable.
 *   5. The exam-schedule card (ff_exam_schedule_v1, independent flag) sits
 *      above the hero — the test is the reason a student is here this week,
 *      but a resume-in-progress session still finishes first. Renders
 *      nothing when `nextExam` is absent (flag off, or no exam on record).
 *
 * Copy: every string routes through `todayCopy` / `resolveItemCopy` (P7).
 * Colour: existing tokens only (--orange, --green, --purple, --surface-*,
 * --text-*, --border, --font-display). No new design tokens.
 *
 * `ExamScheduleEntry` comes from `@alfanumrik/lib/exams/types` (lib owns the
 * DTO); `ExamScheduleCard` is the presentation component from
 * `@alfanumrik/ui/exams/v2/ExamSchedule` — same lib/ui split `today/types.ts`
 * already establishes for this page's own primary DTO.
 */

import { useEffect, useRef, useState, type Ref } from 'react';
import { useRouter } from 'next/navigation';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import type { TodayResponse, TodayQueueItem as TodayQueueItemDTO } from '@alfanumrik/lib/today/types';
import { todayCopy, deepLinkToHref } from '@alfanumrik/lib/today/copy';
import { todayIcon } from '@alfanumrik/lib/today/icon-map';
import { resolveItemCopy, isTeacherAssigned, fromTeacherLabel } from '@alfanumrik/lib/today/render';
import TodayQueueItem from '@alfanumrik/ui/today/TodayQueueItem';
import { Button, EmptyState } from '@alfanumrik/ui/ui';
import type { ExamScheduleEntry } from '@alfanumrik/lib/exams/types';
import { ExamScheduleCard } from '@alfanumrik/ui/exams/v2/ExamSchedule';

interface TodayHomeV2Props {
  data: TodayResponse;
  subjects: Subject[];
  isHi: boolean;
  streak: number;
  totalXp: number;
  /** Next test, when ff_exam_schedule_v1 is on and one exists. Omitted otherwise —
   *  the card simply does not render. */
  nextExam?: ExamScheduleEntry | null;
}

/** The dark "pick up where you left off" hero. Only rendered for a genuine
 *  `resume_in_progress` item — never synthesised. "Later" dismisses the prompt
 *  for this visit (no navigation): the session is still in progress server-side,
 *  so the next /today read re-offers it. */
function ResumeHero({
  item,
  subjects,
  isHi,
  onLater,
}: {
  item: TodayQueueItemDTO;
  subjects: Subject[];
  isHi: boolean;
  onLater: () => void;
}) {
  const router = useRouter();
  const { label, subtitle } = resolveItemCopy(item, subjects, isHi);

  return (
    <section
      data-testid="today-v2-resume-hero"
      className="rounded-2xl p-5 mb-4"
      style={{ background: 'var(--text-1)', color: 'var(--surface-1, #fff)' }}
    >
      <p
        className="text-[11px] font-extrabold uppercase tracking-wider"
        style={{ color: 'var(--orange)' }}
      >
        {todayCopy('today.item.resume_in_progress.label', isHi)}
      </p>
      <h2
        className="text-lg font-bold leading-snug mt-2"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {label}
      </h2>
      <p className="text-sm mt-1.5 leading-relaxed" style={{ opacity: 0.65 }}>
        {subtitle}
      </p>
      <div className="flex items-center gap-2.5 mt-4">
        <button
          type="button"
          onClick={() => router.push(deepLinkToHref(item.deepLink))}
          className="flex-[2] rounded-xl text-sm font-bold"
          style={{ background: 'var(--accent-warm-strong)', color: 'var(--on-accent)', minHeight: 48 }}
          data-testid="today-v2-resume-continue"
        >
          {isHi ? 'यहीं से जारी रखें' : 'Pick up here'}
        </button>
        <button
          type="button"
          onClick={onLater}
          className="flex-1 rounded-xl text-sm font-semibold"
          style={{
            border: '1px solid rgb(255 255 255 / 0.28)',
            color: 'rgb(255 255 255 / 0.82)',
            minHeight: 48,
          }}
          data-testid="today-v2-resume-later"
        >
          {isHi ? 'बाद में' : 'Later'}
        </button>
      </div>
    </section>
  );
}

/** The standard hero for every non-resume primary item. Same information as
 *  Wave A's TodayFocusCard, restyled to the one-primary-action rule.
 *  `ctaRef` lets the parent move focus to the primary CTA after the resume
 *  hero is dismissed (a11y floor — the dismissed button would otherwise drop
 *  focus to body). */
function FocusHero({
  item,
  subjects,
  isHi,
  ctaRef,
}: {
  item: TodayQueueItemDTO;
  subjects: Subject[];
  isHi: boolean;
  ctaRef?: Ref<HTMLButtonElement>;
}) {
  const router = useRouter();
  const { label, subtitle, minutesBadge } = resolveItemCopy(item, subjects, isHi);
  const teacherAssigned = isTeacherAssigned(item);
  const accent = teacherAssigned ? 'var(--purple)' : 'var(--orange)';

  return (
    <section
      data-testid="today-v2-focus-hero"
      className="rounded-2xl p-5 mb-4"
      style={{ background: 'var(--surface-1, #fff)', border: `1px solid ${accent}` }}
    >
      {teacherAssigned && (
        <span
          data-testid="today-from-teacher-tag"
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider mb-3"
          style={{
            background: 'rgb(var(--purple-rgb, 124 58 237) / 0.10)',
            color: 'var(--purple)',
            border: '1px solid rgb(var(--purple-rgb, 124 58 237) / 0.20)',
          }}
        >
          <span aria-hidden="true">👩‍🏫</span>
          {fromTeacherLabel(isHi)}
        </span>
      )}
      <div className="flex items-start gap-4">
        <div
          className="rounded-2xl flex items-center justify-center flex-shrink-0"
          style={{
            width: 52,
            height: 52,
            background: 'rgb(var(--orange-rgb) / 0.10)',
            fontSize: 24,
            lineHeight: 1,
          }}
          aria-hidden="true"
        >
          {todayIcon(item.iconHint)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-3)' }}>
            {todayCopy('today.focus', isHi)}
          </p>
          <h2
            className="text-lg font-bold leading-snug"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
          >
            {label}
          </h2>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            {subtitle}
          </p>
        </div>
      </div>
      <button
        ref={ctaRef}
        type="button"
        onClick={() => router.push(deepLinkToHref(item.deepLink))}
        className="w-full rounded-xl text-sm font-bold mt-4"
        style={{ background: 'var(--accent-warm-strong)', color: 'var(--on-accent)', minHeight: 48 }}
        data-testid="today-v2-focus-continue"
      >
        {isHi ? 'शुरू करें' : 'Start'} · {minutesBadge}
      </button>
    </section>
  );
}

export default function TodayHomeV2({ data, subjects, isHi, streak, totalXp, nextExam }: TodayHomeV2Props) {
  const examRouter = useRouter();
  const [resumeDismissed, setResumeDismissed] = useState(false);
  const heroCtaRef = useRef<HTMLButtonElement>(null);
  const primary = data.primary;
  // "Later" dismisses the resume prompt for this visit and promotes the next
  // queue item into the hero (one-primary-action rule). A queue with nothing
  // else falls through to the empty state, so the screen never loses its
  // primary action.
  const isResume = primary.type === 'resume_in_progress' && !resumeDismissed;
  const hero = isResume ? primary : resumeDismissed ? (data.queue[1] ?? null) : primary;
  const rest = resumeDismissed ? data.queue.slice(2) : data.queue.slice(1);

  // a11y floor: after the resume hero unmounts, focus moves to the promoted
  // hero's primary CTA instead of dropping to <body>.
  useEffect(() => {
    if (resumeDismissed) heroCtaRef.current?.focus();
  }, [resumeDismissed]);

  return (
    <div data-testid="today-v2">
      {/* Greeting — streak demoted to a quiet chip, XP kept for parity. */}
      <header className="mb-4" data-testid="today-v2-greeting">
        <h1
          className="text-2xl font-bold"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {todayCopy('today.heading', isHi)}
        </h1>
        <div className="flex items-center gap-2 mt-2.5 flex-wrap">
          {streak > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                color: 'var(--text-3)',
                minHeight: 32,
              }}
            >
              <span aria-hidden="true">🔥</span>
              {streak}
            </span>
          )}
          <span
            className="inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-semibold"
            style={{
              background: 'var(--surface-2)',
              border: '1px solid var(--border)',
              color: 'var(--text-3)',
              minHeight: 32,
            }}
          >
            {totalXp.toLocaleString('en-IN')} XP
          </span>
        </div>
      </header>

      {/* Actionable alert only — kept from Wave A. */}
      {data.meta.practicedToday === false && streak > 0 && (
        <div
          role="alert"
          className="flex items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-semibold mb-3"
          style={{
            background: 'rgb(var(--orange-rgb) / 0.08)',
            border: '1px solid rgb(var(--orange-rgb) / 0.2)',
            color: 'var(--orange)',
          }}
          data-testid="today-streak-risk-banner"
        >
          <span aria-hidden="true">🔥</span>
          <span>
            {isHi ? 'स्ट्रीक खतरे में — आज कुछ अभ्यास करो!' : 'Streak at risk — practice something today!'}
          </span>
        </div>
      )}

      {/* The test is the reason a student is here this week. It sits above the
          plan, but below resume — you finish what you started first. */}
      <ExamScheduleCard
        entry={nextExam ?? null}
        isHi={isHi}
        onRevise={() => examRouter.push('/tests')}
      />

      {isResume ? (
        <ResumeHero
          item={primary}
          subjects={subjects}
          isHi={isHi}
          onLater={() => setResumeDismissed(true)}
        />
      ) : hero ? (
        <FocusHero
          item={hero}
          subjects={subjects}
          isHi={isHi}
          ctaRef={resumeDismissed ? heroCtaRef : undefined}
        />
      ) : (
        <div className="mt-4">
          <EmptyState
            icon="✅"
            title={todayCopy('today.empty', isHi)}
            action={
              <Button
                variant="primary"
                onClick={() => examRouter.push('/quiz')}
                data-testid="today-empty-practice"
              >
                {isHi ? 'मुफ़्त अभ्यास शुरू करें' : 'Start free practice'}
              </Button>
            }
          />
        </div>
      )}

      {rest.length > 0 && (
        <section aria-label={todayCopy('today.heading', isHi)} role="list" className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            {isHi ? 'आगे' : 'Up next'}
          </p>
          {rest.map((item) => (
            <TodayQueueItem key={`${item.rank}-${item.type}`} item={item} subjects={subjects} isHi={isHi} />
          ))}
        </section>
      )}
    </div>
  );
}
