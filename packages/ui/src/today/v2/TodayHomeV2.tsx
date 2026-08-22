'use client';

/**
 * TodayHomeV2 — the canonical loaded-state renderer for `/today`, the default
 * student route.
 *
 * Despite the "v2" in the path this IS the Today renderer; it is refactored in
 * place (no V3 fork). Phase 4 (2026-08-11) rebuilt it as a prioritised action
 * queue against one goal:
 *
 *   Within five seconds of login the student must (1) understand what to do
 *   next, (2) know WHY it is recommended, (3) start or resume it with ONE
 *   action.
 *
 * ── Content tree — exactly this, in this order, nothing else ───────────────
 *   1. Compact greeting                         [data-testid today-greeting]
 *   2. ONE primary Start/Continue card          [data-testid today-primary]
 *   3. Today's plan — at most THREE activities  [data-testid today-plan]
 *   4. ONE most-urgent reminder                 [data-testid today-reminder]
 *   5. ONE compact weekly progress statement    [data-testid today-progress]
 *   6. Small contextual Foxy entry              [data-testid today-foxy]
 *
 * Achievements, leaderboard, XP hero, level chips, promotional blocks and the
 * standalone exam card are deliberately ABSENT. The exam is not gone — when a
 * test is inside the next seven days it WINS the single reminder slot (block
 * 4), which is where an exam actually belongs on an action queue. Nothing may
 * be added above block 2 without changing this contract.
 *
 * ── What this component does NOT do ───────────────────────────────────────
 * It does not compute mastery, does not re-rank, and does not decide what is
 * next. `GET /api/v2/today` → `resolveTodayQueue` owns priority; this renders
 * `data.primary` as the hero and `data.queue.slice(1, 4)` as the plan, in the
 * server's order. Any re-sorting here would fork the adaptive model.
 *
 * ── Honesty rules ─────────────────────────────────────────────────────────
 *   - Estimated effort renders only when derived from learner data
 *     (`reliableEstMinutes`) — the static per-type minute constants are
 *     placeholders and are omitted rather than presented as measurements.
 *   - Subject / topic rows are omitted when the DTO lacks them, never filled.
 *   - The weekly progress statement carries only `current_streak` and
 *     `total_xp`, the two numbers with a reliable source, and labels XP
 *     "total" because no weekly aggregate exists.
 *   - The unread-notification reminder renders only for a number that actually
 *     arrived (`unreadCount` null ⇒ no reminder), never a defaulted 0.
 *
 * ── Vocabulary ────────────────────────────────────────────────────────────
 * Every visible string routes through `@alfanumrik/lib/today/copy` (P7). The
 * resolver's 12 machine `reason` values are mapped to six approved learner
 * phrases there; no internal term (IRT / BKT / DKT / CME / SRS / ZPD / theta /
 * decay / probability / confidence / fatigue / cognitive load) may appear.
 *
 * ── Accessibility / layout floor ──────────────────────────────────────────
 * 44×44 px minimum tap targets, 16 px minimum body text, no nested cards, no
 * horizontal scroll at 360 px, keyboard-reachable controls with visible focus,
 * landmark + list semantics, and no animation of its own (so reduced-motion is
 * satisfied by construction).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import type { Subject } from '@alfanumrik/lib/subjects.types';
import type { TodayResponse, TodayQueueItem as TodayQueueItemDTO } from '@alfanumrik/lib/today/types';
import { todayCopy, deepLinkToHref, todayExamReasonCopy } from '@alfanumrik/lib/today/copy';
import { todayIcon } from '@alfanumrik/lib/today/icon-map';
import {
  resolveItemCopy,
  resolveItemFacets,
  primaryCtaLabel,
  isTeacherAssigned,
  fromTeacherLabel,
} from '@alfanumrik/lib/today/render';
import type { ExamScheduleEntry } from '@alfanumrik/lib/exams/types';
import { track } from '@alfanumrik/lib/analytics';

/** The plan block is capped at three activities. This is a product rule, not a
 *  layout convenience — a fourth "immediate" activity is a fourth decision. */
