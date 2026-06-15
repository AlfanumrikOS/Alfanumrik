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
import {
  runQuizSubmitSideEffects,
  type QuizSubmitOfflineMeta,
} from '@/lib/quiz/submit-side-effects';
import { isFeatureEnabled, QUIZ_TELEMETRY_FLAGS } from '@/lib/feature-flags';
import {
  prepareQuizTelemetry,
  type QuizTelemetryPre,
} from '@/lib/quiz/post-submit-telemetry';

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

  // 4c. POST-SUBMIT TELEMETRY PRE-SNAPSHOT (SPEC-1..5). Gated behind
  //     ff_quiz_telemetry_v1 (unseeded → false → dormant). SPEC-2 needs a
  //     pre/post mastery comparison, so the topic_id resolution + pre-mastery
  //     read MUST happen BEFORE the RPC. Best-effort: prepareQuizTelemetry never
  //     throws (returns a safe empty snapshot on failure). When the flag is OFF
  //     telemetryPre stays undefined and the side-effects telemetry step no-ops,
  //     keeping the submit path byte-identical to today.
  //     DUAL-ID: this PRE-read keys concept_mastery by students.id (body.studentId,
  //     cross-checked == studentRow.id above). WRITES (auth.uid) happen post-RPC.
  let telemetryPre: QuizTelemetryPre | undefined;
  try {
    const telemetryEnabled = await isFeatureEnabled(QUIZ_TELEMETRY_FLAGS.V1, {
      userId: auth.userId,
    });
    if (telemetryEnabled) {
      telemetryPre = await prepareQuizTelemetry(
        admin,
        body.studentId, // students.id — concept_mastery READ key
        body.responses.map((r) => r.question_id),
      );
    }
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
}
