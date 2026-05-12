/**
 * src/lib/state/learner-loop/resolve-next-action.ts
 *
 * The Learner Loop's central resolver. Given a StudentState (built by
 * the canonical builder) plus a small set of additional inputs that
 * need DB I/O, return the single LearnerAction the UI should dispatch.
 *
 * Design discipline:
 *
 *   - The resolver function itself is PURE: state + augmentation + now → action.
 *     Every branch is independently testable with hand-built fixtures.
 *
 *   - I/O lives in `buildLoopAugmentation()` and nowhere else. The
 *     augmenter fetches the few inputs that aren't already on
 *     StudentState (due-review count, today's quiz count, in-progress
 *     lessons). When those move onto StudentState in a later phase, the
 *     augmenter shrinks accordingly.
 *
 *   - Branch ordering is deterministic and documented at the top of
 *     `resolveNextLearnerAction()`. New branches go in their correct
 *     position; do not re-rank without a test that pins the new order.
 *
 *   - "What if no branch fires?" — the final branch is a safe default
 *     (`start_quiz` on weakestChapter, or cold-start if no mastery at all).
 *     The function never returns null.
 *
 * Tenant scope: the resolver itself is tenant-agnostic; the augmenter
 * scopes its reads to the caller's auth_user_id. The future tenant-aware
 * config (LEARNER_LOOP_CONFIG per tenant) plugs in via an optional
 * `config` parameter the route can pass.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { StudentState } from '../student-state';
import { weakestChapter } from '../student-state';
import {
  LEARNER_LOOP_CONFIG,
  type LearnerAction,
} from './types';

// ── The augmentation: small, cheap, derived from existing tables ────

export interface LoopAugmentation {
  /** Number of flashcards due today across all sources. Reads from
   *  `review_cards` filtered on `next_review_date <= today`. */
  dueReviewCount: number;
  /** Has the learner completed at least one quiz session today (IST)?
   *  Reads from `quiz_sessions` for backwards compatibility with the
   *  legacy writer; later phases may switch to `state_events`. */
  attemptedQuizToday: boolean;
  /** In-progress lessons at ≥ CONTINUE_LESSON_MIN_PROGRESS complete.
   *  Reads from `chapter_progress`. May be empty. */
  inProgressLessons: Array<{
    subjectCode: string;
    chapterNumber: number;
    progressPct: number;
  }>;
}

export interface BuildAugmentationOptions {
  /** Defaults to new Date(); override for tests. */
  now?: Date;
}

/** "Today" boundary in IST (UTC+05:30) — start-of-day used by dueReview
 *  + attemptedQuizToday windows. Exported so tests can pin it. */
export function istStartOfDay(now: Date): Date {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const istMidnight = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate(),
      0,
      0,
      0,
    ),
  );
  // Convert IST midnight back to UTC so SQL comparisons work.
  return new Date(istMidnight.getTime() - istOffsetMs);
}

/** Sunday in IST → start of the weekly-dive default branch. */
export function isSundayIst(now: Date): boolean {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  return istNow.getUTCDay() === 0; // 0 = Sunday
}

/** True only on the last calendar day of the month in IST. */
export function isMonthEndDayIst(now: Date): boolean {
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istNow = new Date(now.getTime() + istOffsetMs);
  const next = new Date(istNow.getTime() + 24 * 60 * 60 * 1000);
  return next.getUTCMonth() !== istNow.getUTCMonth();
}

/**
 * Fetch the small set of additional inputs the resolver needs beyond
 * StudentState. Reads only — never writes. Defensive on every concern:
 * a flaky downstream table degrades the corresponding branch (e.g. if
 * `review_cards` is unreachable, `dueReviewCount` is 0 and the resolver
 * just falls through to the next branch).
 */
