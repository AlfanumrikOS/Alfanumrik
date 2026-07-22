/**
 * POST /api/exams/papers/[id]/submit — Submit a mock-test attempt; returns
 * the scored summary + per-question review payload.
 *
 * Permission: exam.view (same gate as the [id] detail route — caller is
 * still in the same exam flow). The detail route serves the slim student
 * view (no correct_answer_index, no explanation); this submit route is
 * where those secrets are revealed AFTER scoring is locked in.
 *
 * P4 atomicity: scoring goes through submit_mock_test_attempt — a single
 *   SECURITY DEFINER RPC writing attempt + responses + xp in one tx.
 * P11 defense-in-depth: ff_competitive_exams_v1 is re-checked at submit
 *   time because the detail-route response is cacheable for 5min — a
 *   plan downgrade between catalog-load and submit must be honored.
 * P13 privacy: logs paper_id + attempt_id + counts + score percent only.
 *   No response indices, no question text, no correct answers in logs.
 *
 * Idempotency: a `submitted`-state attempt for (student, paper) within
 *   the last 60s short-circuits and returns the cached result. Guards
 *   against double-click submits and Vercel function retries.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isValidUuid = (s: string): boolean => UUID_RE.test(s);

const FF_COMPETITIVE_EXAMS = 'ff_competitive_exams_v1';
const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const MAX_RESPONSES = 500;
const IDEMPOTENCY_WINDOW_MS = 60_000;
const ROUTE = '/api/exams/papers/[id]/submit';

// ─── Types ───────────────────────────────────────────────────────────────

interface SubmitResponseInput {
  question_id: string;
  response_index: number | null;
  time_taken_seconds?: number;
  marked_for_review?: boolean;
}

interface SubmitBody {
  responses: SubmitResponseInput[];
  time_taken_seconds: number;
  client_metadata?: Record<string, unknown>;
  /**
   * Present only for the cbse_board dynamic-attempt flow (paper started via
   * POST /api/exams/papers/[id]/start). When set, the RPC scores against
   * the attempt's own question_snapshot instead of the legacy exam_paper_id
   * join. Static JEE/NEET/Olympiad papers — and the legacy cbse_board
   * submit path — omit this entirely; behavior for them is unchanged.
   */
  attempt_id?: string;
}

interface RpcResult {
  attempt_id: string;
  paper_id: string;
  total_questions: number;
  attempted_count: number;
  correct_count: number;
  wrong_count: number;
  skipped_count: number;
  raw_score: number;
  max_score: number;
  score_percent: number;
  xp_earned: number;
  submitted_at: string;
  time_taken_seconds: number;
}

interface QuestionRow {
  id: string;
  question_text: string;
  options: string[] | null;
  correct_answer_index: number | null;
  explanation: string | null;
  hint: string | null;
  chapter_title: string | null;
  paper_pattern: string | null;
  marks_correct: number | null;
  marks_wrong: number | null;
}

interface ReviewEntry {
  question_id: string;
  question_text: string;
  options: string[];
  response_index: number | null;
  correct_answer_index: number | null;
  is_correct: boolean;
  marks_awarded: number;
  explanation: string | null;
  chapter_title: string | null;
}

// ─── Body validation ─────────────────────────────────────────────────────

function isResponseEntry(v: unknown): v is SubmitResponseInput {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.question_id !== 'string' || !isValidUuid(o.question_id)) return false;
  if (o.response_index !== null) {
    if (typeof o.response_index !== 'number' || !Number.isInteger(o.response_index)) return false;
    if (o.response_index < 0 || o.response_index > 3) return false;
  }
  if (o.time_taken_seconds !== undefined) {
    if (typeof o.time_taken_seconds !== 'number') return false;
    if (!Number.isInteger(o.time_taken_seconds) || o.time_taken_seconds < 0) return false;
  }
  if (o.marked_for_review !== undefined && typeof o.marked_for_review !== 'boolean') return false;
  return true;
}

