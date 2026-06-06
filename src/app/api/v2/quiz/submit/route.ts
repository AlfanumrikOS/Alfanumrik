/**
 * POST /api/v2/quiz/submit — server-authoritative quiz grading (mobile + web).
 *
 * ASSESSMENT-APPROVED THIN PASS-THROUGH (P1-P6). This route MIRRORS the
 * existing /api/quiz/submit wrapper: it calls the SAME RPC (submit_quiz_results_v2)
 * with the SAME mapped args and returns the RPC's JSONB result VERBATIM.
 *
 * The RPC owns:
 *   - P1 score = ROUND((correct/total)*100)
 *   - P2 XP = (correct*10) + (>=80?+20) + (===100?+50), 200/day cap via
 *     atomic_quiz_profile_update
 *   - P3 all three anti-cheat checks
 *   - P4 atomicity
 *
 * The route does NO score / XP / anti-cheat math. It forwards inputs and
 * returns server-authoritative values — NEVER recomputed client-side.
 *
 * Arg mapping (rename only — IDENTICAL to /api/quiz/submit):
 *   responses[].selected_option        → selected_displayed_index
 *   responses[].time_taken_seconds     → time_spent
 *   totalTimeSeconds                   → p_time
 *   Idempotency-Key header             → p_idempotency_key
 *
 * Error translation (IDENTICAL to /api/quiz/submit):
 *   P0001 session_not_started          → 409
 *   unique-violation replay race       → cached row, idempotent_replay: true
 *   any other RPC failure              → 503 (retry with same Idempotency-Key)
 *
 * Auth boundary (P9): authorizeRequest('quiz.attempt') + JWT/body studentId
 * cross-check (403 on mismatch). Idempotency-Key (UUID) is REQUIRED (400).
 */
import { NextRequest } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';
import { validateBody } from '@/lib/validation';
import { v2Success, v2Error } from '@/lib/api/v2/envelope';
import { QuizSubmitRequest } from '@/lib/api/v2/contract';

// Shape returned by submit_quiz_results_v2 + cached idempotent rows.
// IDENTICAL to /api/quiz/submit's QuizV2Result.
interface QuizV2Result {
  total: number;
  correct: number;
  score_percent: number;
  xp_earned: number;
  session_id: string | null;
  flagged: boolean;
  idempotent_replay: boolean;
  questions?: unknown[];
  xp_capped?: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical /v2 response shape — server-authoritative, never recomputed. */
function shapeResult(r: QuizV2Result) {
  return {
    schemaVersion: 1 as const,
    session_id: r.session_id,
    score_percent: r.score_percent,
    xp_earned: r.xp_earned,
    correct: r.correct,
    total: r.total,
    flagged: !!r.flagged,
    idempotent_replay: !!r.idempotent_replay,
    marking_authenticity_path: 'oracle_v2' as const,
    ...(r.xp_capped !== undefined ? { xp_capped: !!r.xp_capped } : {}),
    questions: r.questions ?? [],
  };
}

export async function POST(request: NextRequest) {
  // 1. RBAC: must hold quiz.attempt (same as /api/quiz/submit).
  const auth = await authorizeRequest(request, 'quiz.attempt');
  if (!auth.authorized || !auth.userId) {
    return auth.errorResponse ?? v2Error('Unauthorized', 401, 'AUTH_REQUIRED');
  }

  // 2. Idempotency-Key header (REQUIRED, UUID — same as /api/quiz/submit).
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) {
    return v2Error(
      'Missing or invalid Idempotency-Key header (must be UUID)',
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
    );
  }

