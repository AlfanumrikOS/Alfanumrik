import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';

/**
 * GET /api/super-admin/marking-integrity/[studentId]
 *
 * Session drill-down endpoint. Returns all rows from `marking_audit_last_30d`
 * for a specific student, optionally filtered to a single session.
 *
 * Query params:
 *   session  — optional UUID; when present, filters to a single session's rows.
 *   limit    — max rows to return (default 100, max 500).
 *
 * Auth: `super_admin.access` — same permission as the parent listing route.
 *
 * Privacy posture (P13):
 *   UUIDs only. We do not join students/teachers tables here.
 *   The view is service_role-only by grant; supabaseAdmin is the only client
 *   that can query it.
 */

export const runtime = 'nodejs';
export const revalidate = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function clampLimit(raw: string | null): number {
  if (raw == null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

interface RouteParams {
  params: Promise<{ studentId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const auth = await authorizeRequest(request, 'super_admin.access');
  if (!auth.authorized) return auth.errorResponse!;

  const { studentId } = await params;

  if (!UUID_RE.test(studentId)) {
    return NextResponse.json(
      { error: 'invalid_student_id', message: 'studentId must be a valid UUID' },
      { status: 400 },
    );
  }

  const url = request.nextUrl;
  const sessionIdRaw = url.searchParams.get('session');
  const limit = clampLimit(url.searchParams.get('limit'));

  if (sessionIdRaw && !UUID_RE.test(sessionIdRaw)) {
    return NextResponse.json(
      { error: 'invalid_session_id', message: 'session must be a valid UUID' },
      { status: 400 },
    );
  }

  try {
    let query = supabaseAdmin
      .from('marking_audit_last_30d')
      .select(
        'student_id, session_id, question_id, selected_option, snapshot_correct_idx, recorded_is_correct, expected_is_correct, completed_at',
      )
      .eq('student_id', studentId)
      .order('completed_at', { ascending: false })
      .limit(limit);

    if (sessionIdRaw) {
      query = query.eq('session_id', sessionIdRaw);
    }

    const { data, error } = await query;

    if (error) {
      const code = (error as { code?: string }).code;
      if (code === '42P01') {
        return NextResponse.json(
          {
            error: 'view_unavailable',
            message:
              'marking_audit_last_30d view is not yet present on this environment. Run the latest migrations.',
          },
          { status: 503 },
        );
      }
      return NextResponse.json(
        { error: 'query_failed', message: error.message },
        { status: 500 },
      );
    }

    const rows = (data ?? []).map((r) => ({
      student_id: r.student_id as string,
      session_id: r.session_id as string,
      question_id: r.question_id as string,
      selected_option: r.selected_option as number | null,
      snapshot_correct_idx: r.snapshot_correct_idx as number | null,
      recorded_is_correct: r.recorded_is_correct === null ? null : !!r.recorded_is_correct,
      expected_is_correct:
        r.expected_is_correct === null ? null : !!r.expected_is_correct,
      completed_at: r.completed_at as string,
    }));

    // Derive per-session summary from the returned rows.
    const sessionMap = new Map<string, { drift: number; missing: number; total: number }>();
    for (const r of rows) {
      const entry = sessionMap.get(r.session_id) ?? { drift: 0, missing: 0, total: 0 };
      entry.total += 1;
      if (r.snapshot_correct_idx === null) {
        entry.missing += 1;
      } else if (r.recorded_is_correct !== r.expected_is_correct) {
        entry.drift += 1;
      }
      sessionMap.set(r.session_id, entry);
    }

    const sessions = Array.from(sessionMap.entries()).map(([sid, counts]) => ({
      session_id: sid,
      ...counts,
    }));

    return NextResponse.json(
      {
        student_id: studentId,
        session_filter: sessionIdRaw ?? null,
        rows,
        sessions,
        total: rows.length,
      },
      {
        headers: { 'Cache-Control': 'private, max-age=0, s-maxage=30' },
      },
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: 'internal_error',
        message: err instanceof Error ? err.message : 'unknown',
      },
      { status: 500 },
    );
  }
}
