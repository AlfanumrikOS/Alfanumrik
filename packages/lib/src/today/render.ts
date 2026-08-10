/**
 * src/lib/today/render.ts — shared, presentation-only helpers that turn a
 * `TodayQueueItem` into resolved bilingual strings. Centralised here so the
 * focus card and the queue-row component resolve copy IDENTICALLY (one source
 * of interpolation-var assembly, one source of subject-name lookup).
 *
 * No business logic — pure projection over the render DTO + the (already
 * fetched) allowed-subjects list. Subject names come from the canonical
 * bilingual `Subject` list (`useAllowedSubjects`), never hardcoded.
 */

import type { Subject } from '@alfanumrik/lib/subjects.types';
import type { TodayQueueItem } from '@alfanumrik/lib/today/types';
import { todayCopy, todayReasonCopy } from '@alfanumrik/lib/today/copy';

/** Language subjects whose names are ALWAYS shown in native Devanagari script
 *  regardless of UI language — culturally correct in Indian education. */
export const ALWAYS_NATIVE_SCRIPT: Record<string, string> = {
  hindi: 'हिंदी',
  sanskrit: 'संस्कृत',
};

/**
 * Resolve a subject CODE (from `item.meta.subjectCode`) to its bilingual
 * display name using the canonical allowed-subjects list. Falls back to a
 * generic word when the code is absent or unknown, so subtitles never render a
 * raw `{subject}` token or an internal code.
 */
function resolveSubjectName(
  subjectCode: unknown,
  subjects: Subject[],
  isHi: boolean,
): string {
  if (typeof subjectCode === 'string' && subjectCode.length > 0) {
    if (ALWAYS_NATIVE_SCRIPT[subjectCode]) return ALWAYS_NATIVE_SCRIPT[subjectCode];
    const match = subjects.find((s) => s.code === subjectCode);
    if (match) return isHi ? match.nameHi : match.name;
  }
  // Graceful generic fallback — "your subject" / "अपने विषय".
  return isHi ? 'अपने विषय' : 'your subject';
}

/**
 * Build the `{subject}`/`{dueCount}`/`{days}`/`{progress}` interpolation vars
 * for a queue item from its `meta` (lifted verbatim from the source action).
 * The user-facing render layer supplies safe fallbacks for optional tokens so
 * sparse resolver payloads never leak raw placeholders into cards.
 */
function varsForItem(
  item: TodayQueueItem,
  subjects: Subject[],
  isHi: boolean,
): Record<string, string | number> {
  const meta = item.meta ?? {};
  const vars: Record<string, string | number> = {
    subject: resolveSubjectName(meta.subjectCode, subjects, isHi),
    chapterTitle: '',
  };
  const chapterTitle = isHi ? (item.chapterTitleHi ?? item.chapterTitle) : item.chapterTitle;
  if (typeof chapterTitle === 'string' && chapterTitle.trim().length > 0) {
    vars.chapterTitle = ` · ${chapterTitle.trim()}`;
  }
  if (typeof meta.dueCount === 'number') vars.dueCount = meta.dueCount;
  if (typeof meta.daysSinceLastTouch === 'number') vars.days = meta.daysSinceLastTouch;
  if (typeof meta.progressPct === 'number') vars.progress = Math.round(meta.progressPct);
  if (typeof meta.chapterNumber === 'number') vars.chapter = meta.chapterNumber;
  return vars;
}

/** Resolved, ready-to-render copy for a single Today item. */
export interface ResolvedItemCopy {
  label: string;
  subtitle: string;
  /** Pre-formatted "~N min" badge. */
  minutesBadge: string;
}

/**
 * Resolve a queue item's label, subtitle, and minutes badge into final
 * bilingual strings. The one entry point both Today components use.
 */