function parseBody(raw: unknown): SubmitBody | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'invalid_body' };
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.responses) || o.responses.length === 0) return { error: 'invalid_responses' };
  if (o.responses.length > MAX_RESPONSES) return { error: 'invalid_responses' };
  for (const r of o.responses) if (!isResponseEntry(r)) return { error: 'invalid_responses' };

  if (
    typeof o.time_taken_seconds !== 'number' ||
    !Number.isInteger(o.time_taken_seconds) ||
    o.time_taken_seconds <= 0
  ) {
    return { error: 'invalid_time_taken_seconds' };
  }

  if (o.client_metadata !== undefined) {
    if (
      o.client_metadata === null ||
      typeof o.client_metadata !== 'object' ||
      Array.isArray(o.client_metadata)
    ) {
      return { error: 'invalid_client_metadata' };
    }
  }

  if (o.attempt_id !== undefined) {
    if (typeof o.attempt_id !== 'string' || !isValidUuid(o.attempt_id)) {
      return { error: 'invalid_attempt_id' };
    }
  }

  return {
    responses: o.responses as SubmitResponseInput[],
    time_taken_seconds: o.time_taken_seconds,
    client_metadata: (o.client_metadata as Record<string, unknown> | undefined) ?? undefined,
    attempt_id: (o.attempt_id as string | undefined) ?? undefined,
  };
}

