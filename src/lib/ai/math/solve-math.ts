/**
 * ALFANUMRIK — Foxy 3-Agent Math Pipeline: SOLVER (generation half).
 *
 * Part 1B (SOLVER). Generates a step-verified math solution as a strict
 * FoxyResponse, using:
 *   - the cached per-(grade, chapter) NCERT system prompt
 *     (`getNcertSystemPrompt`) as a single cached system block, and
 *   - a chain-of-thought (CoT) user instruction (NO Extended Thinking, NO
 *     `thinking: {}` — strong CoT), routed through the reasoning cascade whose
 *     tier is chosen by the caller (`tier`: 'base' | 'escalate' | 'last').
 *
 * NO RAG: NCERT method-fidelity comes from the cached system prompt + CoT, not
 * retrieval. The route owns RAG for the non-math grounded path; this module
 * never retrieves.
 *
 * This module routes through the reasoning cascade
 * (`src/lib/ai/clients/reasoning-cascade.ts` -> callReasoningModel) which fans
 * the call across gpt-4o-mini (base) → gpt-4o (escalate) → Claude Haiku (last)
 * with AVAILABILITY fallback between providers. The QUALITY escalation (re-solve
 * at a higher tier after a SymPy verifier mismatch) is owned by the pipeline,
 * which calls back in at a higher `startTier`.
 *
 * Output is parsed + validated through FoxyResponseSchema (mirroring the
 * route's `extractValidatedStructured` discipline) and mechanically normalised
 * (delimiter canonicalisation) before being returned. On ANY failure the
 * `structured` field is null so the route can fall back to the legacy grounded
 * path — P12: a malformed/invalid solution is NEVER surfaced as structured.
 *
 * The route (backend-owned) wires this in behind `ff_foxy_math_pipeline_v1`.
 * When the flag is OFF, the route never calls `solveMath`, so this module is
 * inert and existing behavior is byte-identical.
 *
 * Owner: ai-engineer. Review: assessment (math-correctness semantics, NCERT
 * method fidelity, P6/P2). No DOM imports — server-side only.
 */

import {
  callReasoningModel,
  type CascadeTier,
} from '@/lib/ai/clients/reasoning-cascade';
import {
  FoxyResponseSchema,
  validateSubjectRules,
  type FoxyResponse,
} from '@/lib/foxy/schema';
import { normalizeFoxyResponseInline } from '@/lib/foxy/normalize-inline';
import { recoverFoxyResponseFromText } from '@/lib/foxy/recover-from-text';
import { getNcertSystemPrompt } from '@/lib/math/ncert-prompts';
import { logger } from '@/lib/logger';

// The solver does NOT pick a model name directly anymore — it picks a CASCADE
// TIER and hands it to callReasoningModel as the `startTier`. The cascade maps
// 'base' -> gpt-4o-mini, 'escalate' -> gpt-4o, 'last' -> Claude Haiku, and
// applies cross-provider AVAILABILITY fallback. The QUALITY escalation (re-solve
// at a higher tier after a verifier mismatch) is the pipeline's job, expressed
// by calling solveMath again with a higher `tier`.

// Math solutions are short but multi-block; allow headroom for the working +
// self-check-driven structure without inviting runaway prose.
const SOLVE_MAX_TOKENS = 1400;

// Factual / deterministic generation — keep temperature low to suppress
// hallucinated arithmetic. The route may NOT raise this above 0.7 for factual
// answers (P12 rejection condition); math is maximally factual.
const SOLVE_TEMPERATURE = 0.2;

const SOLVE_TIMEOUT_MS = 30_000;

export interface SolveMathInput {
  /** The concrete problem to solve (the student's math-solve query). */
  problem: string;
  /** CBSE grade as a string ("6".."12") — P5. */
  grade: string;
  /** Chapter name/number (classifier output). Used to pick the NCERT prompt. */
  chapter: string;
  /** Optional finer-grained topic (classifier output). Tried before chapter. */
  topic?: string;
  /** Optional difficulty hint (classifier output): 'easy' | 'medium' | 'hard'. */
  difficulty?: string;
  /**
   * Reasoning-cascade START tier. 'base' = gpt-4o-mini (default real-time
   * tier); 'escalate' = gpt-4o; 'last' = Claude Haiku. The PIPELINE decides when
   * to escalate (e.g. after a SymPy verifier mismatch) and re-calls solveMath
   * with the next tier. From the chosen start tier the cascade still applies
   * cross-provider AVAILABILITY fallback toward 'last'.
   */
  tier: CascadeTier;
}

export interface SolveMathResult {
  /**
   * The validated FoxyResponse, or null when generation/validation failed.
   * Null is the explicit "fall back to the grounded path" signal for the
   * route. NEVER a malformed payload (P12).
   */
  structured: FoxyResponse | null;
  /**
   * The raw model text (post-CoT, JSON). Always populated when a model
   * responded — the route can persist this in `content` even when structured
   * validation failed, mirroring the legacy `response`-string contract.
   */
  rawText: string;
  /** The model that produced the response (or '' if no model responded). */
  modelUsed: string;
}

/**
 * The CoT user instruction. Asks the model to reason through the problem and
 * SELF-CHECK internally, then emit ONLY the structured FoxyResponse JSON. The
 * chain-of-thought is internal (never emitted as blocks); the cached system
 * prompt already specifies the block contract + delimiters + the one-terminal-
 * answer rule. We restate the self-check + machine-extractable-answer
 * requirement here because the user turn is the part the model attends to most
 * strongly for THIS specific problem.
 */
