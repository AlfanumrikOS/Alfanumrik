// src/lib/foxy/quiz-me-oracle-gate.ts
//
// Boundary oracle gate for the Foxy post-answer "Quiz me on this" inline MCQ
// (Phase 1 learning actions).
//
// BINDING CONTRACT (assessment): an inline "Quiz me" MCQ MUST pass the P6
// quality oracle AND the same generator-validation oracle that gates
// `question_bank` inserts (REG-54) BEFORE it is shown. A failing MCQ must NOT
// be shown.
//
// This module is the single place that:
//   1. Locates the single `mcq` block inside an already-schema-validated
//      FoxyResponse (the structured payload from grounded-answer).
//   2. Maps it to the oracle's `CandidateQuestion` shape.
//   3. Runs `validateCandidate` (REG-54) — deterministic P6 checks first, then
//      the LLM grader (Claude) when a grader is supplied.
//   4. Returns a decision the route uses to either ship the mcq or fall back
//      to a graceful, non-broken response.
//
// Owner: ai-engineer. Reviewed by: assessment (oracle correctness), testing.
//
// P12: never lowers the validation bar. On grader unavailability/throw the
// oracle fails CLOSED (rejects), so an unaudited MCQ is never shown.

import type { FoxyResponse, FoxyMcqBlock } from '@/lib/foxy/schema';
import { isFoxyMcqBlock } from '@/lib/foxy/schema';
import {
  validateCandidate,
  type CandidateQuestion,
  type LlmGrader,
  type OracleResult,
} from '@/lib/ai/validation/quiz-oracle';

/** Difficulty enum the oracle accepts (lowercase). Foxy mcq uses easy|medium|hard. */
function normalizeDifficulty(d: string | undefined): string | undefined {
  if (typeof d !== 'string') return undefined;
  const lower = d.toLowerCase();
  return lower === 'easy' || lower === 'medium' || lower === 'hard' ? lower : undefined;
}

/** Bloom enum the oracle accepts (lowercase). Foxy mcq uses Title-case Bloom. */
function normalizeBloom(b: string | undefined): string | undefined {
  if (typeof b !== 'string') return undefined;
  return b.toLowerCase();
}

/**
 * Map a FoxyMcqBlock to the oracle's CandidateQuestion. The oracle speaks the
 * `question_bank` vocabulary (question_text + options + correct_answer_index +
 * explanation), which is exactly the four P6 fields the mcq block carries.
 *
 * `grade` is forwarded when known (clean P5 string "6".."12"). `subject` is
 * intentionally NOT forwarded: the oracle's optional subject check uses a fixed
 * CBSE allowlist, but the Foxy route receives free-form subject codes (e.g.
 * "sst", "social_science") that are not in that allowlist — forwarding them
 * would cause a FALSE 'invalid_subject' rejection of an otherwise-valid MCQ.
 * The MCQ's curriculum scope is already constrained by the RAG context + the
 * grade/chapter-scoped prompt, so the subject-drift check adds no safety here.
 */
export function mcqBlockToCandidate(
  mcq: FoxyMcqBlock,
  ctx: { grade?: string } = {},
): CandidateQuestion {
  return {
    question_text: mcq.stem,
    options: [...mcq.options],
    correct_answer_index: mcq.correct_answer_index,
    explanation: mcq.explanation,
    ...(normalizeDifficulty(mcq.difficulty) ? { difficulty: normalizeDifficulty(mcq.difficulty) } : {}),
    ...(normalizeBloom(mcq.bloom_level) ? { bloom_level: normalizeBloom(mcq.bloom_level) } : {}),
    ...(ctx.grade ? { grade: ctx.grade } : {}),
  };
}

export type QuizMeGateResult =
  | { ok: true; mcq: FoxyMcqBlock; llm_calls: number }
  | {
      ok: false;
      reason:
        | 'no_mcq_block'
        | 'multiple_mcq_blocks'
        | OracleResultRejectCategory;
      detail: string;
      llm_calls: number;
    };

// Re-exported reject categories from the oracle (narrowed string for typing).
type OracleResultRejectCategory = Extract<OracleResult, { ok: false }>['category'];

/**
 * Locate the single mcq block in a FoxyResponse. The "Quiz me" directive asks
 * the model for EXACTLY one mcq block; we enforce that here so a malformed
 * multi-mcq payload is treated as a failure (fall back to a normal answer)
 * rather than silently showing the first.
 */
export function findSingleMcqBlock(
  response: FoxyResponse,
): { ok: true; mcq: FoxyMcqBlock } | { ok: false; reason: 'no_mcq_block' | 'multiple_mcq_blocks' } {
  const mcqs = response.blocks.filter(isFoxyMcqBlock);
  if (mcqs.length === 0) return { ok: false, reason: 'no_mcq_block' };
  if (mcqs.length > 1) return { ok: false, reason: 'multiple_mcq_blocks' };
  return { ok: true, mcq: mcqs[0] };
}

/**
 * Gate the inline "Quiz me" MCQ through the REG-54 oracle.
 *
 * - Deterministic P6 checks always run.
 * - The LLM grader runs only when `llmGrade` is supplied (the route supplies a
 *   Claude-backed grader). When omitted (tests / deterministic-only mode) the
 *   gate runs deterministic-only — callers that need the full REG-54 contract
 *   MUST supply the grader.
 *
 * Returns ok:true with the validated mcq when it passes, or ok:false with a
 * machine-readable reason when it fails. The route NEVER shows a failing mcq —
 * it strips the mcq and serves a graceful "let me try a different question"
 * fallback instead (P12: no broken MCQ to students).
 */
export async function gateQuizMeMcq(
  response: FoxyResponse,
  opts: {
    grade?: string;
    /**
     * Accepted for call-site symmetry/logging only; NOT forwarded to the oracle
     * candidate. See mcqBlockToCandidate for why subject is not oracle-checked.
     */
    subject?: string;
    enableLlmGrader: boolean;
    llmGrade?: LlmGrader;
  },
): Promise<QuizMeGateResult> {
  void opts.subject; // not forwarded — see mcqBlockToCandidate doc
  const found = findSingleMcqBlock(response);
  if (!found.ok) {
    return {
      ok: false,
      reason: found.reason,
      detail:
        found.reason === 'no_mcq_block'
          ? 'Quiz-me response contained no mcq block'
          : 'Quiz-me response contained more than one mcq block',
      llm_calls: 0,
    };
  }

  const candidate = mcqBlockToCandidate(found.mcq, {
    grade: opts.grade,
  });

  const result = await validateCandidate(candidate, {
    enableLlmGrader: opts.enableLlmGrader,
    llmGrade: opts.llmGrade,
  });

  if (result.ok) {
    return { ok: true, mcq: found.mcq, llm_calls: result.llm_calls };
  }

  return {
    ok: false,
    reason: result.category,
    detail: result.reason,
    llm_calls: result.llm_calls,
  };
}
