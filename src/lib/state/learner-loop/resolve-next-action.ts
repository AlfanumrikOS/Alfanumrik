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
import { logger } from '../../logger';
import type { StudentState } from '../student-state';
import { weakestChapter } from '../student-state';
import {
  LEARNER_LOOP_CONFIG,
  MAX_TODAY_QUEUE_ITEMS,
  type LearnerAction,
  type LearnerActionKind,
  type ResolverAction,
  type TeacherRemediationAction,
  type TodayQueueResult,
} from './types';

// ── The augmentation: small, cheap, derived from existing tables ────

/**
 * A pending teacher-assigned remediation (Phase 3A Wave A / A3). Present when
 * the student has a `teacher_remediation_assignments` row whose status is
 * `assigned` or `in_progress`. Fetched service-role in `buildLoopAugmentation`
 * (the row is `student_id`-keyed; the BFF runs the admin client per the A1
 * contract). The resolver's highest-priority branch consumes this and emits a
 * `teacher_remediation` action tagged `source:'teacher'`.
 *
 * `chapterId` is the assigned `curriculum_topics.id` (null = general
 * remediation → the resolver falls back to the weakest chapter). `subjectCode`
 * / `chapterNumber` are the resolved navigation anchor when the chapter could
 * be mapped to the student's mastery model (or the weakest-chapter fallback);
 * they may be absent when neither could be resolved (the URL then degrades to
 * a generic chapter-less quiz target — still tagged source:'teacher').
 */
export interface PendingTeacherRemediation {
  /** teacher_remediation_assignments.id — tracking key for the resolve flip. */
  assignmentId: string;
  /** curriculum_topics.id (null = general remediation). */
  chapterId: string | null;
  /** Current status — only `assigned` | `in_progress` ever reach the resolver. */
  status: 'assigned' | 'in_progress';
  /** Optional resolved navigation anchor (mastery code + chapter number). */
  subjectCode?: string;
  chapterNumber?: number;
}

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
  /** The single highest-priority teacher-assigned remediation, or null/absent
   *  when the student has none open. Optional so existing callers that don't
   *  fetch it (and test fixtures) remain valid — absence ≡ "no assignment". */
  pendingTeacherRemediation?: PendingTeacherRemediation | null;
}

export interface BuildAugmentationOptions {
  /** Defaults to new Date(); override for tests. */
  now?: Date;
  /**
   * Service-role client used ONLY for the teacher-remediation read (Phase 3A
   * Wave A / A3). The `teacher_remediation_assignments` row is student-keyed
   * and the BFF reads it through the admin client per the A1 contract. When
   * omitted, the teacher-remediation fetch is skipped (degrades to "none") so
   * callers that don't yet wire it stay byte-identical.
   */
  adminClient?: SupabaseClient;
}

/**
 * Fetch the student's single highest-priority OPEN teacher-assigned
 * remediation (Phase 3A Wave A / A3), or null when none exists.
 *
 * Reads service-role (the row is `student_id`-keyed; RLS lets the student read
 * their own rows, and the BFF/orchestrator path uses the admin client per the
 * A1 contract). `studentId` is the INTERNAL `students.id` (already resolved
 * from `auth.uid()` upstream — NEVER `auth.uid()`).
 *
 * Selection: among `status ∈ {assigned, in_progress}` rows, prefer
 * `in_progress` (an already-started assignment continues), then the OLDEST
 * `created_at` (FIFO — the longest-pending assignment surfaces first). When a
 * `chapter_id` is present we best-effort map it to (subjectCode, chapterNumber)
 * via curriculum_topics → subjects so the resolver can build a chapter-anchored
 * quiz URL; a mapping miss degrades gracefully (chapterId still carried).
 *
 * Defensive: any read failure (table absent on an older env, transient error)
 * returns null so the resolver simply falls through to its routine branches.
 * Never throws.
 */