export const MAX_PLAN_ITEMS = 3;

/** DD-16: `--on-accent` ink is AA-safe on `--accent-warm-strong`, and only on
 *  it. Never put light ink on a bare `--orange` / `--accent-warm`. */
const CTA_SURFACE = {
  background: 'var(--accent-warm-strong)',
  color: 'var(--on-accent)',
} as const;

/** DD-16's second permitted option: keep the warm surface, switch ink to
 *  `--text-1` (rather than lightening the ink on a mid-tone orange). */
const REASON_SURFACE = {
  background: 'rgb(var(--orange-rgb) / 0.10)',
  color: 'var(--text-1)',
  border: '1px solid rgb(var(--orange-rgb) / 0.22)',
} as const;

export type TodayReminderKind = 'exam' | 'streak' | 'unread' | 'none';

interface TodayHomeV2Props {
  data: TodayResponse;
  subjects: Subject[];
  isHi: boolean;
  /** `students.streak_days` via AuthContext snapshot. Reliable. */
  streak: number;
  /** `students.xp_total` via AuthContext snapshot. Reliable, all-time. */
  totalXp: number;
  /** The next test inside seven days, when `ff_exam_schedule_v1` is on and one
   *  exists. Absent/null otherwise — the reminder falls through. */
  nextExam?: ExamScheduleEntry | null;
  /** Unread notification count. `null`/undefined when the read failed or has
   *  not resolved — the reminder is then omitted rather than shown as 0. */
  unreadCount?: number | null;
  /** True when SWR is refreshing over already-rendered data. Surfaces the
   *  partial/stale notice instead of silently showing yesterday's plan. */
  isStale?: boolean;
}

/* ── 4. The single most urgent reminder ─────────────────────────────────── */

interface ResolvedReminder {
  kind: Exclude<TodayReminderKind, 'none'>;
  text: string;
  /** Approved reason phrase, when the reminder has one. */
  reason: string | null;
  /** Present only when there is somewhere useful to go. A reminder with no
   *  destination renders as text — never as a control that does nothing. */
  cta?: { label: string; href: string };
  icon: string;
}

/**
 * Pick ONE reminder, most urgent first:
 *   1. a test inside the next seven days   (dated, externally imposed)
 *   2. a streak about to break today       (expires at midnight)
 *   3. unread updates                      (no deadline)
 * Returns null when none applies — the block is then omitted entirely rather
 * than filled with an encouragement banner.
 */
function resolveReminder(
  isHi: boolean,
  nextExam: ExamScheduleEntry | null | undefined,
  streak: number,
  practicedToday: boolean,
  unreadCount: number | null | undefined,
): ResolvedReminder | null {
  if (nextExam) {
    return {
      kind: 'exam',
      icon: '📅',
      text: todayCopy('today.reminder.exam', isHi, {
        day: nextExam.dayLabel,
        title: nextExam.title,
      }),
      reason: todayExamReasonCopy(isHi),
      cta: { label: todayCopy('today.reminder.exam.cta', isHi), href: '/tests' },
    };
  }
  if (streak > 0 && practicedToday === false) {
    return {
      kind: 'streak',
      icon: '🔥',
      text: todayCopy('today.reminder.streak', isHi, { days: streak }),
      reason: null,
      // No CTA: the primary card above IS the action that saves the streak.
      // A second button here would compete with the one dominant action.
    };
  }
  if (typeof unreadCount === 'number' && unreadCount > 0) {
    return {
      kind: 'unread',
      icon: '🔔',
      text:
        unreadCount === 1
          ? todayCopy('today.reminder.unread.one', isHi)
          : todayCopy('today.reminder.unread', isHi, { count: unreadCount }),
      reason: null,
      cta: { label: todayCopy('today.reminder.unread.cta', isHi), href: '/notifications' },
    };
  }
  return null;
}

/* ── 2. The primary recommendation card ─────────────────────────────────── */

