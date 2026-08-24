import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { getStudentBoardSubjects } from '../cron/board-score/_lib/get-student-board-subjects';

/**
 * GET  /api/board-score  — Fetch latest BoardScore™ predictions for the
 *                           authenticated student (all subjects, current grade).
 * POST /api/board-score  — Trigger an on-demand BoardScore™ compute for the
 *                           authenticated student and a specific subject.
 *
 * Both handlers proxy to the `board-score` Supabase Edge Function using
 * the correct auth token for each action:
 *   - `get`     → forward the student's own JWT (RLS enforces row ownership)
 *   - `compute` → use the SERVICE_ROLE_KEY bearer token
 *
 * The Edge Function is the single source of truth for scoring logic,
 * feature-flag enforcement, and persistence. These routes are thin
 * orchestration layers only.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Resolve the `students.grade` (+ elected subjects) for a given student_id.
 * We need the grade to tell the Edge Function which CBSE weight table to use,
 * and `selected_subjects` to explain an EMPTY prediction list honestly (see
 * `resolveEligibility` below).
 */
async function resolveStudentProfile(
  studentId: string,
): Promise<{ grade: string; selectedSubjects: string[] } | null> {
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('grade, selected_subjects')
    .eq('id', studentId)
    .is('deleted_at', null)
    .single();
  if (error || !data) return null;
  const row = data as { grade: string; selected_subjects: string[] | null };
  return { grade: row.grade, selectedSubjects: row.selected_subjects ?? [] };
}

/**
 * Why an empty BoardScore is empty.
 *
 * Production reality (measured 2026-08-24): `board_score_predictions` has zero
 * rows, and three DIFFERENT gates produce that same empty array —
 *   1. the grade has no `cbse_chapter_weights` at all (grades 6-9 and 11 have
 *      none; only 10 and 12 are populated),
 *   2. the student's `students.selected_subjects` is empty (37 of 38 active
 *      board-grade students), so `getStudentBoardSubjects()` returns [],
 *   3. everything is eligible but the nightly compute has not produced a row.
 *
 * The widget previously rendered ONE "No Data Yet" card for all three, which
 * blames the student for a platform gap in cases 1 and 2. This block tells the
 * client which of the three it is so it can say the true thing. Counts only —
 * no subject list, no identifiers (P13).
 */
interface BoardScoreEligibility {
  grade: string;
  /** False only for grades with no active CBSE mark-allocation data at all. */
  grade_has_board_weights: boolean;
  selected_subject_count: number;
  eligible_subject_count: number;
}

async function gradeHasBoardWeights(grade: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('cbse_chapter_weights')
    .select('subject_code')
    .eq('board', 'CBSE')
    .eq('grade', grade)
    .eq('is_active', true)
    .limit(1);
  // Fail OPEN. A transient read failure must never tell a Class 10 student
  // that their class is unsupported — that would be a new lie replacing the
  // old one. On error we claim support and fall through to the softer states.
  if (error) return true;
  return (data?.length ?? 0) > 0;
}

async function resolveEligibility(
  studentId: string,
  grade: string,
  selectedSubjects: string[],
): Promise<BoardScoreEligibility> {
  const hasWeights = await gradeHasBoardWeights(grade);
  // Skip the 3-query intersection when the grade has no weights at all — the
  // answer is necessarily zero and the client shows the grade state anyway.
  const eligible = hasWeights ? await getStudentBoardSubjects(studentId, grade) : [];
  return {
    grade,
    grade_has_board_weights: hasWeights,
    selected_subject_count: selectedSubjects.length,
    eligible_subject_count: eligible.length,
  };
}

/**
 * Fetch the Edge Function URL and ensure required env vars are present.
 */
function getEdgeConfig(): { url: string; serviceRoleKey: string } | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return {
    url: `${supabaseUrl}/functions/v1/board-score`,
    serviceRoleKey,
  };
}

// ─── GET /api/board-score ─────────────────────────────────────────────────────

/**
 * Returns the student's latest board score predictions for all subjects.
 * Response mirrors the Edge Function shape:
 *   { code: 'ok', message: string, data: BoardScorePrediction[] }
 */
