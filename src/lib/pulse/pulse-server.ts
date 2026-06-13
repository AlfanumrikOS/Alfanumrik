// src/lib/pulse/pulse-server.ts
//
// Student Pulse — SERVER-ONLY assembly helpers. Turns already-authorized,
// RLS-scoped DB reads into the `PulseResponse` / `PulseListItem` wire shapes.
//
// This module is the bridge between the pure signal math (`signals.ts`) and the
// four API routes. It NEVER authorizes — every exported function assumes the
// caller has ALREADY passed `authorizeRequest` + the appropriate ownership
// check (`canAccessStudent`, class ownership, school membership). It uses the
// service-role admin client for the bulk reads, which is legitimate because the
// boundary was enforced upstream (P8: `supabase-admin` is server-only and the
// canAccessStudent / class-ownership gate is the actual security boundary).
//
// What it reuses (does NOT duplicate):
//   - `deriveSignals` + types from `./signals` (the pure math).
//   - `createStudentStateBuilder` / `buildStudentState` from
//     `@/lib/state/student-state-builder` for the single-student engagement +
//     live + identity read (XP, level, streak, last_active, mastery rollup).
//   - The `learner_mastery` + `state_events` tables for snapshots + timeline.
//
// P5: grades are strings, passed through verbatim. P13: timeline summaries are a
// whitelisted, non-PII subset of each event payload — never the raw payload.

import type { SupabaseClient } from '@supabase/supabase-js';
import { deriveSignals, PULSE_THRESHOLDS } from './signals';
import type {
  PulseRawInput,
  MasteryChangeEvent,
  SubjectMasterySnapshot,
  PulseSignals,
} from './signals';
import type {
  PulseResponse,
  PulseStatus,
  PulseTimelineEntry,
  MasterySummary,
  SubjectMasterySummaryEntry,
  PulseListItem,
} from './types';
import { createStudentStateBuilder } from '@/lib/state/student-state-builder';
import type { StudentState } from '@/lib/state/student-state';

/** How many recent timeline events the single-student lens returns. */
const TIMELINE_LIMIT = 10;
/** How many recent mastery_changed events feed the cliff signal. */
const MASTERY_EVENT_LIMIT = 30;

// ════════════════════════════════════════════════════════════════════════════
// DB ROW SHAPES (the columns we read)
// ════════════════════════════════════════════════════════════════════════════

interface LearnerMasteryRow {
  auth_user_id: string;
  subject_code: string;
  chapter_number: number;
  mastery: number;
  last_updated_at: string;
}

interface StateEventRow {
  kind: string;
  occurred_at: string;
  payload: Record<string, unknown> | null;
}