function PrimaryCard({
  item,
  subjects,
  isHi,
  onStart,
}: {
  item: TodayQueueItemDTO;
  subjects: Subject[];
  isHi: boolean;
  onStart: () => void;
}) {
  const { label } = resolveItemCopy(item, subjects, isHi);
  const facets = resolveItemFacets(item, subjects, isHi);
  const teacherAssigned = isTeacherAssigned(item);

  // "Subject · Topic · Activity", with any missing part dropped rather than
  // filled. `Boolean` filter is what makes the omission honest.
  const line = [facets.subject, facets.concept, facets.activity].filter(Boolean).join(' · ');

  return (
    <section
      data-testid="today-primary"
      aria-labelledby="today-primary-title"
      className="rounded-2xl p-4 sm:p-5"
      style={{ background: 'var(--surface-1)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{
            width: 44,
            height: 44,
            background: 'var(--surface-2)',
            fontSize: 22,
            lineHeight: 1,
          }}
        >
          {todayIcon(item.iconHint)}
        </span>
        <div className="flex-1 min-w-0">
          <p
            className="text-[13px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--text-3)' }}
          >
            {todayCopy('today.primary.eyebrow', isHi)}
          </p>
          <h2
            id="today-primary-title"
            className="text-lg font-bold leading-snug mt-0.5 break-words"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
          >
            {label}
          </h2>
        </div>
      </div>

      {/* Subject · Topic · Activity — 16px body text, wraps at 360px. */}
      {line.length > 0 && (
        <p
          data-testid="today-primary-facets"
          className="text-base leading-relaxed mt-3 break-words"
          style={{ color: 'var(--text-2)' }}
        >
          {line}
        </p>
      )}

      {/* Why this is recommended + where the learner already is + effort.
          Each chip is omitted when its value is not reliable. */}
      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {facets.reason && (
          <span
            data-testid="today-primary-reason"
            className="inline-flex items-center rounded-full px-3 py-1.5 text-base font-semibold"
            style={REASON_SURFACE}
          >
            <span className="sr-only">{todayCopy('today.reason.label', isHi)}: </span>
            {facets.reason}
          </span>
        )}
        <span
          data-testid="today-primary-status"
          className="inline-flex items-center rounded-full px-3 py-1.5 text-base font-medium"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          {facets.status.text}
        </span>
        {facets.estMinutes !== null && (
          <span
            data-testid="today-primary-effort"
            className="inline-flex items-center rounded-full px-3 py-1.5 text-base font-medium"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
          >
            {todayCopy('today.minutesBadge', isHi, { n: facets.estMinutes })}
          </span>
        )}
        {teacherAssigned && (
          <span
            data-testid="today-from-teacher-tag"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-base font-semibold"
            style={{
              background: 'rgb(var(--purple-rgb, 124 58 237) / 0.10)',
              color: 'var(--text-1)',
              border: '1px solid rgb(var(--purple-rgb, 124 58 237) / 0.22)',
            }}
          >
            <span aria-hidden="true">👩‍🏫</span>
            {fromTeacherLabel(isHi)}
          </span>
        )}
      </div>

      {/* THE one primary action on this screen. */}
      <button
        type="button"
        onClick={onStart}
        data-testid="today-primary-cta"
        className="w-full min-h-tap-min rounded-xl text-base font-bold mt-4 px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={CTA_SURFACE}
      >
        {primaryCtaLabel(item, isHi)}
      </button>
    </section>
  );
}

/* ── 3. Today's plan (≤ 3) ──────────────────────────────────────────────── */

