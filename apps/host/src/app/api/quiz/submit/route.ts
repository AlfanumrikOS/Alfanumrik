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
 *         OR the RPC's SECURITY DEFINER ownership guard denied the caller →
 *         { code: 'STUDENT_OWNERSHIP_DENIED' }. Shares SQLSTATE P0001 with
 *         session_not_started, so it is discriminated by message and MUST be
 *         checked first — see rpc-error-classification.ts.
 *   409 → P0001 session_not_started → client should restart the quiz
 *   500 → PERMANENT RPC failure (SQLSTATE 42501 / 42883 / 23514) →
 *         { code: 'RPC_PERMANENT', retryable: false }. Retrying with the same
 *         Idempotency-Key can NEVER succeed; the client must stop (but must NOT
 *         discard the attempt — see rpc-error-classification.ts).
 *   503 → transient RPC failure → { code: 'RPC_FAILED', retryable: true };
 *         client should retry with same Idempotency-Key
 *
 * Transport (both supported)
 *   The RPC runs on `createSupabaseRouteClient(request)`: `Authorization:
 *   Bearer <jwt>` (mobile) is forwarded to PostgREST under the anon key, and
 *   cookie-session callers (web) fall through to `createSupabaseServerClient()`.
 *   RLS is enforced on both paths; the service-role key is never used for the
 *   RPC call.
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
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { capture as posthogCapture } from '@alfanumrik/lib/posthog/server';
import { validateBody } from '@alfanumrik/lib/validation';
import { runQuizSubmitSideEffects } from '@alfanumrik/lib/quiz/submit-side-effects';
import {
  authTransportLabel,
  isPermanentRpcFailure,
  isOwnershipGuardDenial,
  OWNERSHIP_DENIED_CODE,
  OWNERSHIP_DENIED_MESSAGE,
  OWNERSHIP_DENIED_OPS_CATEGORY,
  OWNERSHIP_DENIED_OPS_MESSAGE,
  RPC_PERMANENT_CODE,
  RPC_PERMANENT_MESSAGE,
  RPC_TRANSIENT_CODE,
  RPC_TRANSIENT_MESSAGE,
} from '@alfanumrik/lib/quiz/rpc-error-classification';

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
    .select('id, account_status')
    .eq('auth_user_id', auth.userId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (!studentRow?.id) {
    return NextResponse.json(
      { success: false, error: 'No student profile linked to this account', code: 'NO_STUDENT_PROFILE' },
      { status: 403 },
    );
  }
  if (studentRow.account_status === 'suspended') {
    return NextResponse.json(
      { success: false, error: 'Account suspended', code: 'ACCOUNT_SUSPENDED' },
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
  //
  // BOTH transports are handled: `createSupabaseRouteClient` forwards an
  // `Authorization: Bearer <jwt>` (mobile) to PostgREST under the anon key, and
  // falls back to the cookie session client (`createSupabaseServerClient`) for
  // web callers. RLS is enforced on both paths; the service-role key is never
  // used. This comment used to sit above the COOKIE-ONLY client — the intent
  // was always right, the code never matched it, and every Bearer caller
  // therefore reached PostgREST as role `anon`. `submit_quiz_results_v2` is
  // granted only to `authenticated, service_role`, so mobile submissions raised
  // SQLSTATE 42501 and were reported as a transient 503 (P0, 2026-08-12).
  const supabaseUser = await createSupabaseRouteClient(request);

  // ── 7. Call submit_quiz_results_v2 with idempotency key ───────────────
  let rpcData: QuizV2Result | null = null;
  let rpcErr: { message: string; code?: string } | null = null;
  try {
    const { data, error } = await supabaseUser.rpc('submit_quiz_results_v2', {
      p_session_id: body.sessionId,
      p_student_id: body.studentId,
      p_subject: body.subject ?? 'unknown',
      p_grade: body.grade ?? 'unknown',
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

    // P0001 (a) — the SECURITY DEFINER OWNERSHIP-GUARD denial. MUST be tested
    // BEFORE the session_not_started branch below: a bare `RAISE EXCEPTION` in
    // PL/pgSQL is SQLSTATE P0001, so the guard's
    // 'Access denied: caller does not own student %' and the RPC's routine
    // 'session_not_started' arrive with the SAME code. Ordering is the only
    // thing separating them; the message test is exact, so a legitimate
    // session_not_started can never fall in here.
    //
    // Previously this collapsed into the 409 below, which answered a genuine
    // cross-student submission with "session not started, please restart" and
    // emitted no security signal at all. It is now its own 403 + its own
    // ops_events row.
    if (isOwnershipGuardDenial(rpcErr)) {
      logger.error('quiz.submit: RPC ownership guard denied', {
        error: new Error('ownership_guard_denied'),
        sessionId: body.sessionId,
        studentId: body.studentId,
        authUserId: auth.userId,
      });
      // AWAITED, unlike the sibling RPC-failure event below which is `void`ed.
      // A serverless invocation can be torn down as soon as the response is
      // returned, so a fire-and-forget write is a write that may never land —
      // acceptable for a scoring-failure metric, not for the only record that a
      // cross-student attempt happened. This path is by definition rare and
      // abnormal, so the added latency costs nothing real. logOpsEvent never
      // throws (DB failures degrade to console.warn), so awaiting cannot turn a
      // 403 into a 500.
      await logOpsEvent({
        category: OWNERSHIP_DENIED_OPS_CATEGORY,
        severity: 'error',
        source: 'api/quiz/submit/route.ts',
        message: OWNERSHIP_DENIED_OPS_MESSAGE,
        subjectType: 'student',
        subjectId: body.studentId,
        context: {
          // Server-side forensic correlation only. The raw RPC message is NOT
          // logged: it interpolates the same student id already carried in
          // `student_id`, so it would add nothing but a second copy.
          rpc_code: rpcErr.code ?? null,
          guard: 'student_ownership',
          session_id: body.sessionId,
          student_id: body.studentId,
          auth_user_id: auth.userId,
          // Which transport the denied caller used. Must be the SAME test the
          // route client applies (`startsWith('Bearer ')`) — a `Basic` header is
          // NOT a Bearer caller, and mislabelling it here would send a forensic
          // investigation after the wrong client.
          transport: authTransportLabel(request),
        },
      });
      // 403, no `hint`, no `retryable`. The mobile drain classifies 4xx →
      // discard, which is the correct disposition for an attempt the caller is
      // not entitled to make. P13: no identifier and no SQL text in the body.
      return NextResponse.json(
        {
          success: false,
          error: OWNERSHIP_DENIED_MESSAGE,
          code: OWNERSHIP_DENIED_CODE,
        },
        { status: 403 },
      );
    }

    // P0001 (b) — session_not_started branch raised inside the RPC. Normal,
    // expected client state; response is unchanged byte-for-byte.
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

    // PERMANENT vs TRANSIENT. A missing grant (42501), a missing/undeployed RPC
    // (42883 / PGRST202) or a CHECK violation (23514) can NEVER be resolved by
    // replaying the same request with the same Idempotency-Key — reporting them
    // as a transient 503 made the Flutter drain queue retry forever. See
    // src/lib/quiz/rpc-error-classification.ts for the full rationale.
    const permanent = isPermanentRpcFailure(rpcErr);

    // Ops is paged for BOTH classes at severity `error` — a permanent failure is
    // strictly more urgent, so it keeps (and flags) the same page.
    logger.error('quiz.submit: RPC failed', {
      error: new Error(rpcErr.message),
      sessionId: body.sessionId,
      studentId: body.studentId,
      permanent,
    });
    void logOpsEvent({
      category: 'quiz',
      severity: 'error',
      source: 'api/quiz/submit/route.ts',
      message: permanent
        ? 'submit_quiz_results_v2_failed_permanent'
        : 'submit_quiz_results_v2_failed',
      context: {
        rpc_error: rpcErr.message,
        rpc_code: rpcErr.code ?? null,
        failure_class: permanent ? 'permanent' : 'transient',
        session_id: body.sessionId,
        student_id: body.studentId,
      },
    });

    if (permanent) {
      // 500 (NOT 4xx): the mobile drain classifies `4xx → discard`, and
      // discarding would throw away the student's real attempt. `retryable:
      // false` is the machine-readable signal that lets the client stop
      // retrying WITHOUT losing the data. The message never says "retry".
      return NextResponse.json(
        {
          success: false,
          error: RPC_PERMANENT_MESSAGE,
          code: RPC_PERMANENT_CODE,
          retryable: false,
        },
        { status: 500 },
      );
    }

    // Genuine transient → 503 so the client retries with the same key.
    return NextResponse.json(
      {
        success: false,
        error: RPC_TRANSIENT_MESSAGE,
        code: RPC_TRANSIENT_CODE,
        retryable: true,
      },
      { status: 503 },
    );
  }

  if (!rpcData) {
    return NextResponse.json(
      {
        success: false,
        error: 'Empty response from scoring engine',
        code: 'EMPTY_RESPONSE',
        retryable: true,
      },
      { status: 503 },
    );
  }

  // ── 9-10. Post-RPC side-effects (PostHog + ADR-005 spine + orchestrator) ─
  // Shared, fire-and-forget, never blocks the response. Internally guarded by
  // `idempotent_replay` so replays don't double-count / double-publish. This
  // is the EXACT same code path /api/v2/quiz/submit runs — see
  // src/lib/quiz/submit-side-effects.ts (single source, no drift).
  runQuizSubmitSideEffects(
    admin,
    auth.userId,
    {
      studentId: body.studentId,
      sessionId: body.sessionId,
      subject: body.subject,
      topic: body.topic,
      chapter: body.chapter,
      totalTimeSeconds: body.totalTimeSeconds,
      responses: body.responses,
    },
    rpcData,
  );

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
    // M1 (audit 2026-08-14): surface xp_capped so the web cap banner
    // (QuizResults.tsx reads `xp_capped === true`) shows exactly like the
    // /v2 route does. Before this, the two mirrored routes drifted — /v2
    // returned xp_capped but this route dropped it, so the web route never
    // showed the daily-XP-cap banner.
    ...(r.xp_capped !== undefined ? { xp_capped: !!r.xp_capped } : {}),
    // Pass through the questions array if present so the client can render the
    // review screen without a second round-trip. Stable schema set by the RPC.
    questions: r.questions ?? [],
  };
}