function buildCoTUserMessage(input: SolveMathInput): string {
  const diff = input.difficulty ? `\nDifficulty: ${input.difficulty}.` : '';
  const topicLine = input.topic ? `\nTopic: ${input.topic}.` : '';
  return `Solve this Class ${input.grade} problem, the NCERT way.${topicLine}${diff}

PROBLEM:
${input.problem}

Think step by step BEFORE answering (this reasoning is private — do not put it in any block):
1. Restate what is asked and identify the single value/result to find.
2. Name the NCERT method/theorem/formula to use.
3. Work it through one operation at a time.
4. SELF-CHECK: substitute the result back into the original problem (or apply a sanity check) and confirm it is consistent. If it fails, redo the working.

Then output ONLY the FoxyResponse JSON described in the system prompt:
- state the method first,
- numbered "step" blocks (one operation each) with "math" blocks for formulas,
- EXACTLY ONE terminal "answer" block whose final value is machine-extractable (a bare number, \\( \\frac{a}{b} \\) or a/b, a simplified expression, or "x = p or x = q"),
- end with ONE Socratic "question" block.
Return the JSON object and nothing else.`;
}

/**
 * Try to recover a validated FoxyResponse from the model's raw text. Mirrors
 * the route's `extractValidatedStructured` order of operations:
 *   1. parse the whole text as JSON and validate against FoxyResponseSchema;
 *   2. else recover an inline FoxyResponse from text (handles ```json fences /
 *      leading prose) via recoverFoxyResponseFromText;
 *   3. normalise delimiters and re-validate; if normalisation ever breaks
 *      validity (it only shrinks/holds), keep the pre-normalisation valid one.
 * Returns null when nothing validates — P12: never lower the bar.
 */
function validateAndNormalize(rawText: string): FoxyResponse | null {
  const normalizeAndRevalidate = (valid: FoxyResponse): FoxyResponse => {
    const normalized = normalizeFoxyResponseInline(valid);
    const reparsed = FoxyResponseSchema.safeParse(normalized);
    return reparsed.success ? reparsed.data : valid;
  };

  // 1. Direct JSON parse + schema validate.
  let direct: unknown;
  try {
    direct = JSON.parse(rawText);
  } catch {
    direct = undefined;
  }
  if (direct !== undefined) {
    const parsed = FoxyResponseSchema.safeParse(direct);
    if (parsed.success) return normalizeAndRevalidate(parsed.data);
  }

  // 2. Inline recovery (fences / leading prose / trailing commentary).
  const recovered = recoverFoxyResponseFromText(rawText);
  if (recovered) return normalizeAndRevalidate(recovered);

  return null;
}

/**
 * Generate a structured math solution for ONE concrete problem.
 *
 * NEVER throws — all failure modes (API error, circuit breaker open, malformed
 * output, subject-rule violation) resolve to `{ structured: null, ... }` so
 * the route can fall back to the grounded path.
 */
export async function solveMath(input: SolveMathInput): Promise<SolveMathResult> {
  const systemPrompt = getNcertSystemPrompt(input.grade, input.chapter, input.topic);
  const userMessage = buildCoTUserMessage(input);

  let rawText = '';
  let modelUsed = '';

  try {
    const response = await callReasoningModel(
      {
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: SOLVE_MAX_TOKENS,
        temperature: SOLVE_TEMPERATURE,
        timeoutMs: SOLVE_TIMEOUT_MS,
        // Math solver emits a strict FoxyResponse JSON object.
        jsonMode: true,
      },
      { startTier: input.tier },
    );
    rawText = response.content ?? '';
    modelUsed = response.model;
  } catch (err) {
    // callReasoningModel throws only when EVERY tier from the start tier failed
    // (cross-provider outage / circuit-breaker-open on the Haiku last resort).
    // P12: a generation failure is a clean fall-back, never a thrown route.
    logger.warn('foxy.math.solve_failed', {
      grade: input.grade,
      tier: input.tier,
      reason: err instanceof Error ? err.message.slice(0, 120) : 'unknown',
    });
    return { structured: null, rawText: '', modelUsed: '' };
  }

  if (!rawText.trim()) {
    return { structured: null, rawText: '', modelUsed };
  }

  const validated = validateAndNormalize(rawText);
  if (!validated) {
    logger.warn('foxy.math.solve_unvalidated', {
      grade: input.grade,
      tier: input.tier,
      // raw length only — never the content (could echo the problem; non-PII
      // but kept minimal for log hygiene).
      rawLen: rawText.length,
    });
    return { structured: null, rawText, modelUsed };
  }

  // Subject-rule gate (P6/P12): a math solution that violates the subject
  // rules (e.g. claims subject "math" but emits no math block — handled as a
  // warning, not a reject by validateSubjectRules) is downgraded to a null
  // structured only on a HARD reject. Math's rule only WARNS on missing math
  // blocks, so this is effectively a no-op for math but keeps the contract
  // explicit if a future seed mislabels subject.
  const subjectCheck = validateSubjectRules(validated);
  if (!subjectCheck.ok) {
    logger.warn('foxy.math.solve_subject_reject', {
      grade: input.grade,
      reason: subjectCheck.reason,
    });
    return { structured: null, rawText, modelUsed };
  }

  return { structured: validated, rawText, modelUsed };
}
