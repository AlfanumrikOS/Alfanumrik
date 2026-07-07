// src/lib/pulse/types.ts
//
// Student Pulse — API contract types (the wire shape every Pulse route returns
// and the frontend consumes). These are the single source of truth for the
// Pulse HTTP layer; the frontend `src/components/pulse/*` and the SWR hooks in
// `src/lib/pulse/use-pulse.ts` import from here so the wire shape never drifts
// from the server.
//
// Signal math + signal types live in `src/lib/pulse/signals.ts` (the pure
// derivation layer). This file REUSES `PulseSignals` from there and adds the
// route-level envelope (status, timeline, mastery summary) the lenses return.
//
// Convention note: `src/lib/types.ts` is a flat registry of raw DB-row
// interfaces (Student, Subject, …), NOT a re-export hub. Self-contained feature
// contracts (e.g. the SWR `LearnerNextResponse` in `src/lib/swr.tsx`, the
// school-admin `command-center-types.ts`) live next to their feature. Pulse
// follows that established pattern: the contract lives here, co-located with the
// signals + hooks it serves.
//
// P5: grades are strings ("6".."12"). P13: every field below is a derived
// verdict / count / non-PII identifier or a name the VIEWER is already
// authorized to see — no raw PII beyond the authorized surface.

import type { PulseSignals } from './signals';

// Re-export the signal types so a frontend consumer can import everything Pulse
// from one module (`@alfanumrik/lib/pulse/types`) without also reaching into signals.ts.
export type {
  PulseSignals,
  InactivitySignal,
  MasteryCliffSignal,
  AtRiskConcentrationSignal,
  SubjectConcentration,
  InactivityVerdict,
  MasteryCliffVerdict,
  ConcentrationBand,
} from './signals';

// ════════════════════════════════════════════════════════════════════════════
// SHARED PRIMITIVES
// ════════════════════════════════════════════════════════════════════════════

/**
 * Coarse, at-a-glance status for a learner. Derived from the three signals so a
 * lens (or a list row) can render one badge without re-reading every signal:
 *   - 'thriving'   — no risk signal firing.
 *   - 'steady'     — minor / single low-severity signal.
 *   - 'watch'      — a meaningful risk signal (grace-day inactivity, a forming
 *                    concentration cluster, or a flagged mastery cliff).
 *   - 'at_risk'    — a strong risk signal (broken streak, high concentration).
 *   - 'unknown'    — not enough data to judge (new learner / pruned history).
 */
export type PulseStatus =
  | 'thriving'
  | 'steady'
  | 'watch'
  | 'at_risk'
  | 'unknown';

/**
 * One activity-timeline entry, projected from a `state_events` row. Carries the
 * event kind, when it happened, and a SMALL, non-PII payload subset (subject /
 * chapter / verdict-ish fields only) — never the raw event payload (which can
 * contain identifiers the viewer shouldn't see). Mirrors the `state_events`
 * column shape (`kind`, `occurred_at`, `payload`).
 */
export interface PulseTimelineEntry {
  /** `state_events.kind`, e.g. 'learner.quiz_completed', 'learner.mastery_changed'. */
  kind: string;
  /** ISO-8601 `state_events.occurred_at`. */
  occurredAt: string;
  /**
   * A bounded, non-PII subset of the event payload (subject code, chapter
   * number, mastery deltas, score, etc.). Never the full raw payload — the
   * route whitelists fields. Shape varies by kind; consumers branch on `kind`.
   */
  summary: Record<string, string | number | boolean | null>;
}

/**
 * Per-subject strength / at-risk rollup, derived from the `learner_mastery`
 * snapshots. `meanMastery` is the average chapter mastery (0..1) for the
 * subject; `atRiskChapterCount` mirrors the concentration signal's < 0.4 count.
 */
export interface SubjectMasterySummaryEntry {
  /** Subject code, lowercase (as stored in `learner_mastery.subject_code`). */
  subject: string;
  /** Mean chapter mastery for the subject (0..1); null when no signal. */
  meanMastery: number | null;
  /** Total chapters with a mastery reading for this subject. */
  chapterCount: number;
  /** Chapters with mastery < 0.4 (the platform at-risk line). */
  atRiskChapterCount: number;
}

/**
 * Compact mastery summary for a single learner: the per-subject rollup plus a
 * derived strengths / at-risk split for quick rendering. Strengths are the
 * highest-mastery subjects; atRisk are the subjects carrying the most at-risk
 * chapters. Both are ordered best/worst-first.
 */