export async function buildLoopAugmentation(
  sb: SupabaseClient,
  authUserId: string,
  studentId: string,
  opts: BuildAugmentationOptions = {},
): Promise<LoopAugmentation> {
  const now = opts.now ?? new Date();
  const istToday = istStartOfDay(now);
  const todayIso = istToday.toISOString();

  // Run the three reads in parallel — they are independent.
  const [dueCardsRes, todayQuizRes, inProgressRes] = await Promise.all([
    sb
      .from('review_cards')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .lte('next_review_date', new Date(now).toISOString())
      .limit(1),
    sb
      .from('quiz_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', studentId)
      .eq('is_completed', true)
      .gte('completed_at', todayIso)
      .limit(1),
    sb
      .from('chapter_progress')
      .select('subject, chapter_number, progress_percent')
      .eq('student_id', studentId)
      .gte('progress_percent', LEARNER_LOOP_CONFIG.CONTINUE_LESSON_MIN_PROGRESS * 100)
      .lt('progress_percent', 100)
      .order('last_studied_at', { ascending: false })
      .limit(5),
  ]);

  const inProgressLessons = (inProgressRes.data ?? []).map(row => ({
    subjectCode: String(row.subject).toLowerCase(),
    chapterNumber: Number(row.chapter_number),
    progressPct: Number(row.progress_percent) / 100,
  }));

  return {
    dueReviewCount: dueCardsRes.count ?? 0,
    attemptedQuizToday: (todayQuizRes.count ?? 0) > 0,
    inProgressLessons,
  };
}

// ── Branch helpers (each independently testable) ─────────────────────

function totalAttempts(state: StudentState): number {
  let n = 0;
  for (const s of state.mastery) {
    for (const c of s.chapters) n += c.attempts;
  }
  return n;
}

/** A chapter is "decayed" iff mastery is above the minimum AND the
 *  last-touch age exceeds the retention window for that mastery. */
export function decayedChapters(
  state: StudentState,
  now: Date,
): Array<{ subjectCode: string; chapterNumber: number; mastery: number; daysSince: number }> {
  const out: Array<{ subjectCode: string; chapterNumber: number; mastery: number; daysSince: number }> = [];
  const nowMs = now.getTime();
  for (const subject of state.mastery) {
    for (const chapter of subject.chapters) {
      if (chapter.mastery === null) continue;
      if (chapter.mastery < LEARNER_LOOP_CONFIG.REVISE_MIN_MASTERY) continue;
      if (chapter.lastUpdatedAt === null) continue;
      const daysSince =
        (nowMs - new Date(chapter.lastUpdatedAt).getTime()) / (24 * 60 * 60 * 1000);
      const window = LEARNER_LOOP_CONFIG.RETENTION_WINDOW_DAYS(chapter.mastery);
      if (daysSince > window) {
        out.push({
          subjectCode: subject.subjectCode,
          chapterNumber: chapter.chapterNumber,
          mastery: chapter.mastery,
          daysSince,
        });
      }
    }
  }
  // Most-stale first — the resolver returns the head.
  out.sort((a, b) => b.daysSince - a.daysSince);
  return out;
}

function modalityForMastery(mastery: number): 'read' | 'explainer' | 'worked-example' {
  if (mastery >= 0.85) return 'worked-example';
  if (mastery >= 0.7) return 'explainer';
  return 'read';
}

// ── The resolver ─────────────────────────────────────────────────────

export interface ResolveOptions {
  /** Override "now" for deterministic tests. Defaults to new Date(). */
  now?: Date;
}

/**
 * Pure resolver. Branch order is the contract — keep it stable, pin
 * with tests, do not reorder without an ADR.
 *
 *   1. cold_start_diagnostic — no mastery signal yet
 *   2. review_due_cards     — at least REVIEW_STACKING_THRESHOLD due today
 *   3. revise_decayed_topic — any chapter decayed past its window
 *   4. start_quiz (ZPD)     — not yet attempted today + a weakest chapter exists
 *   5. continue_lesson      — at least one in-progress lesson ≥ 50%
 *   6. weekly_dive          — Sunday IST
 *   7. monthly_synthesis    — last calendar day of the month IST
 *   8. start_quiz (default) — weakest chapter as the catch-all
 *
 * Branch 1 takes precedence over everything because a cold-start learner
 * with zero signal has nothing for the other branches to act on. Branch
 * 6 and 7 sit below the daily branches deliberately — Sunday and
 * month-end are *defaults*, not overrides. A student with 30 stacking
 * reviews on a Sunday gets reviews, not a dive.
 */
