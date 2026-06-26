// src/app/api/cron/adaptive-remediation/route.ts
//
// Phase A Loops A + B + C — adaptive closed loop cron worker (single route, two
// phases). This ONE route carries all three loops; daily-cron's thin
// triggerAdaptiveRemediation() POSTs { phase: 'all' } and B/C ride that same call.
//
//   POST { phase?: 'inject' | 'verify' | 'all' }   (default 'all')
//
// Invoked nightly by the daily-cron Edge Function's thin
// `triggerAdaptiveRemediation()` step (spec Decision 3: daily-cron is Deno and
// cannot import src/lib/*, so ALL detection / verification math lives HERE,
// next to the pure modules — never re-implemented in Deno).
//
//   INJECT — per-trigger_signal flag gating (spec Decision X2):
//     • Loop A (mastery_cliff)        gated on ff_adaptive_remediation_v1.
//     • Loop B (inactivity)           gated on ff_adaptive_loops_bc_v1.
//     • Loop C (at_risk_concentration) gated on ff_adaptive_loops_bc_v1.
//     For each scanned student we derive the cliff signal (Loop A), the
//     inactivity verdict (Loop B — opens on 'broken' only) and the worst 'high'
//     subject (Loop C) via the SAME pure math every Pulse lens uses, plan each
//     through its frozen pure planner, then run arbitrateInterventions(...) so
//     AT MOST ONE new intervention opens per student per night (ceiling = 1,
//     precedence A > C > B — the anti-storm core, spec §6 / Decision X3).
//     The DB partial unique index (one active per student×subject×chapter) is
//     the race-proof backstop: a 23505 on insert is a benign dedupe.
//       - Loop B winner → sentinel triple ('_inactivity', 0); a re-engagement
//         NUDGE (event + onReEngagementNudge), no queue/card injection (B1).
//       - Loop C winner → worst (subject, chapter); the intervention IS the
//         escalation (immediate teacher B2B / parent B2C, reusing Loop A's
//         resolver + dedupe index) + event + audit + onConcentrationEscalated (C1).
//
//   VERIFY — gated on ACTIVE ROWS EXISTING, **not** any flag (spec §9 kill-switch
//     drain semantics — flipping a flag OFF stops new injections but mid-flight
//     interventions keep draining to terminal). Branches by trigger_signal:
//       - mastery_cliff        → recovery-evaluation → recovered | escalate.
//       - inactivity           → inactivity-return-evaluation → recovered |
//                                escalate to PARENT (never teacher, B4).
//       - at_risk_concentration → concentration-resolution-evaluation →
//                                recovered | RE-NOTIFY (status stays/becomes
//                                escalated; teacher re-flag / parent follow-up /
//                                ops — Decision C4, NOT a second row).
//     All transitions are race-guarded with .eq('status','active').
//
// Security (P9, REG-118/REG-119 posture): fail-closed CRON_SECRET gate with a
// constant-time compare BEFORE any DB I/O. Accepts `x-cron-secret`,
// `Authorization: Bearer`, or `?token=`.
//
// P13: no PII anywhere — rows, events, audit details, and logs carry UUIDs,
// subject codes, chapter numbers, and derived metrics only.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  isFeatureEnabled,
  ADAPTIVE_REMEDIATION_FLAGS,
  ADAPTIVE_LOOPS_BC_FLAGS,
  DIGITAL_TWIN_FLAGS,
} from '@/lib/feature-flags';
import { deriveSignals, PULSE_THRESHOLDS } from '@/lib/pulse/signals';
import { masteryEventsFromRows, snapshotsFromMasteryRows } from '@/lib/pulse/pulse-server';
import {
  ADAPTIVE_REMEDIATION_RULES,
  planRemediationInjection,
  type ActiveInterventionRef as CliffActiveRef,
  type TerminalInterventionRef as CliffTerminalRef,
} from '@/lib/learn/remediation-queue-adapter';
import {
  evaluateRecovery,
  verificationWindowEndMs,
  type InterventionRecord,
  type MasteryObservation,
} from '@/lib/learn/recovery-evaluation';
import {
  ADAPTIVE_LOOPS_BC_RULES,
  BLOCKED_PREREQUISITE_RULES,
  planInactivityIntervention,
  planConcentrationIntervention,
  planBlockedPrerequisiteIntervention,
  arbitrateInterventions,
  INACTIVITY_SENTINEL_SUBJECT,
  INACTIVITY_SENTINEL_CHAPTER,
  type ActiveInterventionRef,
  type TerminalInterventionRef,
  type InterventionCandidate,
  type BlockReason,
} from '@/lib/learn/adaptive-loops-rules';
import {
  evaluateInactivityReturn,
  type InactivityInterventionRecord,
  type ActivityObservation,
} from '@/lib/learn/inactivity-return-evaluation';
import {
  evaluateConcentrationResolution,
  type ConcentrationInterventionRecord,
  type SubjectSnapshotObservation,
} from '@/lib/learn/concentration-resolution-evaluation';
import { publishEvent } from '@/lib/state/events/publish';
import { auditLog } from '@/lib/audit';
import {
  onRemediationAssigned,
  onRemediationRecovered,
  onRemediationEscalated,
  onReEngagementNudge,
  onReEngagementReturned,
  onInactivityEscalated,
  onConcentrationEscalated,
  onConcentrationResolved,
  onConcentrationReescalated,
} from '@/lib/notification-triggers';
import { subjectMatchTier } from './_lib/subject-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MS_PER_DAY = 86_400_000;

/**
 * The base daily-rhythm queue is structurally exactly 7 items: 5 SRS (padded)
 * + 1 ZPD + 1 reflection — composeDailyRhythm() always emits all three blocks.
 */
const BASE_RHYTHM_QUEUE_SIZE = 7;

/** Stamped into trigger_snapshot so mid-flight threshold changes are auditable. */
const RULES_VERSION = 'loop-a-v1';
const RULES_VERSION_BC = 'loops-bc-v1';
const RULES_VERSION_D = 'loop-d-v1';

/** Loop D: SM-2 strength used when reproducing the snapshot decay in TS. Strength
 *  1.0 makes predictRetention(days,1)=exp(-days), so days=-ln(decay) reproduces
 *  the snapshot retention EXACTLY — TS classifyPrerequisiteBlock then mirrors the
 *  SQL detect_blocked_dependents verdict from the same numbers (no second read). */
const LOOP_D_STRENGTH = 1.0;
/** Loop D: a dependent topic counts as "actively attempted" if the student
 *  touched it within this many days (mirrors the twin-builder active window). */
const LOOP_D_DEPENDENT_ACTIVE_DAYS = 14;

/** Generic 500 body (architect cond 1): never echo `err.message` to the caller. */
const GENERIC_500_BODY = 'internal_error';

/** Inject scan window: students with a mastery_changed event in the last 24h. */
const INJECT_SCAN_HOURS = 24;
/** Bounded batches (Vercel 30s budget); carry-over lands on the next daily run. */
const MAX_INJECT_STUDENTS_PER_RUN = 200;
const MAX_VERIFY_ROWS_PER_RUN = 500;
/** Per-student mastery-event history depth — parity with pulse-server's lens. */
const MASTERY_EVENT_LIMIT = 30;
/** Bounded inactive-student scan for Loop B candidates (B/C enabled only). */
const MAX_INACTIVE_SCAN = 500;

// ════════════════════════════════════════════════════════════════════════════
// AUTH — fail-closed, constant-time, BEFORE any DB I/O
// ════════════════════════════════════════════════════════════════════════════

