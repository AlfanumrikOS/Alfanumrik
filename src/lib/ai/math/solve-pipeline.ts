/**
 * Foxy Math Solve Pipeline — Solver -> Verifier -> verdict→display mapping.
 *
 * Extracted verbatim from src/app/api/foxy/route.ts so the P12-critical
 * fail-closed verdict→display mapping can be unit-tested directly (mocking
 * solveMath + verifyMath) without going through the route's 503-before-pipeline
 * auth/feature-flag gates.
 *
 * Badge state is computed SERVER-SIDE here and attached to the /api/foxy
 * response envelope as `badgeState`; the renderer must NOT recompute it.
 *
 * This module is logic-identical to the inline route definitions it replaced —
 * no runtime behavior changed. `persistMathTurnAndRespond` stays in route.ts
 * (route/DB-coupled) and imports `runMathSolvePipeline` + `FoxyMathBadgeState`
 * from here.
 */

import { logger } from '@/lib/logger';
import { solveMath } from '@/lib/ai/math/solve-math';
import type { CascadeTier } from '@/lib/ai/clients/reasoning-cascade';
import {
  verifyMath,
  type VerifyMathKind,
  type VerifyMathResult,
} from '@/lib/math-python-client';
import { FoxyResponseSchema, type FoxyResponse } from '@/lib/foxy/schema';

// 'out_of_scope' is included in the shared union because the ROUTE sets it at
// the request boundary (a non-CBSE / out-of-curriculum math request). The
// pipeline itself NEVER returns 'out_of_scope' — it only ever produces
// 'verified' | 'check_manually' | 'none' — but every consumer of the badge
// state shares this one union.
export type FoxyMathBadgeState = 'verified' | 'check_manually' | 'none' | 'out_of_scope';

// Neutral bilingual replacement for a stripped (unverifiable-but-wrong) answer.
// We keep the working visible (the steps/math), but never surface the
// confidently-wrong final value. EN + Hinglish inline (P7).
const MATH_CHECK_TOGETHER_TEXT =
  "Let's check this final step together — I want to be sure before I give the answer. " +
  'Is aakhri step ko saath mein verify karte hain — jawab dene se pehle pakka karna hai.';

/**
 * Count the terminal `answer` blocks and return the single claimed value when
 * exactly one exists. Zero or multiple => null (we can't isolate a verifiable
 * claim). Pure.
 */