function PlanRow({
  item,
  subjects,
  isHi,
  onOpen,
}: {
  item: TodayQueueItemDTO;
  subjects: Subject[];
  isHi: boolean;
  onOpen: () => void;
}) {
  const { label } = resolveItemCopy(item, subjects, isHi);
  const facets = resolveItemFacets(item, subjects, isHi);
  const detail = [facets.subject, facets.activity].filter(Boolean).join(' · ');

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        data-testid="today-plan-item"
        className="w-full min-h-tap-min flex items-center gap-3 rounded-2xl px-3 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
      >
        <span
          aria-hidden="true"
          className="flex items-center justify-center rounded-xl flex-shrink-0"
          style={{ width: 36, height: 36, background: 'var(--surface-1)', fontSize: 18, lineHeight: 1 }}
        >
          {todayIcon(item.iconHint)}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-base font-semibold truncate" style={{ color: 'var(--text-1)' }}>
            {label}
          </span>
          {detail.length > 0 && (
            <span className="block text-sm truncate mt-0.5" style={{ color: 'var(--text-3)' }}>
              {detail}
            </span>
          )}
        </span>
        {facets.reason && (
          <span
            className="hidden sm:inline text-sm font-medium flex-shrink-0"
            style={{ color: 'var(--text-3)' }}
          >
            {facets.reason}
          </span>
        )}
        <span aria-hidden="true" className="flex-shrink-0" style={{ color: 'var(--text-3)' }}>
          →
        </span>
      </button>
    </li>
  );
}

/* ── The surface ────────────────────────────────────────────────────────── */

