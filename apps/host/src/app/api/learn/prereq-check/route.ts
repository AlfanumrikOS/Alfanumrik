/**
 * GET /api/learn/prereq-check?subject=&grade=&chapter= — Foxy North-Star
 * Phase 3 (E5/D12 prerequisite gating, fail-open suggest UI).
 *
 * Returns the prerequisite-readiness verdict for the authenticated student
 * on a (subject, grade, chapter) target, computed by the pure/assessment-
 * owned `checkPrereqs` module over the knowledge graph (concept_edges
 * edge_type='prerequisite') + the student's own mastery (RLS-scoped read).
 *
 * Contract (mirrors /api/learn/remediation's null-when-off shape):
 *   - ff_prereq_gating_v1 evaluated PER-STUDENT server-side. Flag OFF →
 *     HTTP 200 with a `null` body — the client renders nothing and the
 *     quiz-setup UI fails open (no gating).
 *   - Flag ON → HTTP 200 with checkPrereqs' result, Cache-Control
 *     private max-age=300 (per-student readable only; short TTL because
 *     mastery moves after every quiz).
 *   - Auth: authorizeRequest('progress.view_own', { requireStudentId }).
 *   - Reads via the RLS server client — this route never touches the
 *     service-role client (P8).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { checkPrereqs } from '@alfanumrik/lib/learn/prereq-gating';
import { logger } from '@alfanumrik/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Prerequisite-gating rollout flag (architect seed, default OFF). */
const PREREQ_GATING_FLAG = 'ff_prereq_gating_v1';

const GRADE_RE = /^(?:[6-9]|1[0-2])$/; // P5: grades are strings "6".."12"

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorizeRequest(request, 'progress.view_own', {
    requireStudentId: true,
  });
  if (!auth.authorized) return auth.errorResponse!;
  if (!auth.studentId) {
    return NextResponse.json({ error: 'no_student_profile' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const subject = (searchParams.get('subject') ?? '').trim().toLowerCase();
  const grade = (searchParams.get('grade') ?? '').trim();
  const chapterRaw = (searchParams.get('chapter') ?? '').trim();
  const chapter = Number.parseInt(chapterRaw, 10);

  if (!subject || subject.length > 64) {
    return NextResponse.json({ error: 'invalid_subject' }, { status: 400 });
  }
  if (!GRADE_RE.test(grade)) {
    return NextResponse.json({ error: 'invalid_grade' }, { status: 400 });
  }
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 99 || String(chapter) !== chapterRaw) {
    return NextResponse.json({ error: 'invalid_chapter' }, { status: 400 });
  }

  // Per-student flag gate — OFF → null body (client fails open, renders
  // nothing). Same contract as /api/learn/remediation.
  const flagOn = await isFeatureEnabled(PREREQ_GATING_FLAG, {
    userId: auth.userId ?? undefined,
    role: 'student',
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });
  if (!flagOn) {
    return NextResponse.json(null, { status: 200 });
  }

  try {
    // RLS-scoped server client: the student reads only their own mastery.
    const supabase = await createSupabaseServerClient();
    const result = await checkPrereqs(supabase, {
      studentId: auth.studentId,
      subject,
      grade,
      chapterNumber: chapter,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (err) {
    // Fail open: the suggest UI treats an error like "no gate". P13:
    // counts-only logging.
    logger.warn('learn/prereq-check: checkPrereqs failed', {
      error: err instanceof Error ? err.message : String(err),
      subject,
      chapter,
    });
    return NextResponse.json(null, { status: 200 });
  }
}
