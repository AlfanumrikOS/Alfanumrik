/**
 * POST /api/exams/papers/[id]/start — start a dynamically-assembled
 * cbse_board mock-test attempt.
 *
 * Phase 2.2 remediation, item 6 of the "Alfanumrik Student Portal — Master
 * Action Plan" (assessment-authored spec). Only `cbse_board` papers use
 * this route: the 51 grade x subject template rows seeded by
 * 20260722096200 have NO pre-linked question_bank rows via exam_paper_id
 * (that is intentional catalog/metadata-only seeding, not a content gap).
 * Instead, this route calls `start_mock_test_attempt`, which pulls
 * directly from the GENERAL question_bank pool by subject + grade +
 * difficulty (same pool the legacy /mock-exam page already draws from),
 * assembles the 5-section / 39-question / 80-mark paper, snapshots the
 * selection into `mock_test_attempts.question_snapshot`, and returns
 * `{ attempt_id, questions }`.
 *
 * Permission: exam.view (same gate as the sibling [id] and submit routes).
 *
 * This route is intentionally cbse_board-ONLY:
 *   - JEE/NEET/Olympiad (and any other non-cbse_board family) papers keep
 *     their existing static exam_paper_id-linked flow entirely — they never
 *     call this route (frontend only calls it when the GET .../[id]
 *     response's paper.exam_family === 'cbse_board').
 *   - No ff_competitive_exams_v1 / plan-tier gate is applied here: cbse_board
 *     is free-tier in both sibling routes, and this route only ever serves
 *     cbse_board papers by construction (a non-cbse_board id is rejected
 *     with 400 before the RPC is even called).
 *
 * All-or-nothing content-insufficient contract: when the underlying
 * question_bank pool cannot fill every section via the assessment-defined
 * fallback ladder, the RPC returns a 200-shaped payload with a truthy
 * (non-persisted) `attempt_id` and an EMPTY `questions` array — matching
 * exactly the same shape the frontend's static-paper empty state already
 * renders via `<NotReadyCard />` (`packages/ui/src/exams/mock-test-
 * types.ts` `StartAttemptResponse`; consumer in
 * `apps/host/src/app/(student)/exams/mock/[paperId]/page.tsx`). No
 * `mock_test_attempts` row is written in that case (nothing to reconcile
 * — the runner never mounts past NotReadyCard).
 *
 * Response shapes:
 *   200 -> { attempt_id, questions: StartAttemptQuestion[] }
 *          (questions may be empty — content_insufficient case)
 *   400 -> { success: false, error: 'invalid_paper_id' | 'paper_not_cbse_board' }
 *   401 -> unauthenticated (from authorizeRequest)
 *   403 -> { success: false, error: 'student_profile_required' }
 *   404 -> { success: false, error: 'paper_not_found' }
 *   500 -> { success: false, error: 'start_failed' }
 *
 * P13 privacy: logs paper id + subject + grade + counts only. Never logs
 * student id, question text, or correct answers.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (s: string): boolean => UUID_RE.test(s);

const ROUTE = '/api/exams/papers/[id]/start';

interface StartRpcResult {
  attempt_id: string;
  questions: Array<{
    question_id: string;
    section: string;
    marks: number;
    order: number;
    text: string;
    text_hi?: string | null;
    options: string[];
  }>;
  content_insufficient?: boolean;
  deficient_sections?: Array<{ section: string; required: number; filled: number }>;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    // 1. Auth (P9 RBAC boundary) — same permission as the sibling routes.
    const auth = await authorizeRequest(request, 'exam.view');
    if (!auth.authorized) return auth.errorResponse!;

    // 2. Validate path param.
    const { id: paperId } = await context.params;
    if (!paperId || !isValidUuid(paperId)) {
      return NextResponse.json(
        { success: false, error: 'invalid_paper_id' },
        { status: 400 },
      );
    }

    // 3. Load the paper — must exist, be active, and be a single-subject
    //    cbse_board paper (dynamic assembly requires exactly one subject;
    //    see start_mock_test_attempt's own defensive check for the
    //    pre-existing multi-subject sample paper edge case).
    const { data: paper, error: paperError } = await supabaseAdmin
      .from('exam_papers')
      .select('id, exam_family, grade, subject_scope, is_active')
      .eq('id', paperId)
      .eq('is_active', true)
      .maybeSingle();

    if (paperError) {
      logger.error('exams_start_paper_lookup_failed', {
        error: new Error(paperError.message),
        route: ROUTE,
        paperId,
      });
      return NextResponse.json(
        { success: false, error: 'paper_lookup_failed' },
        { status: 500 },
      );
    }
    if (!paper) {
      return NextResponse.json(
        { success: false, error: 'paper_not_found' },
        { status: 404 },
      );
    }

    // This route exists exclusively for cbse_board dynamic assembly.
    // Non-cbse_board families keep their existing static flow untouched
    // (frontend never calls this route for them, but reject defensively
    // rather than let the RPC's exception surface as an opaque 500).
    if (paper.exam_family !== 'cbse_board') {
      return NextResponse.json(
        { success: false, error: 'paper_not_cbse_board' },
        { status: 400 },
      );
    }

    // 4. Resolve student.
    const studentId = auth.studentId;
    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'student_profile_required' },
        { status: 403 },
      );
    }

    // 5. Call the assembly RPC.
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'start_mock_test_attempt',
      { p_student_id: studentId, p_paper_id: paperId },
    );

    if (rpcError || !rpcData) {
      logger.error('exams_start_rpc_failed', {
        error: rpcError ? new Error(rpcError.message) : new Error('empty_rpc_response'),
        route: ROUTE,
        paperId,
      });
      const detail =
        process.env.NODE_ENV === 'production'
          ? undefined
          : rpcError?.message ?? 'empty_rpc_response';
      return NextResponse.json(
        { success: false, error: 'start_failed', detail },
        { status: 500 },
      );
    }

    const result = rpcData as unknown as StartRpcResult;

    // P13: subject/grade/counts only — never student id or question content.
    if (result.content_insufficient) {
      logger.warn('exams_start_content_insufficient', {
        route: ROUTE,
        paperId,
        subject: paper.subject_scope?.[0] ?? null,
        grade: paper.grade ?? null,
        deficient_sections: result.deficient_sections ?? [],
      });
    } else {
      logger.info('exams_start_attempt_created', {
        route: ROUTE,
        paperId,
        subject: paper.subject_scope?.[0] ?? null,
        grade: paper.grade ?? null,
        question_count: result.questions?.length ?? 0,
      });
    }

    return NextResponse.json({
      attempt_id: result.attempt_id,
      questions: result.questions ?? [],
    });
  } catch (err) {
    logger.error('exams_start_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: ROUTE,
    });
    return NextResponse.json(
      { success: false, error: 'internal_server_error' },
      { status: 500 },
    );
  }
}

// 405 for non-POST. App Router doesn't auto-405 when other handlers aren't
// exported — make the contract explicit (mirrors the sibling submit route).
const methodNotAllowed = () =>
  NextResponse.json(
    { success: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  );

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const PATCH = methodNotAllowed;
