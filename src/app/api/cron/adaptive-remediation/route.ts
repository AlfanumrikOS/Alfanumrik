// src/app/api/cron/adaptive-remediation/route.ts
//
// Phase A Loop A — adaptive closed loop cron worker (single route, two phases).
//
//   POST { phase?: 'inject' | 'verify' | 'all' }   (default 'all')
//
// Invoked nightly by the daily-cron Edge Function's thin
// `triggerAdaptiveRemediation()` step (spec Decision 3: daily-cron is Deno and
// cannot import src/lib/*, so ALL detection / verification math lives HERE,
// next to the pure modules — never re-implemented in Deno).
//
//   INJECT — flag-gated on ff_adaptive_remediation_v1. Scans students with a
//     recent learner.mastery_changed event, derives the mastery-cliff signal
//     via deriveSignals() (the SAME pure math every Pulse lens uses — guardrail
//     6: no duplicate threshold definitions), plans the injection through the
//     frozen remediation-queue-adapter (guardrails 1-5 enforced inside), and
//     INSERTs adaptive_interventions rows. The DB partial unique index
//     (one active per student×subject×chapter) is the race-proof backstop:
//     a 23505 on insert is treated as a benign dedupe, never an error.
//
//   VERIFY — gated on ACTIVE ROWS EXISTING, **not** the flag. This is the
//     spec §9 kill-switch semantics: flipping the flag OFF stops new
//     injections but mid-flight interventions keep draining to a terminal
//     state (recovered / escalated) — the kill switch drains, it does not
//     freeze. Recovery verdicts come from the frozen recovery-evaluation
//     module; window math reuses the row's denormalized verify_by so a later
//     window change is non-retroactive.
//
// Escalation (verify, verdict 'expired') — spec Decision 7, TIERED authority:
//   B2B   — student has a roster class with a teacher → INSERT
//           teacher_remediation_assignments (status 'assigned'; chapter_id
//           mapped via subjects.code → curriculum_topics(subject_id, grade,
//           chapter_number), nullable when unmapped — grade stays a STRING,
//           P5) → escalated_to='teacher' + teacher_assignment_id.
//   B2C   — no roster teacher, linked guardian (status approved/active)
//           exists → escalated_to='parent' + guardian notification.
//   none  — escalated_to=NULL, student notification only; the null target is
//           carried on the event payload for ops visibility.
//   Always: system.remediation_escalated event (best-effort, Decision 4) +
//   an audit_logs row (metadata only — UUIDs + codes, REG-68 pattern) so the
//   audit trail survives a bus-off environment.
//
// Security (P9, REG-118/REG-119 posture): fail-closed CRON_SECRET gate with a
// constant-time compare BEFORE any DB I/O. Accepts `x-cron-secret` (the
// daily-cron fetch-out precedent), `Authorization: Bearer`, or `?token=`
// (the Vercel-cron precedent from /api/cron/irt-calibrate).
//
// P13: no PII anywhere — rows, events, audit details, and logs carry UUIDs,
// subject codes, chapter numbers, and derived metrics only.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { isFeatureEnabled, ADAPTIVE_REMEDIATION_FLAGS } from '@/lib/feature-flags';
import { deriveSignals } from '@/lib/pulse/signals';
import { masteryEventsFromRows } from '@/lib/pulse/pulse-server';
import {
  ADAPTIVE_REMEDIATION_RULES,
  planRemediationInjection,
  type ActiveInterventionRef,
  type TerminalInterventionRef,
} from '@/lib/learn/remediation-queue-adapter';
import {
  evaluateRecovery,
  verificationWindowEndMs,
  type InterventionRecord,
  type MasteryObservation,
} from '@/lib/learn/recovery-evaluation';
import { publishEvent } from '@/lib/state/events/publish';
import { auditLog } from '@/lib/audit';
import {
  onRemediationAssigned,
  onRemediationRecovered,
  onRemediationEscalated,
} from '@/lib/notification-triggers';
import { subjectMatchTier } from './_lib/subject-match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MS_PER_DAY = 86_400_000;

/**
 * The base daily-rhythm queue is structurally exactly 7 items: 5 SRS (padded)
 * + 1 ZPD + 1 reflection — composeDailyRhythm() always emits all three blocks
 * (see src/lib/learn/daily-rhythm-orchestrator.ts). The adapter's capacity
 * gate (guardrail 2) therefore sees min(3, 10 − 7) = 3 in cron context.
 */
