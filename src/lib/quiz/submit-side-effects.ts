/**
 * src/lib/quiz/submit-side-effects.ts — shared post-RPC side-effects for the
 * quiz-submit routes.
 *
 * Both POST /api/quiz/submit (web/legacy) and POST /api/v2/quiz/submit
 * (mobile + web /v2) call the SAME submit_quiz_results_v2 RPC and then run the
 * SAME best-effort side-effects:
 *
 *   1. PostHog telemetry  — quiz_graded, xp_awarded, and (conditionally)
 *      quiz_anti_cheat_flagged + daily_xp_cap_hit.
 *   2. ADR-005 spine emit — one learner.mastery_changed event per chapter
 *      touched, gated inside publishEvent() by ff_event_bus_v1.
 *   3. Orchestrator bridge — maybeDispatchQuizCompletion(), gated by
 *      ff_orchestrator_v1 inside the bridge.
 *
 * This module is the SINGLE SOURCE for those side-effects so the two routes
 * can never drift. NEITHER route owns the event-construction logic anymore;
 * they both call `runQuizSubmitSideEffects()` after the RPC returns success.
 *
 * GUARDS (identical to the legacy route): every side-effect fires ONLY on a
 * fresh grade (`idempotent_replay === false`). On a cached idempotent replay
 * the caller passes `idempotentReplay: true` and this function returns
 * immediately — no double-counting in PostHog funnels, no double-publish on
 * the bus, no duplicate orchestrator dispatch.
 *
 * P13: every PostHog payload carries IDs + metrics only — never PII. The
 * publishEvent envelope carries the auth_user_id (server-side, not P13-
 * restricted) + subject/chapter codes + mastery floats only.
 *
 * NO scoring / XP / anti-cheat math lives here. The RPC is authoritative;
 * this module only re-broadcasts the RPC's already-computed values.
 */

import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { logOpsEvent } from '@/lib/ops-events';
import { capture as posthogCapture } from '@/lib/posthog/server';
import { maybeDispatchQuizCompletion } from '@/lib/state/quiz-orchestrator-bridge';
import { publishEvent } from '@/lib/state/events/publish';
import { bktUpdate } from '@/lib/state/services/quiz-completion-service';