function constantTimeMatch(provided: string, secret: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Carrier precedence is FIRST-PRESENT-WINS, not first-match-wins (pinned by
 * tests — irt-calibrate precedent): exactly ONE candidate is selected (Bearer,
 * else x-cron-secret, else ?token=) and compared once. A WRONG value in a
 * higher-precedence carrier is NOT rescued by a correct lower one.
 */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed on missing configuration

  const auth = req.headers.get('authorization') ?? '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
  const headerSecret = req.headers.get('x-cron-secret') ?? '';
  const token = req.nextUrl.searchParams.get('token') ?? '';

  const provided = bearer || headerSecret || token;
  if (!provided) return false;
  return constantTimeMatch(provided, secret);
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED ROW SHAPES
// ════════════════════════════════════════════════════════════════════════════

interface StudentRow {
  id: string;
  auth_user_id: string | null;
  school_id: string | null;
  grade: string | null;
  last_active?: string | null;
  created_at?: string | null;
}

interface StateEventRow {
  actor_auth_user_id?: string | null;
  kind: string;
  occurred_at: string;
  payload: Record<string, unknown> | null;
}

interface InterventionRow {
  id: string;
  student_id: string;
  subject_code: string;
  chapter_number: number;
  trigger_signal: string;
  trigger_snapshot: Record<string, unknown> | null;
  created_at: string;
  verify_by: string;
  escalated_to: string | null;
  teacher_assignment_id: string | null;
}

interface TriggerSnapshot {
  largestDrop: number | null;
  baselineMastery: number | null;
  postCliffMastery: number;
  declineStreak: number;
  evaluatedAtIso: string;
  rulesVersion: string;
}

interface LearnerMasteryRow {
  auth_user_id: string;
  subject_code: string;
  chapter_number: number;
  mastery: number;
  last_updated_at: string;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Genuine student-activity event kinds (never the streak freeze-bump). Used
 *  as Loop B's "qualifying activity" return source (spec §10 / §12-B). */
const ACTIVITY_EVENT_KINDS = [
  'learner.session_started',
  'learner.quiz_completed',
  'learner.lesson_completed',
  'learner.mastery_changed',
  'learner.review_graded',
  'learner.scan_extracted',
  'learner.concept_check_answered',
] as const;

// ════════════════════════════════════════════════════════════════════════════
// INJECT PHASE
// ════════════════════════════════════════════════════════════════════════════

interface InjectSummary {
  skipped?: 'flag_off';
  scanned: number;
  injected: number;
  injectedCliff: number;
  injectedInactivity: number;
  injectedConcentration: number;
  injectedBlockedPrereq: number;
  deduped: number;
  skippedNullTarget: number;
  blocked: number;
  ceilingDeferred: number;
  errors: number;
}

type EscalationTarget =
  | { kind: 'teacher'; teacherId: string; classId: string }
  | { kind: 'parent' }
  | { kind: 'none' };

/**
 * Per-student inputs the inject loop assembles once, then feeds to each loop's
 * pure planner. Keeps the three planners' inputs aligned (same active/terminal
 * ledger, same nowMs).
 */
interface InjectStudentContext {
  student: StudentRow;
  activeRefs: ActiveInterventionRef[];
  terminalRefs: TerminalInterventionRef[];
}

async function runInjectPhase(
  admin: SupabaseClient,
  nowMs: number,
): Promise<InjectSummary> {
  const summary: InjectSummary = {
    scanned: 0,
    injected: 0,
    injectedCliff: 0,
    injectedInactivity: 0,
    injectedConcentration: 0,
    injectedBlockedPrereq: 0,
    deduped: 0,
    skippedNullTarget: 0,
    blocked: 0,
    ceilingDeferred: 0,
    errors: 0,
  };
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV;

  // Per-trigger_signal gating (spec Decision X2). Loop A and Loops B/C have
  // INDEPENDENT kill switches — either may be on without the other.
  const cliffGloballyOn = await isFeatureEnabled(ADAPTIVE_REMEDIATION_FLAGS.V1, {
    environment,
  });
  const bcGloballyOn = await isFeatureEnabled(ADAPTIVE_LOOPS_BC_FLAGS.V1, {
    environment,
  });
  // Loop D (blocked_prerequisite, Digital Twin Slice 1) has its OWN independent
  // kill switch (ff_digital_twin_v1). When OFF, Loop D contributes ZERO
  // candidates and behavior is byte-identical to today.
  const twinGloballyOn = await isFeatureEnabled(DIGITAL_TWIN_FLAGS.V1, {
    environment,
  });

  // ALL inject loops off → inject is a global no-op (same shape Loop A reported).
  if (!cliffGloballyOn && !bcGloballyOn && !twinGloballyOn) {
    return { ...summary, skipped: 'flag_off' };
  }

  // 1. Candidate student population.
  //    Loop A scans students with recent mastery movement. Loops B/C need a
  //    BROADER population: inactive students (Loop B) never appear in the
  //    mastery-changed scan, and concentration is subject-level. We UNION:
  //      (a) recent-mastery-changed students (Loop A + Loop C concentration),
  //      (b) active students whose last_active is stale (Loop B candidates),
  //    bounded so the Vercel 30s budget holds; carry-over lands next night.
  const authUserIdSet = new Set<string>();

  const sinceIso = new Date(nowMs - INJECT_SCAN_HOURS * 3_600_000).toISOString();
  const { data: recentRows, error: recentErr } = await admin
    .from('state_events')
    .select('actor_auth_user_id')
    .eq('kind', 'learner.mastery_changed')
    .gte('occurred_at', sinceIso)
    .limit(5000);
  if (recentErr) {
    logger.error('adaptive_remediation: inject scan failed', { error: recentErr.message });
    summary.errors++;
    return summary;
  }
  for (const r of (recentRows ?? []) as Array<{ actor_auth_user_id: string | null }>) {
    if (typeof r.actor_auth_user_id === 'string' && r.actor_auth_user_id.length > 0) {
      authUserIdSet.add(r.actor_auth_user_id);
    }
  }

  // Inactive-student scan — only when Loops B/C are enabled. 'broken' inactivity
  // means last_active strictly before yesterday-00:00 UTC (deriveInactivity's
  // 2+-UTC-day rule). We over-fetch (< two UTC days ago) and let deriveInactivity
  // make the precise verdict per student.
  let inactiveStudentRows: StudentRow[] = [];
  if (bcGloballyOn) {
    const twoDaysAgoIso = new Date(nowMs - 2 * MS_PER_DAY).toISOString();
    const { data: inactiveRows, error: inactiveErr } = await admin
      .from('students')
      .select('id, auth_user_id, school_id, grade, last_active, created_at')
      .eq('is_active', true)
      .is('deleted_at', null)
      .lt('last_active', twoDaysAgoIso)
      .order('last_active', { ascending: true })
      .limit(MAX_INACTIVE_SCAN);
    if (inactiveErr) {
      logger.error('adaptive_remediation: inject inactive scan failed', { error: inactiveErr.message });
      summary.errors++;
    } else {
      inactiveStudentRows = (inactiveRows ?? []) as StudentRow[];
      for (const s of inactiveStudentRows) {
        if (s.auth_user_id) authUserIdSet.add(s.auth_user_id);
      }
    }
  }

  const authUserIds = [...authUserIdSet].slice(0, MAX_INJECT_STUDENTS_PER_RUN);
  if (authUserIds.length === 0) return summary;

  // 2. Resolve internal student rows (active, not deleted). Includes last_active
  //    + created_at for Loop B (inactivity verdict + onboarding grace).
  const { data: studentRows, error: studentErr } = await admin
    .from('students')
    .select('id, auth_user_id, school_id, grade, last_active, created_at')
    .in('auth_user_id', authUserIds)
    .eq('is_active', true)
    .is('deleted_at', null);
  if (studentErr) {
    logger.error('adaptive_remediation: inject students fetch failed', { error: studentErr.message });
    summary.errors++;
    return summary;
  }
  const students = (studentRows ?? []) as StudentRow[];
  if (students.length === 0) return summary;
  const studentIds = students.map((s) => s.id);
  const validAuthIds = students.map((s) => s.auth_user_id).filter((x): x is string => !!x);

  // 3. Per-student mastery-event history (cliff signal, Loop A + Loop C input).
  const { data: eventRows, error: eventErr } = await admin
    .from('state_events')
    .select('actor_auth_user_id, kind, occurred_at, payload')
    .in('actor_auth_user_id', validAuthIds)
    .eq('kind', 'learner.mastery_changed')
    .order('occurred_at', { ascending: false })
    .limit(MASTERY_EVENT_LIMIT * Math.max(1, students.length));
  if (eventErr) {
    logger.error('adaptive_remediation: inject mastery events fetch failed', { error: eventErr.message });
    summary.errors++;
    return summary;
  }
  const eventsByUser = new Map<string, StateEventRow[]>();
  for (const r of (eventRows ?? []) as StateEventRow[]) {
    const uid = r.actor_auth_user_id;
    if (!uid) continue;
    const arr = eventsByUser.get(uid) ?? [];
    if (arr.length < MASTERY_EVENT_LIMIT) arr.push(r);
    eventsByUser.set(uid, arr);
  }

  // 3b. Per-student subject mastery snapshots (Loop C concentration). Only read
  //     when B/C is enabled — Loop A never needs them.
  const masteryByUser = new Map<string, LearnerMasteryRow[]>();
  if (bcGloballyOn) {
    const { data: masteryRows, error: masteryErr } = await admin
      .from('learner_mastery')
      .select('auth_user_id, subject_code, chapter_number, mastery, last_updated_at')
      .in('auth_user_id', validAuthIds);
    if (masteryErr) {
      logger.error('adaptive_remediation: inject mastery snapshot fetch failed', { error: masteryErr.message });
      summary.errors++;
    } else {
      for (const r of (masteryRows ?? []) as LearnerMasteryRow[]) {
        const arr = masteryByUser.get(r.auth_user_id) ?? [];
        arr.push(r);
        masteryByUser.set(r.auth_user_id, arr);
      }
    }
  }

  // 4. Intervention ledger: active rows (across ALL loops — needed for the
  //    arbiter's one-active-max + A↔C coexistence) + recently-terminal rows
  //    for the cooldown checks. The longest cooldown across loops bounds the
  //    terminal lookback (Loop A 3d, Loop B/C 7d).
  const maxCooldownDays = Math.max(
    ADAPTIVE_REMEDIATION_RULES.chapter_cooldown_days,
    ADAPTIVE_LOOPS_BC_RULES.nudge_cooldown_days,
    ADAPTIVE_LOOPS_BC_RULES.concentration_cooldown_days,
  );
  const cooldownSinceIso = new Date(nowMs - maxCooldownDays * MS_PER_DAY).toISOString();
  const [activeRes, terminalRes] = await Promise.all([
    admin
      .from('adaptive_interventions')
      .select('student_id, subject_code, chapter_number, trigger_signal')
      .in('student_id', studentIds)
      .eq('status', 'active'),
    admin
      .from('adaptive_interventions')
      .select('student_id, subject_code, chapter_number, trigger_signal, resolved_at')
      .in('student_id', studentIds)
      .neq('status', 'active')
      .gte('resolved_at', cooldownSinceIso),
  ]);
  if (activeRes.error || terminalRes.error) {
    logger.error('adaptive_remediation: inject intervention-ledger fetch failed', {
      error: (activeRes.error ?? terminalRes.error)?.message,
    });
    summary.errors++;
    return summary;
  }
  // A NULL/missing trigger_signal defaults to 'mastery_cliff' (the column is
  // NOT NULL in prod + every legacy Loop A row is mastery_cliff, so this only
  // normalizes the edge case and keeps guardrail 5 / cooldown matching robust).
  const normSignal = (s: string | null | undefined): ActiveInterventionRef['triggerSignal'] =>
    s === 'inactivity' || s === 'at_risk_concentration' || s === 'blocked_prerequisite'
      ? s
      : 'mastery_cliff';
  const activesByStudent = new Map<string, ActiveInterventionRef[]>();
  for (const r of (activeRes.data ?? []) as Array<{
    student_id: string; subject_code: string; chapter_number: number; trigger_signal: string | null;
  }>) {
    const arr = activesByStudent.get(r.student_id) ?? [];
    arr.push({
      triggerSignal: normSignal(r.trigger_signal),
      subjectCode: r.subject_code,
      chapterNumber: r.chapter_number,
    });
    activesByStudent.set(r.student_id, arr);
  }
  const terminalsByStudent = new Map<string, TerminalInterventionRef[]>();
  for (const r of (terminalRes.data ?? []) as Array<{
    student_id: string; subject_code: string; chapter_number: number; trigger_signal: string | null; resolved_at: string | null;
  }>) {
    const terminalAtMs = r.resolved_at ? Date.parse(r.resolved_at) : NaN;
    if (!Number.isFinite(terminalAtMs)) continue;
    const arr = terminalsByStudent.get(r.student_id) ?? [];
    arr.push({
      triggerSignal: normSignal(r.trigger_signal),
      subjectCode: r.subject_code,
      chapterNumber: r.chapter_number,
      terminalAtMs,
    });
    terminalsByStudent.set(r.student_id, arr);
  }

  // 5. Per-student: build candidates from all three loops, arbitrate to ONE,
  //    and open the winner. The arbiter enforces the daily ceiling + precedence;
  //    a per-run `alreadyOpenedTonight` flag is unnecessary because each student
  //    is processed exactly once here (one arbitrate call decides their slot).
  for (const student of students) {
    if (!student.auth_user_id) continue;
    summary.scanned++;

    const activeRefs = activesByStudent.get(student.id) ?? [];
    const terminalRefs = terminalsByStudent.get(student.id) ?? [];
    const candidates: InterventionCandidate[] = [];

    // ── Loop A candidate (mastery_cliff) ──────────────────────────────────
    let cliffSnapshot: TriggerSnapshot | null = null;
    let cliffBaseline: number | null = null;
    let cliffPostCliff: number | null = null;
    let cliffVerifyByIso: string | null = null;
    if (cliffGloballyOn) {
      const enabledForStudent = await isFeatureEnabled(ADAPTIVE_REMEDIATION_FLAGS.V1, {
        userId: student.auth_user_id,
        role: 'student',
        environment,
      });
      if (enabledForStudent) {
        const masteryEvents = masteryEventsFromRows(
          (eventsByUser.get(student.auth_user_id) ?? []).map((r) => ({
            kind: r.kind,
            occurred_at: r.occurred_at,
            payload: r.payload,
          })),
        );
        const cliff = deriveSignals({ nowMs, masteryEvents }).masteryCliff;
        if (cliff.verdict === 'flagged' && cliff.worstSubject != null && cliff.worstChapter != null) {
          // Snapshot baseline/trough for the target chapter (verify needs it).
          let baselineMastery: number | null = null;
          let postCliffMastery: number | null = null;
          let bestDrop = -Infinity;
          for (const e of masteryEvents) {
            if (e.subjectCode !== cliff.worstSubject) continue;
            if (e.chapterNumber !== cliff.worstChapter) continue;
            if (e.fromMastery == null || !Number.isFinite(e.fromMastery)) continue;
            if (!Number.isFinite(e.toMastery)) continue;
            const drop = e.fromMastery - e.toMastery;
            if (drop > bestDrop) {
              bestDrop = drop;
              baselineMastery = e.fromMastery;
              postCliffMastery = e.toMastery;
            }
          }
          if (postCliffMastery != null) {
            // Run the frozen adapter (guardrails 1-5 inside) to confirm injectability.
            const candidateId = randomUUID();
            const plan = planRemediationInjection({
              cliffSignal: cliff,
              candidates: [{
                subjectCode: cliff.worstSubject,
                chapterNumber: cliff.worstChapter,
                interventionId: candidateId,
                dropMagnitude: cliff.largestDrop,
              }],
              fatigueScore: null,
              activeInterventions: activeRefs
                .filter((a) => a.triggerSignal === 'mastery_cliff')
                .map<CliffActiveRef>((a) => ({ subjectCode: a.subjectCode, chapterNumber: a.chapterNumber })),
              recentTerminalInterventions: terminalRefs
                .filter((t) => t.triggerSignal === 'mastery_cliff')
                .map<CliffTerminalRef>((t) => ({
                  subjectCode: t.subjectCode,
                  chapterNumber: t.chapterNumber,
                  terminalAtMs: t.terminalAtMs,
                })),
              currentQueueSize: BASE_RHYTHM_QUEUE_SIZE,
              nowMs,
            });
            if (plan.inject.length > 0) {
              const card = plan.inject[0];
              cliffBaseline = baselineMastery;
              cliffPostCliff = postCliffMastery;
              cliffVerifyByIso = new Date(verificationWindowEndMs({
                subjectCode: card.subjectCode,
                chapterNumber: card.chapterNumber,
                baselineMastery,
                troughMastery: postCliffMastery,
                createdAtMs: nowMs,
                windowDays: ADAPTIVE_REMEDIATION_RULES.verification_window_days,
              })).toISOString();
              cliffSnapshot = {
                largestDrop: cliff.largestDrop,
                baselineMastery,
                postCliffMastery,
                declineStreak: cliff.declineStreak,
                evaluatedAtIso: new Date(nowMs).toISOString(),
                rulesVersion: RULES_VERSION,
              };
              candidates.push({
                loop: 'A',
                subjectCode: card.subjectCode.toLowerCase(),
                chapterNumber: card.chapterNumber,
                severity: cliff.largestDrop ?? null,
              });
            } else {
              summary.blocked++;
            }
          } else {
            summary.skippedNullTarget++;
          }
        }
      }
    }

    // ── Loop B candidate (inactivity) + Loop C candidate (concentration) ──
    let inactivitySnapshot: Record<string, unknown> | null = null;
    let concentrationContext:
      | { subjectCode: string; chapterNumber: number; atRiskChapterCount: number; worstChapterMastery: number | null }
      | null = null;
    if (bcGloballyOn) {
      const enabledForStudent = await isFeatureEnabled(ADAPTIVE_LOOPS_BC_FLAGS.V1, {
        userId: student.auth_user_id,
        role: 'student',
        environment,
      });
      if (enabledForStudent) {
        const lastActiveMs = student.last_active ? Date.parse(student.last_active) || null : null;
        const masterySnapshots = snapshotsFromMasteryRows(masteryByUser.get(student.auth_user_id) ?? []);
        const signals = deriveSignals({
          nowMs,
          lastActiveMs,
          subjectSnapshots: masterySnapshots,
        });

        // Loop B — opens on 'broken' only (the planner enforces every guardrail).
        const createdAtMs = student.created_at ? Date.parse(student.created_at) : NaN;
        const bPlan = planInactivityIntervention({
          inactivityVerdict: signals.inactivity.verdict,
          daysSinceActive: signals.inactivity.daysSinceActive,
          studentCreatedAtMs: createdAtMs,
          activeInterventions: activeRefs,
          recentTerminalInterventions: terminalRefs,
          // The arbiter is the SINGLE authority on the ceiling — pass false here
          // so the planner reports per-loop eligibility; cross-loop precedence
          // is resolved by arbitrateInterventions below.
          ceilingAlreadySpent: false,
          nowMs,
        });
        if (bPlan.open) {
          inactivitySnapshot = {
            daysSinceActive: signals.inactivity.daysSinceActive,
            hadStreakFreeze: false,
            evaluatedAtIso: new Date(nowMs).toISOString(),
            rulesVersion: RULES_VERSION_BC,
          };
          candidates.push({
            loop: 'B',
            subjectCode: INACTIVITY_SENTINEL_SUBJECT,
            chapterNumber: INACTIVITY_SENTINEL_CHAPTER,
            severity: signals.inactivity.daysSinceActive ?? null,
          });
        }

        // Loop C — worst 'high'-band subject. deriveAtRiskConcentration sorts
        // worst-first, so the first entry whose band === 'high' is the worst.
        const worst = signals.atRiskConcentration.bySubject.find((s) => s.band === 'high');
        if (worst) {
          const cPlan = planConcentrationIntervention({
            subjectCode: worst.subject,
            band: worst.band,
            activeInterventions: activeRefs,
            recentTerminalInterventions: terminalRefs,
            ceilingAlreadySpent: false,
            nowMs,
          });
          if (cPlan.open) {
            // Worst at-risk chapter in the subject: lowest mastery, tie → lowest
            // chapter_number. Real chapters only (>= 1) — never the sentinel.
            const rows = (masteryByUser.get(student.auth_user_id) ?? []).filter(
              (r) =>
                r.subject_code === worst.subject &&
                Number.isFinite(r.mastery) &&
                r.mastery < PULSE_THRESHOLDS.at_risk_mastery &&
                r.chapter_number >= 1,
            );
            let worstChapter: number | null = null;
            let worstMastery: number | null = null;
            for (const r of rows) {
              if (
                worstChapter == null ||
                r.mastery < (worstMastery ?? Infinity) ||
                (r.mastery === worstMastery && r.chapter_number < worstChapter)
              ) {
                worstChapter = r.chapter_number;
                worstMastery = r.mastery;
              }
            }
            if (worstChapter != null) {
              concentrationContext = {
                subjectCode: worst.subject.toLowerCase(),
                chapterNumber: worstChapter,
                atRiskChapterCount: worst.atRiskChapterCount,
                worstChapterMastery: worstMastery,
              };
              candidates.push({
                loop: 'C',
                subjectCode: worst.subject.toLowerCase(),
                chapterNumber: worstChapter,
                severity: worst.atRiskChapterCount,
              });
            }
          }
        }
      }
    }

    // ── Loop D candidate (blocked_prerequisite — Digital Twin Slice 1) ──────
    // Gated on its OWN flag (ff_digital_twin_v1). When OFF, zero candidates are
    // produced and the arbiter sees exactly the A/B/C set it would today.
    const blockedPrereqContexts = new Map<string, BlockedPrereqContext>();
    if (twinGloballyOn) {
      const enabledForStudent = await isFeatureEnabled(DIGITAL_TWIN_FLAGS.V1, {
        userId: student.auth_user_id,
        role: 'student',
        environment,
      });
      if (enabledForStudent) {
        const dResult = await buildBlockedPrerequisiteCandidates(
          admin,
          summary,
          student,
          activeRefs,
          terminalRefs,
          nowMs,
        );
        for (const c of dResult.candidates) candidates.push(c);
        for (const [k, v] of dResult.contexts) blockedPrereqContexts.set(k, v);
      }
    }

    // ── Arbitrate: ONE winner per student per night (ceiling=1, A > D > C > B). ─
    // The SAME single arbiter call decides across A/B/C/D, so the anti-storm
    // ceiling (≤1 new intervention/student/night) and the precedence are
    // enforced centrally — Loop D never bypasses it.
    if (candidates.length === 0) continue;
    const arb = arbitrateInterventions(candidates, false);
    if (!arb.selected) continue;
    const winner = arb.selected;

    // Any otherwise-eligible candidate the arbiter did NOT pick is deferred to a
    // subsequent night (its signal persists). Count for observability.
    if (candidates.length > 1) {
      summary.ceilingDeferred += candidates.length - 1;
    }

    if (winner.loop === 'A') {
      const opened = await openCliffIntervention(admin, summary, student, winner, {
        snapshot: cliffSnapshot!,
        baselineMastery: cliffBaseline,
        verifyByIso: cliffVerifyByIso!,
        nowMs,
      });
      if (opened) summary.injectedCliff++;
    } else if (winner.loop === 'B') {
      const opened = await openInactivityIntervention(admin, summary, student, {
        snapshot: inactivitySnapshot!,
        nowMs,
      });
      if (opened) summary.injectedInactivity++;
    } else if (winner.loop === 'C') {
      const opened = await openConcentrationIntervention(admin, summary, student, winner, {
        context: concentrationContext!,
        nowMs,
      });
      if (opened) summary.injectedConcentration++;
    } else if (winner.loop === 'D') {
      const ctx = blockedPrereqContexts.get(`${winner.subjectCode}:${winner.chapterNumber}`);
      if (ctx) {
        const opened = await openBlockedPrerequisiteIntervention(admin, summary, student, ctx, nowMs);
        if (opened) summary.injectedBlockedPrereq++;
      }
    }
  }

  return summary;
}

/**
 * Open a Loop A mastery-cliff intervention (unchanged behavior from the original
 * route, factored into a helper). Returns true on a real insert (not a dedupe).
 */
async function openCliffIntervention(
  admin: SupabaseClient,
  summary: InjectSummary,
  student: StudentRow,
  winner: InterventionCandidate,
  args: { snapshot: TriggerSnapshot; baselineMastery: number | null; verifyByIso: string; nowMs: number },
): Promise<boolean> {
  const interventionId = randomUUID();
  const { error: insertErr } = await admin
    .from('adaptive_interventions')
    .insert({
      id: interventionId,
      student_id: student.id,
      subject_code: winner.subjectCode.toLowerCase(),
      chapter_number: winner.chapterNumber,
      trigger_signal: 'mastery_cliff',
      trigger_snapshot: args.snapshot,
      status: 'active',
      verify_by: args.verifyByIso,
    });
  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      summary.deduped++;
    } else {
      summary.errors++;
      logger.error('adaptive_remediation: cliff intervention insert failed', {
        studentId: student.id,
        error: insertErr.message,
      });
    }
    return false;
  }
  summary.injected++;

  try {
    await publishEvent(admin, {
      kind: 'system.remediation_injected',
      eventId: randomUUID(),
      occurredAt: new Date(args.nowMs).toISOString(),
      actorAuthUserId: student.auth_user_id!,
      tenantId: student.school_id ?? null,
      idempotencyKey: `remediation:${interventionId}:injected`,
      payload: {
        interventionId,
        subjectCode: winner.subjectCode.toLowerCase(),
        chapterNumber: winner.chapterNumber,
        largestDrop: args.snapshot.largestDrop,
        declineStreak: args.snapshot.declineStreak,
        baselineMastery: args.baselineMastery,
        verifyBy: args.verifyByIso,
      },
    });
  } catch (err) {
    logger.warn('adaptive_remediation: remediation_injected publish failed', {
      interventionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await onRemediationAssigned(student.id, {
    subjectCode: winner.subjectCode.toLowerCase(),
    chapterNumber: winner.chapterNumber,
    interventionId,
  });
  return true;
}

/**
 * Open a Loop B inactivity intervention (sentinel triple). The intervention is a
 * re-engagement NUDGE — event + onReEngagementNudge (student + linked parent);
 * NO queue/card injection (Decision B1). Returns true on a real insert.
 */
async function openInactivityIntervention(
  admin: SupabaseClient,
  summary: InjectSummary,
  student: StudentRow,
  args: { snapshot: Record<string, unknown>; nowMs: number },
): Promise<boolean> {
  const interventionId = randomUUID();
  const verifyByIso = new Date(
    args.nowMs + ADAPTIVE_LOOPS_BC_RULES.inactivity_return_window_days * MS_PER_DAY,
  ).toISOString();

  const { error: insertErr } = await admin
    .from('adaptive_interventions')
    .insert({
      id: interventionId,
      student_id: student.id,
      subject_code: INACTIVITY_SENTINEL_SUBJECT, // already lowercase, passes the CHECK
      chapter_number: INACTIVITY_SENTINEL_CHAPTER, // 0 — requires the >= 0 CHECK relax
      trigger_signal: 'inactivity',
      trigger_snapshot: args.snapshot,
      status: 'active',
      verify_by: verifyByIso,
    });
  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      summary.deduped++;
    } else {
      summary.errors++;
      logger.error('adaptive_remediation: inactivity intervention insert failed', {
        studentId: student.id,
        error: insertErr.message,
      });
    }
    return false;
  }
  summary.injected++;

  const daysSinceActive =
    typeof args.snapshot.daysSinceActive === 'number' ? args.snapshot.daysSinceActive : 0;
  try {
    await publishEvent(admin, {
      kind: 'system.engagement_nudged',
      eventId: randomUUID(),
      occurredAt: new Date(args.nowMs).toISOString(),
      actorAuthUserId: student.auth_user_id!,
      tenantId: student.school_id ?? null,
      idempotencyKey: `inactivity:${interventionId}:nudged`,
      payload: {
        interventionId,
        daysSinceActive: Math.max(0, Math.floor(daysSinceActive)),
        verifyBy: verifyByIso,
      },
    });
  } catch (err) {
    logger.warn('adaptive_remediation: engagement_nudged publish failed', {
      interventionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await onReEngagementNudge(student.id, {
    interventionId,
    daysSinceActive: Math.max(0, Math.floor(daysSinceActive)),
  });
  return true;
}

/**
 * Open a Loop C concentration intervention — the intervention IS the escalation
 * (immediate, at inject; Decision C1). Reuses Loop A's resolveEscalationTarget +
 * resolveChapterId + the teacher_remediation_assignments insert + the dedupe
 * index. B2B → teacher assignment; B2C → parent; neither → no recipient. Emits
 * the event + metadata-only audit row + onConcentrationEscalated. Returns true
 * on a real intervention insert (not a dedupe).
 */
async function openConcentrationIntervention(
  admin: SupabaseClient,
  summary: InjectSummary,
  student: StudentRow,
  winner: InterventionCandidate,
  args: {
    context: { subjectCode: string; chapterNumber: number; atRiskChapterCount: number; worstChapterMastery: number | null };
    nowMs: number;
  },
): Promise<boolean> {
  const interventionId = randomUUID();
  const subjectCode = args.context.subjectCode.toLowerCase();
  const chapterNumber = args.context.chapterNumber;
  const verifyByIso = new Date(
    args.nowMs + ADAPTIVE_LOOPS_BC_RULES.concentration_return_window_days * MS_PER_DAY,
  ).toISOString();

  // Resolve the escalation target FIRST (the escalation happens at inject). If
  // the teacher-assignment write fails we abort WITHOUT opening the row, so the
  // next nightly run retries the whole escalation cleanly (no half-escalation).
  const target = await resolveEscalationTarget(admin, student.id, subjectCode);
  let teacherAssignmentId: string | null = null;
  let escalatedTo: 'teacher' | 'parent' | null = null;

  if (target.kind === 'teacher') {
    const assignmentId = await createOrFindTeacherAssignment(
      admin,
      summary,
      student,
      target,
      subjectCode,
      chapterNumber,
    );
    if (assignmentId === null) return false; // insert failure → retry next run
    teacherAssignmentId = assignmentId;
    escalatedTo = 'teacher';
  } else if (target.kind === 'parent') {
    escalatedTo = 'parent';
  } // 'none' → escalatedTo stays null (ops-visible via the event payload)

  const snapshot: Record<string, unknown> = {
    atRiskChapterCount: args.context.atRiskChapterCount,
    worstChapterMastery: args.context.worstChapterMastery,
    bandAtTrigger: 'high',
    evaluatedAtIso: new Date(args.nowMs).toISOString(),
    rulesVersion: RULES_VERSION_BC,
  };

  const { error: insertErr } = await admin
    .from('adaptive_interventions')
    .insert({
      id: interventionId,
      student_id: student.id,
      subject_code: subjectCode,
      chapter_number: chapterNumber,
      trigger_signal: 'at_risk_concentration',
      trigger_snapshot: snapshot,
      status: 'active', // verify watches the band; escalated_to is set at inject
      escalated_to: escalatedTo,
      teacher_assignment_id: teacherAssignmentId,
      verify_by: verifyByIso,
    });
  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      // Benign dedupe: a concurrent/duplicate run already opened this (student,
      // subject, chapter). A teacher assignment we may have just created is
      // covered by its own dedupe index — surface for ops, don't delete data.
      summary.deduped++;
      if (teacherAssignmentId) {
        logger.warn('adaptive_remediation: concentration intervention deduped; assignment may be redundant', {
          interventionId,
          teacherAssignmentId,
        });
      }
    } else {
      summary.errors++;
      logger.error('adaptive_remediation: concentration intervention insert failed', {
        studentId: student.id,
        error: insertErr.message,
      });
    }
    return false;
  }
  summary.injected++;

  try {
    await publishEvent(admin, {
      kind: 'system.concentration_escalated',
      eventId: randomUUID(),
      occurredAt: new Date(args.nowMs).toISOString(),
      actorAuthUserId: student.auth_user_id!,
      tenantId: escalatedTo === 'teacher' ? student.school_id ?? null : null,
      idempotencyKey: `concentration:${interventionId}:escalated`,
      payload: {
        interventionId,
        subjectCode,
        chapterNumber,
        atRiskChapterCount: args.context.atRiskChapterCount,
        escalatedTo,
        teacherAssignmentId,
        verifyBy: verifyByIso,
      },
    });
  } catch (err) {
    logger.warn('adaptive_remediation: concentration_escalated publish failed', {
      interventionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Audit row — ALWAYS, metadata only (REG-68 pattern). Survives a bus-off env.
  await auditLog({
    actor_id: null,
    actor_role: 'system',
    action: 'system.concentration_escalated',
    target_entity: 'adaptive_interventions',
    target_id: interventionId,
    metadata: {
      subject_code: subjectCode,
      chapter_number: chapterNumber,
      at_risk_chapter_count: args.context.atRiskChapterCount,
      escalated_to: escalatedTo,
      teacher_assignment_id: teacherAssignmentId,
      verify_by: verifyByIso,
      rules_version: RULES_VERSION_BC,
    },
  });

  await onConcentrationEscalated(student.id, {
    subjectCode,
    interventionId,
    atRiskChapterCount: args.context.atRiskChapterCount,
    escalatedTo,
  });
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// LOOP D — blocked_prerequisite candidate build + intervention open (Slice 1)
// ════════════════════════════════════════════════════════════════════════════

/** One row from the detect_blocked_dependents(p_student_id, p_decay_floor,
 *  p_mastery_floor) RPC. IDs + numbers only (P13). */
interface BlockedDependentRow {
  blocked_topic_id: string;
  blocking_prerequisite_id: string;
  prerequisite_mastery: number | null;
  prerequisite_decay: number | null;
  edge_strength: number | null;
  edge_source: string | null;
}

/** Everything openBlockedPrerequisiteIntervention needs for the winning Loop D
 *  candidate, captured at plan time (keyed `${subjectCode}:${dependentChapter}`). */
interface BlockedPrereqContext {
  subjectCode: string; // dependent subject, lowercase
  dependentChapter: number;
  prereqChapter: number;
  reason: BlockReason;
  prereqMastery: number | null;
  prereqDecay: number | null;
  edgeStrength: number | null;
  edgeSource: string | null;
  severity: number; // classification.deficit — within-loop tie-break
}

interface CurriculumTopicMetaRow {
  id: string;
  subject_id: string | null;
  chapter_number: number | null;
}

interface DependentTouchRow {
  topic_id: string;
  last_practiced_at: string | null;
  last_attempted_at: string | null;
}

/**
 * Build the Loop D (blocked_prerequisite) arbiter candidates for one student.
 * Calls the architect-owned detect_blocked_dependents RPC (floors SOURCED from
 * BLOCKED_PREREQUISITE_RULES — never hardcoded), resolves each blocked edge's
 * dependent/prerequisite topic to (subject_code, chapter_number) via
 * curriculum_topics, and runs every edge through the frozen pure planner
 * planBlockedPrerequisiteIntervention(). Only `open` plans yield a candidate.
 *
 * classifyPrerequisiteBlock (inside the planner) is fed from the RPC's OWN
 * snapshot-derived numbers so the TS verdict mirrors the SQL verdict exactly:
 * prereqPKnow = prerequisite_mastery, and the decay axis is reproduced by
 * strength=1 + days=-ln(decay) (predictRetention(days,1) === decay). No second
 * data source, no divergence from what the RPC decided on.
 *
 * Never throws — a failed RPC/lookup degrades to zero candidates (Loop D simply
 * contributes nothing tonight; A/B/C are unaffected). P13: IDs + numbers only.
 */
async function buildBlockedPrerequisiteCandidates(
  admin: SupabaseClient,
  summary: InjectSummary,
  student: StudentRow,
  activeRefs: ActiveInterventionRef[],
  terminalRefs: TerminalInterventionRef[],
  nowMs: number,
): Promise<{ candidates: InterventionCandidate[]; contexts: Map<string, BlockedPrereqContext> }> {
  const out = {
    candidates: [] as InterventionCandidate[],
    contexts: new Map<string, BlockedPrereqContext>(),
  };

  const { data: blockedRows, error: rpcErr } = await admin.rpc('detect_blocked_dependents', {
    p_student_id: student.id,
    p_decay_floor: BLOCKED_PREREQUISITE_RULES.decay_floor,
    p_mastery_floor: BLOCKED_PREREQUISITE_RULES.mastery_floor,
  });
  if (rpcErr) {
    summary.errors++;
    logger.warn('adaptive_remediation: detect_blocked_dependents failed', { error: rpcErr.message });
    return out;
  }
  const edges = (blockedRows ?? []) as BlockedDependentRow[];
  if (edges.length === 0) return out;

  // Resolve (subject, chapter) for every topic the RPC referenced.
  const topicIds = [
    ...new Set(
      edges.flatMap((e) => [e.blocked_topic_id, e.blocking_prerequisite_id]).filter((x): x is string => !!x),
    ),
  ];
  const { data: topicRows, error: topicErr } = await admin
    .from('curriculum_topics')
    .select('id, subject_id, chapter_number')
    .in('id', topicIds);
  if (topicErr) {
    summary.errors++;
    logger.warn('adaptive_remediation: curriculum_topics lookup failed', { error: topicErr.message });
    return out;
  }
  const topicMeta = new Map<string, CurriculumTopicMetaRow>();
  for (const t of (topicRows ?? []) as CurriculumTopicMetaRow[]) topicMeta.set(t.id, t);

  const subjectIds = [
    ...new Set(
      [...topicMeta.values()].map((t) => t.subject_id).filter((x): x is string => !!x),
    ),
  ];
  const subjectCodeById = new Map<string, string>();
  if (subjectIds.length > 0) {
    const { data: subjRows } = await admin.from('subjects').select('id, code').in('id', subjectIds);
    for (const s of (subjRows ?? []) as Array<{ id: string; code: string | null }>) {
      if (s.code) subjectCodeById.set(s.id, s.code);
    }
  }

  // dependentIsActive proxy: a recent concept_mastery touch on the dependent topic.
  const dependentTopicIds = [
    ...new Set(edges.map((e) => e.blocked_topic_id).filter((x): x is string => !!x)),
  ];
  const touchByTopic = new Map<string, DependentTouchRow>();
  if (dependentTopicIds.length > 0) {
    const { data: cmRows } = await admin
      .from('concept_mastery')
      .select('topic_id, last_practiced_at, last_attempted_at')
      .eq('student_id', student.id)
      .in('topic_id', dependentTopicIds);
    for (const r of (cmRows ?? []) as DependentTouchRow[]) touchByTopic.set(r.topic_id, r);
  }
  const dependentActiveSinceMs = nowMs - LOOP_D_DEPENDENT_ACTIVE_DAYS * MS_PER_DAY;

  // Best candidate per dependent (subject:chapter) key — keep the worst block.
  for (const e of edges) {
    const depMeta = topicMeta.get(e.blocked_topic_id);
    const preMeta = topicMeta.get(e.blocking_prerequisite_id);
    if (!depMeta || !preMeta || !depMeta.subject_id) continue;
    const subjectCode = subjectCodeById.get(depMeta.subject_id);
    if (!subjectCode) continue;
    const dependentChapter = depMeta.chapter_number;
    if (typeof dependentChapter !== 'number' || !Number.isFinite(dependentChapter) || dependentChapter < 1) {
      continue; // need a real chapter to key the intervention row
    }
    const prereqChapter =
      typeof preMeta.chapter_number === 'number' && Number.isFinite(preMeta.chapter_number)
        ? preMeta.chapter_number
        : 0;

    const touch = touchByTopic.get(e.blocked_topic_id);
    const lastTouchMs = touch
      ? Math.max(
          touch.last_practiced_at ? Date.parse(touch.last_practiced_at) : NaN,
          touch.last_attempted_at ? Date.parse(touch.last_attempted_at) : NaN,
        )
      : NaN;
    const dependentIsActive = Number.isFinite(lastTouchMs) && lastTouchMs >= dependentActiveSinceMs;

    // Reproduce the RPC's snapshot decay in TS (strength=1, days=-ln(decay)).
    const prereqMastery = finiteOrNull(e.prerequisite_mastery);
    const prereqDecay = finiteOrNull(e.prerequisite_decay);
    let prereqDaysSinceStudy: number | null = null;
    if (prereqDecay != null) {
      const clamped = Math.min(1, Math.max(1e-6, prereqDecay));
      prereqDaysSinceStudy = -Math.log(clamped);
    }

    const subjectLc = subjectCode.toLowerCase();
    const plan = planBlockedPrerequisiteIntervention({
      prerequisite: {
        subjectCode: subjectLc,
        prereqChapterNumber: prereqChapter,
        dependentChapterNumber: dependentChapter,
        prereqPKnow: prereqMastery,
        prereqDaysSinceStudy,
        prereqStrength: LOOP_D_STRENGTH,
      },
      dependentIsActive,
      activeInterventions: activeRefs,
      recentTerminalInterventions: terminalRefs,
      // The arbiter is the single ceiling authority (A > D > C > B) — pass false.
      ceilingAlreadySpent: false,
      nowMs,
    });
    if (!plan.open || !plan.candidate) continue;

    const key = `${subjectLc}:${dependentChapter}`;
    const severity =
      typeof plan.candidate.severity === 'number' && Number.isFinite(plan.candidate.severity)
        ? plan.candidate.severity
        : 0;
    const existing = out.contexts.get(key);
    if (existing && existing.severity >= severity) continue; // keep the worst block
    out.contexts.set(key, {
      subjectCode: subjectLc,
      dependentChapter,
      prereqChapter,
      reason: plan.reason,
      prereqMastery,
      prereqDecay,
      edgeStrength: finiteOrNull(e.edge_strength),
      edgeSource: e.edge_source ?? null,
      severity,
    });
  }

  // Emit exactly one candidate per dependent key (the worst block kept above).
  for (const ctx of out.contexts.values()) {
    out.candidates.push({
      loop: 'D',
      subjectCode: ctx.subjectCode,
      chapterNumber: ctx.dependentChapter,
      severity: ctx.severity,
    });
  }
  return out;
}

/**
 * Open a Loop D blocked-prerequisite intervention. The row is keyed by the
 * DEPENDENT (subject, chapter) — the topic the student is stuck on — while the
 * trigger_snapshot records the blocking PREREQUISITE chapter + reason (what to
 * revisit). Slice 1 is detection-only: we land the durable active row + a
 * metadata-only audit trail (P13). The student-facing surfacing and the
 * blocked_prerequisite verify evaluator land in a later slice; the verify phase
 * already counts these rows as pending (never mis-routes them). Returns true on
 * a real insert (not a 23505 dedupe).
 */
async function openBlockedPrerequisiteIntervention(
  admin: SupabaseClient,
  summary: InjectSummary,
  student: StudentRow,
  ctx: BlockedPrereqContext,
  nowMs: number,
): Promise<boolean> {
  const interventionId = randomUUID();
  const subjectCode = ctx.subjectCode.toLowerCase();
  const verifyByIso = new Date(
    nowMs + BLOCKED_PREREQUISITE_RULES.return_window_days * MS_PER_DAY,
  ).toISOString();

  const snapshot: Record<string, unknown> = {
    prereqChapterNumber: ctx.prereqChapter,
    prereqMastery: ctx.prereqMastery,
    prereqDecay: ctx.prereqDecay,
    blockReason: ctx.reason,
    edgeStrength: ctx.edgeStrength,
    edgeSource: ctx.edgeSource,
    evaluatedAtIso: new Date(nowMs).toISOString(),
    rulesVersion: RULES_VERSION_D,
  };

  const { error: insertErr } = await admin
    .from('adaptive_interventions')
    .insert({
      id: interventionId,
      student_id: student.id,
      subject_code: subjectCode,
      chapter_number: ctx.dependentChapter,
      trigger_signal: 'blocked_prerequisite',
      trigger_snapshot: snapshot,
      status: 'active',
      verify_by: verifyByIso,
    });
  if (insertErr) {
    if ((insertErr as { code?: string }).code === '23505') {
      summary.deduped++;
    } else {
      summary.errors++;
      logger.error('adaptive_remediation: blocked_prerequisite intervention insert failed', {
        studentId: student.id,
        error: insertErr.message,
      });
    }
    return false;
  }
  summary.injected++;

  // Metadata-only audit (REG-127/REG-133 posture) — chapters + reason + version,
  // never any PII.
  await auditLog({
    actor_id: null,
    actor_role: 'system',
    action: 'system.blocked_prerequisite_injected',
    target_entity: 'adaptive_interventions',
    target_id: interventionId,
    metadata: {
      subject_code: subjectCode,
      dependent_chapter: ctx.dependentChapter,
      prereq_chapter: ctx.prereqChapter,
      block_reason: ctx.reason,
      edge_source: ctx.edgeSource,
      verify_by: verifyByIso,
      rules_version: RULES_VERSION_D,
    },
  });
  return true;
}

// ════════════════════════════════════════════════════════════════════════════
// ESCALATION RESOLUTION (shared by Loop A verify + Loop C inject) — VERBATIM
// ════════════════════════════════════════════════════════════════════════════

/**
 * B2B wins whenever ANY roster teacher exists. Class selection is deterministic
 * — subject-matching classes first (exact normalized match outranks token-
 * boundary partial match), tie-broken by most recent class creation; classes
 * without a teacher are skipped in order. B2C (linked guardian, dual-status) is
 * the fallback; 'none' is the terminal no-recipient edge case.
 */
async function resolveEscalationTarget(
  admin: SupabaseClient,
  studentId: string,
  subjectCode: string,
): Promise<EscalationTarget> {
  const { data: csRows } = await admin
    .from('class_students')
    .select('class_id')
    .eq('student_id', studentId)
    .eq('is_active', true);
  const classIds = [...new Set(
    ((csRows ?? []) as Array<{ class_id: string }>).map((r) => r.class_id),
  )];

  if (classIds.length > 0) {
    const { data: classRows } = await admin
      .from('classes')
      .select('id, subject, created_at')
      .in('id', classIds)
      .eq('is_active', true)
      .is('deleted_at', null);
    const classes = ((classRows ?? []) as Array<{
      id: string; subject: string | null; created_at: string | null;
    }>);

    const tierOf = new Map(
      classes.map((c) => [c.id, subjectMatchTier(c.subject, subjectCode)]),
    );
    const ordered = [...classes].sort((a, b) => {
      const tierDiff = (tierOf.get(b.id) ?? 0) - (tierOf.get(a.id) ?? 0);
      if (tierDiff !== 0) return tierDiff;
      const aTs = a.created_at ? Date.parse(a.created_at) || 0 : 0;
      const bTs = b.created_at ? Date.parse(b.created_at) || 0 : 0;
      return bTs - aTs || a.id.localeCompare(b.id);
    });

    for (const cls of ordered) {
      const { data: ctRows } = await admin
        .from('class_teachers')
        .select('teacher_id, joined_at')
        .eq('class_id', cls.id)
        .eq('is_active', true)
        .order('joined_at', { ascending: true })
        .limit(1);
      const teacher = ((ctRows ?? []) as Array<{ teacher_id: string }>)[0];
      if (teacher?.teacher_id) {
        return { kind: 'teacher', teacherId: teacher.teacher_id, classId: cls.id };
      }
    }
  }

  const { data: linkRows } = await admin
    .from('guardian_student_links')
    .select('id')
    .eq('student_id', studentId)
    .in('status', ['approved', 'active'])
    .limit(1);
  if (((linkRows ?? []) as Array<{ id: string }>).length > 0) {
    return { kind: 'parent' };
  }

  return { kind: 'none' };
}

/**
 * Map (subject_code, chapter_number, grade-string) → curriculum_topics.id.
 * Returns null when unmapped — teacher_remediation_assignments.chapter_id is
 * nullable by design. P5: grade is compared as a STRING end-to-end.
 */
async function resolveChapterId(
  admin: SupabaseClient,
  subjectCode: string,
  chapterNumber: number,
  grade: string | null,
): Promise<string | null> {
  if (!grade) return null;
  try {
    const { data: subj } = await admin
      .from('subjects')
      .select('id')
      .ilike('code', subjectCode)
      .limit(1)
      .maybeSingle();
    const subjectId = (subj as { id?: string } | null)?.id;
    if (!subjectId) return null;

    const { data: topic } = await admin
      .from('curriculum_topics')
      .select('id')
      .eq('subject_id', subjectId)
      .eq('grade', grade)
      .eq('chapter_number', chapterNumber)
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (topic as { id?: string } | null)?.id ?? null;
  } catch (err) {
    logger.warn('adaptive_remediation: chapter mapping failed', {
      subjectCode,
      chapterNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Create the teacher_remediation_assignments row (status 'assigned'), reusing the
 * 20260619000400 dedupe index: a 23505 is a benign dedupe → look up the EXISTING
 * assigned row's id (keyed on the FULL natural key: student_id, class_id,
 * chapter_id eq-or-IS-NULL, status). Returns the assignment id, or null on a
 * non-dedupe insert failure / unresolvable conflict (caller aborts → retry).
 * Shared by Loop A verify-escalation and Loop C inject-escalation.
 */
async function createOrFindTeacherAssignment(
  admin: SupabaseClient,
  summary: { errors: number },
  student: StudentRow,
  target: { teacherId: string; classId: string },
  subjectCode: string,
  chapterNumber: number,
): Promise<string | null> {
  const chapterId = await resolveChapterId(admin, subjectCode, chapterNumber, student.grade ?? null);
  const { data: assignment, error: assignErr } = await admin
    .from('teacher_remediation_assignments')
    .insert({
      teacher_id: target.teacherId,
      student_id: student.id,
      class_id: target.classId,
      chapter_id: chapterId,
      status: 'assigned',
    })
    .select('id')
    .single();
  if (!assignErr && assignment?.id) {
    return (assignment as { id: string }).id;
  }
  if ((assignErr as { code?: string } | null)?.code === '23505') {
    let dupLookup = admin
      .from('teacher_remediation_assignments')
      .select('id')
      .eq('student_id', student.id)
      .eq('class_id', target.classId)
      .eq('status', 'assigned');
    dupLookup = chapterId
      ? dupLookup.eq('chapter_id', chapterId)
      : dupLookup.is('chapter_id', null);
    const { data: dupRows, error: dupErr } = await dupLookup
      .order('created_at', { ascending: false })
      .limit(1);
    const dupId = ((dupRows ?? []) as Array<{ id: string }>)[0]?.id ?? null;
    if (dupErr || !dupId) {
      summary.errors++;
      logger.error('adaptive_remediation: assignment dedupe lookup failed', {
        studentId: student.id,
        error: dupErr?.message ?? 'no existing assigned row found',
      });
      return null;
    }
    return dupId;
  }
  summary.errors++;
  logger.error('adaptive_remediation: teacher assignment insert failed', {
    studentId: student.id,
    error: assignErr?.message ?? 'no id returned',
  });
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// VERIFY PHASE (drain semantics — gated on active rows, NOT the flag)
// ════════════════════════════════════════════════════════════════════════════

interface VerifySummary {
  skipped?: 'no_active_rows';
  evaluated: number;
  pending: number;
  recovered: number;
  escalated: number;
  reescalated: number;
  errors: number;
}

async function runVerifyPhase(
  admin: SupabaseClient,
  nowMs: number,
): Promise<VerifySummary> {
  const summary: VerifySummary = {
    evaluated: 0,
    pending: 0,
    recovered: 0,
    escalated: 0,
    reescalated: 0,
    errors: 0,
  };

  // Drain gate (spec §9): the ONLY condition is "active rows exist". NOT flag-
  // gated — the kill switch must drain, not freeze. Now carries B/C rows too.
  const { data: activeRows, error: activeErr } = await admin
    .from('adaptive_interventions')
    .select('id, student_id, subject_code, chapter_number, trigger_signal, trigger_snapshot, created_at, verify_by, escalated_to, teacher_assignment_id')
    .eq('status', 'active')
    .order('verify_by', { ascending: true })
    .limit(MAX_VERIFY_ROWS_PER_RUN);
  if (activeErr) {
    logger.error('adaptive_remediation: verify sweep failed', { error: activeErr.message });
    summary.errors++;
    return summary;
  }
  const rows = (activeRows ?? []) as InterventionRow[];
  if (rows.length === 0) {
    return { ...summary, skipped: 'no_active_rows' };
  }

  // Resolve the students behind the active rows.
  const studentIds = [...new Set(rows.map((r) => r.student_id))];
  const { data: studentRows, error: studentErr } = await admin
    .from('students')
    .select('id, auth_user_id, school_id, grade')
    .in('id', studentIds);
  if (studentErr) {
    logger.error('adaptive_remediation: verify students fetch failed', { error: studentErr.message });
    summary.errors++;
    return summary;
  }
  const studentById = new Map<string, StudentRow>();
  for (const s of (studentRows ?? []) as StudentRow[]) studentById.set(s.id, s);

  const authIds = [...studentById.values()]
    .map((s) => s.auth_user_id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  const minCreatedIso = rows.map((r) => r.created_at).sort()[0];

  // Which loops are present among the active rows — only fetch the observation
  // sources each present loop needs. A missing/unknown trigger_signal defaults
  // to the mastery_cliff branch (Loop A is the original, default loop), so
  // `hasCliff` must be true for any row that is NOT explicitly inactivity /
  // at_risk_concentration — otherwise the cliff verify would run without its
  // mastery observations.
  const hasConcentration = rows.some((r) => r.trigger_signal === 'at_risk_concentration');
  const hasInactivity = rows.some((r) => r.trigger_signal === 'inactivity');
  // 'blocked_prerequisite' (Loop D) has NO verify evaluator yet (Slice 1 is
  // detection-only), so it must NOT make hasCliff true — otherwise the cliff
  // observation fetch would run just for D rows. The dispatch below routes D
  // explicitly; anything NOT B/C/D defaults to the cliff branch.
  const hasCliff = rows.some(
    (r) =>
      r.trigger_signal !== 'at_risk_concentration' &&
      r.trigger_signal !== 'inactivity' &&
      r.trigger_signal !== 'blocked_prerequisite',
  );

  // Loop A + Loop C verify both read mastery (events + projection rollup).
  // Loop B verify reads genuine ACTIVITY events since the min created_at.
  const [obsEventsRes, masteryRowsRes, activityEventsRes] = await Promise.all([
    (hasCliff || hasConcentration) && authIds.length > 0
      ? admin
          .from('state_events')
          .select('actor_auth_user_id, kind, occurred_at, payload')
          .in('actor_auth_user_id', authIds)
          .eq('kind', 'learner.mastery_changed')
          .gte('occurred_at', minCreatedIso)
          .order('occurred_at', { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
    (hasCliff || hasConcentration) && authIds.length > 0
      ? admin
          .from('learner_mastery')
          .select('auth_user_id, subject_code, chapter_number, mastery, last_updated_at')
          .in('auth_user_id', authIds)
      : Promise.resolve({ data: [], error: null }),
    hasInactivity && authIds.length > 0
      ? admin
          .from('state_events')
          .select('actor_auth_user_id, kind, occurred_at, payload')
          .in('actor_auth_user_id', authIds)
          .in('kind', ACTIVITY_EVENT_KINDS as unknown as string[])
          .gte('occurred_at', minCreatedIso)
          .order('occurred_at', { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (obsEventsRes.error || masteryRowsRes.error || activityEventsRes.error) {
    logger.error('adaptive_remediation: verify observation fetch failed', {
      error: (obsEventsRes.error ?? masteryRowsRes.error ?? activityEventsRes.error)?.message,
    });
    summary.errors++;
    return summary;
  }

  // ── Loop A mastery observations (subject/chapter-keyed) ──
  const observationsByUser = new Map<string, MasteryObservation[]>();
  for (const r of (obsEventsRes.data ?? []) as StateEventRow[]) {
    const uid = r.actor_auth_user_id;
    if (!uid) continue;
    const p = r.payload ?? {};
    const subjectCode = typeof p.subjectCode === 'string' ? p.subjectCode.toLowerCase() : null;
    const chapterNumber = typeof p.chapterNumber === 'number' ? p.chapterNumber : null;
    const toMastery = finiteOrNull(p.toMastery);
    const observedAtMs = Date.parse(r.occurred_at);
    if (subjectCode == null || chapterNumber == null || toMastery == null) continue;
    if (!Number.isFinite(observedAtMs)) continue;
    const arr = observationsByUser.get(uid) ?? [];
    arr.push({ subjectCode, chapterNumber, mastery: toMastery, observedAtMs });
    observationsByUser.set(uid, arr);
  }
  // ── Loop C subject snapshots (per-subject at-risk-chapter counts over time) ──
  // We bucket the learner_mastery projection rows per (auth_user, subject) and
  // count chapters below the at-risk line — ONE snapshot at the rollup's
  // last_updated_at per subject. The mastery_changed events ALSO contribute a
  // point-in-time count when they advance a chapter across the line. Keyed by
  // auth_user_id.
  const masteryRowsByUser = new Map<string, LearnerMasteryRow[]>();
  for (const r of (masteryRowsRes.data ?? []) as LearnerMasteryRow[]) {
    const arr = masteryRowsByUser.get(r.auth_user_id) ?? [];
    arr.push(r);
    masteryRowsByUser.set(r.auth_user_id, arr);
  }
  const subjectSnapshotsByUser = buildSubjectSnapshots(masteryRowsByUser, nowMs);
  for (const arr of observationsByUser.values()) {
    arr.sort((a, b) => a.observedAtMs - b.observedAtMs);
  }

  // ── Loop B activity observations (genuine returns) ──
  const activityByUser = new Map<string, ActivityObservation[]>();
  for (const r of (activityEventsRes.data ?? []) as StateEventRow[]) {
    const uid = r.actor_auth_user_id;
    if (!uid) continue;
    const observedAtMs = Date.parse(r.occurred_at);
    if (!Number.isFinite(observedAtMs)) continue;
    const arr = activityByUser.get(uid) ?? [];
    arr.push({ observedAtMs });
    activityByUser.set(uid, arr);
  }

  const nowIso = new Date(nowMs).toISOString();

  for (const row of rows) {
    summary.evaluated++;
    const student = studentById.get(row.student_id);

    if (row.trigger_signal === 'inactivity') {
      await verifyInactivityRow(admin, summary, row, student, activityByUser, nowMs, nowIso);
    } else if (row.trigger_signal === 'at_risk_concentration') {
      await verifyConcentrationRow(admin, summary, row, student, subjectSnapshotsByUser, nowMs, nowIso);
    } else if (row.trigger_signal === 'blocked_prerequisite') {
      // Loop D (Digital Twin Slice 1) is detection-only: the blocked-prerequisite
      // verify evaluator lands in a later slice. The row stays active (durable)
      // and is counted pending — NEVER mis-routed into the mastery-cliff evaluator
      // (whose snapshot fields it does not carry).
      summary.pending++;
    } else {
      // mastery_cliff (default — preserves Loop A behavior).
      await verifyCliffRow(admin, summary, row, student, observationsByUser, nowMs, nowIso);
    }
  }

  return summary;
}

/**
 * Build per-(auth_user, subject) snapshot observations for Loop C verify. The
 * learner_mastery projection gives one current count per subject (timestamped at
 * the latest rollup update); the mastery_changed event stream gives prior
 * point-in-time counts as chapters crossed the at-risk line. The pure evaluator
 * uses the LATEST in-window snapshot, so the current rollup count is the
 * authoritative current state for the band-drop verdict.
 */
function buildSubjectSnapshots(
  masteryRowsByUser: Map<string, LearnerMasteryRow[]>,
  nowMs: number,
): Map<string, SubjectSnapshotObservation[]> {
  const out = new Map<string, SubjectSnapshotObservation[]>();
  const atRisk = PULSE_THRESHOLDS.at_risk_mastery;

  for (const [uid, rows] of masteryRowsByUser.entries()) {
    // Current per-subject at-risk-chapter count from the projection rollup.
    const countBySubject = new Map<string, number>();
    let latestUpdateMs = 0;
    for (const r of rows) {
      if (!Number.isFinite(r.mastery)) continue;
      const subj = r.subject_code;
      const cur = countBySubject.get(subj) ?? 0;
      countBySubject.set(subj, r.mastery < atRisk ? cur + 1 : cur);
      const ts = Date.parse(r.last_updated_at);
      if (Number.isFinite(ts) && ts > latestUpdateMs) latestUpdateMs = ts;
    }
    const observedAtMs = latestUpdateMs > 0 ? latestUpdateMs : nowMs;
    const arr = out.get(uid) ?? [];
    for (const [subjectCode, atRiskChapterCount] of countBySubject.entries()) {
      arr.push({ subjectCode, atRiskChapterCount, observedAtMs });
    }
    out.set(uid, arr);
  }

  // Sort chronological so the evaluator's later-element-wins tie-break holds.
  for (const arr of out.values()) {
    arr.sort((a, b) => a.observedAtMs - b.observedAtMs);
  }
  return out;
}

// ── Loop A verify (unchanged behavior, extracted) ──────────────────────────
async function verifyCliffRow(
  admin: SupabaseClient,
  summary: VerifySummary,
  row: InterventionRow,
  student: StudentRow | undefined,
  observationsByUser: Map<string, MasteryObservation[]>,
  nowMs: number,
  nowIso: string,
): Promise<void> {
  const snapshot = (row.trigger_snapshot ?? {}) as Partial<TriggerSnapshot>;
  const createdAtMs = Date.parse(row.created_at);
  const verifyByMs = Date.parse(row.verify_by);
  const windowDays =
    Number.isFinite(createdAtMs) && Number.isFinite(verifyByMs) && verifyByMs > createdAtMs
      ? (verifyByMs - createdAtMs) / MS_PER_DAY
      : ADAPTIVE_REMEDIATION_RULES.verification_window_days;

  const record: InterventionRecord = {
    subjectCode: row.subject_code,
    chapterNumber: row.chapter_number,
    baselineMastery: finiteOrNull(snapshot.baselineMastery),
    troughMastery: finiteOrNull(snapshot.postCliffMastery) ?? Number.NaN,
    createdAtMs,
    windowDays,
  };
  const observations = student?.auth_user_id
    ? observationsByUser.get(student.auth_user_id) ?? []
    : [];

  const evaluation = evaluateRecovery(record, observations, nowMs);

  if (evaluation.verdict === 'pending') {
    summary.pending++;
    return;
  }

  if (evaluation.verdict === 'recovered') {
    const { data: updated, error: updErr } = await admin
      .from('adaptive_interventions')
      .update({ status: 'recovered', resolved_at: nowIso })
      .eq('id', row.id)
      .eq('status', 'active')
      .select('id');
    if (updErr) {
      summary.errors++;
      logger.error('adaptive_remediation: recovered transition failed', {
        interventionId: row.id, error: updErr.message,
      });
      return;
    }
    if (((updated ?? []) as Array<{ id: string }>).length === 0) return; // raced
    summary.recovered++;

    if (student?.auth_user_id) {
      try {
        await publishEvent(admin, {
          kind: 'system.remediation_recovered',
          eventId: randomUUID(),
          occurredAt: nowIso,
          actorAuthUserId: student.auth_user_id,
          tenantId: student.school_id ?? null,
          idempotencyKey: `remediation:${row.id}:recovered`,
          payload: {
            interventionId: row.id,
            subjectCode: row.subject_code,
            chapterNumber: row.chapter_number,
            recoveredMastery: Math.min(1, Math.max(0, evaluation.masteryNow ?? 0)),
            daysToRecovery: Math.max(0, Math.floor((nowMs - (Number.isFinite(createdAtMs) ? createdAtMs : nowMs)) / MS_PER_DAY)),
          },
        });
      } catch (err) {
        logger.warn('adaptive_remediation: remediation_recovered publish failed', {
          interventionId: row.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await onRemediationRecovered(row.student_id, {
      subjectCode: row.subject_code,
      chapterNumber: row.chapter_number,
      interventionId: row.id,
    });
    return;
  }

  // expired → escalate
  const target = await resolveEscalationTarget(admin, row.student_id, row.subject_code);
  let teacherAssignmentId: string | null = null;
  let escalatedTo: 'teacher' | 'parent' | null = null;

  if (target.kind === 'teacher') {
    const assignmentId = await createOrFindTeacherAssignment(
      admin, summary, student ?? { id: row.student_id, auth_user_id: null, school_id: null, grade: null },
      target, row.subject_code, row.chapter_number,
    );
    if (assignmentId === null) return; // insert failure → row stays active
    teacherAssignmentId = assignmentId;
    escalatedTo = 'teacher';
  } else if (target.kind === 'parent') {
    escalatedTo = 'parent';
  }

  const { data: escUpdated, error: escErr } = await admin
    .from('adaptive_interventions')
    .update({ status: 'escalated', escalated_to: escalatedTo, teacher_assignment_id: teacherAssignmentId, resolved_at: nowIso })
    .eq('id', row.id)
    .eq('status', 'active')
    .select('id');
  if (escErr) {
    summary.errors++;
    logger.error('adaptive_remediation: escalated transition failed', {
      interventionId: row.id, teacherAssignmentId, error: escErr.message,
    });
    return;
  }
  if (((escUpdated ?? []) as Array<{ id: string }>).length === 0) {
    if (teacherAssignmentId) {
      logger.warn('adaptive_remediation: escalation raced; assignment may be redundant', {
        interventionId: row.id, teacherAssignmentId,
      });
    }
    return;
  }
  summary.escalated++;

  if (student?.auth_user_id) {
    try {
      await publishEvent(admin, {
        kind: 'system.remediation_escalated',
        eventId: randomUUID(),
        occurredAt: nowIso,
        actorAuthUserId: student.auth_user_id,
        tenantId: student.school_id ?? null,
        idempotencyKey: `remediation:${row.id}:escalated`,
        payload: {
          interventionId: row.id,
          subjectCode: row.subject_code,
          chapterNumber: row.chapter_number,
          escalatedTo,
          teacherAssignmentId,
        },
      });
    } catch (err) {
      logger.warn('adaptive_remediation: remediation_escalated publish failed', {
        interventionId: row.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await auditLog({
    actor_id: null,
    actor_role: 'system',
    action: 'system.remediation_escalated',
    target_entity: 'adaptive_interventions',
    target_id: row.id,
    metadata: {
      subject_code: row.subject_code,
      chapter_number: row.chapter_number,
      escalated_to: escalatedTo,
      teacher_assignment_id: teacherAssignmentId,
      verify_by: row.verify_by,
      rules_version: typeof (row.trigger_snapshot as { rulesVersion?: unknown } | null)?.rulesVersion === 'string'
        ? (row.trigger_snapshot as { rulesVersion: string }).rulesVersion : null,
    },
  });

  await onRemediationEscalated(row.student_id, {
    subjectCode: row.subject_code,
    chapterNumber: row.chapter_number,
    interventionId: row.id,
    escalatedTo,
  });
}

// ── Loop B verify (inactivity return-check) ─────────────────────────────────
async function verifyInactivityRow(
  admin: SupabaseClient,
  summary: VerifySummary,
  row: InterventionRow,
  student: StudentRow | undefined,
  activityByUser: Map<string, ActivityObservation[]>,
  nowMs: number,
  nowIso: string,
): Promise<void> {
  const createdAtMs = Date.parse(row.created_at);
  const verifyByMs = Date.parse(row.verify_by);
  const windowDays =
    Number.isFinite(createdAtMs) && Number.isFinite(verifyByMs) && verifyByMs > createdAtMs
      ? (verifyByMs - createdAtMs) / MS_PER_DAY
      : ADAPTIVE_LOOPS_BC_RULES.inactivity_return_window_days;

  const record: InactivityInterventionRecord = { createdAtMs, windowDays };
  const observations = student?.auth_user_id
    ? activityByUser.get(student.auth_user_id) ?? []
    : [];

  const evaluation = evaluateInactivityReturn(record, observations, nowMs);

  if (evaluation.verdict === 'pending') {
    summary.pending++;
    return;
  }

  if (evaluation.verdict === 'returned') {
    const { data: updated, error: updErr } = await admin
      .from('adaptive_interventions')
      .update({ status: 'recovered', resolved_at: nowIso })
      .eq('id', row.id)
      .eq('status', 'active')
      .select('id');
    if (updErr) {
      summary.errors++;
      logger.error('adaptive_remediation: inactivity returned transition failed', {
        interventionId: row.id, error: updErr.message,
      });
      return;
    }
    if (((updated ?? []) as Array<{ id: string }>).length === 0) return; // raced
    summary.recovered++;

    if (student?.auth_user_id) {
      try {
        await publishEvent(admin, {
          kind: 'system.engagement_returned',
          eventId: randomUUID(),
          occurredAt: nowIso,
          actorAuthUserId: student.auth_user_id,
          tenantId: student.school_id ?? null,
          idempotencyKey: `inactivity:${row.id}:returned`,
          payload: {
            interventionId: row.id,
            daysToReturn: Math.max(0, evaluation.daysSinceIntervention ?? 0),
          },
        });
      } catch (err) {
        logger.warn('adaptive_remediation: engagement_returned publish failed', {
          interventionId: row.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await onReEngagementReturned(row.student_id, { interventionId: row.id });
    return;
  }

  // expired → escalate to PARENT only (Decision B4); never a teacher row.
  const { data: linkRows } = await admin
    .from('guardian_student_links')
    .select('id')
    .eq('student_id', row.student_id)
    .in('status', ['approved', 'active'])
    .limit(1);
  const escalatedTo: 'parent' | null =
    ((linkRows ?? []) as Array<{ id: string }>).length > 0 ? 'parent' : null;

  const { data: escUpdated, error: escErr } = await admin
    .from('adaptive_interventions')
    .update({ status: 'escalated', escalated_to: escalatedTo, resolved_at: nowIso })
    .eq('id', row.id)
    .eq('status', 'active')
    .select('id');
  if (escErr) {
    summary.errors++;
    logger.error('adaptive_remediation: inactivity escalated transition failed', {
      interventionId: row.id, error: escErr.message,
    });
    return;
  }
  if (((escUpdated ?? []) as Array<{ id: string }>).length === 0) return; // raced
  summary.escalated++;

  if (student?.auth_user_id) {
    try {
      await publishEvent(admin, {
        kind: 'system.engagement_escalated',
        eventId: randomUUID(),
        occurredAt: nowIso,
        actorAuthUserId: student.auth_user_id,
        tenantId: student.school_id ?? null,
        idempotencyKey: `inactivity:${row.id}:escalated`,
        payload: { interventionId: row.id, escalatedTo },
      });
    } catch (err) {
      logger.warn('adaptive_remediation: engagement_escalated publish failed', {
        interventionId: row.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await auditLog({
    actor_id: null,
    actor_role: 'system',
    action: 'system.engagement_escalated',
    target_entity: 'adaptive_interventions',
    target_id: row.id,
    metadata: {
      trigger_signal: 'inactivity',
      escalated_to: escalatedTo,
      verify_by: row.verify_by,
      rules_version: RULES_VERSION_BC,
    },
  });

  await onInactivityEscalated(row.student_id, { interventionId: row.id, escalatedTo });
}

// ── Loop C verify (concentration band-drop check + re-notify on expiry) ─────
async function verifyConcentrationRow(
  admin: SupabaseClient,
  summary: VerifySummary,
  row: InterventionRow,
  student: StudentRow | undefined,
  subjectSnapshotsByUser: Map<string, SubjectSnapshotObservation[]>,
  nowMs: number,
  nowIso: string,
): Promise<void> {
  const createdAtMs = Date.parse(row.created_at);
  const verifyByMs = Date.parse(row.verify_by);
  const windowDays =
    Number.isFinite(createdAtMs) && Number.isFinite(verifyByMs) && verifyByMs > createdAtMs
      ? (verifyByMs - createdAtMs) / MS_PER_DAY
      : ADAPTIVE_LOOPS_BC_RULES.concentration_return_window_days;

  const record: ConcentrationInterventionRecord = {
    subjectCode: row.subject_code,
    createdAtMs,
    windowDays,
  };
  const snapshots = student?.auth_user_id
    ? subjectSnapshotsByUser.get(student.auth_user_id) ?? []
    : [];

  const evaluation = evaluateConcentrationResolution(record, snapshots, nowMs);

  if (evaluation.verdict === 'pending') {
    summary.pending++;
    return;
  }

  if (evaluation.verdict === 'resolved') {
    const { data: updated, error: updErr } = await admin
      .from('adaptive_interventions')
      .update({ status: 'recovered', resolved_at: nowIso })
      .eq('id', row.id)
      .eq('status', 'active')
      .select('id');
    if (updErr) {
      summary.errors++;
      logger.error('adaptive_remediation: concentration resolved transition failed', {
        interventionId: row.id, error: updErr.message,
      });
      return;
    }
    if (((updated ?? []) as Array<{ id: string }>).length === 0) return; // raced
    summary.recovered++;

    if (student?.auth_user_id) {
      try {
        await publishEvent(admin, {
          kind: 'system.concentration_resolved',
          eventId: randomUUID(),
          occurredAt: nowIso,
          actorAuthUserId: student.auth_user_id,
          tenantId: student.school_id ?? null,
          idempotencyKey: `concentration:${row.id}:resolved`,
          payload: {
            interventionId: row.id,
            subjectCode: row.subject_code,
            atRiskChapterCount: Math.max(0, evaluation.atRiskCountNow ?? 0),
            daysToResolve: Math.max(0, evaluation.daysToResolve ?? 0),
          },
        });
      } catch (err) {
        logger.warn('adaptive_remediation: concentration_resolved publish failed', {
          interventionId: row.id, error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await onConcentrationResolved(row.student_id, {
      subjectCode: row.subject_code,
      interventionId: row.id,
      atRiskChapterCount: evaluation.atRiskCountNow,
    });
    return;
  }

  // expired → RE-NOTIFY (Decision C4): the human handoff already happened at
  // inject; the row carries escalated_to. We re-flag the SAME human (no second
  // row) and transition active → escalated (terminal: "automation could not
  // resolve it; the human handoff is now the durable owner").
  const escalatedTo = (row.escalated_to === 'teacher' || row.escalated_to === 'parent')
    ? (row.escalated_to as 'teacher' | 'parent')
    : null;
  const teacherAssignmentId = row.teacher_assignment_id;

  const { data: escUpdated, error: escErr } = await admin
    .from('adaptive_interventions')
    .update({ status: 'escalated', resolved_at: nowIso })
    .eq('id', row.id)
    .eq('status', 'active')
    .select('id');
  if (escErr) {
    summary.errors++;
    logger.error('adaptive_remediation: concentration re-escalate transition failed', {
      interventionId: row.id, error: escErr.message,
    });
    return;
  }
  if (((escUpdated ?? []) as Array<{ id: string }>).length === 0) return; // raced
  summary.reescalated++;

  // B2B re-flag: bump the existing teacher assignment back to 'assigned' so it
  // resurfaces on the teacher queue (idempotent — re-flagging an already-assigned
  // row is a no-op). Best-effort; never blocks the terminal transition.
  if (escalatedTo === 'teacher' && teacherAssignmentId) {
    const { error: bumpErr } = await admin
      .from('teacher_remediation_assignments')
      .update({ status: 'assigned', updated_at: nowIso })
      .eq('id', teacherAssignmentId);
    if (bumpErr) {
      logger.warn('adaptive_remediation: concentration re-flag assignment bump failed', {
        interventionId: row.id, teacherAssignmentId, error: bumpErr.message,
      });
    }
  }

  if (student?.auth_user_id) {
    try {
      await publishEvent(admin, {
        kind: 'system.concentration_reescalated',
        eventId: randomUUID(),
        occurredAt: nowIso,
        actorAuthUserId: student.auth_user_id,
        tenantId: escalatedTo === 'teacher' ? student.school_id ?? null : null,
        idempotencyKey: `concentration:${row.id}:reescalated`,
        payload: {
          interventionId: row.id,
          subjectCode: row.subject_code,
          escalatedTo,
          teacherAssignmentId,
        },
      });
    } catch (err) {
      logger.warn('adaptive_remediation: concentration_reescalated publish failed', {
        interventionId: row.id, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await auditLog({
    actor_id: null,
    actor_role: 'system',
    action: 'system.concentration_reescalated',
    target_entity: 'adaptive_interventions',
    target_id: row.id,
    metadata: {
      subject_code: row.subject_code,
      chapter_number: row.chapter_number,
      escalated_to: escalatedTo,
      teacher_assignment_id: teacherAssignmentId,
      verify_by: row.verify_by,
      rules_version: RULES_VERSION_BC,
    },
  });

  await onConcentrationReescalated(row.student_id, {
    subjectCode: row.subject_code,
    interventionId: row.id,
    escalatedTo,
  });
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest): Promise<Response> {
  // Fail-closed auth gate — BEFORE any DB I/O (REG-118/REG-119 posture).
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: 'unauthorized' },
      { status: 401 },
    );
  }

  let phase: 'inject' | 'verify' | 'all' = 'all';
  try {
    const body = (await req.json().catch(() => null)) as { phase?: unknown } | null;
    if (body?.phase === 'inject' || body?.phase === 'verify') phase = body.phase;
  } catch {
    // empty/malformed body → default 'all'
  }

  const startedAt = Date.now();
  const nowMs = startedAt;

  try {
    const result: { inject?: InjectSummary; verify?: VerifySummary } = {};
    if (phase !== 'verify') {
      result.inject = await runInjectPhase(supabaseAdmin, nowMs);
    }
    if (phase !== 'inject') {
      result.verify = await runVerifyPhase(supabaseAdmin, nowMs);
    }

    logger.info('adaptive_remediation: run complete', {
      phase,
      inject: result.inject,
      verify: result.verify,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      success: true,
      data: {
        phase,
        injected: result.inject?.injected ?? 0,
        resolved:
          (result.verify?.recovered ?? 0) +
          (result.verify?.escalated ?? 0) +
          (result.verify?.reescalated ?? 0),
        inject: result.inject ?? null,
        verify: result.verify ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('adaptive_remediation: unhandled', { message });
    return NextResponse.json(
      { success: false, error: GENERIC_500_BODY },
      { status: 500 },
    );
  }
}
