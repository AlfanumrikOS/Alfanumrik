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
 *   body.sessionId                     → p_idempotency_key   (R9 — NOT the
 *     client's Idempotency-Key header. The header is still REQUIRED and
 *     UUID-validated as a client retry token, but the GRADING key is bound to
 *     the session so that one session can only ever be graded once. Full
 *     rationale, incl. why we ignore the header rather than reject a mismatch
 *     that every live mobile client would trip, in
 *     packages/lib/src/quiz/idempotency.ts.)
 *
 * Error translation (IDENTICAL to /api/quiz/submit):
 *   P0001 ownership-guard denial       → 403 { code: 'STUDENT_OWNERSHIP_DENIED' }
 *     ('Access denied: caller does        Shares SQLSTATE P0001 with
 *      not own student %')                session_not_started, so it is
 *                                         discriminated by MESSAGE and checked
 *                                         FIRST. Logged to ops_events at
 *                                         severity `error`.
 *   P0001 session_not_started          → 409
 *   unique-violation replay race       → cached row, idempotent_replay: true
 *   PERMANENT RPC failure              → 500 { code: 'RPC_PERMANENT',
 *     (SQLSTATE 42501/42883/23514)          retryable: false } — do NOT retry,
 *                                          do NOT discard the attempt
 *   any other RPC failure              → 503 { code: 'RPC_FAILED',
 *                                          retryable: true } (retry same key)
 *
 * Transport (both supported): the RPC runs on `createSupabaseRouteClient(request)`,
 * which forwards `Authorization: Bearer <jwt>` (the ONLY transport the Flutter app
 * uses) to PostgREST under the anon key and falls back to the cookie session client
 * for web. RLS enforced on both paths; service-role is never used for the RPC.
 *
 * Auth boundary (P9): authorizeRequest('quiz.attempt') + JWT/body studentId
 * cross-check (403 on mismatch). Idempotency-Key (UUID) is REQUIRED (400).
 */
import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@alfanumrik/lib/rbac';
import { createSupabaseRouteClient } from '@alfanumrik/lib/supabase-route';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { validateBody } from '@alfanumrik/lib/validation';
import { v2Success, v2Error } from '@alfanumrik/lib/api/v2/envelope';
import { QuizSubmitRequest } from '@alfanumrik/lib/api/v2/contract';
import { withRoute } from '@alfanumrik/lib/api/v2/with-route';
import {
  runQuizSubmitSideEffects,
  type QuizSubmitOfflineMeta,
} from '@alfanumrik/lib/quiz/submit-side-effects';
import {
  prepareQuizTelemetry,
  type QuizTelemetryPre,
} from '@alfanumrik/lib/quiz/post-submit-telemetry';
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
import { resolveGradingIdempotencyKey } from '@alfanumrik/lib/quiz/idempotency';

/**
 * Max age (hours) of an OFFLINE-captured attempt the server will still replay.
 * Beyond this the drain is rejected 422 REPLAY_TOO_STALE. Named constant
 * (feature-flaggable later if needed); 168h = 7 days. Assessment/architect
 * approved. This gate uses capturedAt for AGE only — it NEVER derives attempt
 * duration (P3 stays driven by totalTimeSeconds).
 */
const OFFLINE_REPLAY_MAX_STALENESS_HOURS = 168;

/** Clock-skew tolerance: capturedAt may be at most this far in the future. */
const OFFLINE_REPLAY_CLOCK_SKEW_MS = 5 * 60 * 1000; // 5 minutes

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

export const POST = withRoute(async (request: NextRequest) => {
  // 1. RBAC: must hold quiz.attempt (same as /api/quiz/submit).
  const auth = await authorizeRequest(request, 'quiz.attempt');
  if (!auth.authorized || !auth.userId) {
    return (auth.errorResponse ?? v2Error('Unauthorized', 401, 'AUTH_REQUIRED')) as unknown as NextResponse;
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

  // 3b. R9 — bind the GRADING key to the session, not to the client header.
  //     MOBILE IS A LIVE CALLER HERE and it cannot send the session id: it
  //     mints its key in `startQuiz()` before `start_quiz_session` returns a
  //     session (mobile/lib/providers/quiz_provider.dart), and every offline
  //     drain replays that same key verbatim. So we IGNORE the header value
  //     for grading rather than 400 on a mismatch — rejecting would fail 100%
  //     of mobile submissions and need a forced app release. The header stays
  //     required + UUID-validated, so the wire contract is unchanged; it is
  //     simply no longer allowed to pick which key grades the quiz.
  //     Without this, two different client keys on one session = two graded
  //     rows = double XP (P2), and the resume/`/today` already-graded gates
  //     (which look the SESSION ID up in `quiz_sessions.idempotency_key`)
  //     stop matching so a graded session becomes resumable again.
  const gradingKey = resolveGradingIdempotencyKey(body.sessionId, idempotencyKey);

  // 4. Cross-check JWT's student_id matches body.studentId (defense-in-depth).
  const admin = getSupabaseAdmin();
  const { data: studentRow } = await admin
    .from('students')
    .select('id, account_status')
    .eq('auth_user_id', auth.userId)
    .eq('is_active', true)
    .is('deleted_at', null)
    .maybeSingle();

  if (!studentRow?.id) {
    return v2Error('No student profile linked to this account', 403, 'NO_STUDENT_PROFILE');
  }
  // M1 (audit 2026-08-14): parity with /api/quiz/submit — a suspended student
  // must be blocked here too. The web route has this gate; /v2/quiz/submit was
  // missing it, so a suspended student could still grade quizzes via mobile.
  if (studentRow.account_status === 'suspended') {
    return v2Error('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }
  if (studentRow.id !== body.studentId) {
    logger.warn('v2.quiz.submit: studentId mismatch', {
      jwtStudentId: studentRow.id,
      bodyStudentId: body.studentId,
      sessionId: body.sessionId,
    });
    return v2Error('Student ID mismatch', 403, 'STUDENT_ID_MISMATCH');
  }

  // 4b. OFFLINE-REPLAY GATES (Wave 2.5.1). These run ONLY when the submit was
  //     captured offline (attemptMode === 'offline_replay') and ALL run BEFORE
  //     the RPC call. When online, none of this executes — the path below is
  //     byte-identical to today. The RPC stays the sole grading authority: these
  //     gates VERIFY the replay's freshness + shuffle integrity, they never grade
  //     and never derive attempt duration (P3 uses totalTimeSeconds only).
  let offlineMeta: QuizSubmitOfflineMeta | undefined;
  if (body.attemptMode === 'offline_replay') {
    const drainedAt = new Date();

    // (1) capturedAt is REQUIRED for an offline replay.
    if (!body.capturedAt) {
      return v2Error(
        'capturedAt is required for an offline replay',
        400,
        'OFFLINE_CAPTURED_AT_REQUIRED',
      );
    }
    const capturedAt = new Date(body.capturedAt);

    // (2) Clock-skew: capturedAt must not be implausibly in the future.
    if (capturedAt.getTime() > drainedAt.getTime() + OFFLINE_REPLAY_CLOCK_SKEW_MS) {
      return v2Error(
        'capturedAt is in the future beyond the allowed skew',
        422,
        'REPLAY_CLOCK_INVALID',
      );
    }
    // Clamp to now so a small forward skew does not produce a negative latency.
    const effectiveCapturedAt = new Date(
      Math.min(capturedAt.getTime(), drainedAt.getTime()),
    );

    // (3) Staleness: drained too long after capture → reject.
    const ageHours =
      (drainedAt.getTime() - effectiveCapturedAt.getTime()) / (1000 * 60 * 60);
    if (ageHours > OFFLINE_REPLAY_MAX_STALENESS_HOURS) {
      return v2Error(
        'Offline attempt is too stale to replay',
        422,
        'REPLAY_TOO_STALE',
      );
    }

    // (4) Device-summed duration consistency. totalTimeSeconds remains the SOLE
    //     P3 timing source forwarded to the RPC — this is a cross-check only.
    if (
      body.clientCapturedTotalSeconds !== undefined &&
      body.clientCapturedTotalSeconds !== body.totalTimeSeconds
    ) {
      return v2Error(
        'clientCapturedTotalSeconds does not match totalTimeSeconds',
        400,
        'OFFLINE_TIME_INCONSISTENT',
      );
    }

    // (5) Shuffle-map verification. The server NEVER grades against the client
    //     map — it only asserts the client map equals the server-stored
    //     quiz_session_shuffles snapshot element-for-element. Any mismatch fails
    //     closed (422). A MISSING snapshot row is left to the existing RPC
    //     session_not_started → 409 path (do not invent a new code here).
    if (body.shuffleMapsClientGradedAgainst) {
      const { data: shuffleRows } = await admin
        .from('quiz_session_shuffles')
        .select('question_id, shuffle_map')
        .eq('session_id', body.sessionId);

      // No snapshot at all → defer to the RPC's session_not_started path.
      if (shuffleRows && shuffleRows.length > 0) {
        const serverMapByQuestion = new Map<string, number[]>();
        for (const row of shuffleRows as Array<{ question_id: string; shuffle_map: unknown }>) {
          if (Array.isArray(row.shuffle_map)) {
            serverMapByQuestion.set(row.question_id, row.shuffle_map as number[]);
          }
        }

        for (const [questionId, clientMap] of Object.entries(
          body.shuffleMapsClientGradedAgainst,
        )) {
          const serverMap = serverMapByQuestion.get(questionId);
          // Missing the row for THIS question, or any element diverges → fail closed.
          if (
            !serverMap ||
            serverMap.length !== clientMap.length ||
            !clientMap.every((v, i) => v === serverMap[i])
          ) {
            logger.warn('v2.quiz.submit: offline shuffle-map mismatch', {
              sessionId: body.sessionId,
              questionId,
            });
            return v2Error(
              'Client shuffle map does not match the server snapshot',
              422,
              'SHUFFLE_MAP_MISMATCH',
            );
          }
        }
      }
    }

    // Gates passed. Build the telemetry metadata threaded into the side-effects.
    const queueLatencySeconds = Math.max(
      0,
      Math.round((drainedAt.getTime() - effectiveCapturedAt.getTime()) / 1000),
    );
    offlineMeta = {
      attemptMode: 'offline_replay',
      capturedAt: body.capturedAt,
      drainedAt: drainedAt.toISOString(),
      queueLatencySeconds,
      ...(body.drainAttempt !== undefined ? { drainAttempt: body.drainAttempt } : {}),
    };
  }

  // 4c. POST-SUBMIT LEARNING TELEMETRY PRE-SNAPSHOT (SPEC-1..5). Always-on
  //     (P0): the closed-loop learning-evidence requirement mandates that every
  //     quiz submission writes learning_events. The pre-RPC topic_id resolution +
  //     pre-mastery read is best-effort — failures degrade gracefully to an empty
  //     snapshot (target topic still gets a quiz_attempt event).
  //     DUAL-ID: this PRE-read keys concept_mastery by students.id (body.studentId,
  //     cross-checked == studentRow.id above). WRITES (auth.uid) happen post-RPC.
  let telemetryPre: QuizTelemetryPre | undefined;
  try {
    telemetryPre = await prepareQuizTelemetry(
      admin,
      body.studentId, // students.id — concept_mastery READ key
      body.responses.map((r) => r.question_id),
    );
  } catch {
    // Never let telemetry preparation break submit. Leave telemetryPre undefined.
    telemetryPre = undefined;
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
  //
  // BOTH transports are handled: `createSupabaseRouteClient` forwards an
  // `Authorization: Bearer <jwt>` to PostgREST under the anon key, and falls
  // back to the cookie session client (`createSupabaseServerClient()`) for web
  // callers. RLS is enforced on both paths; the service-role key is never used.
  // This comment used to sit above the COOKIE-ONLY client — the intent was
  // always right, the code never matched it. The entire Flutter app is
  // Bearer-only and posts here, so every mobile caller reached PostgREST as
  // role `anon`; `submit_quiz_results_v2` is granted only to `authenticated,
  // service_role`, so every mobile submission raised SQLSTATE 42501 and was
  // mis-reported as a transient 503 (P0, 2026-08-12).
  const supabaseUser = await createSupabaseRouteClient(request);

  // 6. Call submit_quiz_results_v2 with the SAME args as /api/quiz/submit.
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
      // R9: the SESSION id, never the client header. See step 3b.
      p_idempotency_key: gradingKey,
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

    // P0001 (a) — the SECURITY DEFINER OWNERSHIP-GUARD denial. MUST be tested
    // BEFORE the session_not_started branch: a bare `RAISE EXCEPTION` in
    // PL/pgSQL is SQLSTATE P0001, so the guard's
    // 'Access denied: caller does not own student %' and the routine
    // 'session_not_started' arrive with the SAME code. Ordering is the only
    // thing separating them; the message test is exact, so a legitimate
    // session_not_started can never fall in here.
    //
    // Previously this collapsed into the 409 below — a genuine cross-student
    // submission got "session not started, please restart" and ops got nothing.
    if (isOwnershipGuardDenial(rpcErr)) {
      logger.error('v2.quiz.submit: RPC ownership guard denied', {
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
        source: 'api/v2/quiz/submit/route.ts',
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
          // Same Bearer test the route client applies — a `Basic` header is NOT
          // a Bearer caller, and mislabelling it would send a forensic
          // investigation after the wrong client.
          transport: authTransportLabel(request),
        },
      });
      // 403, no `retryable`. The mobile drain classifies 4xx → discard, which
      // is the correct disposition for an attempt the caller is not entitled to
      // make. P13: no identifier and no SQL text in the body.
      return v2Error(OWNERSHIP_DENIED_MESSAGE, 403, OWNERSHIP_DENIED_CODE);
    }

    // P0001 (b) — session_not_started → 409. Unchanged byte-for-byte.
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
        // R9: must be the SAME key the INSERT raced on, else the cached row is
        // never found and a genuine retry 503s instead of replaying.
        .eq('idempotency_key', gradingKey)
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
        // Offline-sync telemetry MUST fire once per drain — including this
        // idempotent replay (it measures replays). runQuizSubmitSideEffects'
        // own idempotent_replay guard short-circuits ALL other side-effects
        // (PostHog / spine / orchestrator), so a cached replay emits ONLY the
        // offline-sync ops-event — never double-counting the funnels. When
        // online (offlineMeta undefined) this is a no-op.
        runQuizSubmitSideEffects(
          admin,
          auth.userId,
          {
            studentId: body.studentId,
            sessionId: body.sessionId,
            subject: body.subject,
            grade: body.grade,
            topic: body.topic,
            chapter: body.chapter,
            totalTimeSeconds: body.totalTimeSeconds,
            responses: body.responses,
            offlineMeta,
            // SPEC-5: this is an idempotent replay — the side-effects function's
            // own idempotent_replay guard short-circuits the telemetry step, so
            // even though we pass the snapshot here it never fires on a replay.
            telemetryPre,
          },
          replay,
        );
        return v2Success(shapeResult(replay));
      }
      // else fall through to 503 — the cached row is on its way.
    }

    // PERMANENT vs TRANSIENT. A missing grant (42501), a missing/undeployed RPC
    // (42883 / PGRST202) or a CHECK violation (23514) can NEVER be resolved by
    // replaying the same request with the same Idempotency-Key — reporting them
    // as a transient 503 made the Flutter drain queue (`5xx → retain`) retry
    // forever. See src/lib/quiz/rpc-error-classification.ts for the rationale.
    const permanent = isPermanentRpcFailure(rpcErr);

    // Ops is paged for BOTH classes at severity `error` — a permanent failure is
    // strictly more urgent, so it keeps (and flags) the same page.
    logger.error('v2.quiz.submit: RPC failed', {
      error: new Error(rpcErr.message),
      sessionId: body.sessionId,
      studentId: body.studentId,
      permanent,
    });
    void logOpsEvent({
      category: 'quiz',
      severity: 'error',
      source: 'api/v2/quiz/submit/route.ts',
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
      // 500 (NOT 4xx): the drain classifies `4xx → discard`, and discarding
      // would throw away the student's captured offline attempt. `retryable:
      // false` is the machine-readable signal that lets the client stop retrying
      // WITHOUT losing the data. The message never says "retry".
      return v2Error(RPC_PERMANENT_MESSAGE, 500, RPC_PERMANENT_CODE, false);
    }

    // Genuine transient → 503 so the client retries with the same key.
    return v2Error(RPC_TRANSIENT_MESSAGE, 503, RPC_TRANSIENT_CODE, true);
  }

  if (!rpcData) {
    return v2Error('Empty response from scoring engine', 503, 'EMPTY_RESPONSE', true);
  }

  // 8. Post-RPC side-effects — FULL PARITY with /api/quiz/submit. The SAME
  //    shared function runs PostHog telemetry + the ADR-005 spine emit +
  //    the orchestrator bridge. Fire-and-forget, never blocks the response,
  //    internally guarded by `idempotent_replay` so cached replays don't
  //    double-count. NO scoring / XP / anti-cheat math — see
  //    src/lib/quiz/submit-side-effects.ts (single source, no drift with /api/quiz/submit).
  runQuizSubmitSideEffects(
    admin,
    auth.userId,
    {
      studentId: body.studentId,
      sessionId: body.sessionId,
      subject: body.subject,
      grade: body.grade,
      topic: body.topic,
      chapter: body.chapter,
      totalTimeSeconds: body.totalTimeSeconds,
      responses: body.responses,
      // Offline-sync telemetry (Wave 2.5.3). Undefined on the online path →
      // no new ops-event, byte-identical online behavior.
      offlineMeta,
      // Post-submit learning telemetry pre-snapshot (SPEC-1..5). Undefined when
      // ff_quiz_telemetry_v1 is OFF → the telemetry step no-ops.
      telemetryPre,
    },
    rpcData,
  );

  // 9. Return the RPC result VERBATIM (server-authoritative; never recomputed).
  return v2Success(shapeResult(rpcData));
});