function extractSingleAnswerValue(structured: FoxyResponse): string | null {
  const answerBlocks = structured.blocks.filter((b) => b.type === 'answer');
  if (answerBlocks.length !== 1) return null;
  const text = (answerBlocks[0] as { text?: string }).text ?? '';
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Decide the SymPy verify `kind` + the canonical problem expression from the
 * original student problem (the classifier/message is the source of truth for
 * the originating expression, not the model's prose). An expression that
 * contains an '=' with a variable is a 'solve_equation'; otherwise 'evaluate'.
 * Pure.
 */
function deriveVerifyKindAndProblem(problem: string): {
  kind: VerifyMathKind;
  problemExpression: string;
} {
  const p = (problem ?? '').trim();
  const hasEquals = /(?<![<>=!])=(?!=)/.test(p);
  const hasVariable = /[a-zA-Z]/.test(p.replace(/\b(sin|cos|tan|sqrt|log|ln|pi|e)\b/gi, ''));
  const kind: VerifyMathKind = hasEquals && hasVariable ? 'solve_equation' : 'evaluate';
  return { kind, problemExpression: p };
}

/**
 * Replace the single `answer` block's value with the neutral check-together
 * line, keeping every other block (steps/math working) intact. Returns a NEW
 * FoxyResponse (does not mutate). Used on the fail-closed branch so the
 * student sees the working but never the confidently-wrong final value.
 * Re-validated by the caller against FoxyResponseSchema (the neutral text is
 * short + within limits, so it stays valid).
 */
export function stripAnswerValue(structured: FoxyResponse): FoxyResponse {
  return {
    ...structured,
    blocks: structured.blocks.map((b) =>
      b.type === 'answer'
        ? { type: 'answer' as const, text: MATH_CHECK_TOGETHER_TEXT }
        : b,
    ),
  };
}

// ─── Foxy Math Pipeline: orchestrator (Solver -> Verifier -> verdict) ────────
//
// Runs the GENERATION half (solveMath) + VERIFICATION half (verifyMath) and
// applies the assessment display mapping with TIER escalation per CEO decision
// D1: solve at tier 'base' (gpt-4o-mini); on a SymPy verifier mismatch escalate
// to 'escalate' (gpt-4o) and re-verify; if STILL false escalate to 'last'
// (Claude Haiku) and re-verify; if still false/unverifiable strip the answer +
// badge 'check_manually' (P12 fail-closed — never serve a confidently-wrong
// value).
// NEVER throws — on any failure returns null so the route falls back to the
// grounded-answer path (existing turn is preserved). 0 XP, no mastery writes:
// this function only generates + verifies + maps; it does NOT call
// submitQuizResults/atomic_quiz_profile_update and writes to NO mastery table.
export interface MathPipelineResult {
  structured: FoxyResponse;
  badgeState: FoxyMathBadgeState;
  modelUsed: string;
  /** The verifier verdict for the SHOWN answer, for telemetry/audit. */
  verdict: VerifyMathResult;
  /** Whether at least one tier escalation fired this turn. */
  escalated: boolean;
}

export async function runMathSolvePipeline(params: {
  problem: string;
  grade: string;
  classifier: { topic?: string; chapter?: string; difficulty?: string };
  chapter: string | null;
  nextTopic: string | null;
  jwt: string;
  traceId: string;
}): Promise<MathPipelineResult | null> {
  const { problem, grade, classifier, chapter, jwt, traceId } = params;

  // Chapter for the NCERT prompt: prefer the classifier chapter, else the
  // route's chapter param, else the topic. solveMath requires a chapter string
  // (it picks the cached NCERT prompt; a generic grade default is used if no
  // seeded chapter matches), so default to '' which getDefaultMathPrompt
  // handles.
  const solveChapter = classifier.chapter || chapter || classifier.topic || '';

  const { kind, problemExpression } = deriveVerifyKindAndProblem(problem);

  // ── Tier-escalation loop (CEO decision D1) ──────────────────────────────
  // Solve at 'base' (gpt-4o-mini). On a SymPy verifier MISMATCH (is_correct ===
  // false) escalate to 'escalate' (gpt-4o) and re-verify; if STILL false
  // escalate to 'last' (Claude Haiku) and re-verify. Anything OTHER than a hard
  // false (true -> verified; null -> unavailable; no single answer) short-
  // circuits the loop with no escalation. After the last tier, a still-false /
  // unverifiable result is stripped + 'check_manually' (P12 fail-closed).
  const TIERS: CascadeTier[] = ['base', 'escalate', 'last'];

  // The best working we have seen so far (carried forward so a later tier that
  // produces nothing usable still has working to strip on the fail-closed path).
  let bestStructured: FoxyResponse | null = null;
  let bestModelUsed = '';
  // The most recent hard-false verdict — the verdict we report when we exhaust
  // the tiers without a verified answer.
  let lastFalseVerdict: VerifyMathResult | null = null;

  for (let i = 0; i < TIERS.length; i++) {
    const tier = TIERS[i];
    const escalated = i > 0;

    if (escalated) {
      // P13: tier names + reason only, never the problem/answer.
      logger.info('foxy.math.escalate_tier', {
        traceId,
        grade,
        toTier: tier,
        reason: lastFalseVerdict?.reason ?? null,
      });
    }

    const solved = await solveMath({
      problem,
      grade,
      chapter: solveChapter,
      topic: classifier.topic,
      difficulty: classifier.difficulty,
      tier,
    });

    if (!solved.structured) {
      // No usable generation from THIS tier. On the FIRST tier with nothing at
      // all we fall back to the grounded path (P12 — never surface a
      // malformed/invalid solution). On a LATER tier we keep the prior tier's
      // working and continue escalating (we already know that working was wrong).
      if (i === 0) return null;
      continue;
    }

    // Carry forward the most recent usable working for the fail-closed path.
    bestStructured = solved.structured;
    bestModelUsed = solved.modelUsed;

    // Extract the single claimed answer value. Zero-or-multiple answer blocks =>
    // we can't isolate a verifiable claim, so badge 'none', no further
    // escalation, and just show the solver output.
    const claimed = extractSingleAnswerValue(solved.structured);
    if (claimed === null) {
      logger.info('foxy.math.no_single_answer', { traceId, grade });
      return {
        structured: solved.structured,
        badgeState: 'none',
        modelUsed: solved.modelUsed,
        verdict: { is_correct: null, confidence: 0, reason: 'no_single_answer' },
        escalated,
      };
    }

    // ── Verifier (SymPy, fail-soft) ───────────────────────────────────────
    const verdict = await verifyMath(
      { problem_expression: problemExpression, claimed_answer: claimed, kind, grade },
      { jwt },
    );

    // true -> verified (green). Show THIS tier's answer.
    if (verdict.is_correct === true) {
      return {
        structured: solved.structured,
        badgeState: 'verified',
        modelUsed: solved.modelUsed,
        verdict,
        escalated,
      };
    }

    // null -> unavailable (NOT wrong). Show, badge 'none', NO escalation.
    if (verdict.is_correct === null) {
      return {
        structured: solved.structured,
        badgeState: 'none',
        modelUsed: solved.modelUsed,
        verdict,
        escalated,
      };
    }

    // false -> remember the verdict and escalate to the next tier (if any).
    lastFalseVerdict = verdict;
  }

  // ── Fail-closed (P12) ───────────────────────────────────────────────────
  // Every tier produced a confidently-wrong (or unverifiable-after-false)
  // answer. Strip the most careful working's value to the neutral line and badge
  // 'check_manually' — keep the steps visible, never surface the wrong value.
  // bestStructured is non-null here: the i===0 branch above already returns null
  // when the FIRST tier yields nothing, so reaching this point means at least
  // one tier produced usable working.
  if (!bestStructured) return null;
  const stripped = stripAnswerValue(bestStructured);
  const reparsed = FoxyResponseSchema.safeParse(stripped);
  return {
    structured: reparsed.success ? reparsed.data : bestStructured,
    badgeState: 'check_manually',
    modelUsed: bestModelUsed,
    verdict: lastFalseVerdict ?? { is_correct: false, confidence: 0, reason: 'unverified' },
    escalated: true,
  };
}
