// src/app/api/cron/build-twin-snapshots/route.ts
//
// Digital Twin + Knowledge Graph (Slice 1) — nightly learner_twin_snapshots
// builder. Invoked by the daily-cron Edge Function's THIN `buildTwinSnapshots`
// step (Deno cannot import src/lib/*, so ALL twin math lives HERE, next to the
// cognitive-engine helpers). Mirrors the adaptive-remediation worker posture.
//
//   POST {}   (no body args)
//
// For each recently-active student, compute today's digital-twin rollup row:
//   - mastery_by_topic        jsonb map  topic_id(uuid) -> mastery (0..1)
//   - decay_state             jsonb map  topic_id(uuid) -> predicted retention (0..1)
//   - dominant_error_types    text[]     (conceptual | careless | procedural), worst-first
//   - misconception_cluster_ids uuid[]   unresolved misconception_patterns.id
//   - cohort_percentile       numeric    within-batch, same-grade, by mean mastery
// UPSERT on (student_id, snapshot_date) so the step is idempotent (safe to run
// twice the same UTC day). Reuses the canonical learner-state reads
// (concept_mastery, student_misconceptions) + cognitive-engine helpers
// (predictRetention) — no thresholds/formulas are re-defined here.
//
// FEATURE FLAG (ff_digital_twin_v1): the ENTIRE body is gated. When OFF this
// route is a strict no-op — it writes nothing and returns
// { skipped: 'flag_off' } — byte-identical to not existing.
//
// Security (P9, REG-118/REG-119 posture): fail-closed CRON_SECRET gate with a
// constant-time compare BEFORE any DB I/O (shared @alfanumrik/lib/cron-auth).
// Accepts `Authorization: Bearer` or `x-cron-secret` (first-present-wins,
// irt-calibrate precedent); the legacy `?token=` query carrier was removed
// 2026-08-03 (secrets in query strings land in access logs).
//
// P13: no PII anywhere — rows, the response, and logs carry student UUIDs,
// topic UUIDs, numbers, and enum-like error tags ONLY. Free-text columns on
// student_misconceptions (question_text / student_answer / correct_answer) are
// NEVER selected. Generic 500 body; counts-only logging + response.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled, DIGITAL_TWIN_FLAGS } from '@alfanumrik/lib/feature-flags';
import { predictRetention } from '@alfanumrik/lib/cognitive-engine';
import { verifyCronAuth } from '@alfanumrik/lib/cron-auth';
import { publishEvent } from '@alfanumrik/lib/state/events/publish';
import {
  detectTransferEvidence,
  type TopicCorrectCount,
  type TransferEdge,
  type SourceMastery,
} from '@alfanumrik/lib/learn/transfer-evidence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MS_PER_DAY = 86_400_000;

/** Generic 500 body: never echo `err.message` to the caller. */
const GENERIC_500_BODY = 'internal_error';

/** Only build twins for students active within this window (bounds the batch). */
const ACTIVE_WINDOW_DAYS = 14;
/** Bounded batch (Vercel 30s budget); carry-over lands on the next daily run. */
const MAX_STUDENTS_PER_RUN = 1000;

/** Default SM-2 memory-strength when a topic has no retention_half_life reading. */
const DEFAULT_STRENGTH = 1.0;

// ════════════════════════════════════════════════════════════════════════════
// AUTH — fail-closed, constant-time, BEFORE any DB I/O
// (shared @alfanumrik/lib/cron-auth gate: first-present-wins Bearer, else
//  x-cron-secret; exactly ONE candidate compared; fail-closed on a missing
//  CRON_SECRET)
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
// ROW SHAPES
// ════════════════════════════════════════════════════════════════════════════

interface StudentRow {
  id: string;
  grade: string | null;
}

interface ConceptMasteryRow {
  student_id: string;
  topic_id: string | null;
  p_know: number | null;
  mastery_probability: number | null;
  mastery_mean: number | null;
  current_retention: number | null;
  retention_half_life: number | null;
  last_practiced_at: string | null;
  error_count_careless: number | null;
  error_count_conceptual: number | null;
  error_count_procedural: number | null;
}

interface MisconceptionRow {
  student_id: string;
  pattern_code: string;
  is_resolved: boolean | null;
}

interface PatternRow {
  id: string;
  pattern_code: string;
}