const BASE_RHYTHM_QUEUE_SIZE = 7;

/** Stamped into trigger_snapshot so mid-flight threshold changes are auditable. */
const RULES_VERSION = 'loop-a-v1';

/**
 * Generic 500 body (architect cond 1): never echo `err.message` to the
 * caller — detail lives in logger.error only.
 */
const GENERIC_500_BODY = 'internal_error';

/** Inject scan window: students with a mastery_changed event in the last 24h. */
const INJECT_SCAN_HOURS = 24;
/** Bounded batches (Vercel 30s budget); carry-over lands on the next daily run. */
const MAX_INJECT_STUDENTS_PER_RUN = 200;
const MAX_VERIFY_ROWS_PER_RUN = 500;
/** Per-student mastery-event history depth — parity with pulse-server's lens. */
const MASTERY_EVENT_LIMIT = 30;

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
 * tests — architect cond 3, irt-calibrate precedent): exactly ONE candidate
 * is selected (Bearer, else x-cron-secret, else ?token=) and compared once.
 * A WRONG value in a higher-precedence carrier is NOT rescued by a correct
 * value in a lower one — no fall-through, so an attacker never gets more
 * than one secret comparison per request.
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
  trigger_snapshot: Record<string, unknown> | null;
  created_at: string;
  verify_by: string;
}