  // 3. Body validation.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return v2Error('Invalid JSON body', 400, 'VALIDATION_ERROR');
  }
  const validation = validateBody(QuizSubmitRequest, raw);
  if (!validation.success) return validation.error;
  const body = validation.data;

  // 4. Cross-check JWT's student_id matches body.studentId (defense-in-depth).
  const admin = getSupabaseAdmin();
  const { data: studentRow } = await admin
    .from('students')
    .select('id')
    .eq('auth_user_id', auth.userId)
    .maybeSingle();

  if (!studentRow?.id) {
    return v2Error('No student profile linked to this account', 403, 'NO_STUDENT_PROFILE');
  }
  if (studentRow.id !== body.studentId) {
    logger.warn('v2.quiz.submit: studentId mismatch', {
      jwtStudentId: studentRow.id,
      bodyStudentId: body.studentId,
      sessionId: body.sessionId,
    });
    return v2Error('Student ID mismatch', 403, 'STUDENT_ID_MISMATCH');
  }

  // 5. Map body.responses → RPC's expected jsonb shape (rename ONLY).
  //    IDENTICAL mapping to /api/quiz/submit.
  const rpcResponses = body.responses.map((r) => ({
    question_id: r.question_id,
    selected_displayed_index: r.selected_option,
    time_spent: r.time_taken_seconds,
  }));

  // JWT-bound client so the RPC's SECURITY DEFINER auth.uid() guard sees the
  // calling student (same as /api/quiz/submit).
  const supabaseUser = await createSupabaseServerClient();

  // 6. Call submit_quiz_results_v2 with the SAME args as /api/quiz/submit.
  let rpcData: QuizV2Result | null = null;
  let rpcErr: { message: string; code?: string } | null = null;
  try {
    const { data, error } = await supabaseUser.rpc('submit_quiz_results_v2', {
      p_session_id: body.sessionId,
      p_student_id: body.studentId,
      p_subject: body.subject ?? 'unknown',
      p_grade: body.grade ?? '0',
      p_topic: body.topic ?? null,
      p_chapter: body.chapter ?? null,
      p_responses: rpcResponses,
      p_time: body.totalTimeSeconds,
      p_idempotency_key: idempotencyKey,
    });
    rpcData = (data ?? null) as QuizV2Result | null;
    rpcErr = error
      ? { message: error.message, code: (error as { code?: string }).code }
      : null;
  } catch (e) {
    rpcErr = { message: e instanceof Error ? e.message : String(e) };
  }

  // 7. Translate RPC errors per contract (IDENTICAL to /api/quiz/submit).
  if (rpcErr) {
    const msg = rpcErr.message || '';

    // P0001 — session_not_started → 409.
    if (msg.startsWith('session_not_started') || rpcErr.code === 'P0001') {
      return v2Error('session_not_started', 409, 'SESSION_NOT_STARTED');
    }

    // Unique-violation replay race → return the cached row with idempotent_replay.
    const isUniqueViolation =
      rpcErr.code === '23505' ||
      msg.includes('quiz_sessions_idempotency_key_uniq') ||
      msg.includes('duplicate key value');

    if (isUniqueViolation) {
      const cached = await admin
        .from('quiz_sessions')
        .select('id, total_questions, correct_answers, score_percent, score')
        .eq('student_id', body.studentId)
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (cached.data) {
        const replay: QuizV2Result = {
          session_id: cached.data.id,
          total: cached.data.total_questions,
          correct: cached.data.correct_answers,
          score_percent: cached.data.score_percent,
          xp_earned: cached.data.score,
          flagged: false,
          idempotent_replay: true,
        };
        return v2Success(shapeResult(replay));
      }
      // else fall through to 503 — the cached row is on its way.
    }

    // Any other failure → 503 so the client retries with the same key.
    logger.error('v2.quiz.submit: RPC failed', {
      error: new Error(rpcErr.message),
      sessionId: body.sessionId,
      studentId: body.studentId,
    });
    void logOpsEvent({
      category: 'quiz',
      severity: 'error',
      source: 'api/v2/quiz/submit/route.ts',
      message: 'submit_quiz_results_v2_failed',
      context: {
        rpc_error: rpcErr.message,
        rpc_code: rpcErr.code ?? null,
        session_id: body.sessionId,
        student_id: body.studentId,
      },
    });
    return v2Error(
      'Temporary scoring failure — retry with same Idempotency-Key',
      503,
      'RPC_FAILED',
    );
  }

  if (!rpcData) {
    return v2Error('Empty response from scoring engine', 503, 'EMPTY_RESPONSE');
  }

  // 8. Return the RPC result VERBATIM (server-authoritative; never recomputed).
  return v2Success(shapeResult(rpcData));
}
