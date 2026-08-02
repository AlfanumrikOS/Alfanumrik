/**
 * packages/lib/src/exams/types.ts — the exam-schedule render DTO (Wave B).
 *
 * Canonical location for the "when is my test" contract shared between the
 * `useExamSchedule` reader hook (this package) and the `ExamSchedule`
 * presentation components (`@alfanumrik/ui/exams/v2/ExamSchedule`). Lib owns
 * the DTO, UI consumes it — the same layering `today/types.ts` →
 * `ui/today/*.tsx` already establishes elsewhere in this codebase.
 *
 * Moved here 2026-08-02 from the UI component file it originally lived in,
 * which had a `packages/lib` hook importing a type from `packages/ui` —
 * backwards from every other pattern in this repo.
 *
 * PROPOSED read DTO — `GET /api/v2/exam-schedule` is implemented against this
 * exact shape (see `use-exam-schedule.ts`), gated by `ff_exam_schedule_v1`.
 * Precedence school > teacher > student is enforced server-side in the read
 * union; reflected here only as the `source` discriminant the UI styles by.
 */

import type { ExamReadinessBand } from './mastery-band';

// Re-exported so consumers of this DTO (both the `useExamSchedule` hook and
// the `ExamSchedule` UI components) can get the whole entry shape — including
// the nested band type — from this one module, without a second import from
// `./mastery-band`. Still the same single canonical type; see that module's
// header for why it must not be re-declared.
export type { ExamReadinessBand };

export type ExamSource = 'school' | 'teacher' | 'student';

export interface ExamScheduleEntry {
  id: string;
  source: ExamSource;
  /** Already-localised title. Never build copy in the presentation layer. */
  title: string;
  /** ISO-8601 date (start date for a multi-day window). */
  startsOn: string;
  /** ISO-8601 date. Equal to startsOn for a single-day test. */
  endsOn: string;
  /** Human-readable day label, pre-formatted by `useExamSchedule` ("Thu", "22–30 Sep"). */
  dayLabel: string;
  /** Who set it — teacher name or school name. Absent for student entries. */
  setBy?: string;
  /** Initials for the teacher avatar. Absent unless source === 'teacher'. */
  setByInitials?: string;
  /** Chapter scope. Present for teacher entries; this is what narrows revision.
   *  Absent for school windows (they scope the whole term). */
  chapters?: Array<{
    /** curriculum_topics.id */
    id: string;
    label: string;
    /** The canonical exam-readiness band — see `./mastery-band` for why this
     *  reuses that relabelling of `concept_mastery.mastery_level` rather than
     *  a locally-invented cutoff set. */
    band: ExamReadinessBand;
  }>;
  /** True only for source === 'student'; drives the edit affordance. */
  editable?: boolean;
}