interface TwinSnapshotInsert {
  student_id: string;
  snapshot_date: string;
  mastery_by_topic: Record<string, number>;
  decay_state: Record<string, number>;
  dominant_error_types: string[];
  misconception_cluster_ids: string[];
  cohort_percentile: number | null;
}

interface BuildSummary {
  skipped?: 'flag_off';
  scanned: number;
  built: number;
  errors: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function firstFiniteMastery(r: ConceptMasteryRow): number | null {
  for (const v of [r.p_know, r.mastery_probability, r.mastery_mean]) {
    if (typeof v === 'number' && Number.isFinite(v)) return clamp01(v);
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
// BUILD
// ════════════════════════════════════════════════════════════════════════════

async function runBuild(admin: SupabaseClient, nowMs: number): Promise<BuildSummary> {
  const summary: BuildSummary = { scanned: 0, built: 0, errors: 0 };
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV;

  // FLAG GATE — strict no-op when OFF (writes nothing, no further I/O).
  const enabled = await isFeatureEnabled(DIGITAL_TWIN_FLAGS.V1, { environment });
  if (!enabled) {
    return { ...summary, skipped: 'flag_off' };
  }

  const snapshotDate = new Date(nowMs).toISOString().slice(0, 10); // UTC YYYY-MM-DD

  // 1. Recently-active student population (bounded).
  const sinceIso = new Date(nowMs - ACTIVE_WINDOW_DAYS * MS_PER_DAY).toISOString();
  const { data: studentRows, error: studentErr } = await admin
    .from('students')
    .select('id, grade')
    .eq('is_active', true)
    .is('deleted_at', null)
    .gte('last_active', sinceIso)
    .order('last_active', { ascending: false })
    .limit(MAX_STUDENTS_PER_RUN);
  if (studentErr) {
    logger.error('build_twin_snapshots: student scan failed', { error: studentErr.message });
    summary.errors++;
    return summary;
  }
  const students = (studentRows ?? []) as StudentRow[];
  if (students.length === 0) return summary;
  summary.scanned = students.length;
  const studentIds = students.map((s) => s.id);

  // 2. Per-student concept mastery (topic-keyed). Canonical learner-state read.
  const { data: cmRows, error: cmErr } = await admin
    .from('concept_mastery')
    .select(
      'student_id, topic_id, p_know, mastery_probability, mastery_mean, current_retention, retention_half_life, last_practiced_at, error_count_careless, error_count_conceptual, error_count_procedural',
    )
    .in('student_id', studentIds);
  if (cmErr) {
    logger.error('build_twin_snapshots: concept_mastery fetch failed', { error: cmErr.message });
    summary.errors++;
    return summary;
  }
  const masteryByStudent = new Map<string, ConceptMasteryRow[]>();
  for (const r of (cmRows ?? []) as ConceptMasteryRow[]) {
    const arr = masteryByStudent.get(r.student_id) ?? [];
    arr.push(r);
    masteryByStudent.set(r.student_id, arr);
  }

  // 3. Unresolved misconceptions → cluster (pattern) UUIDs. We select ONLY
  //    student_id + pattern_code + is_resolved (NEVER the free-text columns).
  const { data: mcRows, error: mcErr } = await admin
    .from('student_misconceptions')
    .select('student_id, pattern_code, is_resolved')
    .in('student_id', studentIds)
    .or('is_resolved.is.null,is_resolved.eq.false');
  if (mcErr) {
    // Non-fatal: misconception clusters are additive context, not load-bearing
    // for the blocked-prerequisite path. Degrade to empty clusters.
    logger.warn('build_twin_snapshots: student_misconceptions fetch failed', { error: mcErr.message });
  }
  const misconceptionRows = (mcRows ?? []) as MisconceptionRow[];

  // Map pattern_code -> misconception_patterns.id (uuid) for the codes seen.
  const seenCodes = [...new Set(misconceptionRows.map((r) => r.pattern_code).filter(Boolean))];
  const codeToId = new Map<string, string>();
  if (seenCodes.length > 0) {
    const { data: patternRows, error: pErr } = await admin
      .from('misconception_patterns')
      .select('id, pattern_code')
      .in('pattern_code', seenCodes);
    if (pErr) {
      logger.warn('build_twin_snapshots: misconception_patterns fetch failed', { error: pErr.message });
    } else {
      for (const p of (patternRows ?? []) as PatternRow[]) codeToId.set(p.pattern_code, p.id);
    }
  }
  const clusterIdsByStudent = new Map<string, string[]>();
  for (const r of misconceptionRows) {
    const id = codeToId.get(r.pattern_code);
    if (!id) continue;
    const set = clusterIdsByStudent.get(r.student_id) ?? [];
    if (!set.includes(id)) set.push(id);
    clusterIdsByStudent.set(r.student_id, set);
  }

  // 4. Build the per-student snapshot rows. We first compute each student's mean
  //    mastery so the within-batch, same-grade cohort percentile can be derived.
  interface Built {
    insert: TwinSnapshotInsert;
    grade: string | null;
    meanMastery: number | null;
  }
  const builtRows: Built[] = [];

  for (const student of students) {
    const rows = masteryByStudent.get(student.id) ?? [];

    const masteryByTopic: Record<string, number> = {};
    const decayState: Record<string, number> = {};
    let masterySum = 0;
    let masteryCount = 0;
    let careless = 0;
    let conceptual = 0;
    let procedural = 0;

    for (const r of rows) {
      // Aggregate persisted error tallies (these ARE the classifyError output the
      // BKT projector already wrote — reusing them avoids re-classifying per
      // response in a nightly rollup).
      careless += Number.isFinite(r.error_count_careless) ? (r.error_count_careless as number) : 0;
      conceptual += Number.isFinite(r.error_count_conceptual) ? (r.error_count_conceptual as number) : 0;
      procedural += Number.isFinite(r.error_count_procedural) ? (r.error_count_procedural as number) : 0;

      if (!r.topic_id) continue; // map keys are topic UUIDs (concept_edges namespace)
      const mastery = firstFiniteMastery(r);
      if (mastery == null) continue;
      masteryByTopic[r.topic_id] = mastery;
      masterySum += mastery;
      masteryCount++;

      // Decay axis: predicted retention via the Ebbinghaus curve (cognitive-
      // engine), strength = SM-2 retention_half_life. Fall back to the persisted
      // current_retention when there is no last-practiced timestamp.
      let retention: number | null = null;
      if (r.last_practiced_at) {
        const lastMs = Date.parse(r.last_practiced_at);
        if (Number.isFinite(lastMs)) {
          const days = Math.max(0, (nowMs - lastMs) / MS_PER_DAY);
          const strength =
            typeof r.retention_half_life === 'number' && Number.isFinite(r.retention_half_life)
              ? r.retention_half_life
              : DEFAULT_STRENGTH;
          retention = clamp01(predictRetention(days, strength));
        }
      }
      if (retention == null && typeof r.current_retention === 'number' && Number.isFinite(r.current_retention)) {
        retention = clamp01(r.current_retention);
      }
      if (retention != null) decayState[r.topic_id] = retention;
    }

    // dominant_error_types: worst-first, only categories with a positive tally.
    const dominantErrorTypes = (
      [
        ['conceptual', conceptual],
        ['careless', careless],
        ['procedural', procedural],
      ] as Array<[string, number]>
    )
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);

    const meanMastery = masteryCount > 0 ? masterySum / masteryCount : null;

    builtRows.push({
      grade: student.grade,
      meanMastery,
      insert: {
        student_id: student.id,
        snapshot_date: snapshotDate,
        mastery_by_topic: masteryByTopic,
        decay_state: decayState,
        dominant_error_types: dominantErrorTypes,
        misconception_cluster_ids: clusterIdsByStudent.get(student.id) ?? [],
        cohort_percentile: null, // filled below
      },
    });
  }

  // 5. Cohort percentile — within THIS batch, same grade, ranked by mean mastery.
  //    percentile = (# peers with mean <= mine) / cohortSize * 100. Null when the
  //    student has no mastery reading or the cohort has < 2 evaluable members.
  const meansByGrade = new Map<string, number[]>();
  for (const b of builtRows) {
    if (b.grade == null || b.meanMastery == null) continue;
    const arr = meansByGrade.get(b.grade) ?? [];
    arr.push(b.meanMastery);
    meansByGrade.set(b.grade, arr);
  }
  for (const b of builtRows) {
    if (b.grade == null || b.meanMastery == null) continue;
    const cohort = meansByGrade.get(b.grade);
    if (!cohort || cohort.length < 2) continue;
    const atOrBelow = cohort.filter((m) => m <= (b.meanMastery as number)).length;
    b.insert.cohort_percentile = Math.round((atOrBelow / cohort.length) * 100);
  }

  // 6. Idempotent UPSERT on (student_id, snapshot_date).
  const inserts = builtRows.map((b) => b.insert);
  if (inserts.length > 0) {
    const { error: upErr } = await admin
      .from('learner_twin_snapshots')
      .upsert(inserts, { onConflict: 'student_id,snapshot_date' });
    if (upErr) {
      logger.error('build_twin_snapshots: upsert failed', { error: upErr.message, rows: inserts.length });
      summary.errors++;
      return summary;
    }
    summary.built = inserts.length;
  }

  return summary;
}

// ════════════════════════════════════════════════════════════════════════════
// D12 TRANSFER-EVIDENCE STEP (Foxy North-Star Phase 3)
// ════════════════════════════════════════════════════════════════════════════
//
// Gated on ff_prereq_gating_v1 (SEPARATE flag from the twin build above —
// OFF → strict no-op). For yesterday's (previous UTC day) CORRECT quiz
// responses:
//   response → question_bank.topic_id (the topic the student succeeded on)
//   → concept_edges rows with edge_type='transfer' landing on those topics
//   → the PURE module detectTransferEvidence() keeps only (topic, fromTopic)
//     pairs whose SOURCE mastery clears TRANSFER_SOURCE_MASTERY_MIN (0.7 —
//     owned by the module, never re-defined here)
//   → one record_transfer_evidence(p_student_id, p_topic_id, p_from_topic_id)
//     RPC call per record (canonical write, migration 20260809000600) + one
//     learner.transfer_evidence bus event (observability; idempotencyKey
//     day-bucketed so a same-day re-run dedupes).
//
// P13: rows, events, and logs carry UUIDs + subject codes + numbers only.

/** Bounded read of yesterday's correct responses (nightly volume guard). */
const TRANSFER_MAX_RESPONSES = 2000;

interface TransferSummary {
  skipped?: 'flag_off';
  candidates: number;
  evidenceRecorded: number;
  errors: number;
}

async function runTransferStep(admin: SupabaseClient, nowMs: number): Promise<TransferSummary> {
  const summary: TransferSummary = { candidates: 0, evidenceRecorded: 0, errors: 0 };
  const environment = process.env.VERCEL_ENV || process.env.NODE_ENV;

  const enabled = await isFeatureEnabled('ff_prereq_gating_v1', { environment });
  if (!enabled) return { ...summary, skipped: 'flag_off' };

  // Previous UTC day window — a fixed bucket keeps same-day re-runs idempotent.
  const todayStartMs = Math.floor(nowMs / MS_PER_DAY) * MS_PER_DAY;
  const yStartIso = new Date(todayStartMs - MS_PER_DAY).toISOString();
  const yEndIso = new Date(todayStartMs).toISOString();
  const dayBucket = yStartIso.slice(0, 10);

  // 1. Yesterday's correct responses (question-linked only).
  const { data: respRows, error: respErr } = await admin
    .from('quiz_responses')
    .select('student_id, question_id, subject')
    .eq('is_correct', true)
    .not('question_id', 'is', null)
    .gte('created_at', yStartIso)
    .lt('created_at', yEndIso)
    .limit(TRANSFER_MAX_RESPONSES);
  if (respErr) {
    logger.error('build_twin_snapshots: transfer response scan failed', { error: respErr.message });
    summary.errors++;
    return summary;
  }
  const responses = (respRows ?? []) as Array<{ student_id: string; question_id: string; subject: string | null }>;
  if (responses.length === 0) return summary;

  // 2. question_id → topic_id (target concept).
  const questionIds = [...new Set(responses.map((r) => r.question_id))];
  const { data: qRows, error: qErr } = await admin
    .from('question_bank')
    .select('id, topic_id')
    .in('id', questionIds)
    .not('topic_id', 'is', null);
  if (qErr) {
    logger.error('build_twin_snapshots: transfer question fetch failed', { error: qErr.message });
    summary.errors++;
    return summary;
  }
  const topicByQuestion = new Map<string, string>();
  for (const q of (qRows ?? []) as Array<{ id: string; topic_id: string | null }>) {
    if (q.topic_id) topicByQuestion.set(q.id, q.topic_id);
  }

  // Group correct counts per student per topic (the pure module's input
  // shape), remembering a subject code per (student, topic) for the event.
  const correctByStudent = new Map<string, Map<string, number>>();
  const subjectByStudentTopic = new Map<string, string | null>();
  for (const r of responses) {
    const topicId = topicByQuestion.get(r.question_id);
    if (!topicId) continue;
    const perTopic = correctByStudent.get(r.student_id) ?? new Map<string, number>();
    perTopic.set(topicId, (perTopic.get(topicId) ?? 0) + 1);
    correctByStudent.set(r.student_id, perTopic);
    const key = `${r.student_id}:${topicId}`;
    if (!subjectByStudentTopic.has(key)) {
      subjectByStudentTopic.set(key, r.subject ? String(r.subject).toLowerCase() : null);
    }
  }
  if (correctByStudent.size === 0) return summary;

  // 3. Transfer edges landing on the succeeded topics.
  const targetTopicIds = [
    ...new Set([...correctByStudent.values()].flatMap((m) => [...m.keys()])),
  ];
  const { data: edgeRows, error: edgeErr } = await admin
    .from('concept_edges')
    .select('from_topic_id, to_topic_id, edge_type')
    .eq('edge_type', 'transfer')
    .in('to_topic_id', targetTopicIds);
  if (edgeErr) {
    logger.error('build_twin_snapshots: transfer edge fetch failed', { error: edgeErr.message });
    summary.errors++;
    return summary;
  }
  const transferEdges: TransferEdge[] = (
    (edgeRows ?? []) as Array<{ from_topic_id: string; to_topic_id: string; edge_type: string }>
  ).map((e) => ({ fromTopicId: e.from_topic_id, toTopicId: e.to_topic_id, edgeType: e.edge_type }));
  if (transferEdges.length === 0) return summary;

  // 4. Source-side mastery for the involved (student, source-topic) pairs.
  // detectTransferEvidence reads concept_mastery.mastery_probability (the
  // module's documented input) — no fallback chain here.
  const studentIds = [...correctByStudent.keys()];
  const sourceTopicIds = [...new Set(transferEdges.map((e) => e.fromTopicId))];
  const { data: cmRows, error: cmErr } = await admin
    .from('concept_mastery')
    .select('student_id, topic_id, mastery_probability')
    .in('student_id', studentIds)
    .in('topic_id', sourceTopicIds);
  if (cmErr) {
    logger.error('build_twin_snapshots: transfer mastery fetch failed', { error: cmErr.message });
    summary.errors++;
    return summary;
  }
  const masteryByStudent = new Map<string, SourceMastery[]>();
  for (const r of (cmRows ?? []) as Array<{ student_id: string; topic_id: string | null; mastery_probability: number | null }>) {
    if (!r.topic_id || typeof r.mastery_probability !== 'number') continue;
    const arr = masteryByStudent.get(r.student_id) ?? [];
    arr.push({ topicId: r.topic_id, masteryProbability: r.mastery_probability });
    masteryByStudent.set(r.student_id, arr);
  }

  // 5. Pure detection per student — the module owns the 0.7 source threshold
  //    (TRANSFER_SOURCE_MASTERY_MIN) and the edge_type re-filter.
  const detected: Array<{ studentId: string; topicId: string; fromTopicId: string; sourceMastery: number }> = [];
  for (const [studentId, perTopic] of correctByStudent) {
    const correctByTopic: TopicCorrectCount[] = [...perTopic.entries()].map(
      ([topicId, correctCount]) => ({ topicId, correctCount }),
    );
    const sourceMastery = masteryByStudent.get(studentId) ?? [];
    const records = detectTransferEvidence({
      studentId,
      correctByTopic,
      transferEdges,
      sourceMastery,
    });
    for (const rec of records) {
      const src = sourceMastery.find((m) => m.topicId === rec.fromTopicId);
      detected.push({
        studentId: rec.studentId,
        topicId: rec.topicId,
        fromTopicId: rec.fromTopicId,
        sourceMastery: src ? Math.min(1, Math.max(0, src.masteryProbability)) : 0,
      });
    }
  }
  summary.candidates = detected.length;
  if (detected.length === 0) return summary;

  // Envelope lookups for the bus (auth uuid + tenant scope).
  const evidencedStudentIds = [...new Set(detected.map((r) => r.studentId))];
  const { data: studentRows } = await admin
    .from('students')
    .select('id, auth_user_id, school_id')
    .in('id', evidencedStudentIds);
  const studentById = new Map(
    ((studentRows ?? []) as Array<{ id: string; auth_user_id: string | null; school_id: string | null }>).map(
      (s) => [s.id, s],
    ),
  );

  // 6. Canonical write (RPC per record — migration 20260809000600) +
  //    observability event.
  //
  //    BINDING (assessment-mandated, Phase 3 item 4): the RPC increments
  //    concept_mastery for the SOURCE topic (`p_topic_id`) — the already-solid
  //    prerequisite whose mastery is being re-evidenced by correct work in the
  //    dependent TARGET (`p_from_topic_id`). The migration's own comment reads
  //    "mastery of p_topic_id evidenced indirectly from correct work in
  //    dependent p_from_topic_id" (supabase/migrations/20260809000600, lines
  //    115-122). detectTransferEvidence returns `fromTopicId` = SOURCE (the
  //    solid prerequisite) and `topicId` = TARGET (today's success), so the
  //    mapping is INVERTED relative to the module's field names — hence this
  //    explicit binding comment. Getting this backwards double-credits the
  //    target instead of the source.
  for (const rec of detected) {
    const { error: rpcErr } = await admin.rpc('record_transfer_evidence', {
      p_student_id: rec.studentId,
      p_topic_id: rec.fromTopicId,      // SOURCE — evidence lands here
      p_from_topic_id: rec.topicId,     // TARGET — dependent topic where student succeeded
    });
    if (rpcErr) {
      summary.errors++;
      logger.warn('build_twin_snapshots: record_transfer_evidence failed', { error: rpcErr.message });
      continue;
    }
    summary.evidenceRecorded++;

    const student = studentById.get(rec.studentId);
    if (!student?.auth_user_id) continue; // canonical row landed; bus is best-effort
    try {
      await publishEvent(admin, {
        kind: 'learner.transfer_evidence',
        eventId: randomUUID(),
        occurredAt: new Date(nowMs).toISOString(),
        actorAuthUserId: student.auth_user_id,
        tenantId: student.school_id ?? null,
        // Idempotency key uses source:target ordering to mirror the event
        // payload's sourceTopicId/targetTopicId shape (assessment-mandated).
        idempotencyKey: `transfer:${rec.studentId}:${rec.fromTopicId}:${rec.topicId}:${dayBucket}`,
        payload: {
          studentId: rec.studentId,
          sourceTopicId: rec.fromTopicId, // already-solid prerequisite (SOURCE)
          targetTopicId: rec.topicId,     // topic student succeeded on today (TARGET)
          subjectCode: subjectByStudentTopic.get(`${rec.studentId}:${rec.topicId}`) ?? null,
          sourceMastery: rec.sourceMastery,
        },
      });
    } catch (err) {
      logger.warn('build_twin_snapshots: transfer_evidence publish failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}

// ════════════════════════════════════════════════════════════════════════════
// HANDLER
// ════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest): Promise<Response> {
  // Fail-closed auth gate — BEFORE any DB I/O (REG-118/REG-119 posture).
  if (!verifyCronAuth(req).ok) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const summary = await runBuild(supabaseAdmin, startedAt);

    // D12 transfer step — independently flagged (ff_prereq_gating_v1) and
    // independently failing: a transfer-step blowup never voids the twin
    // build that already landed above.
    let transfer: TransferSummary = { candidates: 0, evidenceRecorded: 0, errors: 0 };
    try {
      transfer = await runTransferStep(supabaseAdmin, startedAt);
    } catch (err) {
      transfer.errors++;
      logger.error('build_twin_snapshots: transfer step unhandled', {
        message: err instanceof Error ? err.message : String(err),
      });
    }

    // P13: counts only — never student/topic identifiers in logs.
    logger.info('build_twin_snapshots: run complete', {
      skipped: summary.skipped ?? null,
      scanned: summary.scanned,
      built: summary.built,
      errors: summary.errors,
      transferSkipped: transfer.skipped ?? null,
      transferCandidates: transfer.candidates,
      transferRecorded: transfer.evidenceRecorded,
      transferErrors: transfer.errors,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      success: true,
      data: {
        built: summary.built,
        scanned: summary.scanned,
        skipped: summary.skipped ?? null,
        errors: summary.errors,
        transfer: {
          skipped: transfer.skipped ?? null,
          candidates: transfer.candidates,
          evidenceRecorded: transfer.evidenceRecorded,
          errors: transfer.errors,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('build_twin_snapshots: unhandled', { message });
    return NextResponse.json({ success: false, error: GENERIC_500_BODY }, { status: 500 });
  }
}