// ─── Handler ─────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await authorizeRequest(request, 'exam.view');
    if (!auth.authorized) return auth.errorResponse!;

    const { id: paperId } = await context.params;
    if (!paperId || !isValidUuid(paperId)) {
      return NextResponse.json({ success: false, error: 'invalid_paper_id' }, { status: 400 });
    }

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 });
    }
    const parsed = parseBody(raw);
    if ('error' in parsed) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }
    const body = parsed;

    // Paper lookup — must know exam_family before the flag gate.
    const { data: paper, error: paperError } = await supabaseAdmin
      .from('exam_papers')
      .select('id, exam_family, is_active')
      .eq('id', paperId)
      .eq('is_active', true)
      .maybeSingle();

    if (paperError) {
      logger.error('exams_submit_paper_lookup_failed', {
        error: new Error(paperError.message),
        route: ROUTE,
        paperId,
      });
      return NextResponse.json({ success: false, error: 'paper_lookup_failed' }, { status: 500 });
    }
    if (!paper) {
      return NextResponse.json({ success: false, error: 'paper_not_found' }, { status: 404 });
    }

    // P11 defense-in-depth flag gate — mirror of [id] route.
    const isAdmin = auth.roles.some((r) => ADMIN_ROLES.has(r));
    const isCbseBoard = paper.exam_family === 'cbse_board';
    if (!isCbseBoard && !isAdmin) {
      const flagEnabled = await isFeatureEnabled(FF_COMPETITIVE_EXAMS, {
        role: auth.roles[0],
        userId: auth.userId ?? undefined,
      });
      if (!flagEnabled) {
        logger.info('exams_submit_competition_gate_blocked', {
          route: ROUTE,
          exam_family: paper.exam_family,
        });
        return NextResponse.json(
          { success: false, error: 'competition_plan_required', upgrade_url: '/upgrade' },
          { status: 402 },
        );
      }
    }

    const studentId = auth.studentId;
    if (!studentId) {
      return NextResponse.json(
        { success: false, error: 'student_profile_required' },
        { status: 403 },
      );
    }

    // Idempotency replay guard.
    //
    // NOTE (found during Phase 2.2 remediation): this query previously
    // selected/filtered on a column literally named `paper_id`, which does
    // not exist on mock_test_attempts (the real FK column is
    // `exam_paper_id` — see 20260520000008_mock_test_attempts.sql). A
    // PostgREST select against a nonexistent column returns an error, so
    // `recent` was always null and this replay guard has never actually
    // short-circuited a double-submit against the real database — it only
    // appeared to work because the unit-test mock's in-memory fixtures
    // used the same (wrong) property name, masking the bug. Fixed here to
    // query the real column; existing behavior for every exam family is
    // otherwise unchanged (same window, same ordering, same fallback to a
    // fresh RPC call on a cache miss).
    const replayCutoff = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS).toISOString();
    const { data: recent } = await supabaseAdmin
      .from('mock_test_attempts')
      .select(
        'id, exam_paper_id, total_questions, attempted_count, correct_count, wrong_count, skipped_count, raw_score, max_score, score_percent, xp_earned, submitted_at, time_taken_seconds',
      )
      .eq('student_id', studentId)
      .eq('exam_paper_id', paperId)
      .eq('status', 'submitted')
      .gte('submitted_at', replayCutoff)
      .order('submitted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent) {
      const r = recent as Record<string, unknown>;
      const replayResult: RpcResult = {
        attempt_id: r.id as string,
        paper_id: r.exam_paper_id as string,
        total_questions: r.total_questions as number,
        attempted_count: r.attempted_count as number,
        correct_count: r.correct_count as number,
        wrong_count: r.wrong_count as number,
        skipped_count: r.skipped_count as number,
        raw_score: r.raw_score as number,
        max_score: r.max_score as number,
        score_percent: r.score_percent as number,
        xp_earned: r.xp_earned as number,
        submitted_at: r.submitted_at as string,
        time_taken_seconds: r.time_taken_seconds as number,
      };
      // For the dynamic cbse_board flow, the review must be built from the
      // REPLAYED attempt's own snapshot (r.id), not from body.attempt_id —
      // they are expected to match, but the replayed row is the source of
      // truth for what was actually scored.
      const review = await buildReview(paperId, body.responses, r.id as string);
      logger.info('exams_submit_idempotent_replay', {
        route: ROUTE,
        paper_id: paperId,
        attempt_id: replayResult.attempt_id,
        score_percent: replayResult.score_percent,
      });
      return NextResponse.json(buildResponse(replayResult, review));
    }

    // P4 atomic submit — single RPC, single transaction.
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      'submit_mock_test_attempt',
      {
        p_student_id: studentId,
        p_paper_id: paperId,
        p_responses: body.responses,
        p_time_taken_seconds: body.time_taken_seconds,
        p_client_metadata: body.client_metadata ?? null,
        p_attempt_id: body.attempt_id ?? null,
      },
    );

    if (rpcError || !rpcData) {
      logger.error('exams_submit_rpc_failed', {
        error: rpcError ? new Error(rpcError.message) : new Error('empty_rpc_response'),
        route: ROUTE,
        paperId,
      });
      const detail =
        process.env.NODE_ENV === 'production'
          ? undefined
          : rpcError?.message ?? 'empty_rpc_response';
      return NextResponse.json(
        { success: false, error: 'submission_failed', detail },
        { status: 500 },
      );
    }

    const result = rpcData as unknown as RpcResult;
    const review = await buildReview(paperId, body.responses, body.attempt_id);

    logger.info('mock_test_submitted', {
      route: ROUTE,
      paper_id: paperId,
      attempt_id: result.attempt_id,
      score_percent: result.score_percent,
      time_taken_seconds: result.time_taken_seconds,
    });

    return NextResponse.json(buildResponse(result, review));
  } catch (err) {
    logger.error('exams_submit_unexpected_error', {
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
// exported — make the contract explicit.
const methodNotAllowed = () =>
  NextResponse.json(
    { success: false, error: 'method_not_allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  );

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const PATCH = methodNotAllowed;

// ─── Helpers ─────────────────────────────────────────────────────────────

function buildResponse(result: RpcResult, review: ReviewEntry[]) {
  return {
    attempt_id: result.attempt_id,
    paper_id: result.paper_id,
    summary: {
      total_questions: result.total_questions,
      attempted_count: result.attempted_count,
      correct_count: result.correct_count,
      wrong_count: result.wrong_count,
      skipped_count: result.skipped_count,
      raw_score: result.raw_score,
      max_score: result.max_score,
      score_percent: result.score_percent,
      xp_earned: result.xp_earned,
      time_taken_seconds: result.time_taken_seconds,
      submitted_at: result.submitted_at,
    },
    review,
  };
}

interface SnapshotEntry {
  question_id: string;
  section: string;
  marks: number;
  order: number;
}

/**
 * Builds the post-submit review payload.
 *
 * Static JEE/NEET/Olympiad papers (and the legacy cbse_board submit path,
 * i.e. attemptId undefined): resolves questions via the exam_paper_id join,
 * exactly as before.
 *
 * cbse_board dynamic attempts (attemptId present): the questions are pulled
 * from the general question_bank pool and are NEVER linked via
 * exam_paper_id — that join would silently return zero rows. Instead, the
 * question set + per-question marks come from the attempt's own
 * `question_snapshot` (marks_correct = snapshot's `marks`, never
 * question_bank.marks_correct — see submit_mock_test_attempt's snapshot-
 * scoring branch), and only question_text/options/correct_answer_index/
 * explanation/chapter_title are freshly resolved from question_bank by id.
 * No negative marking for this flow (marks_wrong is always 0).
 */
async function buildReview(
  paperId: string,
  responses: SubmitResponseInput[],
  attemptId?: string,
): Promise<ReviewEntry[]> {
  if (attemptId) {
    return buildSnapshotReview(responses, attemptId);
  }
  return buildStaticReview(paperId, responses);
}

async function buildSnapshotReview(
  responses: SubmitResponseInput[],
  attemptId: string,
): Promise<ReviewEntry[]> {
  const { data: attemptRow, error: attemptError } = await supabaseAdmin
    .from('mock_test_attempts')
    .select('question_snapshot')
    .eq('id', attemptId)
    .maybeSingle();

  if (attemptError || !attemptRow) {
    logger.error('exams_submit_snapshot_review_lookup_failed', {
      error: attemptError ? new Error(attemptError.message) : new Error('attempt_not_found'),
      route: ROUTE,
      attemptId,
    });
    return [];
  }

  const snapshot = (
    (attemptRow as Record<string, unknown>).question_snapshot as SnapshotEntry[] | null
  ) ?? [];
  const marksBySnapshotId = new Map<string, number>();
  const snapshotIds: string[] = [];
  for (const s of snapshot) {
    marksBySnapshotId.set(s.question_id, s.marks);
    snapshotIds.push(s.question_id);
  }

  if (snapshotIds.length === 0) return [];

  const { data: rows, error } = await supabaseAdmin
    .from('question_bank')
    .select('id, question_text, options, correct_answer_index, explanation, hint, chapter_title, paper_pattern')
    .in('id', snapshotIds)
    .eq('is_active', true);

  if (error) {
    logger.error('exams_submit_snapshot_review_questions_failed', {
      error: new Error(error.message),
      route: ROUTE,
      attemptId,
    });
    return [];
  }

  const byId = new Map<string, QuestionRow>();
  for (const r of (rows ?? []) as unknown as QuestionRow[]) byId.set(r.id, r);

  return responses.map((r) => {
    const q = byId.get(r.question_id);
    const correctIdx = q?.correct_answer_index ?? null;
    const isCorrect =
      r.response_index !== null && correctIdx !== null && r.response_index === correctIdx;
    const marksCorrect = marksBySnapshotId.get(r.question_id) ?? 0;
    // No negative marking for cbse_board dynamic attempts — marks_wrong is
    // always 0 (mirrors submit_mock_test_attempt's snapshot-scoring branch).
    const marksAwarded = r.response_index === null ? 0 : isCorrect ? marksCorrect : 0;
    return {
      question_id: r.question_id,
      question_text: q?.question_text ?? '',
      options: Array.isArray(q?.options) ? q!.options! : [],
      response_index: r.response_index,
      correct_answer_index: correctIdx,
      is_correct: isCorrect,
      marks_awarded: marksAwarded,
      explanation: q?.explanation ?? null,
      chapter_title: q?.chapter_title ?? null,
    };
  });
}

async function buildStaticReview(
  paperId: string,
  responses: SubmitResponseInput[],
): Promise<ReviewEntry[]> {
  const { data: rows, error } = await supabaseAdmin
    .from('question_bank')
    .select(
      'id, question_text, options, correct_answer_index, explanation, hint, chapter_title, paper_pattern, marks_correct, marks_wrong',
    )
    .eq('exam_paper_id', paperId)
    .eq('is_active', true);

  if (error) {
    logger.error('exams_submit_review_lookup_failed', {
      error: new Error(error.message),
      route: ROUTE,
      paperId,
    });
    return [];
  }

  const byId = new Map<string, QuestionRow>();
  for (const r of (rows ?? []) as unknown as QuestionRow[]) byId.set(r.id, r);

  return responses.map((r) => {
    const q = byId.get(r.question_id);
    const correctIdx = q?.correct_answer_index ?? null;
    const isCorrect =
      r.response_index !== null && correctIdx !== null && r.response_index === correctIdx;
    const marksCorrect = q?.marks_correct ?? 0;
    const marksWrong = q?.marks_wrong ?? 0;
    const marksAwarded =
      r.response_index === null ? 0 : isCorrect ? marksCorrect : marksWrong;
    return {
      question_id: r.question_id,
      question_text: q?.question_text ?? '',
      options: Array.isArray(q?.options) ? q!.options! : [],
      response_index: r.response_index,
      correct_answer_index: correctIdx,
      is_correct: isCorrect,
      marks_awarded: marksAwarded,
      explanation: q?.explanation ?? null,
      chapter_title: q?.chapter_title ?? null,
    };
  });
}