interface StudentIdentityRow {
  id: string;
  auth_user_id: string | null;
  name: string | null;
  grade: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED PURE TRANSFORMS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build per-subject snapshots (for the concentration signal) from raw
 * `learner_mastery` rows belonging to ONE learner.
 */
export function snapshotsFromMasteryRows(
  rows: LearnerMasteryRow[],
): SubjectMasterySnapshot[] {
  const bySubject = new Map<string, number[]>();
  for (const r of rows) {
    if (typeof r.mastery !== 'number' || !Number.isFinite(r.mastery)) continue;
    const code = r.subject_code;
    const arr = bySubject.get(code) ?? [];
    arr.push(r.mastery);
    bySubject.set(code, arr);
  }
  return Array.from(bySubject.entries()).map(([subject, chapterMasteries]) => ({
    subject,
    chapterMasteries,
  }));
}

/**
 * Build the compact MasterySummary (per-subject rollup + strengths / at-risk
 * split) from one learner's `learner_mastery` rows.
 */
export function masterySummaryFromRows(
  rows: LearnerMasteryRow[],
): MasterySummary {
  const bySubjectMap = new Map<string, number[]>();
  for (const r of rows) {
    if (typeof r.mastery !== 'number' || !Number.isFinite(r.mastery)) continue;
    const arr = bySubjectMap.get(r.subject_code) ?? [];
    arr.push(r.mastery);
    bySubjectMap.set(r.subject_code, arr);
  }

  const bySubject: SubjectMasterySummaryEntry[] = [];
  let totalAtRiskChapters = 0;
  for (const [subject, masteries] of bySubjectMap.entries()) {
    const chapterCount = masteries.length;
    const meanMastery =
      chapterCount > 0
        ? masteries.reduce((a, b) => a + b, 0) / chapterCount
        : null;
    const atRiskChapterCount = masteries.reduce(
      (n, m) => (m < PULSE_THRESHOLDS.at_risk_mastery ? n + 1 : n),
      0,
    );
    totalAtRiskChapters += atRiskChapterCount;
    bySubject.push({ subject, meanMastery, chapterCount, atRiskChapterCount });
  }

  // Strengths: highest meanMastery first (subjects with a signal only).
  const strengths = [...bySubject]
    .filter((s) => s.meanMastery != null)
    .sort((a, b) => (b.meanMastery ?? 0) - (a.meanMastery ?? 0))
    .slice(0, 3)
    .map((s) => s.subject);

  // At-risk: most at-risk chapters first; tie-break by lowest meanMastery.
  const atRisk = [...bySubject]
    .filter((s) => s.atRiskChapterCount > 0)
    .sort(
      (a, b) =>
        b.atRiskChapterCount - a.atRiskChapterCount ||
        (a.meanMastery ?? 1) - (b.meanMastery ?? 1),
    )
    .slice(0, 3)
    .map((s) => s.subject);

  // Stable subject ordering for the per-subject list (most at-risk first).
  bySubject.sort(
    (a, b) =>
      b.atRiskChapterCount - a.atRiskChapterCount ||
      a.subject.localeCompare(b.subject),
  );

  return { bySubject, strengths, atRisk, totalAtRiskChapters };
}

/**
 * Map `learner.mastery_changed` event rows → the signal's MasteryChangeEvent[].
 * The stored `payload` is the camelCase event payload
 * (`{subjectCode, chapterNumber, fromMastery, toMastery, trigger}`). Rows are
 * assumed oldest→newest by the caller (we sort defensively).
 */
export function masteryEventsFromRows(
  rows: StateEventRow[],
): MasteryChangeEvent[] {
  const events: MasteryChangeEvent[] = [];
  for (const row of rows) {
    if (row.kind !== 'learner.mastery_changed') continue;
    const p = row.payload ?? {};
    const subjectCode = typeof p.subjectCode === 'string' ? p.subjectCode : null;
    const chapterNumber =
      typeof p.chapterNumber === 'number' ? p.chapterNumber : null;
    const toMastery = typeof p.toMastery === 'number' ? p.toMastery : null;
    if (subjectCode == null || chapterNumber == null || toMastery == null) continue;
    const fromMastery =
      typeof p.fromMastery === 'number' ? p.fromMastery : null;
    events.push({
      subjectCode,
      chapterNumber,
      fromMastery,
      toMastery,
      occurredAtMs: Date.parse(row.occurred_at) || undefined,
    });
  }
  // Oldest → newest (deriveSignals assumes chronological order).
  events.sort((a, b) => (a.occurredAtMs ?? 0) - (b.occurredAtMs ?? 0));
  return events;
}

/**
 * Project `state_events` rows → non-PII PulseTimelineEntry[]. We WHITELIST a
 * bounded set of payload fields per kind (P13) rather than echoing the raw
 * payload, which can carry identifiers the viewer shouldn't see.
 */
export function timelineFromRows(rows: StateEventRow[]): PulseTimelineEntry[] {
  return rows.map((row) => ({
    kind: row.kind,
    occurredAt: row.occurred_at,
    summary: whitelistTimelineSummary(row.kind, row.payload ?? {}),
  }));
}

/**
 * Per-kind ADDITIONS to the generic whitelist below. Each entry must be a
 * non-PII routing/label field justified in place.
 */
const KIND_SAFE_KEYS: Record<string, readonly string[]> = {
  // Phase A Loop A (Round 2, frontend-deferred item): 'teacher' | 'parent' |
  // null — a routing LABEL, never an identifier (P13). pulse-copy's
  // timelineLine branches the student/parent/teacher escalation copy on it;
  // when absent/null the copy degrades to neutral "extra help" framing.
  'system.remediation_escalated': ['escalatedTo'],
};

/** Whitelist the small, non-PII payload subset surfaced on a timeline entry. */
function whitelistTimelineSummary(
  kind: string,
  payload: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  // Generic, always-safe academic descriptors (never PII).
  const safeKeys = [
    'subjectCode',
    'chapterNumber',
    'fromMastery',
    'toMastery',
    'trigger',
    'scorePercent',
    'score_percent',
    'correctCount',
    'totalQuestions',
    'quality',
    'reportKind',
    'mode',
    'durationSec',
    'turnCount',
    'questionCount',
    ...(KIND_SAFE_KEYS[kind] ?? []),
  ];
  for (const k of safeKeys) {
    const v = payload[k];
    if (v == null) continue;
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    ) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Derive the coarse one-badge PulseStatus from the three signals. Worst signal
 * wins. Pure.
 */
export function deriveStatus(signals: PulseSignals): PulseStatus {
  const { inactivity, masteryCliff, atRiskConcentration } = signals;

  // 'unknown' only when EVERYTHING is unknown/never (no usable data at all).
  const inactivityUnknown =
    inactivity.verdict === 'unknown' || inactivity.verdict === 'never';
  const cliffUnknown = masteryCliff.verdict === 'unknown';
  const concentrationEmpty = atRiskConcentration.bySubject.length === 0;
  if (inactivityUnknown && cliffUnknown && concentrationEmpty) {
    return 'unknown';
  }

  // Strong risk → 'at_risk'.
  if (
    inactivity.verdict === 'broken' ||
    atRiskConcentration.worstBand === 'high'
  ) {
    return 'at_risk';
  }

  // Meaningful risk → 'watch'.
  if (
    inactivity.verdict === 'at_risk' ||
    masteryCliff.verdict === 'flagged' ||
    atRiskConcentration.worstBand === 'medium'
  ) {
    return 'watch';
  }

  // Minor signal → 'steady'.
  if (atRiskConcentration.worstBand === 'low') {
    return 'steady';
  }

  // No risk firing.
  return 'thriving';
}

// ════════════════════════════════════════════════════════════════════════════
// SINGLE-STUDENT LENS  (/api/pulse/me, /api/pulse/student/[id])
// ════════════════════════════════════════════════════════════════════════════

/**
 * Assemble the full single-student PulseResponse for ONE learner, identified by
 * their `auth_user_id`. Reuses `buildStudentState()` for engagement/live and
 * pulls the timeline + mastery snapshots from `learner_mastery` + `state_events`.
 *
 * The caller MUST have already authorized access to this learner.
 */
export async function buildSingleStudentPulse(
  admin: SupabaseClient,
  authUserId: string,
  nowMs: number = Date.now(),
): Promise<PulseResponse> {
  // 1. Canonical student state (engagement, live, last_active, streak).
  const buildState = createStudentStateBuilder({ sb: admin });
  const state: StudentState = await buildState(authUserId);

  // 2. Parallel bulk reads scoped to this learner.
  const [masteryRes, timelineRes, masteryEventRes] = await Promise.all([
    admin
      .from('learner_mastery')
      .select('auth_user_id, subject_code, chapter_number, mastery, last_updated_at')
      .eq('auth_user_id', authUserId),
    admin
      .from('state_events')
      .select('kind, occurred_at, payload')
      .eq('actor_auth_user_id', authUserId)
      .order('occurred_at', { ascending: false })
      .limit(TIMELINE_LIMIT),
    admin
      .from('state_events')
      .select('kind, occurred_at, payload')
      .eq('actor_auth_user_id', authUserId)
      .eq('kind', 'learner.mastery_changed')
      .order('occurred_at', { ascending: false })
      .limit(MASTERY_EVENT_LIMIT),
  ]);

  const masteryRows = (masteryRes.data ?? []) as LearnerMasteryRow[];
  const timelineRows = (timelineRes.data ?? []) as StateEventRow[];
  const masteryEventRows = (masteryEventRes.data ?? []) as StateEventRow[];

  // 3. Pure derivations.
  const lastActiveMs = state.engagement.lastActiveAt
    ? Date.parse(state.engagement.lastActiveAt) || null
    : null;

  const raw: PulseRawInput = {
    nowMs,
    lastActiveMs,
    masteryEvents: masteryEventsFromRows(masteryEventRows),
    subjectSnapshots: snapshotsFromMasteryRows(masteryRows),
  };
  const signals = deriveSignals(raw);

  return {
    status: deriveStatus(signals),
    timeline: timelineFromRows(timelineRows),
    masterySummary: masterySummaryFromRows(masteryRows),
    signals,
    schemaVersion: 1,
    generatedAt: new Date(nowMs).toISOString(),
  };
}

// ════════════════════════════════════════════════════════════════════════════
// CLASS LENS  (/api/pulse/class/[classId])
// ════════════════════════════════════════════════════════════════════════════

/** Severity rank for the worst-first roster sort (higher = worse). */
const STATUS_RANK: Record<PulseStatus, number> = {
  at_risk: 4,
  watch: 3,
  steady: 2,
  thriving: 1,
  unknown: 0,
};

/**
 * Assemble a sorted (worst-signal-first) list of LIGHTWEIGHT pulse items for a
 * class roster, from BULK queries only (one students query already done by the
 * caller, one learner_mastery query, one state_events query) — never N×
 * buildStudentState.
 *
 * @param admin            service-role client (boundary enforced upstream).
 * @param students         active-roster identity rows (id, auth_user_id, name, grade).
 * @param nowMs            wall-clock for the inactivity signal.
 */
export async function buildClassPulseItems(
  admin: SupabaseClient,
  students: StudentIdentityRow[],
  nowMs: number = Date.now(),
): Promise<PulseListItem[]> {
  const authUserIds = students
    .map((s) => s.auth_user_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  if (authUserIds.length === 0) {
    // No linked auth users → every student is 'unknown' with empty signals.
    return students.map((s) => emptyListItem(s, nowMs)).sort(sortWorstFirst);
  }

  // Bulk read 1: all mastery rows for the roster, grouped client-side.
  // Bulk read 2: last_active per student (from students), already on the rows.
  // Bulk read 3: recent mastery_changed events for the roster (cliff signal).
  const [masteryRes, lastActiveRes, masteryEventRes] = await Promise.all([
    admin
      .from('learner_mastery')
      .select('auth_user_id, subject_code, chapter_number, mastery, last_updated_at')
      .in('auth_user_id', authUserIds),
    admin
      .from('students')
      .select('auth_user_id, last_active')
      .in('auth_user_id', authUserIds),
    admin
      .from('state_events')
      .select('actor_auth_user_id, kind, occurred_at, payload')
      .in('actor_auth_user_id', authUserIds)
      .eq('kind', 'learner.mastery_changed')
      .order('occurred_at', { ascending: false })
      .limit(MASTERY_EVENT_LIMIT * Math.max(1, authUserIds.length)),
  ]);

  const masteryByUser = new Map<string, LearnerMasteryRow[]>();
  for (const r of (masteryRes.data ?? []) as LearnerMasteryRow[]) {
    const arr = masteryByUser.get(r.auth_user_id) ?? [];
    arr.push(r);
    masteryByUser.set(r.auth_user_id, arr);
  }

  const lastActiveByUser = new Map<string, string | null>();
  for (const r of (lastActiveRes.data ?? []) as Array<{
    auth_user_id: string | null;
    last_active: string | null;
  }>) {
    if (r.auth_user_id) lastActiveByUser.set(r.auth_user_id, r.last_active ?? null);
  }

  const masteryEventsByUser = new Map<string, StateEventRow[]>();
  for (const r of (masteryEventRes.data ?? []) as Array<
    StateEventRow & { actor_auth_user_id: string | null }
  >) {
    if (!r.actor_auth_user_id) continue;
    const arr = masteryEventsByUser.get(r.actor_auth_user_id) ?? [];
    arr.push({ kind: r.kind, occurred_at: r.occurred_at, payload: r.payload });
    masteryEventsByUser.set(r.actor_auth_user_id, arr);
  }

  const items: PulseListItem[] = students.map((s) => {
    if (!s.auth_user_id) return emptyListItem(s, nowMs);

    const masteryRows = masteryByUser.get(s.auth_user_id) ?? [];
    const lastActive = lastActiveByUser.get(s.auth_user_id) ?? null;
    const lastActiveMs = lastActive ? Date.parse(lastActive) || null : null;

    const raw: PulseRawInput = {
      nowMs,
      lastActiveMs,
      masteryEvents: masteryEventsFromRows(
        masteryEventsByUser.get(s.auth_user_id) ?? [],
      ),
      subjectSnapshots: snapshotsFromMasteryRows(masteryRows),
    };
    const signals = deriveSignals(raw);

    return {
      studentId: s.id,
      displayName: s.name || 'Student',
      grade: s.grade ?? null,
      status: deriveStatus(signals),
      signals,
      totalAtRiskChapters: signals.atRiskConcentration.totalAtRiskChapters,
    };
  });

  return items.sort(sortWorstFirst);
}

/** A zero-signal list item for a student with no linked auth user / no data. */
function emptyListItem(s: StudentIdentityRow, nowMs: number): PulseListItem {
  const signals = deriveSignals({ nowMs, lastActiveMs: null });
  return {
    studentId: s.id,
    displayName: s.name || 'Student',
    grade: s.grade ?? null,
    status: deriveStatus(signals),
    signals,
    totalAtRiskChapters: signals.atRiskConcentration.totalAtRiskChapters,
  };
}

/** Worst-first roster sort: status severity desc, then at-risk chapters desc. */
function sortWorstFirst(a: PulseListItem, b: PulseListItem): number {
  return (
    STATUS_RANK[b.status] - STATUS_RANK[a.status] ||
    b.totalAtRiskChapters - a.totalAtRiskChapters ||
    a.displayName.localeCompare(b.displayName)
  );
}