export default function TodayHomeV2({
  data,
  subjects,
  isHi,
  streak,
  totalXp,
  nextExam,
  unreadCount,
  isStale = false,
}: TodayHomeV2Props) {
  const router = useRouter();
  const primary = data.primary;

  // Server order, preserved. `queue[0]` is the primary; the plan is the next
  // three, untouched — no client-side re-ranking.
  const plan = useMemo(() => data.queue.slice(1, 1 + MAX_PLAN_ITEMS), [data.queue]);

  const reminder = useMemo(
    () => resolveReminder(isHi, nextExam, streak, data.meta.practicedToday, unreadCount),
    [isHi, nextExam, streak, data.meta.practicedToday, unreadCount],
  );

  // ── Analytics: one `today_viewed` per resolved queue. Keyed on `resolvedAt`
  // so an SWR revalidation that returns the same queue does not double-count,
  // but a genuinely new resolution does. P13: enums + counts only.
  const viewedFor = useRef<string | null>(null);
  useEffect(() => {
    if (viewedFor.current === data.resolvedAt) return;
    viewedFor.current = data.resolvedAt;
    track('today_viewed', {
      branch: data.meta.branch,
      primary_type: primary.type,
      primary_reason: primary.reason,
      plan_count: plan.length,
      reminder: reminder?.kind ?? 'none',
    });
  }, [data.resolvedAt, data.meta.branch, primary.type, primary.reason, plan.length, reminder]);

  // Stale is its own state, announced once when entered.
  const staleAnnounced = useRef(false);
  useEffect(() => {
    if (!isStale) {
      staleAnnounced.current = false;
      return;
    }
    if (staleAnnounced.current) return;
    staleAnnounced.current = true;
    track('today_state_shown', { state: 'stale' });
  }, [isStale]);

  const foxySubjectCode =
    typeof primary.meta?.subjectCode === 'string' ? primary.meta.subjectCode : null;
  const foxySubjectName = resolveItemFacets(primary, subjects, isHi).subject;
  const foxyHref = foxySubjectCode
    ? `/foxy?subject=${encodeURIComponent(foxySubjectCode)}&source=today`
    : '/foxy?source=today';

  const startPrimary = () => {
    track('today_primary_cta_clicked', { type: primary.type, reason: primary.reason });
    router.push(deepLinkToHref(primary.deepLink));
  };

  return (
    <div data-testid="today-v2" className="flex flex-col gap-4">
      {/* ── 1. Compact greeting. One line, no hero art, no XP banner. ── */}
      <header data-testid="today-greeting">
        <h1
          className="text-xl font-bold leading-tight"
          style={{ fontFamily: 'var(--font-display)', color: 'var(--text-1)' }}
        >
          {todayCopy('today.heading', isHi)}
        </h1>
      </header>

      {/* Partial / stale — the plan on screen is real but may be outdated. */}
      {isStale && (
        <p
          role="status"
          data-testid="today-stale"
          className="text-base rounded-xl px-3 py-2"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)' }}
        >
          {todayCopy('today.state.stale', isHi)}
        </p>
      )}

      {/* ── 2. ONE primary recommendation. ── */}
      <PrimaryCard item={primary} subjects={subjects} isHi={isHi} onStart={startPrimary} />

      {/* ── 3. Today's plan — at most three. ── */}
      {plan.length > 0 && (
        <section data-testid="today-plan" aria-labelledby="today-plan-heading">
          <h2
            id="today-plan-heading"
            className="text-[13px] font-bold uppercase tracking-wider mb-2"
            style={{ color: 'var(--text-3)' }}
          >
            {todayCopy('today.plan.heading', isHi)}
          </h2>
          <ul className="flex flex-col gap-2">
            {plan.map((item) => (
              <PlanRow
                key={`${item.rank}-${item.type}`}
                item={item}
                subjects={subjects}
                isHi={isHi}
                onOpen={() => {
                  track('today_plan_item_clicked', {
                    type: item.type,
                    reason: item.reason,
                    rank: item.rank,
                  });
                  router.push(deepLinkToHref(item.deepLink));
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── 4. ONE most urgent reminder. ── */}
      {reminder && (
        <section
          data-testid="today-reminder"
          data-reminder-kind={reminder.kind}
          role="status"
          className="flex items-center gap-3 rounded-2xl px-3 py-3"
          style={{ background: 'var(--surface-2)', color: 'var(--text-1)' }}
        >
          <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
            {reminder.icon}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-base font-semibold break-words" style={{ color: 'var(--text-1)' }}>
              {reminder.text}
            </span>
            {reminder.reason && (
              <span className="block text-sm mt-0.5" style={{ color: 'var(--text-3)' }}>
                {reminder.reason}
              </span>
            )}
          </span>
          {reminder.cta && (
            <button
              type="button"
              data-testid="today-reminder-cta"
              onClick={() => {
                track('today_reminder_clicked', {
                  reminder: reminder.kind as 'exam' | 'unread',
                });
                router.push(reminder.cta!.href);
              }}
              className="min-h-tap-min flex-shrink-0 rounded-xl px-4 text-base font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
              style={{ background: 'var(--surface-1)', color: 'var(--text-1)', border: '1px solid var(--border)' }}
            >
              {reminder.cta.label}
            </button>
          )}
        </section>
      )}

      {/* ── 5. ONE compact progress statement. Only reliable numbers. ── */}
      <p data-testid="today-progress" className="text-base" style={{ color: 'var(--text-2)' }}>
        {streak > 0
          ? streak === 1
            ? todayCopy('today.progress.streakOne', isHi)
            : todayCopy('today.progress.streak', isHi, { days: streak })
          : todayCopy('today.progress.noStreak', isHi)}
        {totalXp > 0 && (
          <>
            {' · '}
            <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>
              {todayCopy('today.progress.xpTotal', isHi, { xp: totalXp.toLocaleString('en-IN') })}
            </span>
          </>
        )}
      </p>

      {/* ── 6. Small contextual Foxy entry. ── */}
      <a
        href={foxyHref}
        data-testid="today-foxy"
        onClick={() => track('today_foxy_clicked', { has_subject: foxySubjectCode !== null })}
        className="min-h-tap-min flex items-center gap-2.5 rounded-2xl px-3 py-2.5 text-base focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
        style={{ color: 'var(--text-2)' }}
      >
        <span aria-hidden="true" style={{ fontSize: 20, lineHeight: 1 }}>
          🦊
        </span>
        <span className="break-words">
          {foxySubjectName
            ? todayCopy('today.foxy.subject', isHi, { subject: foxySubjectName })
            : todayCopy('today.foxy.generic', isHi)}
        </span>
      </a>
    </div>
  );
}
