/**
 * GET /api/exams/papers/[id] — Full paper + questions for the mock-test runner.
 *
 * Permission: exam.view (matches PERMISSIONS.EXAM_VIEW in rbac.ts).
 *
 * Feature-flag + plan gate (P9 RBAC + P11 plan integrity):
 *   - If the paper's exam_family is `cbse_board` → free tier, anyone may load.
 *   - Otherwise the caller must either:
 *       (a) have an admin / super_admin role (review path), OR
 *       (b) have `ff_competitive_exams_v1` enabled (Competition SKU).
 *     When neither holds, return HTTP 402 + `{error:'competition_plan_required',
 *     upgrade_url:'/upgrade'}`. The frontend renders the upsell modal.
 *
 * Student vs admin viewer:
 *   - Students get a slim question payload that hides `correct_answer_index`
 *     and `explanation` (revealed by the submit endpoint after scoring).
 *   - Admin / super_admin get the full row for review purposes.
 *
 * Response shape:
 *   {
 *     paper: { ...exam_papers row... },
 *     questions: QuestionForRunner[],
 *     served_count: number,
 *     viewer_role: 'student' | 'admin'
 *   }
 *
 * Cache: `private, max-age=300`. Paper metadata is stable for a logged-in
 * user during the session; private prevents shared cache servers from
 * leaking one student's view to another.
 *
 * Privacy (P13): logs the paper id + counts only. No student state, no
 * question text echoed into logs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';

// ─── UUID validation ─────────────────────────────────────────────────────

// RFC 4122 v4 pattern is the de-facto Postgres UUID format. We accept any
// version (v1..v5) so the route doesn't reject IDs minted by gen_random_uuid()
// or alternative tooling. The DB column is `uuid`, so the canonical check is
// shape-based, not version-based.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(s: string): boolean {
  return UUID_RE.test(s);
}

// ─── Constants ───────────────────────────────────────────────────────────

const FF_COMPETITIVE_EXAMS = 'ff_competitive_exams_v1';
const ADMIN_ROLES = new Set(['admin', 'super_admin']);

interface QuestionRow {
  id: string;
  question_text: string;
  options: string[] | null;
  correct_answer_index: number | null;
  explanation: string | null;
  hint: string | null;
  difficulty: string | null;
  bloom_level: string | null;
  marks_correct: number | null;
  marks_wrong: number | null;
  question_number: string | null;
  paper_pattern: string | null;
  chapter_title: string | null;
  chapter_number: number | null;
  subject: string | null;
}

// ─── Handler ─────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // 1. Auth (P9 RBAC boundary).
    const auth = await authorizeRequest(request, 'exam.view');
    if (!auth.authorized) return auth.errorResponse!;

    // 2. Validate path param.
    const { id } = await context.params;
    if (!id || !isValidUuid(id)) {
      return NextResponse.json(
        { success: false, error: 'invalid_paper_id' },
        { status: 400 },
      );
    }

    // 3. Load the paper. We need exam_family BEFORE we run the plan-tier
    //    gate, so the paper fetch comes first; the gate then accepts or
    //    rejects based on the loaded row. A 404 still emits even when the
    //    gate would have blocked, which is intentional — the gate response
    //    must not leak whether a non-cbse paper exists for non-Competition
    //    callers (it would, but only via 402 vs 404, which we're fine with
    //    given the paper code is also returned in the public list route).
    const { data: paper, error: paperError } = await supabaseAdmin
      .from('exam_papers')
      .select('*')
      .eq('id', id)
      .eq('is_active', true)
      .maybeSingle();

    if (paperError) {
      logger.error('exams_paper_lookup_failed', {
        error: new Error(paperError.message),
        route: '/api/exams/papers/[id]',
        paperId: id,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load paper' },
        { status: 500 },
      );
    }
    if (!paper) {
      return NextResponse.json(
        { success: false, error: 'paper_not_found' },
        { status: 404 },
      );
    }

    // 4. Plan-tier / feature-flag gate (P11 — never grant non-free access
    //    without verified payment / flag).
    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.has(r));
    const isCbseBoard = paper.exam_family === 'cbse_board';

    let flagEnabled = false;
    if (!isCbseBoard && !isAdmin) {
      flagEnabled = await isFeatureEnabled(FF_COMPETITIVE_EXAMS, {
        role: auth.roles[0],
        userId: auth.userId ?? undefined,
      });
      if (!flagEnabled) {
        // P13: do NOT log paper.paper_code or any user identifier.
        logger.info('exams_paper_competition_gate_blocked', {
          route: '/api/exams/papers/[id]',
          exam_family: paper.exam_family,
        });
        return NextResponse.json(
          {
            success: false,
            error: 'competition_plan_required',
            upgrade_url: '/upgrade',
          },
          { status: 402 },
        );
      }
    }

    // 5. Load the question set. Admin reviewers see the full row; students
    //    see a slim payload (no correct_answer_index, no explanation).
    const studentColumns = [
      'id',
      'question_text',
      'options',
      'hint',
      'marks_correct',
      'marks_wrong',
      'question_number',
      'paper_pattern',
      'chapter_title',
      'chapter_number',
      'subject',
    ].join(', ');
    const adminColumns = [
      ...studentColumns.split(', '),
      'correct_answer_index',
      'explanation',
      'difficulty',
      'bloom_level',
    ].join(', ');

    const selectCols = isAdmin ? adminColumns : studentColumns;

    const { data: questions, error: qErr } = await supabaseAdmin
      .from('question_bank')
      .select(selectCols)
      .eq('exam_paper_id', id)
      .eq('is_active', true)
      .eq('is_verified', true)
      .order('question_number', { ascending: true });

    if (qErr) {
      logger.error('exams_paper_questions_failed', {
        error: new Error(qErr.message),
        route: '/api/exams/papers/[id]',
        paperId: id,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to load questions' },
        { status: 500 },
      );
    }

    const rows = (questions ?? []) as unknown as Partial<QuestionRow>[];
    const viewerRole: 'student' | 'admin' = isAdmin ? 'admin' : 'student';

    // Defensive scrub: if PostgREST ever leaked an extra column under a
    // future column-rename, we strip the secret fields again at the app
    // layer for non-admin viewers. Cost: one shallow object spread.
    const servedQuestions = isAdmin
      ? rows
      : rows.map((q) => {
          const safe: Record<string, unknown> = { ...q };
          delete safe.correct_answer_index;
          delete safe.explanation;
          delete safe.difficulty;
          delete safe.bloom_level;
          return safe;
        });

    // P13: log counts and the (non-PII) paper.id only. Never log
    // student id, question text, or correct answers.
    logger.info('exams_paper_served', {
      route: '/api/exams/papers/[id]',
      paperId: id,
      served_count: servedQuestions.length,
      viewer_role: viewerRole,
    });

    return NextResponse.json(
      {
        paper,
        questions: servedQuestions,
        served_count: servedQuestions.length,
        viewer_role: viewerRole,
      },
      {
        headers: {
          // Per-user catalog: must not be shared by intermediary caches.
          'Cache-Control': 'private, max-age=300',
        },
      },
    );
  } catch (err) {
    logger.error('exams_paper_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/exams/papers/[id]',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
