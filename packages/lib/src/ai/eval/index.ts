// packages/lib/src/ai/eval/index.ts
//
// Runtime ResponseEval sensor (Phase 4) — public surface.
// Pure composer + types + constants (response-eval) and the fire-and-forget
// emitter (emit). See docs/superpowers/specs/2026-07-24-runtime-response-eval-design.md.

export {
  scoreResponse,
  HALLUCINATION_CONFIDENCE_FLOOR,
  UNGROUNDED_CONFIDENCE_CAP,
  LATENCY_HEALTHY_MS,
  LATENCY_DEGRADED_CEILING_MS,
  COST_PER_TURN_BUDGET_USD,
  COST_PER_TURN_CEILING_USD,
  type ResponseEval,
  type ResponseEvalDimension,
  type ResponseEvalDimensionName,
  type ResponseEvalFlagReason,
  type ResponseEvalSignals,
  type EvalSource,
} from '@alfanumrik/lib/ai/eval/response-eval';

export {
  logResponseEval,
  evaluateAndEmit,
  type LogResponseEvalDeps,
} from '@alfanumrik/lib/ai/eval/emit';