/** Minimal RPC result shape the side-effects read. Superset-safe. */
export interface QuizSubmitSideEffectResult {
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

/**
 * Offline-replay telemetry metadata (Wave 2.5.3). Present ONLY when the submit
 * arrived via attemptMode === 'offline_replay'. When absent (online path) NO
 * new ops-event is emitted — the online side-effects path stays byte-identical.
 *
 * METADATA ONLY (P13): no answer/question text, no PII.
 */
export interface QuizSubmitOfflineMeta {
  /** Branch selector — only 'offline_replay' rows carry this metadata block. */
  attemptMode: 'offline_replay';
  /** Device completion time (ISO-8601). NOT used for any duration math (P3). */
  capturedAt: string;
  /** Server-side drain timestamp (ISO-8601), set at route entry. */
  drainedAt: string;
  /** max(0, round((drainedAt - capturedAt)/1000)) — computed server-side. */
  queueLatencySeconds: number;
  /** Telemetry retry counter (1-based), if the client sent one. */
  drainAttempt?: number;
}

/** Normalized request facts the side-effects read (same for both routes). */
export interface QuizSubmitSideEffectInput {
  studentId: string;
  sessionId: string;
  subject?: string;
  topic?: string | null;
  chapter?: number | null;
  totalTimeSeconds: number;
  responses: Array<{ question_id: string; time_taken_seconds: number }>;
  /**
   * Offline-replay telemetry metadata. Absent on the online path. When present,
   * an `offline-sync` ops-event fires for EVERY drain — including idempotent
   * replays (it measures them), BEFORE the idempotent_replay early-return.
   */
  offlineMeta?: QuizSubmitOfflineMeta;
}

/**
 * Run all post-RPC side-effects for a successful quiz submission.
 *
 * Fire-and-forget by design — never awaits, never throws. The caller invokes
 * it after the RPC returns success and BEFORE returning the response. The
 * `idempotentReplay` guard short-circuits the whole thing so replays don't
 * double-count.
 *
 * @param admin       Service-role Supabase client (the spine emit + tenant
 *                    read require service_role; the bus is RLS-locked).
 * @param authUserId  The calling student's auth user id (event actor).
 * @param input       Normalized request facts (studentId, sessionId, etc).
 * @param result      The RPC result (server-authoritative score/xp/flags).
 */
export function runQuizSubmitSideEffects(
  admin: SupabaseClient,
  authUserId: string,
  input: QuizSubmitSideEffectInput,
  result: QuizSubmitSideEffectResult,
): void {
  // OFFLINE-SYNC TELEMETRY (Wave 2.5.3) — MUST fire BEFORE the idempotent-replay
  // early-return: the whole point is to measure replays (queue latency,
  // staleness, drain attempts), so it has to run on cached replays too. Only
  // fires when offline metadata is present; the online path emits nothing new
  // here, preserving its byte-identical behavior. METADATA ONLY (P13).
  if (input.offlineMeta) {
    emitOfflineSyncEvent(input, result, input.offlineMeta);
  }

  // GUARD: replays must not double-count / double-publish / double-dispatch.
  if (result.idempotent_replay) return;

  emitPostHogEvents(input, result);
  emitSpineEvents(admin, authUserId, input, result);
  dispatchOrchestratorBridge(authUserId, input, result);
}

// ─── 0. Offline-sync telemetry (Wave 2.5.3) ──────────────────────────────────
// Rides ops_events (NOT the ADR-005 spine — architect condition). One
// 'learner_offline_sync_replay' event per drain, metadata only. Fires for
// fresh grades AND idempotent replays (it measures both).

function emitOfflineSyncEvent(
  input: QuizSubmitSideEffectInput,
  result: QuizSubmitSideEffectResult,
  meta: QuizSubmitOfflineMeta,
): void {
  void logOpsEvent({
    category: 'offline-sync',
    severity: 'info',
    source: 'lib/quiz/submit-side-effects.ts',
    message: 'learner_offline_sync_replay',
    subjectType: 'student',
    subjectId: input.studentId,
    context: {
      schemaVersion: 1,
      sessionId: result.session_id ?? input.sessionId,
      capturedAt: meta.capturedAt,
      drainedAt: meta.drainedAt,
      queueLatencySeconds: meta.queueLatencySeconds,
      wasIdempotentReplay: result.idempotent_replay,
      drainAttempt: meta.drainAttempt ?? null,
    },
  });
}

// ─── 1. PostHog events (server-side) ─────────────────────────────────────────
// Only emit when this is a fresh grading event. Replays already short-circuited.

function emitPostHogEvents(
  input: QuizSubmitSideEffectInput,
  result: QuizSubmitSideEffectResult,
): void {
  // quiz_graded — primary funnel event.
  void posthogCapture(
    'quiz_graded',
    input.studentId,
    {
      session_id: result.session_id ?? input.sessionId,
      score_percent: result.score_percent,
      xp_earned: result.xp_earned,
      correct: result.correct,
      total: result.total,
      marking_authenticity_path: 'oracle_v2',
      anti_cheat_flagged: !!result.flagged,
      idempotent_replay: false,
    },
    // $insert_id keyed by session — second emission for same session is dropped.
    `quiz_graded:${result.session_id ?? input.sessionId}`,
  ).catch(() => { /* swallow */ });

  // xp_awarded — even when flagged (xp_earned will be 0). Useful for funnel parity.
  void posthogCapture(
    'xp_awarded',
    input.studentId,
    {
      xp_delta: result.xp_earned,
      source: 'quiz',
      // daily_total_after is approximate without re-reading; use xp_earned as
      // a lower bound. The dashboard can sum across rows to get the true total.
      daily_total_after: result.xp_earned,
      capped: !!result.xp_capped,
    },
    `xp_awarded:quiz:${result.session_id ?? input.sessionId}`,
  ).catch(() => { /* swallow */ });

  if (result.flagged) {
    void posthogCapture(
      'quiz_anti_cheat_flagged',
      input.studentId,
      {
        session_id: result.session_id ?? input.sessionId,
        // The RPC doesn't surface a granular reason — derive from data.
        reason: deriveAntiCheatReason(result, input.totalTimeSeconds, input.responses.length),
      },
      `anti_cheat:${result.session_id ?? input.sessionId}`,
    ).catch(() => { /* swallow */ });
  }

  if (result.xp_capped) {
    void posthogCapture(
      'daily_xp_cap_hit',
      input.studentId,
      {
        source: 'quiz',
        cap: 200, // matches XP_RULES.quiz_daily_cap; surfaced for dashboard parity
        attempted_xp: result.xp_earned,
      },
      `daily_xp_cap_hit:quiz:${new Date().toISOString().slice(0, 10)}:${input.studentId}`,
    ).catch(() => { /* swallow */ });
  }
}

// ─── 2. ADR-005 spine emit — learner.mastery_changed ─────────────────────────
//
// Route-level publishEvent. Gated ONLY by ff_event_bus_v1 inside
// publishEvent() — independent of ff_orchestrator_v1 (bridge below). This lets
// operators flip the bus ON for projector subscribers (mastery-state-writer,
// concept-mastery-projector) without also turning on the orchestrator's
// StudentState build path.
//
// Idempotency keys mirror the orchestrator's keys verbatim, so when BOTH
// paths fire (operator ramps ff_event_bus_v1 AND ff_orchestrator_v1 on for
// the same tenant) the bus's UNIQUE(idempotency_key) constraint dedupes —
// exactly one row per (kind, session, chapter).
//
// Best-effort: never blocks the response. Failures log and continue.

function emitSpineEvents(
  admin: SupabaseClient,
  authUserId: string,
  input: QuizSubmitSideEffectInput,
  result: QuizSubmitSideEffectResult,
): void {
  const sessionIdForEvent = result.session_id ?? input.sessionId;
  const subjectCode = (input.subject ?? 'unknown').toLowerCase();
  const primaryChapter = input.chapter ?? 1;
  const occurredAt = new Date().toISOString();

  // Best-effort prior read for mastery deltas. topic_mastery is keyed by
  // (student_id, subject, topic_tag); we don't have topic_tag at the route, so
  // we fall back to null priors. That's accepted by the registry schema —
  // fromMastery is nullable for first-attempt events.
  const priorByChapter: Record<number, number | null> = {};

  const gradedQuestions = input.responses.map((r) => {
    const graded = result.questions?.find(
      (q): q is { question_id?: string; is_correct?: boolean } =>
        !!q && typeof q === 'object' && (q as { question_id?: string }).question_id === r.question_id,
    );
    return { correct: graded?.is_correct === true };
  });

  // Fire-and-forget — never throws into the response. publishEvent short-
  // circuits internally when ff_event_bus_v1 is OFF. The trailing .catch()
  // guards against any unhandled rejection from the IIFE (the per-emit
  // try/catches handle individual publish failures).
  void (async () => {
    const tenantId = await resolveTenantIdForStudent(admin, input.studentId);

    let deltas: ReturnType<typeof computeMasteryDeltas> = [];
    try {
      deltas = computeMasteryDeltas(primaryChapter, gradedQuestions, priorByChapter);
    } catch (err) {
      logger.warn('quiz.submit: computeMasteryDeltas failed', {
        sessionId: sessionIdForEvent,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    for (const d of deltas) {
      try {
        await publishEvent(admin, {
          kind: 'learner.mastery_changed',
          eventId: randomUUID(),
          occurredAt,
          actorAuthUserId: authUserId,
          tenantId,
          idempotencyKey: masteryChangedIdempotencyKey(sessionIdForEvent, d.chapterNumber),
          payload: {
            subjectCode,
            chapterNumber: d.chapterNumber,
            fromMastery: d.fromMastery,
            toMastery: d.toMastery,
            trigger: 'quiz',
          },
        });
      } catch (err) {
        logger.warn('quiz.submit: publishEvent learner.mastery_changed failed', {
          sessionId: sessionIdForEvent,
          chapterNumber: d.chapterNumber,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  })().catch((err) => {
    // Last-ditch swallow: never let the spine-emit IIFE propagate an unhandled
    // rejection to the runtime (it shouldn't — every awaited call above is
    // try-caught — but defense-in-depth is cheap here).
    logger.warn('quiz.submit: spine-emit IIFE rejected', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

// ─── 3. Orchestrator bridge — additive, flag-gated, never throws ─────────────
// While ff_orchestrator_v1 is OFF (the steady state during Phase 2's first
// weeks), this is a no-op. When the flag flips on for a tenant we get
// learner.quiz_completed + learner.mastery_changed events on the bus.
// Subscribers run in parity-check / dry-run mode until we verify their
// projections match the legacy RPC's writes.
//
// Idempotency keys match the spine emit above — when both fire, the UNIQUE
// constraint on state_events.idempotency_key dedupes naturally.

function dispatchOrchestratorBridge(
  authUserId: string,
  input: QuizSubmitSideEffectInput,
  result: QuizSubmitSideEffectResult,
): void {
  void maybeDispatchQuizCompletion({
    authUserId,
    legacySessionId: result.session_id ?? input.sessionId,
    input: {
      quizSessionId: result.session_id ?? input.sessionId,
      subjectCode: (input.subject ?? 'unknown').toLowerCase(),
      chapterNumber: input.chapter ?? 1,
      questions: input.responses.map((r) => {
        const graded = result.questions?.find(
          (q): q is { question_id?: string; is_correct?: boolean } =>
            !!q && typeof q === 'object' && (q as { question_id?: string }).question_id === r.question_id,
        );
        return {
          correct: graded?.is_correct === true,
          timeSpentSec: r.time_taken_seconds,
        };
      }),
      startedAt: new Date(Date.now() - input.totalTimeSeconds * 1000).toISOString(),
      endedAt: new Date().toISOString(),
    },
  }).then((bridgeResult) => {
    if (bridgeResult.ranOrchestrator) {
      void logOpsEvent({
        category: 'state-architecture',
        severity: 'info',
        source: 'lib/quiz/submit-side-effects.ts',
        message: 'orchestrator_bridge_dispatched',
        context: {
          session_id: result.session_id ?? input.sessionId,
          published_event_count: bridgeResult.publishedEventCount,
        },
      });
    } else if (bridgeResult.error) {
      logger.warn('quiz.submit: orchestrator bridge errored (legacy path unaffected)', {
        error: new Error(bridgeResult.error),
        sessionId: result.session_id ?? input.sessionId,
      });
    }
  }).catch(() => { /* never throw from bridge */ });
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

/** Best-effort reason derivation for anti-cheat events. RPC does not return one. */
export function deriveAntiCheatReason(
  r: Pick<QuizSubmitSideEffectResult, 'total'>,
  totalTimeSeconds: number,
  responseCount: number,
): string {
  const avg = r.total > 0 ? totalTimeSeconds / r.total : 0;
  if (avg < 3) return 'avg_time_below_3s';
  if (responseCount !== r.total) return 'response_count_mismatch';
  return 'all_same_answer_or_other';
}

/**
 * Resolve the tenant scope for a learner — read once from students.school_id.
 * Returns null on B2C learners or any read failure (logged + treated as B2C).
 * Used by the spine emit to populate the event envelope's tenantId.
 */
async function resolveTenantIdForStudent(
  sb: SupabaseClient,
  studentId: string,
): Promise<string | null> {
  try {
    const { data } = await sb
      .from('students')
      .select('school_id')
      .eq('id', studentId)
      .maybeSingle();
    const schoolId = (data as { school_id?: string | null } | null)?.school_id ?? null;
    return schoolId;
  } catch (err) {
    logger.warn('quiz.submit: resolveTenantIdForStudent failed', {
      studentId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Stable idempotency key for learner.quiz_completed. */
export function quizCompletedIdempotencyKey(quizSessionId: string): string {
  return `quiz-completed:${quizSessionId}`;
}

/** Stable idempotency key for learner.mastery_changed (one per chapter per session). */
export function masteryChangedIdempotencyKey(
  quizSessionId: string,
  chapterNumber: number,
): string {
  return `mastery-changed:${quizSessionId}:${chapterNumber}`;
}

/**
 * Compute per-chapter mastery deltas from the RPC's per-question grades.
 * Mirrors quiz-completion-service.ts's BKT chain (same priors, same bktUpdate).
 * Returns one entry per chapter that appeared in this quiz session.
 *
 * Pure and exported for unit tests. fromMastery is null when we have no prior
 * reading for that chapter (first-ever attempt); the registry schema allows
 * null fromMastery.
 *
 * @param chapterNumber Primary chapter of the quiz session (default bucket for
 *   any question that didn't carry its own chapter override).
 * @param gradedQuestions Per-question correctness from the RPC.
 * @param priorByChapter Optional per-chapter prior mastery reading. When absent
 *   for a chapter, we use the BKT_PRIOR_INIT (0.3) as the prior but emit
 *   fromMastery=null on the event so subscribers can distinguish "we don't
 *   know" from "we know it's 0.3".
 */
export function computeMasteryDeltas(
  chapterNumber: number,
  gradedQuestions: Array<{ correct: boolean; chapterNumberOverride?: number | null }>,
  priorByChapter: Record<number, number | null> = {},
): Array<{ chapterNumber: number; fromMastery: number | null; toMastery: number }> {
  // Same constant as quiz-completion-service.ts. Keep these in lockstep — if
  // BKT_PRIOR_INIT changes there, mirror it here.
  const BKT_PRIOR_INIT = 0.3;

  const byChapter = new Map<number, boolean[]>();
  for (const q of gradedQuestions) {
    const ch = q.chapterNumberOverride ?? chapterNumber;
    if (!byChapter.has(ch)) byChapter.set(ch, []);
    byChapter.get(ch)!.push(q.correct);
  }

  const out: Array<{ chapterNumber: number; fromMastery: number | null; toMastery: number }> = [];
  for (const [ch, outcomes] of byChapter) {
    const priorRaw = priorByChapter[ch];
    const fromMastery = (typeof priorRaw === 'number' && Number.isFinite(priorRaw))
      ? priorRaw
      : null;
    let m = fromMastery ?? BKT_PRIOR_INIT;
    for (const ok of outcomes) {
      m = bktUpdate(m, ok);
    }
    const toMastery = Math.max(0, Math.min(1, m));
    out.push({ chapterNumber: ch, fromMastery, toMastery });
  }
  return out;
}
