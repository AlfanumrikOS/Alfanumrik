/**
 * packages/lib/src/quiz/idempotency.ts — the single place that decides WHICH
 * idempotency key grades a quiz submission.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE INVARIANT (R9)
 *
 *   For any submission that carries a sessionId, the idempotency key used for
 *   grading is that sessionId and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `/api/quiz/submit` and `/api/v2/quiz/submit` both took `Idempotency-Key`
 * from a CLIENT header and forwarded it verbatim as `p_idempotency_key`,
 * unbound to `sessionId`. Two things depend on that binding holding:
 *
 *   1. ONE GRADED SUBMISSION PER SESSION (P2/P4). The only server-side
 *      enforcement is the partial unique index
 *        quiz_sessions_idempotency_key_uniq ON (student_id, idempotency_key)
 *        WHERE idempotency_key IS NOT NULL
 *      (migration 20260504100200). That index constrains the KEY, not the
 *      session — so two different client-chosen keys for the same session are
 *      two legal rows, two `atomic_quiz_profile_update` calls, and DOUBLE XP.
 *
 *   2. THE ALREADY-GRADED GATES. Two readers ask "has this session been
 *      graded?" by looking the SESSION ID up in the key column:
 *        - apps/host/src/app/api/quiz/session/[sessionId]/progress/route.ts
 *          (the resume payload's `already_submitted` gate), and
 *        - packages/lib/src/state/student-state-builder.ts
 *          (which PRODUCES the /today "Continue where you stopped" card).
 *      If the stored key is a client UUID instead of the session id, both
 *      silently stop matching and a graded session becomes resumable again.
 *
 * Today the web client calls `submit_quiz_results_v2` directly
 * (packages/lib/src/supabase.ts passes `p_idempotency_key: sessionId ?? null`,
 * i.e. it already honours this invariant), so these routes are unreachable
 * from web and nothing is broken yet. At the `ff_server_only_quiz_submit`
 * cutover they become the ONLY legal grading path and both failures go live.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY WE IGNORE THE HEADER RATHER THAN 400 ON A MISMATCH
 *
 * Mobile is a LIVE caller of `/v2/quiz/submit` and it CANNOT send the session
 * id as its key: `QuizNotifier.startQuiz()` mints `attemptKey = _uuidGen.v4()`
 * BEFORE `start_quiz_session` has returned a `serverSessionId`
 * (mobile/lib/providers/quiz_provider.dart). Its key is therefore never equal
 * to the session id — for online submits AND for every offline drain, which
 * replays `QueuedQuizAttempt.idempotencyKey` verbatim. Rejecting a mismatch
 * with 400 would fail 100% of mobile quiz submissions and require a forced app
 * release. So the header stays REQUIRED and UUID-validated (unchanged wire
 * contract, unchanged response shape) but it is demoted to a client-side retry
 * token: the server no longer lets it choose the grading key.
 *
 * This does not weaken replay. Both keys are per-attempt and stable across
 * retries, but the session id is stable across MORE (a page refresh or app
 * restart wipes mobile's in-memory `state.idempotencyKey`; the session id
 * survives in the database). Re-submitting the same session — a network
 * retry, a re-drain of a queued offline attempt, or a resumed tab reaching the
 * end again — still hits the RPC's short-circuit and returns the prior result
 * with `idempotent_replay: true` instead of re-grading.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the idempotency key a quiz submission is graded under.
 *
 * @param sessionId  The server session id from the validated request body.
 *                   Both submit routes declare this REQUIRED (`zUuid` /
 *                   `z.string().uuid()`), so in practice it is always a valid
 *                   UUID by the time this is called.
 * @param headerKey  The already-validated `Idempotency-Key` request header.
 * @returns          `sessionId` whenever it is a usable UUID; otherwise
 *                   `headerKey`.
 *
 * The fallback exists purely so no EXISTING caller gains a new failure mode:
 * if a request ever reaches grading without a session id (a legacy or
 * hand-rolled client that slipped past body validation), behaviour is exactly
 * what it is today — the client's header key is used — rather than a crash or
 * a NULL key that would disable the replay short-circuit entirely. It is not a
 * hole in the invariant: the invariant is scoped to submissions that HAVE a
 * sessionId, and every such submission is now keyed by it.
 */
export function resolveGradingIdempotencyKey(
  sessionId: string | null | undefined,
  headerKey: string,
): string {
  return sessionId && UUID_RE.test(sessionId) ? sessionId : headerKey;
}
