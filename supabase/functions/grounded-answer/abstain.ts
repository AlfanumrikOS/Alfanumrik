// supabase/functions/grounded-answer/abstain.ts
// Response builder for the abstain branch of GroundedResponse (grounded=false).
//
// Single responsibility: stamp a well-formed abstain response with latency
// and trace_id so callers get a consistent shape across all 7 abstain
// reasons (spec §6.1). No I/O here — trace writes happen in Task 2.8.

import type { AbstainReason, GroundedResponse, SuggestedAlternative } from './types.ts';

export function buildAbstainResponse(
  reason: AbstainReason,
  alternatives: SuggestedAlternative[],
  trace_id: string,
  started_at: number,
): GroundedResponse {
  return {
    grounded: false,
    abstain_reason: reason,
    suggested_alternatives: alternatives,
    trace_id,
    meta: { latency_ms: Date.now() - started_at },
  };
}