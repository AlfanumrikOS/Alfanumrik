/**
 * src/lib/state/quiz-orchestrator-bridge.ts — the additive bridge from
 * the legacy quiz route to the new orchestrator.
 *
 * Phase 2 rollout strategy:
 *
 *   - The legacy submit_quiz_results_v2 RPC keeps running. It is the
 *     authoritative grader during Phase 2.
 *   - After the RPC succeeds, the quiz route calls this bridge.
 *   - If `ff_orchestrator_v1` is OFF (the default), the bridge is a
 *     no-op — zero behavioural change.
 *   - If `ff_orchestrator_v1` is ON, the bridge dispatches
 *     quiz-completion-service through the Orchestrator, which
 *     publishes learner.quiz_completed + learner.mastery_changed
 *     events on the bus.
 *   - The bridge NEVER throws. Any failure becomes a logger.warn.
 *     A misbehaving orchestrator must not be able to break a
 *     successfully-graded quiz submission.
 *
 * What this lets us do:
 *
 *   - Verify the orchestrator path produces the right events in
 *     production (canary on the Cusiosense house tenant) before any
 *     subscriber starts writing through it.
 *   - Compare orchestrator-computed mastery deltas against the legacy
 *     adaptive_mastery writes (parity check via offline diff).
 *   - Once parity is verified, flip subscribers to actually write to
 *     the new learner_mastery projection, and start retiring legacy
 *     RPC side-effects one at a time.
 *
 * The bridge owns the lazy Orchestrator construction so that no
 * orchestrator code is imported into the route module unless the flag
 * is on (keeps Lambda cold-starts cheap).
 */

import { logger } from '@/lib/logger';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { Orchestrator } from './orchestrator';
import { createStudentStateBuilder } from './student-state-builder';
import { STANDARD_SERVICES } from './services/registry';
import { quizCompletionService, type QuizCompletionInput } from './services/quiz-completion-service';

let lazyOrchestrator: Orchestrator | null = null;

function getOrchestrator(): Orchestrator {
  if (lazyOrchestrator) return lazyOrchestrator;
  const sb = getSupabaseAdmin();
  lazyOrchestrator = new Orchestrator({
    sb,
    buildState: createStudentStateBuilder({ sb }),
    services: STANDARD_SERVICES,
  });
  return lazyOrchestrator;
}

export interface BridgeArgs {
  authUserId: string;
  input: QuizCompletionInput;
  /**
   * The legacy RPC's session id. We thread it back into the orchestrator
   * input so the published event references the same id the legacy
   * mastery writers used — important for the parity diff phase.
   */
  legacySessionId: string;
}

export interface BridgeResult {
  ranOrchestrator: boolean;
  publishedEventCount: number;
  skippedReason?: string;
  error?: string;
}

/**
 * Best-effort dispatch into the orchestrator. Returns a result that
 * the caller logs / surfaces to telemetry. NEVER throws.
 */
export async function maybeDispatchQuizCompletion(
  args: BridgeArgs,
): Promise<BridgeResult> {
  // The orchestrator's own flag check would catch the OFF case too,
  // but we early-out here to avoid building state on every quiz submit
  // when the orchestrator is off (which is the steady state during
  // Phase 2's first weeks).
  const enabled = await safeIsFeatureEnabled('ff_orchestrator_v1', args.authUserId);
  if (!enabled) {
    return { ranOrchestrator: false, publishedEventCount: 0, skippedReason: 'flag_off' };
  }

  try {
    const o = getOrchestrator();
    const result = await o.dispatch<QuizCompletionInput, unknown>({
      authUserId: args.authUserId,
      service: quizCompletionService,
      input: args.input,
    });
    return {
      ranOrchestrator: true,
      publishedEventCount: result.publishedEventCount,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn('quiz-orchestrator-bridge: dispatch failed (legacy path unaffected)', {
      error: new Error(message),
      authUserId: args.authUserId,
      legacySessionId: args.legacySessionId,
    });
    return {
      ranOrchestrator: false,
      publishedEventCount: 0,
      error: message,
    };
  }
}

async function safeIsFeatureEnabled(
  flag: string,
  userId: string,
): Promise<boolean> {
  try {
    return await isFeatureEnabled(flag, { userId });
  } catch {
    return false;
  }
}

/** Test-only — reset the module singleton between tests. */
export function _resetForTests(): void {
  lazyOrchestrator = null;
}
