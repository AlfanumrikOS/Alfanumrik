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

import type { Subject } from '@/lib/subjects.types';
import type { TodayQueueItem } from '@/lib/today/types';
import { todayCopy } from '@/lib/today/copy';

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
 * Absent fields are simply not added — `todayCopy` leaves any unsupplied token
 * untouched, but every subtitle template only references tokens its own type
 * provides, so resolved subtitles are always complete.
 */
function varsForItem(
  item: TodayQueueItem,
  subjects: Subject[],
  isHi: boolean,
): Record<string, string | number> {
  const meta = item.meta ?? {};
  const vars: Record<string, string | number> = {
    subject: resolveSubjectName(meta.subjectCode, subjects, isHi),
  };
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