export async function fetchPendingTeacherRemediation(
  admin: SupabaseClient,
  studentId: string,
): Promise<PendingTeacherRemediation | null> {
  try {
    const { data: rows, error } = await admin
      .from('teacher_remediation_assignments')
      .select('id, chapter_id, status, created_at')
      .eq('student_id', studentId)
      .in('status', ['assigned', 'in_progress'])
      .order('created_at', { ascending: true })
      .limit(20);

    if (error || !rows || rows.length === 0) return null;

    type Row = { id: string; chapter_id: string | null; status: string; created_at: string };
    const open = rows as Row[];

    // Prefer an already-started assignment; else the oldest (FIFO via the
    // ascending created_at sort the query applied).
    const inProgress = open.find((r) => r.status === 'in_progress');
    const chosen = inProgress ?? open[0];
    if (!chosen) return null;

    const status: PendingTeacherRemediation['status'] =
      chosen.status === 'in_progress' ? 'in_progress' : 'assigned';

    const out: PendingTeacherRemediation = {
      assignmentId: chosen.id,
      chapterId: chosen.chapter_id ?? null,
      status,
    };

    // Best-effort anchor: chapter_id (curriculum_topics.id) → (subject code,
    // chapter number). A miss is non-fatal — the resolver falls back to the
    // weakest chapter (general remediation behaviour).
    if (chosen.chapter_id) {
      const { data: topic } = await admin
        .from('curriculum_topics')
        .select('chapter_number, subject_id')
        .eq('id', chosen.chapter_id)
        .maybeSingle();
      const topicRow = topic as { chapter_number: number | null; subject_id: string | null } | null;
      if (topicRow?.subject_id) {
        const { data: subj } = await admin
          .from('subjects')
          .select('code')
          .eq('id', topicRow.subject_id)
          .maybeSingle();
        const subjectCode = (subj as { code?: string } | null)?.code;
        if (subjectCode) out.subjectCode = subjectCode;
      }
      if (typeof topicRow?.chapter_number === 'number' && topicRow.chapter_number > 0) {
        out.chapterNumber = topicRow.chapter_number;
      }
    }

    return out;
  } catch (err) {
    logger.warn('fetchPendingTeacherRemediation failed; treating as none', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Flip an `assigned` teacher-remediation row to `in_progress` (Phase 3A Wave A
 * / A3, assessment rule 4 — "surfacing/starting the assigned task moves
 * assigned → in_progress"). Service-role write keyed by the assignment id.
 *
 * Guarded with `.eq('status','assigned')` so it is idempotent: a row already
 * `in_progress`/`resolved`/`dismissed` is untouched (the UPDATE matches zero
 * rows). NO scoring / XP / mastery math — this only advances the assignment's
 * lifecycle. Best-effort: returns false (never throws) on any failure.
 */
export async function markTeacherRemediationInProgress(
  admin: SupabaseClient,
  assignmentId: string,
): Promise<boolean> {
  try {
    const { error } = await admin
      .from('teacher_remediation_assignments')
      .update({ status: 'in_progress' })
      .eq('id', assignmentId)
      .eq('status', 'assigned');
    if (error) {
      logger.warn('markTeacherRemediationInProgress failed', {
        assignmentId,
        error: error.message,
      });
      return false;
    }
    return true;
  } catch (err) {
    logger.warn('markTeacherRemediationInProgress threw', {
      assignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Mark a teacher-remediation row `resolved` (+ `resolved_at`) on COMPLETION of
 * the assigned practice (Phase 3A Wave A / A3, assessment rule 4 — "completing
 * the corresponding practice moves it to resolved"). Service-role write keyed
 * by the assignment id, scoped to the OWNING student so a forged id cannot
 * resolve another student's assignment.
 *
 * Only flips OPEN rows (`assigned` | `in_progress`); an already-`resolved` /
 * `dismissed` row is left untouched (the guard matches zero rows) — idempotent.
 * NO scoring / XP / mastery math: the assigned task was already graded as a
 * normal student quiz (P1/P2/P3 untouched); this only closes the assignment.
 *
 * Returns:
 *   - { ok: true, alreadyResolved } on success (alreadyResolved=true when the
 *     guard matched no open row but the row exists resolved),
 *   - { ok: false, notFound: true } when no such row for this student,
 *   - { ok: false } on a DB error.
 */
export async function resolveTeacherRemediation(
  admin: SupabaseClient,
  assignmentId: string,
  studentId: string,
): Promise<{ ok: boolean; alreadyResolved?: boolean; notFound?: boolean }> {
  try {
    // Confirm the row belongs to this student first (defense in depth — the
    // student_id scope on the UPDATE also enforces this, but a clean 404 vs
    // 200-idempotent distinction needs the prior read).
    const { data: existing, error: readErr } = await admin
      .from('teacher_remediation_assignments')
      .select('id, status')
      .eq('id', assignmentId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (readErr) {
      logger.warn('resolveTeacherRemediation read failed', {
        assignmentId,
        error: readErr.message,
      });
      return { ok: false };
    }
    if (!existing) return { ok: false, notFound: true };

    const status = (existing as { status: string }).status;
    if (status === 'resolved') {
      return { ok: true, alreadyResolved: true };
    }
    // `dismissed` is terminal — treat a resolve attempt as a no-op success so
    // the Today completion flow never errors, but do not reopen it.
    if (status === 'dismissed') {
      return { ok: true, alreadyResolved: true };
    }

    const { error: updErr } = await admin
      .from('teacher_remediation_assignments')
      .update({ status: 'resolved', resolved_at: new Date().toISOString() })
      .eq('id', assignmentId)
      .eq('student_id', studentId)
      .in('status', ['assigned', 'in_progress']);
    if (updErr) {
      logger.warn('resolveTeacherRemediation update failed', {
        assignmentId,
        error: updErr.message,
      });
      return { ok: false };
    }
    return { ok: true, alreadyResolved: false };
  } catch (err) {
    logger.warn('resolveTeacherRemediation threw', {
      assignmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false };
  }
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

  // Teacher-assigned remediation (Phase 3A Wave A / A3). Service-role read —
  // only when the caller passed an admin client. Independent of the three
  // RLS-scoped reads below; runs in parallel with them. When no admin client
  // is wired, this resolves to null (degrades to "no assignment").
  const teacherRemediationPromise: Promise<PendingTeacherRemediation | null> =
    opts.adminClient
      ? fetchPendingTeacherRemediation(opts.adminClient, studentId)
      : Promise.resolve(null);

  // Run the three reads in parallel — they are independent.
  const [dueCardsRes, todayQuizRes, inProgressRes, pendingTeacherRemediation] = await Promise.all([
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
    teacherRemediationPromise,
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
    pendingTeacherRemediation,
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

/**
 * Build the teacher-remediation action from a pending assignment (Phase 3A
 * Wave A / A3). REUSES the existing quiz route — no new quiz type. The chapter
 * anchor is, in priority order:
 *   1. the assignment's resolved (subjectCode, chapterNumber) from its
 *      curriculum_topics mapping (chapter-anchored assignment), else
 *   2. the student's WEAKEST chapter (general remediation, chapter_id null —
 *      reuses `weakestChapter`/`ctx.weakest`, the EXISTING fallback logic), else
 *   3. no anchor (neither resolved) → a generic, chapter-less quiz target.
 * Every variant carries `source:'teacher'` + the `assignmentId` so the UI tags
 * it "from your teacher" and the completion flow can flip its status.
 */
function buildTeacherRemediationAction(
  pending: PendingTeacherRemediation,
  ctx: BranchCtx,
): TeacherRemediationAction {
  // Anchor resolution: explicit assignment anchor → weakest chapter → none.
  const anchorSubject = pending.subjectCode ?? ctx.weakest?.subjectCode;
  const anchorChapter = pending.chapterNumber ?? ctx.weakest?.chapterNumber;

  const params = new URLSearchParams();
  if (anchorSubject) params.set('subject', anchorSubject);
  if (typeof anchorChapter === 'number') params.set('chapter', String(anchorChapter));
  // Tracking + provenance — the completion flow reads these to flip status.
  params.set('remediationId', pending.assignmentId);
  params.set('from', 'teacher');
  const url = `/quiz?${params.toString()}`;

  return {
    kind: 'teacher_remediation',
    url,
    source: 'teacher',
    assignmentId: pending.assignmentId,
    chapterId: pending.chapterId,
    ...(anchorSubject ? { subjectCode: anchorSubject } : {}),
    ...(typeof anchorChapter === 'number' ? { chapterNumber: anchorChapter } : {}),
    reason: 'teacher_assigned',
  };
}

// ── The resolver ─────────────────────────────────────────────────────

export interface ResolveOptions {
  /** Override "now" for deterministic tests. Defaults to new Date(). */
  now?: Date;
}

/**
 * Per-resolution context. Built ONCE per call and threaded through every
 * branch predicate + builder so a branch never recomputes a derived value
 * differently than the resolver used to. This is what makes the ordered
 * BRANCHES array byte-for-byte equivalent to the old if-ladder:
 *   - `attempts`, `decayed`, `weakest` are computed exactly once, exactly
 *     as the old function computed them (and in the same order).
 */
interface BranchCtx {
  now: Date;
  attempts: number;
  /** decayedChapters(state, now) — most-stale first. */
  decayed: ReturnType<typeof decayedChapters>;
  /** weakestChapter(state) — single weakest with signal, or null. */
  weakest: ReturnType<typeof weakestChapter>;
}

function buildBranchCtx(state: StudentState, now: Date): BranchCtx {
  return {
    now,
    attempts: totalAttempts(state),
    decayed: decayedChapters(state, now),
    weakest: weakestChapter(state),
  };
}

/**
 * A single resolver branch. `predicate` decides eligibility; `build`
 * produces the action. `build` is ONLY ever called when `predicate`
 * returned true for the same (state, augmentation, ctx), so it may assume
 * the predicate's guarantees (e.g. branch 3's builder assumes
 * `ctx.decayed.length > 0`).
 */
interface ResolverBranch {
  kind: ResolverAction['kind'];
  predicate(state: StudentState, aug: LoopAugmentation, ctx: BranchCtx): boolean;
  build(state: StudentState, aug: LoopAugmentation, ctx: BranchCtx): ResolverAction;
}

/**
 * THE single source of truth for "what next". Ordered branch array —
 * order IS the contract. `resolveNextLearnerAction` returns the FIRST
 * entry whose predicate is true; `resolveTodayQueue` returns ALL of them.
 * Every predicate / builder below (ranks 1-8) is lifted VERBATIM from the
 * previous if-ladder — no threshold, comparison, URL shape, or reason string
 * was changed. Pin with tests; do not reorder without an ADR.
 *
 *   0. teacher_remediation  — a teacher flagged this student × concept
 *                             (status assigned|in_progress). HIGHEST priority.
 *   1. cold_start_diagnostic — no mastery signal yet
 *   2. review_due_cards     — at least REVIEW_STACKING_THRESHOLD due today
 *   3. revise_decayed_topic — any chapter decayed past its window
 *   4. start_quiz (ZPD)     — not yet attempted today + a weakest chapter exists
 *   5. continue_lesson      — at least one in-progress lesson ≥ 50%
 *   6. weekly_dive          — Sunday IST
 *   7. monthly_synthesis    — last calendar day of the month IST
 *   8. start_quiz (default) — weakest chapter as the catch-all
 *
 * Branch 0 (teacher remediation, Phase 3A Wave A / A3) sits ABOVE cold-start:
 * a teacher-assigned task is the single most authoritative "do this next"
 * signal and must win even for a brand-new learner (a teacher would only
 * assign it because they SAW the student needs it). Branch 1 takes precedence
 * over ranks 2-8 because a cold-start learner with zero signal has nothing for
 * those branches to act on. Branches 6 and 7 sit below the daily branches
 * deliberately — Sunday and month-end are *defaults*, not overrides. A student
 * with 30 stacking reviews on a Sunday gets reviews, not a dive.
 */
const BRANCHES: ResolverBranch[] = [
  // Branch 0 — teacher-assigned remediation (HIGHEST priority). Fires whenever
  // the augmenter surfaced an open assignment. Reuses the existing quiz route +
  // the weakest-chapter fallback (no new quiz type); only tags source:'teacher'
  // and carries the assignmentId. NO scoring / XP / anti-cheat semantics here.
  {
    kind: 'teacher_remediation',
    predicate: (_state, aug) => !!aug.pendingTeacherRemediation,
    build: (_state, aug, ctx) =>
      buildTeacherRemediationAction(aug.pendingTeacherRemediation!, ctx),
  },

  // Branch 1 — cold start
  {
    kind: 'cold_start_diagnostic',
    predicate: (state, _aug, ctx) =>
      state.mastery.length === 0 ||
      ctx.attempts < LEARNER_LOOP_CONFIG.COLD_START_MAX_ATTEMPTS,
    build: () => ({
      kind: 'cold_start_diagnostic',
      url: '/diagnostic',
      reason: 'no_signals_yet',
    }),
  },

  // Branch 2 — due reviews stacking
  {
    kind: 'review_due_cards',
    predicate: (_state, aug) =>
      aug.dueReviewCount >= LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD,
    build: (_state, aug) => ({
      kind: 'review_due_cards',
      url: '/review',
      dueCount: aug.dueReviewCount,
      reason: 'reviews_stacking',
    }),
  },

  // Branch 3 — decayed topic needs a re-encounter with the source
  {
    kind: 'revise_decayed_topic',
    predicate: (_state, _aug, ctx) => ctx.decayed.length > 0,
    build: (_state, _aug, ctx) => {
      const top = ctx.decayed[0];
      return {
        kind: 'revise_decayed_topic',
        url: `/learn/${encodeURIComponent(top.subjectCode)}/${top.chapterNumber}?mode=read&from=revise`,
        subjectCode: top.subjectCode,
        chapterNumber: top.chapterNumber,
        daysSinceLastTouch: Math.round(top.daysSince),
        recommendedModality: modalityForMastery(top.mastery),
        reason: 'decay_above_threshold',
      };
    },
  },

  // Branch 4 — today's ZPD (only if not yet attempted today and there's a
  // weakest chapter to point at)
  {
    kind: 'start_quiz',
    predicate: (_state, aug, ctx) => !aug.attemptedQuizToday && ctx.weakest !== null,
    build: (_state, _aug, ctx) => {
      const weakest = ctx.weakest!;
      return {
        kind: 'start_quiz',
        url: `/quiz?subject=${encodeURIComponent(weakest.subjectCode)}&chapter=${weakest.chapterNumber}`,
        subjectCode: weakest.subjectCode,
        chapterNumber: weakest.chapterNumber,
        zpdBin: LEARNER_LOOP_CONFIG.ZPD_BIN_FOR_MASTERY(weakest.mastery),
        reason: 'todays_zpd',
      };
    },
  },

  // Branch 5 — continue an in-progress lesson
  {
    kind: 'continue_lesson',
    predicate: (_state, aug) => aug.inProgressLessons.length > 0,
    build: (_state, aug) => {
      const top = aug.inProgressLessons[0];
      return {
        kind: 'continue_lesson',
        url: `/learn/${encodeURIComponent(top.subjectCode)}/${top.chapterNumber}`,
        subjectCode: top.subjectCode,
        chapterNumber: top.chapterNumber,
        progressPct: top.progressPct,
        reason: 'in_progress_lesson',
      };
    },
  },

  // Branch 6 — Sunday weekly dive default
  {
    kind: 'weekly_dive',
    predicate: (_state, _aug, ctx) => isSundayIst(ctx.now),
    build: (state, _aug, ctx) => {
      const weakSubject =
        ctx.weakest?.subjectCode ?? state.mastery[0]?.subjectCode ?? 'science';
      return {
        kind: 'weekly_dive',
        url: '/dive',
        suggestedPrompt: `Pick a phenomenon from ${weakSubject} you're curious about`,
        reason: 'sunday_default',
      };
    },
  },

  // Branch 7 — month-end synthesis default
  {
    kind: 'monthly_synthesis',
    predicate: (_state, _aug, ctx) => isMonthEndDayIst(ctx.now),
    build: () => ({
      kind: 'monthly_synthesis',
      url: '/progress?view=synthesis',
      reason: 'month_end_default',
    }),
  },

  // Branch 8 — catch-all: weakest-topic quiz. weakest is guaranteed
  // non-null here because branch 1 caught the empty-mastery case.
  {
    kind: 'start_quiz',
    predicate: (_state, _aug, ctx) => ctx.weakest !== null,
    build: (_state, _aug, ctx) => {
      const weakest = ctx.weakest!;
      return {
        kind: 'start_quiz',
        url: `/quiz?subject=${encodeURIComponent(weakest.subjectCode)}&chapter=${weakest.chapterNumber}`,
        subjectCode: weakest.subjectCode,
        chapterNumber: weakest.chapterNumber,
        zpdBin: LEARNER_LOOP_CONFIG.ZPD_BIN_FOR_MASTERY(weakest.mastery),
        reason: 'weakest_topic_practice',
      };
    },
  },
];

/**
 * Pure resolver. Returns the FIRST eligible branch's action — identical
 * behaviour to the historical if-ladder, now driven by the ordered
 * BRANCHES array (the single source of truth shared with
 * `resolveTodayQueue`).
 */
export function resolveNextLearnerAction(
  state: StudentState,
  augmentation: LoopAugmentation,
  options: ResolveOptions = {},
): ResolverAction {
  const now = options.now ?? new Date();
  const ctx = buildBranchCtx(state, now);

  for (const branch of BRANCHES) {
    if (branch.predicate(state, augmentation, ctx)) {
      return branch.build(state, augmentation, ctx);
    }
  }

  // Defensive — unreachable given branch 1 catches empty mastery and
  // branch 8 fires whenever a weakest chapter exists. Typesafe fallback.
  return {
    kind: 'cold_start_diagnostic',
    url: '/diagnostic',
    reason: 'no_signals_yet',
  };
}

// ── The Today queue (Wave A) ─────────────────────────────────────────

/**
 * Derive the live-session resume action from `state.live`. Returns null
 * when the learner is idle. The URL reuses the live state's existing
 * target derivation — no new routes are invented here:
 *   - in_quiz   → /quiz   (the runtime resumes from the open session)
 *   - in_foxy   → /foxy   (the chat resumes the open thread)
 *   - in_lesson → /learn/{subjectCode}/{chapterNumber}  (same shape the
 *                 continue_lesson branch already builds)
 */
function resumeActionFromLive(state: StudentState): LearnerAction | null {
  const live = state.live;
  switch (live.kind) {
    case 'in_quiz':
      return {
        kind: 'resume_in_progress',
        url: '/quiz',
        liveKind: 'in_quiz',
        subjectCode: live.subjectCode,
        chapterNumber: live.chapterNumber,
        reason: 'live_session',
      };
    case 'in_foxy':
      return {
        kind: 'resume_in_progress',
        url: '/foxy',
        liveKind: 'in_foxy',
        // foxy live state may have a null subject; omit chapter (no anchor).
        ...(live.subjectCode ? { subjectCode: live.subjectCode } : {}),
        reason: 'live_session',
      };
    case 'in_lesson':
      return {
        kind: 'resume_in_progress',
        url: `/learn/${encodeURIComponent(live.subjectCode)}/${live.chapterNumber}`,
        liveKind: 'in_lesson',
        subjectCode: live.subjectCode,
        chapterNumber: live.chapterNumber,
        reason: 'live_session',
      };
    case 'idle':
      return null;
  }
}

/**
 * Wave A — the ordered "Today queue".
 *
 * Runs the SAME ordered BRANCHES predicates as `resolveNextLearnerAction`
 * (one source of truth — no duplicated branch logic) and collects EVERY
 * eligible branch, in order, instead of stopping at the first. Layered on
 * top, per the approved assessment contract:
 *
 *   - LIVE-RESUME EXCEPTION: if `state.live.kind !== 'idle'`, a synthetic
 *     `resume_in_progress` action is prepended as `primary` and `queue[0]`
 *     (a live activity always wins the CTA). This is the ONLY case where
 *     `primary` differs from the raw first-match branch. `branch` still
 *     reports what the raw resolver chose.
 *
 *   - COLD-START SHORT-CIRCUIT: if branch 1 (cold_start_diagnostic) is
 *     eligible, the queue is ONLY `[resume?, cold_start_diagnostic]` —
 *     ranks 2-8 are suppressed (a learner with no signal has nothing for
 *     them to act on).
 *
 *   - SRS SOFT VARIANT: branch 2 fires at dueReviewCount >= threshold. The
 *     queue MAY additionally surface a softer review item when
 *     `1 <= dueReviewCount < threshold`, reusing the already-declared
 *     `reviews_due_today` reason (no new constant). It is inserted in
 *     branch-2 order but CLAMPED to after the primary — the soft review is
 *     supplementary and must never displace the CTA (preserving the
 *     `queue[0] === primary === raw first-match` invariant).
 *
 *   - DE-DUP: when the resume action came from an in-progress lesson, the
 *     rank-5 continue_lesson for the SAME chapter is suppressed (don't show
 *     the same chapter twice).
 *
 *   - TRUNCATION: the final queue is capped at MAX_TODAY_QUEUE_ITEMS.
 *
 * Read-only. Pure over (state, augmentation, now). No DB writes, no
 * mutation, no scoring / XP / mastery math.
 */
export function resolveTodayQueue(
  state: StudentState,
  augmentation: LoopAugmentation,
  opts: { now: Date },
): TodayQueueResult {
  const now = opts.now;
  const ctx = buildBranchCtx(state, now);

  // The raw first-match branch — what resolveNextLearnerAction returns.
  // We re-derive it from the SAME ordered array (no duplicated predicate).
  let firstMatchIndex = -1;
  for (let i = 0; i < BRANCHES.length; i++) {
    if (BRANCHES[i].predicate(state, augmentation, ctx)) {
      firstMatchIndex = i;
      break;
    }
  }
  const rawFirst: LearnerAction =
    firstMatchIndex >= 0
      ? BRANCHES[firstMatchIndex].build(state, augmentation, ctx)
      : // Defensive parity with resolveNextLearnerAction's fallback.
        { kind: 'cold_start_diagnostic', url: '/diagnostic', reason: 'no_signals_yet' };
  const branch: LearnerActionKind = rawFirst.kind;

  // Live-resume exception — a mid-session activity always wins the CTA.
  const resume = resumeActionFromLive(state);

  // TEACHER-REMEDIATION PRECEDENCE (Phase 3A Wave A / A3) — a teacher-assigned
  // task outranks even cold-start, so when it is eligible we must NOT take the
  // cold-start short-circuit below (which would suppress it). We look branches
  // up by `kind` (not index) so this stays correct regardless of array order.
  const teacherBranch = BRANCHES.find((b) => b.kind === 'teacher_remediation')!;
  const teacherEligible = teacherBranch.predicate(state, augmentation, ctx);

  // COLD-START SHORT-CIRCUIT — cold-start eligible (and NO teacher assignment)
  // ⇒ queue is only [resume?, cold_start_diagnostic]; suppress ranks 2-8
  // entirely. A pending teacher assignment skips this so it surfaces.
  const coldBranch = BRANCHES.find((b) => b.kind === 'cold_start_diagnostic')!;
  const coldStartEligible = coldBranch.predicate(state, augmentation, ctx);
  if (coldStartEligible && !teacherEligible) {
    const cold = coldBranch.build(state, augmentation, ctx);
    const queue: LearnerAction[] = resume ? [resume, cold] : [cold];
    const truncated = queue.slice(0, MAX_TODAY_QUEUE_ITEMS);
    return {
      primary: truncated[0],
      queue: truncated,
      branch,
    };
  }

  // Build the ordered queue of EVERY eligible branch, in branch order.
  // `rawFirst` (the genuine primary) is always the FIRST element — the
  // SRS soft variant is supplementary and must never displace the CTA, so
  // it is inserted in branch order but clamped to AFTER `rawFirst`. (The
  // soft variant only ever applies when branch-2's HARD predicate is false;
  // if it were true, branch 2 would itself be `rawFirst`.)
  const queue: LearnerAction[] = [];
  // Holds a soft-review item whose branch-2 ordinal sorts BEFORE the primary,
  // until the primary is emitted (so it never leads the queue).
  let pendingSoftReview: LearnerAction | null = null;

  for (let i = 0; i < BRANCHES.length; i++) {
    const b = BRANCHES[i];

    // SRS soft variant — sits at branch-2's position, but never before the
    // primary. Only when the hard branch-2 predicate is NOT met but at least
    // one review is due, and the primary itself is not already the review
    // branch.
    if (
      b.kind === 'review_due_cards' &&
      !b.predicate(state, augmentation, ctx) &&
      rawFirst.kind !== 'review_due_cards'
    ) {
      const due = augmentation.dueReviewCount;
      if (due >= 1 && due < LEARNER_LOOP_CONFIG.REVIEW_STACKING_THRESHOLD) {
        const soft: LearnerAction = {
          kind: 'review_due_cards',
          url: '/review',
          dueCount: due,
          reason: 'reviews_due_today',
        };
        // If the primary hasn't been emitted yet (its branch sorts after
        // branch 2), the soft item would land before it — defer it so the
        // queue stays led by `rawFirst`. We push it now only when the queue
        // already contains the primary.
        if (queue.length > 0) {
          queue.push(soft);
        } else {
          pendingSoftReview = soft;
        }
      }
    }

    if (b.predicate(state, augmentation, ctx)) {
      queue.push(b.build(state, augmentation, ctx));
      // Flush a deferred soft-review immediately AFTER the primary so it
      // keeps its branch-2 adjacency without ever leading the queue.
      if (pendingSoftReview !== null) {
        queue.push(pendingSoftReview);
        pendingSoftReview = null;
      }
    }
  }
  // Edge case: a deferred soft review with no eligible hard branch after it
  // (shouldn't happen — branch 8 fires whenever a weakest chapter exists —
  // but stay defensive so the item is never silently dropped).
  if (pendingSoftReview !== null) {
    queue.push(pendingSoftReview);
    pendingSoftReview = null;
  }

  // DE-DUP — if the resume action is an in-progress lesson, drop the
  // rank-5 continue_lesson for the SAME chapter (same card twice).
  let deduped = queue;
  if (resume && resume.kind === 'resume_in_progress' && resume.liveKind === 'in_lesson') {
    deduped = queue.filter(
      a =>
        !(
          a.kind === 'continue_lesson' &&
          a.subjectCode === resume.subjectCode &&
          a.chapterNumber === resume.chapterNumber
        ),
    );
  }

  // Prepend the live-resume action (wins the CTA), then truncate.
  const withResume: LearnerAction[] = resume ? [resume, ...deduped] : deduped;
  const finalQueue = withResume.slice(0, MAX_TODAY_QUEUE_ITEMS);

  return {
    // primary === resume when live, else the raw first-match branch.
    primary: finalQueue[0] ?? rawFirst,
    queue: finalQueue,
    branch,
  };
}