export function resolveItemCopy(
  item: TodayQueueItem,
  subjects: Subject[],
  isHi: boolean,
): ResolvedItemCopy {
  const vars = varsForItem(item, subjects, isHi);
  return {
    label: todayCopy(item.labelKey, isHi, vars),
    subtitle: todayCopy(item.subtitleKey, isHi, vars),
    minutesBadge: todayCopy('today.minutesBadge', isHi, { n: item.estMinutes }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   Phase 4 — the primary-recommendation facets.

   The primary card has to answer, in five seconds: what subject, what topic,
   what kind of work, how much effort, WHY, and where am I in it. Those are six
   independent fields, not one prose subtitle, so they get resolved as six
   independent values here rather than being re-parsed out of `subtitle` by the
   component.

   Honesty rules encoded below (these are the whole point of this block):
     - `subject` / `concept` are null when the DTO does not carry them. The
       component omits the row; it never prints the "your subject" filler that
       `resolveItemCopy` uses inside a sentence, because a labelled "Subject:"
       row reading "your subject" looks like real data and isn't.
     - `estMinutes` is null unless the number is DERIVED FROM LEARNER DATA.
       See `reliableEstMinutes`.
     - `reason` is null for any reason the copy table doesn't know, so an
       unmapped resolver branch shows no justification rather than a made-up
       one or a raw machine string.
   ═════════════════════════════════════════════════════════════════════════ */

/**
 * Estimated effort, but ONLY when it is a real signal.
 *
 * `TodayQueueItem.estMinutes` is populated by `map-action.ts` from a static
 * per-type table (`TYPE_PRESENTATION` — quiz 7, lesson 6, dive 15 …). Those
 * constants are presentation placeholders chosen at authoring time; they are
 * not measured, not per-student, and not derived from anything this learner
 * did. Printing them on the primary card is inventing a number.
 *
 * The ONE exception is `srs_due`, whose `estMinutes` map-action computes as
 * `min(dueCount, 5)` from the live due-card count — that is derived from real
 * learner state, so it is shown.
 *
 * TODO(assessment): if a real per-activity effort model lands (median
 * completion time per item type × learner), widen this predicate to consume
 * it. Until then, omitting is the correct behaviour.
 */
export function reliableEstMinutes(item: TodayQueueItem): number | null {
  if (item.type !== 'srs_due') return null;
  const dueCount = item.meta?.dueCount;
  if (typeof dueCount !== 'number' || dueCount <= 0) return null;
  if (typeof item.estMinutes !== 'number' || item.estMinutes <= 0) return null;
  return item.estMinutes;
}

/** Progress through the item, when the DTO carries a real percentage. */
function reliableProgressPct(item: TodayQueueItem): number | null {
  const pct = item.meta?.progressPct;
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return null;
  // The resolver carries `progressPct` as a 0..1 fraction (chapter_progress'
  // pool_coverage_percent / 100). Normalise to a 0..100 integer here, in the
  // one place that renders it.
  const asPercent = pct <= 1 ? pct * 100 : pct;
  const rounded = Math.round(asPercent);
  if (rounded <= 0 || rounded >= 100) return null;
  return rounded;
}

/** The six independent fields the primary recommendation card renders. */
export interface TodayItemFacets {
  /** Bilingual subject display name, or null when the item carries no subject. */
  subject: string | null;
  /** Chapter/topic title in the active language, or null when absent. */
  concept: string | null;
  /** What kind of work this is (closed vocabulary, always present). */
  activity: string;
  /** Estimated minutes, or null when no reliable estimate exists. */
  estMinutes: number | null;
  /** One of the six approved learner-facing phrases, or null when unmapped. */
  reason: string | null;
  /** Where the learner already is in this item. */
  status: { kind: 'in_progress' | 'partway' | 'not_started'; text: string };
}

/**
 * Resolve the primary card's six facets. Pure projection over the render DTO
 * plus the already-fetched allowed-subjects list.
 */
export function resolveItemFacets(
  item: TodayQueueItem,
  subjects: Subject[],
  isHi: boolean,
): TodayItemFacets {
  const code = item.meta?.subjectCode;
  const hasSubject = typeof code === 'string' && code.length > 0;
  const subject = hasSubject ? resolveSubjectName(code, subjects, isHi) : null;

  const rawConcept = isHi ? (item.chapterTitleHi ?? item.chapterTitle) : item.chapterTitle;
  const concept =
    typeof rawConcept === 'string' && rawConcept.trim().length > 0 ? rawConcept.trim() : null;

  const progressPct = reliableProgressPct(item);
  let status: TodayItemFacets['status'];
  if (item.type === 'resume_in_progress') {
    status = { kind: 'in_progress', text: todayCopy('today.primary.status.inProgress', isHi) };
  } else if (progressPct !== null) {
    status = {
      kind: 'partway',
      text: todayCopy('today.primary.status.partway', isHi, { progress: progressPct }),
    };
  } else {
    status = { kind: 'not_started', text: todayCopy('today.primary.status.notStarted', isHi) };
  }

  return {
    subject,
    concept,
    activity: todayCopy(`today.activity.${item.type}`, isHi),
    estMinutes: reliableEstMinutes(item),
    reason: todayReasonCopy(item.reason, isHi),
    status,
  };
}

/**
 * The primary CTA verb. "Continue" for anything the learner is already inside;
 * "Start" otherwise. One primary action per screen — this is its label.
 */
export function primaryCtaLabel(item: TodayQueueItem, isHi: boolean): string {
  const isContinuation =
    item.type === 'resume_in_progress' || item.type === 'continue_lesson';
  return todayCopy(
    isContinuation ? 'today.primary.cta.continue' : 'today.primary.cta.start',
    isHi,
  );
}

/**
 * Phase 3A Wave A — is this item a teacher-assigned remediation? True when the
 * resolver tagged it `source:'teacher'` (carried verbatim in `item.meta`). The
 * UI renders a visible "from your teacher" tag for these. Robust to absence:
 * any item without the marker returns false.
 */
export function isTeacherAssigned(item: TodayQueueItem): boolean {
  return item.type === 'teacher_remediation' || item.meta?.source === 'teacher';
}

/** The `teacher_remediation_assignments.id` a teacher-assigned item carries
 *  (for the completion `resolve` call), or null when absent. */
export function teacherAssignmentId(item: TodayQueueItem): string | null {
  const id = item.meta?.assignmentId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** Bilingual "from your teacher" tag text. */
export function fromTeacherLabel(isHi: boolean): string {
  return todayCopy('today.item.teacher_remediation.fromTeacher', isHi);
}