export function resolveNextLearnerAction(
  state: StudentState,
  augmentation: LoopAugmentation,
  options: ResolveOptions = {},
): LearnerAction {
  const now = options.now ?? new Date();

  // Branch 1 — cold start
  const attempts = totalAttempts(state);
  if (
    state.mastery.length === 0 ||
    attempts < LEARNER_LOOP_CONFIG.COLD_START_MAX_ATTEMPTS
  ) {
    return {
      kind: 'cold_start_diagnostic',
      url: '/diagnostic',
      reason: 'no_signals_yet',
    };
  }

  // Branch 2 — due reviews stacking
  if (
    augmentation.dueReviewCount >= LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD
  ) {
    return {
      kind: 'review_due_cards',
      url: '/review',
      dueCount: augmentation.dueReviewCount,
      reason: 'reviews_stacking',
    };
  }

  // Branch 3 — decayed topic needs a re-encounter with the source
  const decayed = decayedChapters(state, now);
  if (decayed.length > 0) {
    const top = decayed[0];
    return {
      kind: 'revise_decayed_topic',
      url: `/learn/${encodeURIComponent(top.subjectCode)}/${top.chapterNumber}?mode=read&from=revise`,
      subjectCode: top.subjectCode,
      chapterNumber: top.chapterNumber,
      daysSinceLastTouch: Math.round(top.daysSince),
      recommendedModality: modalityForMastery(top.mastery),
      reason: 'decay_above_threshold',
    };
  }

  const weakest = weakestChapter(state);

  // Branch 4 — today's ZPD (only if not yet attempted today and there's a
  // weakest chapter to point at)
  if (!augmentation.attemptedQuizToday && weakest !== null) {
    return {
      kind: 'start_quiz',
      url: `/quiz?subject=${encodeURIComponent(weakest.subjectCode)}&chapter=${weakest.chapterNumber}`,
      subjectCode: weakest.subjectCode,
      chapterNumber: weakest.chapterNumber,
      zpdBin: LEARNER_LOOP_CONFIG.ZPD_BIN_FOR_MASTERY(weakest.mastery),
      reason: 'todays_zpd',
    };
  }

  // Branch 5 — continue an in-progress lesson
  if (augmentation.inProgressLessons.length > 0) {
    const top = augmentation.inProgressLessons[0];
    return {
      kind: 'continue_lesson',
      url: `/learn/${encodeURIComponent(top.subjectCode)}/${top.chapterNumber}`,
      subjectCode: top.subjectCode,
      chapterNumber: top.chapterNumber,
      progressPct: top.progressPct,
      reason: 'in_progress_lesson',
    };
  }

  // Branch 6 — Sunday weekly dive default
  if (isSundayIst(now)) {
    const weakSubject = weakest?.subjectCode ?? state.mastery[0]?.subjectCode ?? 'science';
    return {
      kind: 'weekly_dive',
      url: '/dive',
      suggestedPrompt: `Pick a phenomenon from ${weakSubject} you're curious about`,
      reason: 'sunday_default',
    };
  }

  // Branch 7 — month-end synthesis default
  if (isMonthEndDayIst(now)) {
    return {
      kind: 'monthly_synthesis',
      url: '/progress?view=synthesis',
      reason: 'month_end_default',
    };
  }

  // Branch 8 — catch-all: weakest-topic quiz. weakest is guaranteed
  // non-null here because branch 1 caught the empty-mastery case.
  // Fallback to first subject if for some reason it is null.
  if (weakest !== null) {
    return {
      kind: 'start_quiz',
      url: `/quiz?subject=${encodeURIComponent(weakest.subjectCode)}&chapter=${weakest.chapterNumber}`,
      subjectCode: weakest.subjectCode,
      chapterNumber: weakest.chapterNumber,
      zpdBin: LEARNER_LOOP_CONFIG.ZPD_BIN_FOR_MASTERY(weakest.mastery),
      reason: 'weakest_topic_practice',
    };
  }

  // Defensive — shouldn't be reachable given branch 1, but typesafe.
  return {
    kind: 'cold_start_diagnostic',
    url: '/diagnostic',
    reason: 'no_signals_yet',
  };
}
