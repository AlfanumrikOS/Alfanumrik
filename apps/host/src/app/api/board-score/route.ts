import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';

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
 * Resolve the `students.grade` for a given student_id.
 * We need the grade to tell the Edge Function which CBSE weight table to use.
 */
async function resolveStudentGrade(studentId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('grade')
    .eq('id', studentId)
    .is('deleted_at', null)
    .single();
  if (error || !data) return null;
  return (data as { grade: string }).grade;
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

  const grade = await resolveStudentGrade(studentId);
  if (!grade) {
    return NextResponse.json(
      { error: 'student_not_found', message: 'Student record not found or inactive.' },
      { status: 404 },
    );
  }

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

  const grade = await resolveStudentGrade(studentId);
  if (!grade) {
    return NextResponse.json(
      { error: 'student_not_found', message: 'Student record not found or inactive.' },
      { status: 404 },
    );
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