interface TriggerSnapshot {
  largestDrop: number | null;
  baselineMastery: number | null;
  postCliffMastery: number;
  declineStreak: number;
  evaluatedAtIso: string;
  rulesVersion: string;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ════════════════════════════════════════════════════════════════════════════
// INJECT PHASE
// ════════════════════════════════════════════════════════════════════════════

interface InjectSummary {
  skipped?: 'flag_off';
  scanned: number;
  injected: number;
  deduped: number;
  skippedNullTarget: number;
  blocked: number;
  errors: number;
}

async function runInjectPhase(
  admin: SupabaseClient,
  nowMs: number,
): Promise<InjectSummary> {
  const summary: InjectSummary = {
    scanned: 0,
    injected: 0,
    deduped: 0,
    skippedNullTarget: 0,
    blocked: 0,
    errors: 0,
  };
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV;

  // Kill-switch gate #1: the INJECT phase is flag-gated (spec §9).
  const globallyOn = await isFeatureEnabled(ADAPTIVE_REMEDIATION_FLAGS.V1, {
    environment,
  });
  if (!globallyOn) {
    return { ...summary, skipped: 'flag_off' };
  }

  // 1. Bounded candidate scan: students with recent mastery movement only.
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
  const authUserIds = [...new Set(
    ((recentRows ?? []) as Array<{ actor_auth_user_id: string | null }>)
      .map((r) => r.actor_auth_user_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  )].slice(0, MAX_INJECT_STUDENTS_PER_RUN);
  if (authUserIds.length === 0) return summary;

  // 2. Resolve internal student rows (active, not deleted).
  const { data: studentRows, error: studentErr } = await admin
    .from('students')
    .select('id, auth_user_id, school_id, grade')
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

  // 3. Per-student mastery-event history (same source + shape the Pulse
  //    lenses assemble — masteryEventsFromRows is the pulse-server transform).
  const { data: eventRows, error: eventErr } = await admin
    .from('state_events')
    .select('actor_auth_user_id, kind, occurred_at, payload')
    .in('actor_auth_user_id', students.map((s) => s.auth_user_id).filter(Boolean))
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

  // 4. Adapter inputs: active interventions + recently-terminal (cooldown).
  const cooldownSinceIso = new Date(
    nowMs - ADAPTIVE_REMEDIATION_RULES.chapter_cooldown_days * MS_PER_DAY,
  ).toISOString();
  const [activeRes, terminalRes] = await Promise.all([
    admin
      .from('adaptive_interventions')
      .select('student_id, subject_code, chapter_number')
      .in('student_id', studentIds)
      .eq('status', 'active'),
    admin
      .from('adaptive_interventions')
      .select('student_id, subject_code, chapter_number, resolved_at')
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
  const activesByStudent = new Map<string, ActiveInterventionRef[]>();
  for (const r of (activeRes.data ?? []) as Array<{
    student_id: string; subject_code: string; chapter_number: number;
  }>) {
    const arr = activesByStudent.get(r.student_id) ?? [];
    arr.push({ subjectCode: r.subject_code, chapterNumber: r.chapter_number });
    activesByStudent.set(r.student_id, arr);
  }
  const terminalsByStudent = new Map<string, TerminalInterventionRef[]>();
  for (const r of (terminalRes.data ?? []) as Array<{
    student_id: string; subject_code: string; chapter_number: number; resolved_at: string | null;
  }>) {
    const terminalAtMs = r.resolved_at ? Date.parse(r.resolved_at) : NaN;
    if (!Number.isFinite(terminalAtMs)) continue;
    const arr = terminalsByStudent.get(r.student_id) ?? [];
    arr.push({ subjectCode: r.subject_code, chapterNumber: r.chapter_number, terminalAtMs });
    terminalsByStudent.set(r.student_id, arr);
  }

  // 5. Per-student: derive cliff → plan → insert → event + notification.
  for (const student of students) {
    if (!student.auth_user_id) continue;
    summary.scanned++;

    // Per-student flag check honours rollout_percentage cohort ramps.
    const enabledForStudent = await isFeatureEnabled(ADAPTIVE_REMEDIATION_FLAGS.V1, {
      userId: student.auth_user_id,
      role: 'student',
      environment,
    });
    if (!enabledForStudent) continue;

    const masteryEvents = masteryEventsFromRows(
      (eventsByUser.get(student.auth_user_id) ?? []).map((r) => ({
        kind: r.kind,
        occurred_at: r.occurred_at,
        payload: r.payload,
      })),
    );
    const signals = deriveSignals({ nowMs, masteryEvents });
    const cliff = signals.masteryCliff;
    if (cliff.verdict !== 'flagged') continue;

    // Decline-streak-only flags (Path 2) carry null target fields — v1 logs
    // and skips (you cannot target a chapter you cannot name; spec §4).
    if (cliff.worstSubject == null || cliff.worstChapter == null) {
      summary.skippedNullTarget++;
      logger.info('adaptive_remediation: decline-streak-only cliff skipped', {
        studentId: student.id,
        declineStreak: cliff.declineStreak,
      });
      continue;
    }

    // Snapshot the baseline/trough from the worst drop event for the target
    // chapter (Decision 6 — verification later needs only the CURRENT reading).
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
    if (postCliffMastery == null) {
      // Cannot snapshot a trough → cannot verify recovery later. Don't inject.
      summary.skippedNullTarget++;
      continue;
    }

    const interventionId = randomUUID();
    const plan = planRemediationInjection({
      cliffSignal: cliff,
      candidates: [{
        subjectCode: cliff.worstSubject,
        chapterNumber: cliff.worstChapter,
        interventionId,
        dropMagnitude: cliff.largestDrop,
      }],
      fatigueScore: null, // cron context — no live session state (treated NOT fatigued)
      activeInterventions: activesByStudent.get(student.id) ?? [],
      recentTerminalInterventions: terminalsByStudent.get(student.id) ?? [],
      currentQueueSize: BASE_RHYTHM_QUEUE_SIZE,
      nowMs,
    });
    if (plan.inject.length === 0) {
      summary.blocked++;
      continue;
    }
    const card = plan.inject[0];

    const verifyByIso = new Date(verificationWindowEndMs({
      subjectCode: card.subjectCode,
      chapterNumber: card.chapterNumber,
      baselineMastery,
      troughMastery: postCliffMastery,
      createdAtMs: nowMs,
      windowDays: ADAPTIVE_REMEDIATION_RULES.verification_window_days,
    })).toISOString();

    const snapshot: TriggerSnapshot = {
      largestDrop: cliff.largestDrop,
      baselineMastery,
      postCliffMastery,
      declineStreak: cliff.declineStreak,
      evaluatedAtIso: new Date(nowMs).toISOString(),
      rulesVersion: RULES_VERSION,
    };

    const { error: insertErr } = await admin
      .from('adaptive_interventions')
      .insert({
        id: interventionId,
        student_id: student.id,
        subject_code: card.subjectCode.toLowerCase(),
        chapter_number: card.chapterNumber,
        trigger_signal: 'mastery_cliff',
        trigger_snapshot: snapshot,
        status: 'active',
        verify_by: verifyByIso,
      });
    if (insertErr) {
      // 23505 = the partial unique index (one active per student×subject×
      // chapter) caught a concurrent/duplicate run — benign dedupe, no
      // side-effects (semantically ON CONFLICT DO NOTHING).
      if (insertErr.code === '23505') {
        summary.deduped++;
      } else {
        summary.errors++;
        logger.error('adaptive_remediation: intervention insert failed', {
          studentId: student.id,
          error: insertErr.message,
        });
      }
      continue;
    }
    summary.injected++;

    // Observability event — best-effort, never load-bearing (Decision 4).
    try {
      await publishEvent(admin, {
        kind: 'system.remediation_injected',
        eventId: randomUUID(),
        occurredAt: new Date(nowMs).toISOString(),
        actorAuthUserId: student.auth_user_id,
        tenantId: student.school_id ?? null,
        idempotencyKey: `remediation:${interventionId}:injected`,
        payload: {
          interventionId,
          subjectCode: card.subjectCode.toLowerCase(),
          chapterNumber: card.chapterNumber,
          largestDrop: cliff.largestDrop,
          declineStreak: cliff.declineStreak,
          baselineMastery,
          verifyBy: verifyByIso,
        },
      });
    } catch (err) {
      logger.warn('adaptive_remediation: remediation_injected publish failed', {
        interventionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Student notification — fire-and-forget (the trigger never throws).
    await onRemediationAssigned(student.id, {
      subjectCode: card.subjectCode.toLowerCase(),
      chapterNumber: card.chapterNumber,
      interventionId,
    });
  }

  return summary;
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
  errors: number;
}

type EscalationTarget =
  | { kind: 'teacher'; teacherId: string; classId: string }
  | { kind: 'parent' }
  | { kind: 'none' };

/**
 * Spec Decision 7 + §7 mapping note: B2B wins whenever ANY roster teacher
 * exists. Class selection is deterministic — subject-matching classes first
 * (exact normalized match outranks token-boundary partial match — see
 * ./_lib/subject-match.ts), tie-broken by most recent class creation; classes
 * without a teacher are skipped in order. B2C (linked guardian, dual-status)
 * is the fallback; 'none' is the terminal no-recipient edge case.
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

    // Deterministic ordering: best subject-match tier first (2 exact > 1
    // partial > 0 none — exact-equality always beats a partial token match),
    // then newest-created.
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

  // B2C: any live guardian link (dual-status convention — do not re-derive).
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
 * nullable by design (renders as "general" remediation on the teacher side).
 * P5: grade is compared as a STRING end-to-end.
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

async function runVerifyPhase(
  admin: SupabaseClient,
  nowMs: number,
): Promise<VerifySummary> {
  const summary: VerifySummary = {
    evaluated: 0,
    pending: 0,
    recovered: 0,
    escalated: 0,
    errors: 0,
  };

  // Drain gate (spec §9): the ONLY condition is "active rows exist".
  // Deliberately NOT flag-gated — the kill switch must drain, not freeze.
  const { data: activeRows, error: activeErr } = await admin
    .from('adaptive_interventions')
    .select('id, student_id, subject_code, chapter_number, trigger_snapshot, created_at, verify_by')
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

  // Post-intervention mastery observations — canonical read order: the
  // learner.mastery_changed event stream first, with the learner_mastery
  // projection rollup as a same-shape fallback observation (spec §4 verify
  // details). evaluateRecovery() itself filters per (subject, chapter, window).
  const minCreatedIso = rows
    .map((r) => r.created_at)
    .sort()[0];
  const [obsEventsRes, masteryRowsRes] = await Promise.all([
    authIds.length > 0
      ? admin
          .from('state_events')
          .select('actor_auth_user_id, kind, occurred_at, payload')
          .in('actor_auth_user_id', authIds)
          .eq('kind', 'learner.mastery_changed')
          .gte('occurred_at', minCreatedIso)
          .order('occurred_at', { ascending: true })
          .limit(5000)
      : Promise.resolve({ data: [], error: null }),
    authIds.length > 0
      ? admin
          .from('learner_mastery')
          .select('auth_user_id, subject_code, chapter_number, mastery, last_updated_at')
          .in('auth_user_id', authIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (obsEventsRes.error || masteryRowsRes.error) {
    logger.error('adaptive_remediation: verify observation fetch failed', {
      error: (obsEventsRes.error ?? masteryRowsRes.error)?.message,
    });
    summary.errors++;
    return summary;
  }

  const observationsByUser = new Map<string, MasteryObservation[]>();
  for (const r of (obsEventsRes.data ?? []) as StateEventRow[]) {
    const uid = r.actor_auth_user_id;
    if (!uid) continue;
    const p = r.payload ?? {};
    // Lowercase-normalize (assessment cond 3): the adaptive_interventions row
    // stores subject_code lowercase (DB CHECK adaptive_interventions_subject_
    // lower) and evaluateRecovery() matches subjectCode EXACTLY — a
    // mixed-case event payload ('Math') must still match the row ('math').
    const subjectCode =
      typeof p.subjectCode === 'string' ? p.subjectCode.toLowerCase() : null;
    const chapterNumber = typeof p.chapterNumber === 'number' ? p.chapterNumber : null;
    const toMastery = finiteOrNull(p.toMastery);
    const observedAtMs = Date.parse(r.occurred_at);
    if (subjectCode == null || chapterNumber == null || toMastery == null) continue;
    if (!Number.isFinite(observedAtMs)) continue;
    const arr = observationsByUser.get(uid) ?? [];
    arr.push({ subjectCode, chapterNumber, mastery: toMastery, observedAtMs });
    observationsByUser.set(uid, arr);
  }
  for (const r of (masteryRowsRes.data ?? []) as Array<{
    auth_user_id: string;
    subject_code: string;
    chapter_number: number;
    mastery: number;
    last_updated_at: string;
  }>) {
    const observedAtMs = Date.parse(r.last_updated_at);
    if (!Number.isFinite(observedAtMs) || !Number.isFinite(r.mastery)) continue;
    const arr = observationsByUser.get(r.auth_user_id) ?? [];
    arr.push({
      subjectCode: r.subject_code,
      chapterNumber: r.chapter_number,
      mastery: r.mastery,
      observedAtMs,
    });
    observationsByUser.set(r.auth_user_id, arr);
  }
  // Chronological order — evaluateRecovery resolves equal timestamps to the
  // later array element, so callers pass oldest → newest.
  for (const arr of observationsByUser.values()) {
    arr.sort((a, b) => a.observedAtMs - b.observedAtMs);
  }

  const nowIso = new Date(nowMs).toISOString();

  for (const row of rows) {
    summary.evaluated++;
    const student = studentById.get(row.student_id);
    const snapshot = (row.trigger_snapshot ?? {}) as Partial<TriggerSnapshot>;

    const createdAtMs = Date.parse(row.created_at);
    const verifyByMs = Date.parse(row.verify_by);
    // Honour the row's denormalized verify_by (non-retroactive window) and
    // fall back to the canonical constant only when the row is malformed.
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
      continue;
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
          interventionId: row.id,
          error: updErr.message,
        });
        continue;
      }
      if (((updated ?? []) as Array<{ id: string }>).length === 0) continue; // raced — already terminal
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
              daysToRecovery: Math.max(
                0,
                Math.floor((nowMs - (Number.isFinite(createdAtMs) ? createdAtMs : nowMs)) / MS_PER_DAY),
              ),
            },
          });
        } catch (err) {
          logger.warn('adaptive_remediation: remediation_recovered publish failed', {
            interventionId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      await onRemediationRecovered(row.student_id, {
        subjectCode: row.subject_code,
        chapterNumber: row.chapter_number,
        interventionId: row.id,
      });
      continue;
    }

    // ── verdict === 'expired' → ESCALATE ──────────────────────────────────
    const target = await resolveEscalationTarget(admin, row.student_id, row.subject_code);

    let teacherAssignmentId: string | null = null;
    let escalatedTo: 'teacher' | 'parent' | null = null;

    if (target.kind === 'teacher') {
      const chapterId = await resolveChapterId(
        admin,
        row.subject_code,
        row.chapter_number,
        student?.grade ?? null,
      );
      const { data: assignment, error: assignErr } = await admin
        .from('teacher_remediation_assignments')
        .insert({
          teacher_id: target.teacherId,
          student_id: row.student_id,
          class_id: target.classId,
          chapter_id: chapterId,
          status: 'assigned',
        })
        .select('id')
        .single();
      if (!assignErr && assignment?.id) {
        teacherAssignmentId = (assignment as { id: string }).id;
      } else if ((assignErr as { code?: string } | null)?.code === '23505') {
        // 23505 = the partial unique index on teacher_remediation_assignments
        // (status='assigned' — architect cond 2 companion migration,
        // 20260619000400) caught a concurrent/duplicate escalation. Mirror of
        // the interventions-insert pattern: benign dedupe — look up the
        // EXISTING assigned row's id for the FK and proceed with the escalated
        // transition. The lookup keys on (student_id, class_id, chapter_id
        // eq-or-IS-NULL, status) — the FULL natural key of the unique index,
        // so the recovered FK is the actual conflicting row, never a
        // same-student assigned row from a DIFFERENT class.
        let dupLookup = admin
          .from('teacher_remediation_assignments')
          .select('id')
          .eq('student_id', row.student_id)
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
          // Conflict reported but the surviving row can't be resolved — leave
          // the intervention ACTIVE so the next daily run retries cleanly.
          summary.errors++;
          logger.error('adaptive_remediation: assignment dedupe lookup failed', {
            interventionId: row.id,
            error: dupErr?.message ?? 'no existing assigned row found',
          });
          continue;
        }
        teacherAssignmentId = dupId;
      } else {
        // Assignment insert failed → leave the intervention ACTIVE so the next
        // daily run retries the whole escalation (no half-escalated state).
        summary.errors++;
        logger.error('adaptive_remediation: teacher assignment insert failed', {
          interventionId: row.id,
          error: assignErr?.message ?? 'no id returned',
        });
        continue;
      }
      escalatedTo = 'teacher';
    } else if (target.kind === 'parent') {
      escalatedTo = 'parent';
    } // 'none' → escalatedTo stays null (ops-visible via the event payload)

    const { data: escUpdated, error: escErr } = await admin
      .from('adaptive_interventions')
      .update({
        status: 'escalated',
        escalated_to: escalatedTo,
        teacher_assignment_id: teacherAssignmentId,
        resolved_at: nowIso,
      })
      .eq('id', row.id)
      .eq('status', 'active')
      .select('id');
    if (escErr) {
      summary.errors++;
      logger.error('adaptive_remediation: escalated transition failed', {
        interventionId: row.id,
        teacherAssignmentId, // ops-visible: a created assignment may be orphaned
        error: escErr.message,
      });
      continue;
    }
    if (((escUpdated ?? []) as Array<{ id: string }>).length === 0) {
      // Raced to terminal by a concurrent run. If we just created an
      // assignment it is now redundant — surface for ops, don't delete data.
      if (teacherAssignmentId) {
        logger.warn('adaptive_remediation: escalation raced; assignment may be redundant', {
          interventionId: row.id,
          teacherAssignmentId,
        });
      }
      continue;
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
          interventionId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Audit row — ALWAYS, metadata only (UUIDs + codes — REG-68 pattern).
    // This is the trail that survives a bus-off environment (Decision 4).
    await auditLog({
      actor_id: null, // system action under tiered authority
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
        rules_version: typeof snapshot.rulesVersion === 'string' ? snapshot.rulesVersion : null,
      },
    });

    await onRemediationEscalated(row.student_id, {
      subjectCode: row.subject_code,
      chapterNumber: row.chapter_number,
      interventionId: row.id,
      escalatedTo,
    });
  }

  return summary;
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
        resolved: (result.verify?.recovered ?? 0) + (result.verify?.escalated ?? 0),
        inject: result.inject ?? null,
        verify: result.verify ?? null,
      },
    });
  } catch (err) {
    // Architect cond 1: the response body is a GENERIC CONSTANT — raw error
    // detail goes to the structured logger only (P13; no internals/PII can
    // leak to a caller, even an authenticated cron caller).
    const message = err instanceof Error ? err.message : String(err);
    logger.error('adaptive_remediation: unhandled', { message });
    return NextResponse.json(
      { success: false, error: GENERIC_500_BODY },
      { status: 500 },
    );
  }
}
