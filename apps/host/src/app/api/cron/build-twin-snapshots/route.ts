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
// constant-time compare BEFORE any DB I/O. Accepts `x-cron-secret`,
// `Authorization: Bearer`, or `?token=` (first-present-wins, irt-calibrate
// precedent).
//
// P13: no PII anywhere — rows, the response, and logs carry student UUIDs,
// topic UUIDs, numbers, and enum-like error tags ONLY. Free-text columns on
// student_misconceptions (question_text / student_answer / correct_answer) are
// NEVER selected. Generic 500 body; counts-only logging + response.

import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled, DIGITAL_TWIN_FLAGS } from '@alfanumrik/lib/feature-flags';
import { predictRetention } from '@alfanumrik/lib/cognitive-engine';

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
// ════════════════════════════════════════════════════════════════════════════

function constantTimeMatch(provided: string, secret: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * First-present-wins carrier precedence (Bearer, else x-cron-secret, else
 * ?token=): exactly ONE candidate is compared. A wrong value in a higher-
 * precedence carrier is NOT rescued by a correct lower one. Fail-closed on a
 * missing CRON_SECRET.
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
// HANDLER
// ════════════════════════════════════════════════════════════════════════════

export async function POST(req: NextRequest): Promise<Response> {
  // Fail-closed auth gate — BEFORE any DB I/O (REG-118/REG-119 posture).
  if (!isAuthorized(req)) {
    return NextResponse.json({ success: false, error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const summary = await runBuild(supabaseAdmin, startedAt);

    // P13: counts only — never student/topic identifiers in logs.
    logger.info('build_twin_snapshots: run complete', {
      skipped: summary.skipped ?? null,
      scanned: summary.scanned,
      built: summary.built,
      errors: summary.errors,
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({
      success: true,
      data: {
        built: summary.built,
        scanned: summary.scanned,
        skipped: summary.skipped ?? null,
        errors: summary.errors,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('build_twin_snapshots: unhandled', { message });
    return NextResponse.json({ success: false, error: GENERIC_500_BODY }, { status: 500 });
  }
}
