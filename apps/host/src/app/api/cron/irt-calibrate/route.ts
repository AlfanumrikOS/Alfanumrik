// src/app/api/cron/irt-calibrate/route.ts
// Phase 4 of Foxy moat plan — nightly IRT 2PL recalibration cron.
//
// Schedule:  vercel.json -> "/api/cron/irt-calibrate" runs daily at 02:50 UTC
//            (08:20 IST), 20 minutes after daily-cron so the day's quiz_responses
//            are settled.
// Auth:      CRON_SECRET via constant-time compare (matches reconcile-payments
//            and expired-subscriptions routes).
// Action:    Calls recalibrate_question_irt_2pl(NULL, 30) under the service role,
//            which fits 2PL (a, b) for every active question with >= 30 responses
//            calibrated more than 7 days ago (or never).
// Privacy:   The RPC is SECURITY DEFINER + service_role-only execution. No PII
//            crosses this route — request body is empty, response is the RPC
//            JSON summary.

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';
import { verifyCronAuth } from '@alfanumrik/lib/cron-auth';
import { estimateTheta, type ThetaResponse } from '@alfanumrik/lib/irt/estimate-theta';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Phase 3 E2: per-LO skill-theta writer (runs AFTER item calibration) ─────
//
// Estimates a per-(student, learning_objective) IRT theta from the last 30
// days of quiz_responses and upserts student_skill_state. Uses the pure TS
// Newton-Raphson twin of the update_irt_theta SQL
// (packages/lib/src/irt/estimate-theta.ts — same clips/iterations/convergence;
// SE clamped [0.3, 1.5] per the student_skill_state.theta_se contract).
//
// Mapping (response → LO):
//   primary:  question_bank.concept_code = learning_objectives.code
//   fallback: (subject, grade, chapter_number) → ALL of that chapter's LOs,
//             weighted equally (the response contributes to each).
// Gates: student needs >= 10 responses in the window; an LO needs >= 5 mapped
// responses whose item has a non-null irt_b before a theta is written.
//
// Fail-open per student (one bad student never aborts the pass); counts-only
// results (P13 — no student identifiers in the response or logs).

const SKILL_THETA_WINDOW_DAYS = 30;
const SKILL_THETA_MIN_STUDENT_RESPONSES = 10;
const SKILL_THETA_MIN_LO_RESPONSES = 5;
const SKILL_THETA_RING_SIZE = 20;
const RESPONSE_PAGE_SIZE = 1000;
const RESPONSE_MAX_PAGES = 50; // hard cap: 50k rows per nightly pass

interface SkillThetaResponseRow {
  student_id: string;
  is_correct: boolean;
  created_at: string;
  question_bank: {
    irt_b: number | null;
    concept_code: string | null;
    subject: string | null;
    grade: string | null;
    chapter_number: number | null;
  } | null;
}

interface WriteSkillThetasResult {
  studentsConsidered: number;
  studentsProcessed: number;
  losUpserted: number;
  studentsFailed: number;
}

