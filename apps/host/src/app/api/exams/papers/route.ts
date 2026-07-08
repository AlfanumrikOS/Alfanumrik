/**
 * GET /api/exams/papers — JEE/NEET/Olympiad mock-test catalog (PR-5).
 *
 * Lists available exam papers (catalog metadata only — no questions). The
 * mock-test runner page (`/exams/mock`) calls this to render the picker.
 *
 * Permission: exam.view (matches PERMISSIONS.EXAM_VIEW in rbac.ts).
 *
 * Feature-flag visibility (defense in depth, NOT a security boundary):
 *   - The detail route (/api/exams/papers/[id]) returns HTTP 402 for non-cbse_board
 *     papers when `ff_competitive_exams_v1` is OFF and the caller is not admin.
 *   - The catalog returns all matching papers regardless of flag — the frontend
 *     uses the `flag_enabled` field in the response to render JEE/NEET papers
 *     with a "locked" badge that routes to /upgrade.
 *
 * Query params (all optional):
 *   exam_family  — jee_main | jee_advanced | neet | olympiad_* | cbse_board
 *   subject      — physics | chemistry | math | biology (intersects subject_scope[])
 *   grade        — '11' | '12' (string per P5; passed through for FE context only —
 *                  exam_papers itself has no grade column)
 *   limit        — 1..50, default 20
 *
 * Response shape:
 *   {
 *     papers: ExamPaperSummary[],
 *     flag_enabled: boolean,
 *     total: number
 *   }
 *
 * Privacy (P13): no per-student data is logged. Counts only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

// ─── Constants ───────────────────────────────────────────────────────────

// Mirrors chk_exam_papers_family in 20260520000005_exam_papers_and_pyq_import.sql.
const VALID_EXAM_FAMILIES = new Set([
  'jee_main',
  'jee_advanced',
  'neet',
  'olympiad_phy',
  'olympiad_chem',
  'olympiad_math',
  'olympiad_bio',
  'olympiad_astro',
  'olympiad_info',
  'cbse_board',
  'kvpy',
  'nsep',
  'nsec',
  'nsejs',
  'nstse',
  'nso',
  'imo',
  'ntse',
]);

const VALID_SUBJECTS = new Set(['physics', 'chemistry', 'math', 'biology']);
const VALID_GRADES = new Set(['6', '7', '8', '9', '10', '11', '12']);

const FF_COMPETITIVE_EXAMS = 'ff_competitive_exams_v1';

// ─── Handler ─────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // 1. Auth (P9 RBAC boundary).
    const auth = await authorizeRequest(request, 'exam.view');
    if (!auth.authorized) return auth.errorResponse!;

    // 2. Parse query params.
    const url = new URL(request.url);
    const examFamilyParam = url.searchParams.get('exam_family');
    const subjectParam = url.searchParams.get('subject');
    const gradeParam = url.searchParams.get('grade');
    const limitParam = url.searchParams.get('limit');

    if (examFamilyParam !== null && !VALID_EXAM_FAMILIES.has(examFamilyParam)) {
      return NextResponse.json(
        { success: false, error: 'invalid_exam_family' },
        { status: 400 },
      );
    }
    if (subjectParam !== null && !VALID_SUBJECTS.has(subjectParam)) {
      return NextResponse.json(
        { success: false, error: 'invalid_subject' },
        { status: 400 },
      );
    }
    // P5: grades are strings. We don't filter on it here (exam_papers has no
    // grade column) but we still validate so the FE context value is sane.
    if (gradeParam !== null && !VALID_GRADES.has(gradeParam)) {
      return NextResponse.json(
        { success: false, error: 'invalid_grade' },
        { status: 400 },
      );
    }

    let limit = 20;
    if (limitParam !== null) {
      const parsed = parseInt(limitParam, 10);
      if (Number.isNaN(parsed)) {
        return NextResponse.json(
          { success: false, error: 'invalid_limit' },
          { status: 400 },
        );
      }
      limit = Math.min(50, Math.max(1, parsed));
    }

    // 3. Feature-flag gate (defense in depth — duplicates the plan-tier
    //    gate that the [id] route enforces row-by-row).
    const role = auth.roles[0];
    const flagEnabled = await isFeatureEnabled(FF_COMPETITIVE_EXAMS, {
      role,
      userId: auth.userId ?? undefined,
    });

    // 4. Build the query against exam_papers via the RLS-bypassing admin
    //    client. The catalog is non-sensitive metadata; RLS on exam_papers
    //    grants SELECT to all authenticated users anyway, but we use the
    //    admin client for consistent error handling under the auth check
    //    above (P9 is the security boundary, not RLS).
    let query = supabaseAdmin
      .from('exam_papers')
      .select(
        'id, paper_code, exam_family, exam_session, paper_pattern, exam_year, exam_month, shift, subject_scope, total_questions, total_marks, duration_minutes, marking_scheme, source_url, source_attribution',
      )
      .eq('is_active', true);

    if (examFamilyParam) {
      query = query.eq('exam_family', examFamilyParam);
    }
    // NOTE: previously we restricted to exam_family='cbse_board' when the flag was off.
    // That hid JEE/NEET/Olympiad papers entirely from free-tier students, which broke
    // the catalog's locked-card UX (frontend never received locked papers to render
    // with the upgrade CTA). The detail route still enforces HTTP 402 row-by-row, so
    // returning all papers in the catalog is safe; the runner is the security boundary.

    if (subjectParam) {
      // subject_scope is a text[] column. Postgrest's `contains` (`cs`)
      // operator matches when the array contains all listed elements.
      query = query.contains('subject_scope', [subjectParam]);
    }

    query = query
      .order('exam_year', { ascending: false })
      .order('paper_code', { ascending: true })
      .limit(limit);

    const { data, error } = await query;

    if (error) {
      logger.error('exams_papers_list_failed', {
        error: new Error(error.message),
        route: '/api/exams/papers',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load exam papers' },
        { status: 500 },
      );
    }

    const papers = data ?? [];

    // P13: log counts only, never paper codes or per-student state.
    logger.info('exams_papers_served', {
      route: '/api/exams/papers',
      total: papers.length,
      flagEnabled,
    });

    return NextResponse.json({
      papers,
      flag_enabled: flagEnabled,
      total: papers.length,
    });
  } catch (err) {
    logger.error('exams_papers_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/exams/papers',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
