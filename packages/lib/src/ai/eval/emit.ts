// packages/lib/src/ai/eval/emit.ts
//
// Runtime `ResponseEval` — fire-and-forget emitter (Phase 4).
//
// Emits the PII-free 9-dimension eval record to the observability sink
// (`ops_events`) via `logOpsEvent` at `severity:'info'` (fire-and-forget — no
// awaited DB round-trip on the response path). See spec §6.
//
// FAIL-SAFE (binding): `logResponseEval` NEVER throws into the caller. It wraps
// everything in try/catch and swallows all errors — a failure means "no eval
// emitted this turn", identical to the classifyTurn / perception posture. It
// must never propagate into the student's response path.
//
// P13: the emitted context carries dimension scores + raws + stable codes +
// flagReasons + correlation UUIDs + scope enums (grade/subject) + numbers ONLY.
// It NEVER carries response text, prompt/student-message content, citation
// chunk_text, or any PII. It also rides logOpsEvent's redactContext backstop.
//
// Owner: ai-engineer. Reviewers: assessment, testing, ops.

import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import {
  scoreResponse,
  type ResponseEval,
  type ResponseEvalDimension,
  type ResponseEvalSignals,
} from '@alfanumrik/lib/ai/eval/response-eval';

/** Injectable dependency seam so tests can capture emissions without a DB. */
export interface LogResponseEvalDeps {
  logOpsEvent?: typeof logOpsEvent;
}

/** Flatten one dimension into PII-free primitives for the ops_events context. */
function dimContext(name: string, d: ResponseEvalDimension): Record<string, unknown> {
  return {
    [`${name}_score`]: d.score,
    [`${name}_raw`]: d.raw ?? null,
    [`${name}_source`]: d.source,
    [`${name}_available`]: d.available,
    [`${name}_code`]: d.code ?? null,
  };
}

/**
 * Fire-and-forget emit of a ResponseEval to observability. Never throws; returns
 * a resolved promise even on internal failure (the caller `void`s it).
 */
export async function logResponseEval(
  evalRecord: ResponseEval,
  deps: LogResponseEvalDeps = {},
): Promise<void> {
  try {
    const emit = deps.logOpsEvent ?? logOpsEvent;

    // Codes / ids / enums / numbers ONLY — never any response or message text.
    const context: Record<string, unknown> = {
      ...dimContext('accuracy', evalRecord.accuracy),
      ...dimContext('curriculum_alignment', evalRecord.curriculum_alignment),
      ...dimContext('hallucination_risk', evalRecord.hallucination_risk),
      ...dimContext('age_appropriateness', evalRecord.age_appropriateness),
      ...dimContext('difficulty_fit', evalRecord.difficulty_fit),
      ...dimContext('learning_effectiveness', evalRecord.learning_effectiveness),
      ...dimContext('toxicity', evalRecord.toxicity),
      ...dimContext('latency', evalRecord.latency),
      ...dimContext('cost', evalRecord.cost),
      flagged: evalRecord.flagged,
      flag_reasons: evalRecord.flagReasons,
      trace_id: evalRecord.traceId ?? null,
      session_id: evalRecord.sessionId ?? null,
      message_id: evalRecord.messageId ?? null,
      // grade/subject are scope enums (P5 string / subject code), not PII.
      grade: evalRecord.grade ?? null,
      subject: evalRecord.subject ?? null,
    };

    // Fire-and-forget: severity 'info' → logOpsEvent does not await the DB write.
    // We intentionally do NOT await the emit's completion into the response path.
    void emit({
      category: 'ai',
      source: 'response-eval',
      severity: 'info',
      message: 'response_eval',
      subjectType: 'foxy_message',
      subjectId: evalRecord.messageId ?? undefined,
      requestId: evalRecord.traceId ?? undefined,
      context,
    });
  } catch {
    // Swallow-all: an eval emission failure is a silent no-op, never a throw.
    return;
  }
}

/**
 * Convenience: compose (scoreResponse) + emit (logResponseEval) in one call.
 * Never throws. Fire this `void evaluateAndEmit(signals)` from a caller that has
 * already gated on the `ff_response_eval_v1` flag.
 */
export async function evaluateAndEmit(
  signals: ResponseEvalSignals,
  deps: LogResponseEvalDeps = {},
): Promise<void> {
  try {
    await logResponseEval(scoreResponse(signals), deps);
  } catch {
    return;
  }
}