export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-request-id') ?? crypto.randomUUID();

  const auth = await authorizeRequest(request, 'content.read');
  if (!auth.authorized) return auth.errorResponse;

  const studentId = auth.studentId;
  if (!studentId) {
    return NextResponse.json(
      { error: 'student_not_found', message: 'No student profile linked to this account.' },
      { status: 403 },
    );
  }

  const cfg = getEdgeConfig();
  if (!cfg) {
    logger.error('board-score GET: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 });
  }

  const profile = await resolveStudentProfile(studentId);
  if (!profile) {
    return NextResponse.json(
      { error: 'student_not_found', message: 'Student record not found or inactive.' },
      { status: 404 },
    );
  }
  const { grade, selectedSubjects } = profile;

  // Forward the student's JWT so Edge Function RLS works correctly.
  let authHeader = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!authHeader) {
    const supabase = await createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      authHeader = `Bearer ${session.access_token}`;
    }
  }

  if (!authHeader) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
        'x-request-id': correlationId,
      },
      body: JSON.stringify({ action: 'get', student_id: studentId, grade }),
      signal: AbortSignal.timeout(55_000),
    });

    const text = await res.text();
    let payload: unknown = null;
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 500) }; }

    logger.info('board-score GET: edge returned', {
      correlation_id: correlationId,
      student_id: studentId,
      status: res.status,
    });

    // Only pay for the eligibility reads when the answer is actually empty —
    // the happy path (predictions exist) stays a single edge round-trip.
    const isPlainObject = payload !== null && typeof payload === 'object' && !Array.isArray(payload);
    const predictionCount = isPlainObject && Array.isArray((payload as { data?: unknown }).data)
      ? ((payload as { data: unknown[] }).data).length
      : 0;

    if (res.ok && isPlainObject && predictionCount === 0
        && (payload as { code?: unknown }).code !== 'disabled') {
      const eligibility = await resolveEligibility(studentId, grade, selectedSubjects);
      return NextResponse.json({ ...(payload as Record<string, unknown>), eligibility }, { status: 200 });
    }

    return NextResponse.json(payload, { status: res.ok ? 200 : res.status });
  } catch (err) {
    logger.error('board-score GET: edge invocation failed', {
      correlation_id: correlationId,
      student_id: studentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'edge_invocation_failed' }, { status: 502 });
  }
}

// ─── POST /api/board-score ────────────────────────────────────────────────────

/**
 * Triggers an on-demand BoardScore™ compute for a specific subject.
 *
 * Request body:
 *   { subject_code: string }   e.g. "mathematics", "science"
 *
 * This uses the SERVICE_ROLE_KEY (not the student JWT) because the compute
 * action requires admin-level write access to board_score_predictions.
 * The student association is passed as a validated body payload after
 * the student is confirmed as the owner of the session.
 */
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-request-id') ?? crypto.randomUUID();

  const auth = await authorizeRequest(request, 'content.read');
  if (!auth.authorized) return auth.errorResponse;

  const studentId = auth.studentId;
  if (!studentId) {
    return NextResponse.json(
      { error: 'student_not_found', message: 'No student profile linked to this account.' },
      { status: 403 },
    );
  }

  // Parse and validate body
  let body: { subject_code?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const subjectCode = typeof body.subject_code === 'string'
    ? body.subject_code.trim().toLowerCase()
    : null;

  if (!subjectCode || subjectCode.length === 0 || subjectCode.length > 64) {
    return NextResponse.json(
      { error: 'invalid_subject_code', message: 'subject_code must be a non-empty string ≤64 chars.' },
      { status: 422 },
    );
  }

  const cfg = getEdgeConfig();
  if (!cfg) {
    logger.error('board-score POST: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return NextResponse.json({ error: 'server_misconfigured' }, { status: 503 });
  }

  const profile = await resolveStudentProfile(studentId);
  if (!profile) {
    return NextResponse.json(
      { error: 'student_not_found', message: 'Student record not found or inactive.' },
      { status: 404 },
    );
  }
  const { grade } = profile;

  // Validate subject eligibility BEFORE forwarding to the Edge Function —
  // reuses the same rule the nightly cron applies (spec §4/§7.1). A student
  // (or a client bug, or a stale cached tab) must not be able to trigger a
  // persisted BoardScore prediction for a subject they never selected.
  const eligibleSubjects = await getStudentBoardSubjects(studentId, grade);
  if (!eligibleSubjects.includes(subjectCode)) {
    logger.info('board-score POST: subject not eligible — rejecting before edge call', {
      correlation_id: correlationId,
      student_id: studentId,
      subject_code: subjectCode,
      grade,
    });
    return NextResponse.json({ error: 'subject_not_eligible' }, { status: 422 });
  }

  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.serviceRoleKey}`,
        'x-request-id': correlationId,
      },
      body: JSON.stringify({
        action: 'compute',
        student_id: studentId,
        grade,
        subject_code: subjectCode,
        score_date: new Date().toISOString().slice(0, 10),
      }),
      signal: AbortSignal.timeout(55_000),
    });

    const text = await res.text();
    let payload: unknown = null;
    try { payload = JSON.parse(text); } catch { payload = { raw: text.slice(0, 500) }; }

    logger.info('board-score POST: compute returned', {
      correlation_id: correlationId,
      student_id: studentId,
      subject_code: subjectCode,
      grade,
      status: res.status,
    });

    return NextResponse.json(payload, { status: res.ok ? 200 : res.status });
  } catch (err) {
    logger.error('board-score POST: edge invocation failed', {
      correlation_id: correlationId,
      student_id: studentId,
      subject_code: subjectCode,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'edge_invocation_failed' }, { status: 502 });
  }
}