async function writeSkillThetas(): Promise<WriteSkillThetasResult> {
  const windowStart = new Date(
    Date.now() - SKILL_THETA_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  // 1. Learning-objective maps: code → id (primary), and
  //    subject|grade|chapter → id[] (fallback). One read, reused for all students.
  //
  // SECURITY/RELIABILITY FIX (2026-09-02, P1-3 launch audit): this used to
  // embed `subjects!inner(code)` through `chapters`, but `chapters` carries
  // TWO foreign keys into `subjects` (chapters_subject_id_fkey via
  // subject_id, and fk_chapters_subject_code via subject_code) — live-
  // confirmed via pg_constraint. PostgREST can't pick one automatically, so
  // every run failed with "more than one relationship was found for
  // 'chapters' and 'subjects'" and this cron has not completed successfully
  // since 2026-08-06 (Vercel runtime-error log, 7 occurrences, last
  // 2026-09-02 02:50 UTC). Fix: chapters.subject_code already IS the
  // subject code (live-confirmed: populated on all 551 rows) — read it
  // directly and drop the nested subjects embed entirely, which removes the
  // ambiguity at its root instead of picking one FK name to disambiguate.
  const { data: loRows, error: loError } = await supabaseAdmin
    .from('learning_objectives')
    .select('id, code, chapters!inner(grade, chapter_number, subject_code)');
  if (loError) throw new Error(`learning_objectives read failed: ${loError.message}`);

  const loByCode = new Map<string, string>();
  const losByChapter = new Map<string, string[]>();
  for (const raw of loRows ?? []) {
    const lo = raw as unknown as {
      id: string;
      code: string;
      chapters:
        | { grade: string; chapter_number: number; subject_code: string | null }
        | { grade: string; chapter_number: number; subject_code: string | null }[];
    };
    if (typeof lo.code === 'string' && lo.code) loByCode.set(lo.code, lo.id);
    const ch = Array.isArray(lo.chapters) ? lo.chapters[0] : lo.chapters;
    if (ch && ch.subject_code) {
      const key = `${ch.subject_code}|${ch.grade}|${ch.chapter_number}`;
      const list = losByChapter.get(key) ?? [];
      list.push(lo.id);
      losByChapter.set(key, list);
    }
  }

  // 2. Window responses with the item's IRT + mapping columns embedded
  //    (inner join drops orphaned responses). Paged, ascending so the ring
  //    buffer's "most recent 20" is simply the tail.
  const responses: SkillThetaResponseRow[] = [];
  for (let page = 0; page < RESPONSE_MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin
      .from('quiz_responses')
      .select(
        'student_id, is_correct, created_at, ' +
          'question_bank!inner(irt_b, concept_code, subject, grade, chapter_number)',
      )
      .gte('created_at', windowStart)
      .order('created_at', { ascending: true })
      .range(page * RESPONSE_PAGE_SIZE, (page + 1) * RESPONSE_PAGE_SIZE - 1);
    if (error) throw new Error(`quiz_responses read failed: ${error.message}`);
    const rows = (data ?? []) as unknown as SkillThetaResponseRow[];
    responses.push(...rows);
    if (rows.length < RESPONSE_PAGE_SIZE) break;
  }

  // 3. Group by student.
  const byStudent = new Map<string, SkillThetaResponseRow[]>();
  for (const r of responses) {
    if (!r?.student_id) continue;
    const list = byStudent.get(r.student_id) ?? [];
    list.push(r);
    byStudent.set(r.student_id, list);
  }

  const result: WriteSkillThetasResult = {
    studentsConsidered: byStudent.size,
    studentsProcessed: 0,
    losUpserted: 0,
    studentsFailed: 0,
  };

  const nowIso = new Date().toISOString();

  for (const [studentId, studentRows] of byStudent) {
    if (studentRows.length < SKILL_THETA_MIN_STUDENT_RESPONSES) continue;
    try {
      // Map responses to LOs. `perLo` keeps insertion order = chronological.
      const perLo = new Map<
        string,
        { theta: ThetaResponse[]; attempts: number; correct: number; ring: Array<{ is_correct: boolean; at: string }> }
      >();
      const addTo = (loId: string, row: SkillThetaResponseRow) => {
        const bucket =
          perLo.get(loId) ?? { theta: [], attempts: 0, correct: 0, ring: [] };
        bucket.attempts++;
        if (row.is_correct) bucket.correct++;
        bucket.ring.push({ is_correct: row.is_correct === true, at: row.created_at });
        // Only items with a calibrated non-null irt_b inform the theta MLE.
        const b = row.question_bank?.irt_b;
        if (typeof b === 'number' && Number.isFinite(b)) {
          bucket.theta.push({ b, correct: row.is_correct === true });
        }
        perLo.set(loId, bucket);
      };

      for (const row of studentRows) {
        const qb = row.question_bank;
        if (!qb) continue;
        const primary = qb.concept_code ? loByCode.get(qb.concept_code) : undefined;
        if (primary) {
          addTo(primary, row);
        } else if (qb.subject && qb.grade && qb.chapter_number != null) {
          // Fallback: every LO of the chapter, weighted equally.
          const chapterLos =
            losByChapter.get(`${qb.subject}|${qb.grade}|${qb.chapter_number}`) ?? [];
          for (const loId of chapterLos) addTo(loId, row);
        }
      }

      // Estimate + upsert per LO meeting the >= 5 calibrated-response gate.
      const upserts: Array<Record<string, unknown>> = [];
      for (const [loId, bucket] of perLo) {
        if (bucket.theta.length < SKILL_THETA_MIN_LO_RESPONSES) continue;
        const est = estimateTheta(bucket.theta);
        if (!est) continue;
        upserts.push({
          student_id: studentId,
          learning_objective_id: loId,
          // student_skill_state.theta / theta_se are numeric(5,3).
          theta: Math.round(est.theta * 1000) / 1000,
          theta_se: Math.round(est.se * 1000) / 1000,
          total_attempts: bucket.attempts,
          total_correct: bucket.correct,
          last_n_responses: bucket.ring.slice(-SKILL_THETA_RING_SIZE),
          updated_at: nowIso,
        });
      }

      if (upserts.length > 0) {
        const { error: upsertError } = await supabaseAdmin
          .from('student_skill_state')
          .upsert(upserts, { onConflict: 'student_id,learning_objective_id' });
        if (upsertError) throw new Error(`skill-state upsert failed: ${upsertError.message}`);
        result.losUpserted += upserts.length;
      }
      result.studentsProcessed++;
    } catch (err) {
      // Fail-open per student — log counts-only, never identifiers (P13).
      result.studentsFailed++;
      logger.warn('irt_calibrate_skill_theta_student_failed', {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// Auth: shared @alfanumrik/lib/cron-auth gate. Vercel Cron sends
// `Authorization: Bearer <CRON_SECRET>` automatically; `x-cron-secret` is
// accepted for ops invocations. The legacy `?token=` query carrier was
// REMOVED 2026-08-03 (secrets in query strings land in access logs).

export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyCronAuth(req).ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const { data, error } = await supabaseAdmin.rpc(
      'recalibrate_question_irt_2pl',
      { p_question_id: null, p_min_attempts: 30 },
    );

    if (error) {
      logger.error('irt_calibrate_rpc_error', {
        error,
        durationMs: Date.now() - startedAt,
      });
      return NextResponse.json(
        { ok: false, error: 'rpc_failed', message: error.message },
        { status: 500 },
      );
    }

    logger.info('irt_calibrate_complete', {
      result: data,
      durationMs: Date.now() - startedAt,
    });

    // ── Phase 3 E2: per-LO skill-theta writer (after item calibration) ──────
    // Fail-open: a skill-theta failure never fails the route — item
    // calibration already succeeded and remains the primary contract.
    // Counts-only (P13).
    let skillThetas: WriteSkillThetasResult | { error: string } | null = null;
    try {
      skillThetas = await writeSkillThetas();
      logger.info('irt_calibrate_skill_thetas_complete', {
        ...skillThetas,
        durationMs: Date.now() - startedAt,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('irt_calibrate_skill_thetas_failed', { message });
      skillThetas = { error: 'skill_thetas_failed' };
    }

    await recordCronJobHealth({
      path: '/api/cron/irt-calibrate',
      metric: 'ops.cron.irt_calibrate.last_success_at',
      source: 'cron/irt-calibrate',
      durationMs: Date.now() - startedAt,
    });

    return NextResponse.json({ ok: true, result: data, skillThetas });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('irt_calibrate_unhandled', { message });
    return NextResponse.json(
      { ok: false, error: 'unhandled', message },
      { status: 500 },
    );
  }
}

// POST mirrors GET so the cron can use either verb. Vercel Cron defaults to GET.
export const POST = GET;
