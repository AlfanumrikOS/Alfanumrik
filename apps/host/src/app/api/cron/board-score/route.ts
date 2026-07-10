import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { recordCronJobHealth } from '@alfanumrik/lib/cron-job-health';

/**
 * POST /api/cron/board-score
 *
 * Nightly Vercel Cron that computes BoardScore™ predictions for every active
 * student. Runs at 03:00 UTC daily (08:30 IST) — after daily-cron (02:30)
 * and irt-calibrate (02:50) have completed.
 *
 * Algorithm:
 *   1. Check feature flag `ff_board_score_v1` — bail immediately if disabled.
 *   2. Fetch all active students (is_active = true, deleted_at IS NULL).
 *   3. For each student, determine their active subjects from
 *      `cbse_chapter_weights` filtered by (board = 'CBSE', grade, is_active).
 *   4. Call the `board-score` Edge Function `compute` action for each
 *      (student, subject_code) pair using the SERVICE_ROLE_KEY bearer token.
 *   5. Return a summary: { total_students, total_subjects, success, failed }.
 *
 * Auth: CRON_SECRET header (set by Vercel Cron via cron config).
 *
 * Idempotency: the Edge Function upserts on
 *   (student_id, subject_code, grade, score_date) — safe to retry.
 *
 * Concurrency: subjects for a single student are computed sequentially to
 * avoid hammering Supabase Edge Functions. Students are also processed
 * sequentially (no Promise.all fan-out) because maxDuration = 300s gives
 * ample headroom at typical student counts.
 */

export const runtime = 'nodejs';
export const maxDuration = 300;

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyCronSecret(request: NextRequest): boolean {
  const cronSecret =
    request.headers.get('x-cron-secret') ||
    request.headers.get('authorization')?.replace('Bearer ', '');
  const expected = process.env.CRON_SECRET;
  if (!expected || !cronSecret) return false;
  // Constant-time comparison to prevent timing attacks.
  if (cronSecret.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < cronSecret.length; i++) {
    mismatch |= cronSecret.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface StudentRow {
  id: string;
  grade: string;
}

interface ChapterWeightRow {
  subject_code: string;
}

// ─── Feature Flag ─────────────────────────────────────────────────────────────

async function isBoardScoreEnabled(): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('feature_flags')
      .select('is_enabled')
      .eq('flag_name', 'ff_board_score_v1')
      .single();
    if (error || !data) return false;
    return (data as { is_enabled: boolean }).is_enabled === true;
  } catch {
    // Fail-closed: if we can't read the flag, don't run.
    return false;
  }
}

// ─── Subject lookup ───────────────────────────────────────────────────────────

/**
 * Returns the distinct active subject_codes for a given grade from
 * cbse_chapter_weights. These are the subjects the cron will score.
 */
async function getActiveSubjectsForGrade(grade: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('cbse_chapter_weights')
    .select('subject_code')
    .eq('board', 'CBSE')
    .eq('grade', grade)
    .eq('is_active', true);

  if (error || !data) return [];

  // Deduplicate subject_codes (one row per chapter, many chapters per subject).
  const seen = new Set<string>();
  for (const row of data as ChapterWeightRow[]) {
    seen.add(row.subject_code);
  }
  return [...seen];
}

// ─── Edge Function invocation ─────────────────────────────────────────────────