export interface MasterySummary {
  /** One entry per subject the learner has any mastery reading for. */
  bySubject: SubjectMasterySummaryEntry[];
  /** Up to 3 strongest subjects (highest meanMastery first). Codes only. */
  strengths: string[];
  /** Up to 3 most-at-risk subjects (most at-risk chapters first). Codes only. */
  atRisk: string[];
  /** Total chapters with mastery < 0.4 across all subjects. */
  totalAtRiskChapters: number;
}

// ════════════════════════════════════════════════════════════════════════════
// 1 + 2. SINGLE-STUDENT PULSE  (/api/pulse/me, /api/pulse/student/[id])
// ════════════════════════════════════════════════════════════════════════════

/**
 * The full Pulse for ONE learner. Returned by `/api/pulse/me` (self lens) and
 * `/api/pulse/student/[id]` (parent / teacher / principal / admin / self lens).
 * Both routes return the identical shape — only the authorization differs.
 */
export interface PulseResponse {
  /** Coarse one-badge status derived from `signals`. */
  status: PulseStatus;
  /** Recent activity timeline (newest first), ~10 entries, non-PII summaries. */
  timeline: PulseTimelineEntry[];
  /** Per-subject mastery rollup + strengths / at-risk split. */
  masterySummary: MasterySummary;
  /** The three derived Pulse signals (inactivity, mastery cliff, concentration). */
  signals: PulseSignals;
  /** Marker so a consumer can branch on the contract version if it evolves. */
  schemaVersion: 1;
  /** ISO-8601 build time of this Pulse (server clock). */
  generatedAt: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. CLASS PULSE  (/api/pulse/class/[classId])
// ════════════════════════════════════════════════════════════════════════════

/**
 * A LIGHTWEIGHT pulse row for one student in a class roster. NO full timeline
 * (that would be N× expensive and is not needed for the class triage view) —
 * just the status + signals + a tiny mastery headline so a teacher can scan the
 * roster worst-first. `studentId` is the `students.id` (the teacher already has
 * roster-level access to it); `displayName` is the roster name the teacher can
 * already see (P13: authorized surface).
 */
export interface PulseListItem {
  /** `students.id`. */
  studentId: string;
  /** Roster display name (already visible to the teacher). */
  displayName: string;
  /** Grade as a STRING ("6".."12") per P5; null when unknown. */
  grade: string | null;
  /** Coarse one-badge status derived from `signals`. */
  status: PulseStatus;
  /** The three derived signals (same math as the single-student lens). */
  signals: PulseSignals;
  /** Total chapters with mastery < 0.4 for this student (roster sort key proxy). */
  totalAtRiskChapters: number;
}

/**
 * Response of `/api/pulse/class/[classId]`. A sorted (worst-signal-first) list
 * of lightweight pulse items for the active roster, plus the class id and a
 * count. Built from BULK queries (one learner_mastery, one students, one
 * state_events scoped to the roster) — never N× `buildStudentState`.
 */
export interface ClassPulseResponse {
  classId: string;
  /** Active-roster pulse rows, sorted worst-signal-first. */
  students: PulseListItem[];
  /** Number of rows returned (== students.length). */
  count: number;
  schemaVersion: 1;
  generatedAt: string;
}

// ════════════════════════════════════════════════════════════════════════════
// 4. SCHOOL PULSE  (/api/pulse/school)
// ════════════════════════════════════════════════════════════════════════════

/**
 * One at-risk class row in the school summary. Mirrors the Phase 3B
 * `get_classes_at_risk` RPC row — REUSED verbatim, not re-aggregated. Grade is a
 * string per P5.
 */
export interface SchoolPulseClassRow {
  classId: string;
  className: string;
  grade: string | null;
  studentCount: number;
  atRiskCount: number;
  /** AVG BKT p_know (0..1) across the class; null when no signal. */
  avgMastery: number | null;
}

/**
 * School-level Pulse summary. Built ENTIRELY by composing the Phase 3B read
 * models `get_school_overview` + `get_classes_at_risk` (no scratch aggregation).
 * `dataState` is the RPC's own `data_state` hint so the UI never fabricates
 * numbers for an empty school.
 */
export interface SchoolPulse {
  schoolId: string;
  /** Headline counts (from get_school_overview). */
  overview: {
    classCount: number;
    teacherCount: number;
    studentCount: number;
    /** AVG BKT p_know across the active roster (0..1); null when none. */
    avgMastery: number | null;
  };
  /** Per-class at-risk rollup, most-at-risk first (from get_classes_at_risk). */
  classesAtRisk: SchoolPulseClassRow[];
  /** 'live' when there is real signal; 'no_data' for an empty school. */
  dataState: 'live' | 'no_data';
  schemaVersion: 1;
  generatedAt: string;
}
