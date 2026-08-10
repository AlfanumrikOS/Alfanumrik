/**
 * packages/lib/src/quiz/resume-gate.ts — the `ff_quiz_v2` resume interlock,
 * evaluated FAIL-CLOSED, in ONE place, for BOTH sides of the promise.
 *
 * ─── Why this module is separate from `resume.ts` ─────────────────────────
 *
 * SERVER-ONLY. It imports the feature-flag engine, which reads the Supabase
 * service-role credential from the environment. `resume.ts` is imported by
 * the `/quiz` CLIENT component (`fetchQuizResume`, the breadcrumb helpers), so
 * putting the gate there would drag service-role-reading code into the browser
 * bundle. Keep this file out of every `'use client'` import graph.
 *
 * ─── The defect this exists to close ──────────────────────────────────────
 *
 * The interlock ("resume is refused while `ff_quiz_v2` is ON, because immediate
 * per-question correctness + resume is the one combination that lets a student
 * see an answer is wrong, refresh, and re-answer") was enforced at ONE point:
 * the resume route's GET. But `resolveResumableQuiz` in
 * `packages/lib/src/state/student-state-builder.ts` — which decides whether
 * `/today` shows the "Continue where you stopped" primary card — had four gates
 * (freshness, ≥1 answer, not graded, positive chapter) and NONE of them was the
 * flag.
 *
 * So for any student on the `ff_quiz_v2` ramp the product did this:
 *   `/today` renders "Continue where you stopped"
 *     → tap → `/quiz?session=<id>`
 *     → GET returns `blocked_immediate_feedback`
 *     → the resume consumer fails soft with NO message
 *     → the student lands on the setup screen, progress apparently gone.
 *
 * That is precisely the "the CTA said resume and started over" defect Phase 4
 * existed to kill, reintroduced for the flagged cohort. THE RULE: consult the
 * flag where the card is PRODUCED, not only where it is consumed. Never promise
 * what you will refuse. The route-side check stays as defence in depth.
 *
 * ─── Why fail-CLOSED, and what that inverts ───────────────────────────────
 *
 * `isFeatureEnabled` returns `false` for a missing flag, a malformed payload, a
 * failed fetch, or missing env. For a feature ramp that is the correct default.
 * For THIS flag it was backwards: `false` means "immediate feedback is off"
 * means "resume is ALLOWED". A flag service that is merely unreachable would
 * therefore have re-opened the exact exploit the interlock exists to prevent,
 * silently, with no signal anywhere.
 *
 * So this module reads the flag with `readFeatureFlagStrict` and treats every
 * undetermined outcome as ON — i.e. refuse resume. `ff_quiz_v2` IS seeded
 * (`20260802150000_seed_ff_quiz_v2.sql`), so a `flag_not_found` means our model
 * of the world is wrong, which is not evidence of safety. The cost of a false
 * refusal is that a student starts fresh — the pre-Phase-4 behaviour. The cost
 * of a false allow is a defeated P1/P2. Those are not symmetric.
 */

import { readFeatureFlagStrict } from '../feature-flags';

/**
 * `ff_quiz_v2` = Screen 07 Practice's immediate per-question correctness.
 * While it is ON — or while we cannot prove it is OFF — resume is refused.
 *
 * Single source of truth for the flag NAME across the route, the state builder
 * and their tests.
 */
export const IMMEDIATE_FEEDBACK_FLAG = 'ff_quiz_v2';

export interface ResumeGateContext {
  /** Auth user UUID of the person who will ACT on the resume, for the per-user rollout hash. */
  userId?: string;
  /**
   * That person's REAL roles, as loaded by RBAC — never a hardcoded guess.
   * A hardcoded `'student'` silently mis-evaluates any role-scoped flag for a
   * caller who is not one, in whichever direction the scoping happens to run.
   * All roles are evaluated and ANY hit refuses (fail-closed on ambiguity).
   */
  roles?: string[];
  environment?: string;
  institutionId?: string;
}

/** Injection seam so callers (and tests) can supply a reader. */
export type StrictFlagReader = typeof readFeatureFlagStrict;

/**
 * True when resume MUST be refused for this caller.
 *
 * Returns true when the flag is on for ANY of the caller's roles, and true
 * whenever the flag could not be determined at all. Only a positive, scoped,
 * successfully-read "off" returns false.
 */
export async function isResumeBlockedByImmediateFeedback(
  ctx: ResumeGateContext,
  read: StrictFlagReader = readFeatureFlagStrict,
): Promise<boolean> {
  // A caller with no known role is still evaluated once with `role: undefined`,
  // which is exactly how an unscoped flag should be read for them. It is not a
  // reason to skip the check.
  const roles = ctx.roles && ctx.roles.length > 0 ? ctx.roles : [undefined];

  for (const role of roles) {
    let result: Awaited<ReturnType<StrictFlagReader>>;
    try {
      result = await read(IMMEDIATE_FEEDBACK_FLAG, {
        userId: ctx.userId,
        role,
        environment: ctx.environment,
        institutionId: ctx.institutionId,
      });
    } catch {
      return true; // Could not determine → refuse.
    }
    if (!result.determined) return true; // Could not determine → refuse.
    if (result.enabled) return true; // On for a role this caller actually holds.
  }
  return false;
}
