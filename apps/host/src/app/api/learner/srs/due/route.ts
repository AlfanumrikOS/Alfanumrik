/**
 * GET /api/learner/srs/due — server-side count (and optional items) of due
 * SRS quiz-wrong-answer cards for the authenticated student.
 *
 * Exposes the E4 SRS "due-quiz-cards" single-source predicate
 * (packages/lib/src/learn/srs-predicate.ts) over an RLS-scoped server client,
 * so client components can obtain the count without importing the browser
 * supabase client into their module graph AND without ever reaching for
 * service-role code (P8). The srs-source adapter is server-only because it
 * delegates to domains/practice → supabaseAdmin; this route is its
 * client-consumer sibling for the specific quiz-wrong-answer lane.
 *
 * Contract:
 *   - Auth: authorizeRequest('progress.view_own', { requireStudentId: true }).
 *   - Response 200: { count: number, items?: Array<{ id, sourceId, subject }> }
 *     `items` is included only when `?withItems=1` is present; the dashboard
 *     count use-case avoids it (cheaper payload).
 *   - Cache-Control: private, max-age=60 (per-student read; SRS moves after
 *     every grade, so the TTL is short but non-zero to blunt double-mount
 *     dev renders and background refetches).
 *   - Reads via the RLS server client — this route never touches the
 *     service-role client (P8).
 *
 * The predicate is defined ONCE in srs-predicate.ts. This route MUST route
 * every read through buildSrsDueQuery so it can never drift from the quiz
 * page's fetchSrsDueQuizCards call.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { buildSrsDueQuery } from '@alfanumrik/lib/learn/srs-predicate';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DueCardRow {
  id: string;
  source_id: string | null;
  subject: string | null;
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorizeRequest(request, 'progress.view_own', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;
  if (!auth.studentId) {
    return NextResponse.json({ success: false, error: 'no_student_profile' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const withItems = searchParams.get('withItems') === '1';
  const subjectParam = (searchParams.get('subject') ?? '').trim().toLowerCase();
  const subject = subjectParam.length > 0 && subjectParam.length <= 64 ? subjectParam : null;

  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await buildSrsDueQuery(supabase, auth.studentId, {
      subject,
      columns: 'id, source_id, subject',
      // Aligned with fetchSrsDueQuizCards's 50-cap.
      limit: 50,
    });
    if (error) {
      // P13: counts-only logging — never log studentId in the message.
      logger.warn('learner/srs/due: query failed', {
        error: error.message,
      });
      return NextResponse.json(
        { success: false, error: 'srs_due_query_failed' },
        { status: 500 },
      );
    }
    const rows = (data ?? []) as DueCardRow[];
    const body: { success: true; count: number; items?: Array<{ id: string; sourceId: string | null; subject: string | null }> } = {
      success: true,
      count: rows.length,
    };
    if (withItems) {
      body.items = rows.map((r) => ({ id: r.id, sourceId: r.source_id, subject: r.subject }));
    }
    return NextResponse.json(body, {
      status: 200,
      headers: { 'Cache-Control': 'private, max-age=60' },
    });
  } catch (err) {
    logger.warn('learner/srs/due: unexpected failure', {
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { success: false, error: 'srs_due_query_failed' },
      { status: 500 },
    );
  }
}
