/**
 * Server-side authoritative quiz submission route (Phase 2.6 of marking-authenticity remediation).
 *
 * Replaces the client-side direct `submit_quiz_results_v2` RPC call. Once
 * `ff_server_only_quiz_submit` flips ON in production this route is the only
 * legal path to grade a quiz. While the flag is OFF the route still executes
 * (transparent passthrough) so we can shake out integration bugs in production
 * before cutting over.
 *
 * Contract
 *   POST /api/quiz/submit
 *   Headers:
 *     Authorization: Bearer <jwt>            (or session cookie)
 *     Idempotency-Key: <UUID>                (REQUIRED — 400 otherwise)
 *   Body: see `submitBodySchema` below.
 *
 * Response
 *   200 → { success: true, data: { session_id, score_percent, xp_earned, correct,
 *           total, flagged, idempotent_replay, marking_authenticity_path } }
 *   400 → missing/invalid Idempotency-Key, validation error
 *   401 → unauthenticated
 *   403 → quiz.attempt missing OR studentId in body != JWT's student_id
 *   409 → P0001 session_not_started → client should restart the quiz
 *   503 → transient RPC failure → client should retry with same Idempotency-Key
 *
 * Idempotency model
 *   - Idempotency-Key is persisted in `quiz_sessions.idempotency_key` (per-student
 *     unique partial index). The RPC short-circuits on replay and returns the
 *     cached score.
 *   - On a unique-violation race (two concurrent retries arriving simultaneously),
 *     this route catches the unique-violation, SELECTs the existing row, and
 *     returns it with `idempotent_replay: true`.
 *   - PostHog `quiz_graded`/`xp_awarded` events are NOT emitted on idempotent
 *     replay (prevents double-counting in funnels).
 *
 * Auth boundary (P9)
 *   - `authorizeRequest(request, 'quiz.attempt')` proves the caller has the
 *     permission (already seeded by 20260324070000_production_rbac_system.sql).
 *   - Body's studentId is cross-checked against the JWT's resolved student_id —
 *     a defense-in-depth guard against "student A submits as student B" even
 *     though RLS on quiz_session_shuffles would catch the same attack.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeRequest } from '@/lib/rbac';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';
import { capture as posthogCapture } from '@/lib/posthog/server';
import { validateBody } from '@/lib/validation';
import { maybeDispatchQuizCompletion } from '@/lib/state/quiz-orchestrator-bridge';

// ─── Body schema ────────────────────────────────────────────────────────────

const responseSchema = z.object({
  question_id: z.string().uuid(),
  selected_option: z.number().int().min(0).max(3),
  time_taken_seconds: z.number().int().min(0).max(3600),
});

const submitBodySchema = z.object({
  sessionId: z.string().uuid(),
  studentId: z.string().uuid(),
  responses: z.array(responseSchema).min(1).max(50),
  totalTimeSeconds: z.number().int().min(0).max(7200),
  // Optional context — preserved for adaptive layer; omit safely.
  subject: z.string().optional(),
  grade: z.string().optional(),
  topic: z.string().nullable().optional(),
  chapter: z.number().int().nullable().optional(),
  difficulty: z.number().int().nullable().optional(),
  mode: z.string().optional(),
});

// Shape returned by submit_quiz_results_v2 + cached idempotent rows.
interface QuizV2Result {
  total: number;
  correct: number;
  score_percent: number;
  xp_earned: number;
  session_id: string | null;
  flagged: boolean;
  idempotent_replay: boolean;
  questions?: unknown[];
  cme_next_action?: string | null;
  cme_next_concept_id?: string | null;
  cme_reason?: string | null;
  // atomic_quiz_profile_update side-effect fields surfaced for cap UI.
  xp_capped?: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  // ── 1. RBAC: must hold quiz.attempt ────────────────────────────────────
  const auth = await authorizeRequest(request, 'quiz.attempt');
  if (!auth.authorized || !auth.userId) {
    return auth.errorResponse ??
      NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // ── 2. Idempotency-Key header (REQUIRED) ───────────────────────────────
  const idempotencyKey = request.headers.get('idempotency-key');
  if (!idempotencyKey || !UUID_REGEX.test(idempotencyKey)) {
    return NextResponse.json(
      {
        success: false,
        error: 'Missing or invalid Idempotency-Key header (must be UUID)',
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      },
      { status: 400 },
    );
  }

  // ── 3. Body validation ────────────────────────────────────────────────
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body' },
      { status: 400 },
    );
  }
  const validation = validateBody(submitBodySchema, raw);
  if (!validation.success) {
    // validateBody returns a Response with the right shape — wrap it.
    return validation.error;
  }
  const body = validation.data;

  // ── 4. Cross-check JWT's student_id matches body.studentId ────────────
  // Defense-in-depth: RLS on quiz_session_shuffles would also reject this.
  const admin = getSupabaseAdmin();
  const { data: studentRow } = await admin
    .from('students')
    .select('id')
    .eq('auth_user_id', auth.userId)
    .maybeSingle();

  if (!studentRow?.id) {
    return NextResponse.json(
      { success: false, error: 'No student profile linked to this account', code: 'NO_STUDENT_PROFILE' },
      { status: 403 },
    );
  }
  if (studentRow.id !== body.studentId) {
    logger.warn('quiz.submit: studentId mismatch', {
      jwtStudentId: studentRow.id,
      bodyStudentId: body.studentId,
      sessionId: body.sessionId,
    });
    return NextResponse.json(
      { success: false, error: 'Student ID mismatch', code: 'STUDENT_ID_MISMATCH' },
      { status: 403 },
    );
  }

  // ── 5. Read transition flag — passthrough vs server-only ──────────────
  // While OFF: route still executes; client may also call the RPC directly.
  // While ON:  this route is the only legal path. Logged either way.
  const serverOnly = await isFeatureEnabled('ff_server_only_quiz_submit', { userId: auth.userId });
  if (!serverOnly) {
    // Fire-and-forget — the route is operating as a passthrough during cutover.
    // Use posthog capture since this is a transition signal we want in funnels.
    void posthogCapture(
      'quiz_server_submit_passthrough',
      body.studentId,
      {
        session_id: body.sessionId,
        flag_state: 'off',
      },
      `quiz_server_submit_passthrough:${body.sessionId}:${idempotencyKey}`,
    ).catch(() => { /* never throw from telemetry */ });
  }

  // ── 6. Map body.responses → RPC's expected jsonb shape ────────────────
  // The v2 RPC expects { question_id, selected_displayed_index, time_spent }.
  // We translate our normalized public contract to the RPC's internal naming.
  const rpcResponses = body.responses.map((r) => ({
    question_id: r.question_id,
    selected_displayed_index: r.selected_option,
    time_spent: r.time_taken_seconds,
  }));

  // Use a JWT-bound supabase client so SECURITY DEFINER's auth.uid() check
  // sees the calling student. This is required for the RPC's ownership guard.
  const supabaseUser = await createSupabaseServerClient();

  // ── 7. Call submit_quiz_results_v2 with idempotency key ───────────────
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

  // ── 8. Translate RPC errors per contract ──────────────────────────────
  if (rpcErr) {
    const msg = rpcErr.message || '';
    // P0001 — session_not_started branch raised inside the RPC.
    if (msg.startsWith('session_not_started') || rpcErr.code === 'P0001') {
      return NextResponse.json(
        {
          success: false,
          error: 'session_not_started',
          hint: 'restart_quiz',
          code: 'SESSION_NOT_STARTED',
        },
        { status: 409 },
      );
    }

    // Unique-violation on quiz_sessions_idempotency_key_uniq → race condition
    // where two concurrent retries beat each other to the INSERT. The RPC's
    // own short-circuit handles repeated retries that arrive after the first
    // has committed; this branch handles the race when both arrive in-flight.
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
        const replayResp: QuizV2Result = {
          session_id: cached.data.id,
          total: cached.data.total_questions,
          correct: cached.data.correct_answers,
          score_percent: cached.data.score_percent,
          xp_earned: cached.data.score,
          flagged: false,
          idempotent_replay: true,
        };
        return NextResponse.json({
          success: true,
          data: shapeResponse(replayResp),
        });
      }
      // Otherwise fall through to 503 — the cached row is on its way.
    }

    // Any other RPC failure → 503 so the client retries with the same key.
    logger.error('quiz.submit: RPC failed', {
      error: new Error(rpcErr.message),
      sessionId: body.sessionId,
      studentId: body.studentId,
    });
    void logOpsEvent({
      category: 'quiz',
      severity: 'error',
      source: 'api/quiz/submit/route.ts',
      message: 'submit_quiz_results_v2_failed',
      context: {
        rpc_error: rpcErr.message,
        rpc_code: rpcErr.code ?? null,
        session_id: body.sessionId,
        student_id: body.studentId,
      },
    });
    return NextResponse.json(
      {
        success: false,
        error: 'Temporary scoring failure — retry with same Idempotency-Key',
        code: 'RPC_FAILED',
      },
      { status: 503 },
    );
  }

  if (!rpcData) {
    return NextResponse.json(
      { success: false, error: 'Empty response from scoring engine', code: 'EMPTY_RESPONSE' },
      { status: 503 },
    );
  }

  // ── 9. PostHog events (server-side) ───────────────────────────────────
  // Only emit when this is a fresh grading event. Replays must not double-count.
  if (!rpcData.idempotent_replay) {
    // quiz_graded — primary funnel event.
    void posthogCapture(
      'quiz_graded',
      body.studentId,
      {
        session_id: rpcData.session_id ?? body.sessionId,
        score_percent: rpcData.score_percent,
        xp_earned: rpcData.xp_earned,
        correct: rpcData.correct,
        total: rpcData.total,
        marking_authenticity_path: 'oracle_v2',
        anti_cheat_flagged: !!rpcData.flagged,
        idempotent_replay: false,
      },
      // $insert_id keyed by session — second emission for same session is dropped.
      `quiz_graded:${rpcData.session_id ?? body.sessionId}`,
    ).catch(() => { /* swallow */ });

    // xp_awarded — even when flagged (xp_earned will be 0). Useful for funnel parity.
    void posthogCapture(
      'xp_awarded',
      body.studentId,
      {
        xp_delta: rpcData.xp_earned,
        source: 'quiz',
        // daily_total_after is approximate without re-reading; use xp_earned as
        // a lower bound. The dashboard can sum across rows to get the true total.
        daily_total_after: rpcData.xp_earned,
        capped: !!rpcData.xp_capped,
      },
      `xp_awarded:quiz:${rpcData.session_id ?? body.sessionId}`,
    ).catch(() => { /* swallow */ });

    if (rpcData.flagged) {
      void posthogCapture(
        'quiz_anti_cheat_flagged',
        body.studentId,
        {
          session_id: rpcData.session_id ?? body.sessionId,
          // The RPC doesn't surface a granular reason — derive from data.
          reason: deriveAntiCheatReason(rpcData, body.totalTimeSeconds, body.responses.length),
        },
        `anti_cheat:${rpcData.session_id ?? body.sessionId}`,
      ).catch(() => { /* swallow */ });
    }

    if (rpcData.xp_capped) {
      void posthogCapture(
        'daily_xp_cap_hit',
        body.studentId,
        {
          source: 'quiz',
          cap: 200, // matches XP_RULES.quiz_daily_cap; surfaced for dashboard parity
          attempted_xp: rpcData.xp_earned,
        },
        `daily_xp_cap_hit:quiz:${new Date().toISOString().slice(0, 10)}:${body.studentId}`,
      ).catch(() => { /* swallow */ });
    }
  }

  // ── 10. Orchestrator bridge — additive, flag-gated, never throws ──────
  // While ff_orchestrator_v1 is OFF (the steady state during Phase 2's
  // first weeks), this is a no-op. When the flag flips on for a tenant
  // we get learner.quiz_completed + learner.mastery_changed events on
  // the bus. Subscribers run in parity-check / dry-run mode until we
  // verify their projections match the legacy RPC's writes.
  if (!rpcData.idempotent_replay) {
    void maybeDispatchQuizCompletion({
      authUserId: auth.userId,
      legacySessionId: rpcData.session_id ?? body.sessionId,
      input: {
        quizSessionId: rpcData.session_id ?? body.sessionId,
        subjectCode: (body.subject ?? 'unknown').toLowerCase(),
        chapterNumber: body.chapter ?? 1,
        questions: body.responses.map((r) => {
          const graded = rpcData?.questions?.find(
            (q): q is { question_id?: string; is_correct?: boolean } =>
              !!q && typeof q === 'object' && (q as { question_id?: string }).question_id === r.question_id,
          );
          return {
            correct: graded?.is_correct === true,
            timeSpentSec: r.time_taken_seconds,
          };
        }),
        startedAt: new Date(Date.now() - body.totalTimeSeconds * 1000).toISOString(),
        endedAt: new Date().toISOString(),
      },
    }).then((bridgeResult) => {
      if (bridgeResult.ranOrchestrator) {
        void logOpsEvent({
          category: 'state-architecture',
          severity: 'info',
          source: 'api/quiz/submit/route.ts',
          message: 'orchestrator_bridge_dispatched',
          context: {
            session_id: rpcData?.session_id ?? body.sessionId,
            published_event_count: bridgeResult.publishedEventCount,
          },
        });
      } else if (bridgeResult.error) {
        logger.warn('quiz.submit: orchestrator bridge errored (legacy path unaffected)', {
          error: new Error(bridgeResult.error),
          sessionId: rpcData?.session_id ?? body.sessionId,
        });
      }
    }).catch(() => { /* never throw from bridge */ });
  }

  // ── 11. Return canonical shape ────────────────────────────────────────
  return NextResponse.json({
    success: true,
    data: shapeResponse(rpcData),
  });
}

/** Canonical public response shape. Frontend consumes ONLY these keys. */
function shapeResponse(r: QuizV2Result) {
  return {
    session_id: r.session_id,
    score_percent: r.score_percent,
    xp_earned: r.xp_earned,
    correct: r.correct,
    total: r.total,
    flagged: !!r.flagged,
    idempotent_replay: !!r.idempotent_replay,
    marking_authenticity_path: 'oracle_v2' as const,
    // Pass through the questions array if present so the client can render the
    // review screen without a second round-trip. Stable schema set by the RPC.
    questions: r.questions ?? [],
  };
}

/** Best-effort reason derivation for anti-cheat events. RPC does not return one. */
function deriveAntiCheatReason(
  r: QuizV2Result,
  totalTimeSeconds: number,
  responseCount: number,
): string {
  const avg = r.total > 0 ? totalTimeSeconds / r.total : 0;
  if (avg < 3) return 'avg_time_below_3s';
  if (responseCount !== r.total) return 'response_count_mismatch';
  return 'all_same_answer_or_other';
}