async function computeForStudent(
  edgeUrl: string,
  serviceRoleKey: string,
  studentId: string,
  grade: string,
  subjectCode: string,
  scoreDate: string,
  correlationId: string,
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(edgeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serviceRoleKey}`,
        'x-request-id': `${correlationId}:${studentId}:${subjectCode}`,
      },
      body: JSON.stringify({
        action: 'compute',
        student_id: studentId,
        grade,
        subject_code: subjectCode,
        score_date: scoreDate,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    logger.warn('cron/board-score: per-student compute failed', {
      student_id: studentId,
      grade,
      subject_code: subjectCode,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0 };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const correlationId = request.headers.get('x-request-id') ?? crypto.randomUUID();

  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    logger.error('cron/board-score: missing env (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY)', {
      correlation_id: correlationId,
    });
    return NextResponse.json({ success: false, error: 'Server not configured' }, { status: 503 });
  }

  // ── 1. Feature flag gate ──────────────────────────────────────────────────

  const enabled = await isBoardScoreEnabled();
  if (!enabled) {
    const durationMs = Date.now() - startTime;
    logger.info('cron/board-score: ff_board_score_v1 disabled — skipping run', {
      correlation_id: correlationId,
    });
    await recordCronJobHealth({
      path: '/api/cron/board-score',
      metric: 'ops.cron.board_score.last_success_at',
      source: 'cron/board-score',
      durationMs,
      requestId: correlationId,
      context: { skipped: true, reason: 'ff_board_score_v1 disabled' },
    });
    return NextResponse.json(
      { success: true, skipped: true, reason: 'ff_board_score_v1 disabled' },
      { status: 200 },
    );
  }

  // ── 2. Fetch active students ──────────────────────────────────────────────

  const { data: students, error: studentsErr } = await supabaseAdmin
    .from('students')
    .select('id, grade')
    .eq('is_active', true)
    .is('deleted_at', null);

  if (studentsErr) {
    logger.error('cron/board-score: failed to fetch students', {
      correlation_id: correlationId,
      error: studentsErr.message,
    });
    return NextResponse.json(
      { success: false, error: 'Failed to fetch students', detail: studentsErr.message },
      { status: 500 },
    );
  }

  const activeStudents = (students ?? []) as StudentRow[];
  const scoreDate = new Date().toISOString().slice(0, 10);
  const edgeUrl = `${supabaseUrl}/functions/v1/board-score`;

  // Per-grade subject cache so we don't re-query cbse_chapter_weights for
  // every student in the same grade.
  const subjectsByGrade = new Map<string, string[]>();

  let totalSubjects = 0;
  let successCount = 0;
  let failedCount = 0;
  const failedStudents: { student_id: string; grade: string; subject_code: string }[] = [];

  logger.info('cron/board-score: starting run', {
    correlation_id: correlationId,
    score_date: scoreDate,
    student_count: activeStudents.length,
  });

  // ── 3 & 4. For each student, compute each subject ─────────────────────────

  for (const student of activeStudents) {
    const { id: studentId, grade } = student;

    if (!grade) {
      logger.warn('cron/board-score: student has no grade, skipping', { student_id: studentId });
      continue;
    }

    // Load subjects for this grade (cached).
    if (!subjectsByGrade.has(grade)) {
      const subjects = await getActiveSubjectsForGrade(grade);
      subjectsByGrade.set(grade, subjects);
    }

    const subjects = subjectsByGrade.get(grade) ?? [];

    for (const subjectCode of subjects) {
      totalSubjects++;
      const result = await computeForStudent(
        edgeUrl,
        serviceRoleKey,
        studentId,
        grade,
        subjectCode,
        scoreDate,
        correlationId,
      );

      if (result.ok) {
        successCount++;
      } else {
        failedCount++;
        failedStudents.push({ student_id: studentId, grade, subject_code: subjectCode });

        // Log individual failure but do not abort the full run.
        logger.warn('cron/board-score: compute returned non-ok', {
          correlation_id: correlationId,
          student_id: studentId,
          grade,
          subject_code: subjectCode,
          http_status: result.status,
        });
      }
    }
  }

  const durationMs = Date.now() - startTime;

  logger.info('cron/board-score: run complete', {
    correlation_id: correlationId,
    score_date: scoreDate,
    total_students: activeStudents.length,
    total_subjects: totalSubjects,
    success: successCount,
    failed: failedCount,
    duration_ms: durationMs,
  });

  // Surface a non-200 only if every single computation failed (total outage).
  // Partial failures are normal (student with no CME data) and logged above.
  const allFailed = totalSubjects > 0 && failedCount === totalSubjects;

  if (!allFailed) {
    await recordCronJobHealth({
      path: '/api/cron/board-score',
      metric: 'ops.cron.board_score.last_success_at',
      source: 'cron/board-score',
      durationMs,
      requestId: correlationId,
      context: {
        total_students: activeStudents.length,
        total_subjects: totalSubjects,
        success_count: successCount,
        failed_count: failedCount,
      },
    });
  }

  return NextResponse.json(
    {
      success: !allFailed,
      score_date: scoreDate,
      total_students: activeStudents.length,
      total_subjects: totalSubjects,
      success_count: successCount,
      failed_count: failedCount,
      // Expose first 20 failures only to keep payload bounded.
      failed_sample: failedStudents.slice(0, 20),
      duration_ms: durationMs,
    },
    { status: allFailed ? 502 : 200 },
  );
}

export async function GET(request: NextRequest) {
  return POST(request);
}
