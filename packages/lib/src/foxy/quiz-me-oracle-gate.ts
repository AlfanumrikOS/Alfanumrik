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

import type { FoxyResponse, FoxyMcqBlock } from '@alfanumrik/lib/foxy/schema';
import { isFoxyMcqBlock } from '@alfanumrik/lib/foxy/schema';
import {
  validateCandidate,
  type CandidateQuestion,
  type LlmGrader,
  type OracleResult,
} from '@alfanumrik/lib/ai/validation/quiz-oracle';

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

// ─── Real practice — multi-MCQ oracle gate (ff_foxy_real_practice_v1) ─────────
//
// BINDING CONTRACT (assessment, P6 + REG-54): every mcq block shown in a
// real-practice turn MUST pass the SAME oracle that gates the single Quiz-me
// mcq — deterministic P6 checks first, then the LLM grader (fails CLOSED on
// grader throw). A failing mcq is DROPPED (never shown). This reuses
// `mcqBlockToCandidate` + `validateCandidate` verbatim (the exact machinery
// gateQuizMeMcq uses), so there is one oracle, not two.
//
// The gate is BOUNDED: it keeps at most `maxKeep` survivors and runs the oracle
// on at most `attemptCap` blocks, so the LLM-grader cost per turn can never
// exceed `attemptCap` calls regardless of how many mcqs the model emits.

/** Default number of oracle-passed mcqs a real-practice turn keeps. */
export const PRACTICE_MCQ_MAX_KEEP = 3;

export interface PracticeMcqRejection {
  /** Position of the dropped mcq among the response's mcq blocks. */
  index: number;
  reason: OracleResultRejectCategory;
  detail: string;
}

export interface PracticeGateResult {
  /** Oracle-passed mcq blocks in original order, capped at `maxKeep`. */
  kept: FoxyMcqBlock[];
  /** Total mcq blocks the model emitted. */
  totalMcqs: number;
  /** How many mcq blocks were actually run through the oracle (<= attemptCap). */
  gated: number;
  /** Dropped mcqs with their reject reason. */
  rejections: PracticeMcqRejection[];
  /** Total LLM-grader calls made across all gated mcqs. */
  llm_calls: number;
}

/**
 * Oracle-gate EVERY mcq block in a real-practice FoxyResponse. Keeps only the
 * mcqs that pass (deterministic P6 + REG-54 LLM grader); drops the rest. Never
 * throws for a per-mcq oracle rejection — a rejected mcq is simply omitted from
 * `kept`. The LLM grader still fails CLOSED per mcq (a grader throw drops THAT
 * mcq, it does not abort the batch), so an unaudited mcq is never kept (P12).
 *
 * `subject` is accepted for call-site symmetry/logging only; it is NOT forwarded
 * to the oracle candidate (see mcqBlockToCandidate for why).
 */
export async function gatePracticeMcqs(
  response: FoxyResponse,
  opts: {
    grade?: string;
    subject?: string;
    enableLlmGrader: boolean;
    llmGrade?: LlmGrader;
    /** Max survivors to keep (stop gating once reached). Default PRACTICE_MCQ_MAX_KEEP. */
    maxKeep?: number;
    /** Max mcqs to run through the oracle (bounds LLM cost). Default maxKeep + 2. */
    attemptCap?: number;
  },
): Promise<PracticeGateResult> {
  void opts.subject; // not forwarded — see mcqBlockToCandidate doc
  const maxKeep = Math.max(1, opts.maxKeep ?? PRACTICE_MCQ_MAX_KEEP);
  const attemptCap = Math.max(maxKeep, opts.attemptCap ?? maxKeep + 2);

  const mcqs = response.blocks.filter(isFoxyMcqBlock);
  const kept: FoxyMcqBlock[] = [];
  const rejections: PracticeMcqRejection[] = [];
  let llmCalls = 0;
  let gated = 0;

  for (let i = 0; i < mcqs.length; i++) {
    if (kept.length >= maxKeep) break;
    if (gated >= attemptCap) break;
    gated += 1;

    const candidate = mcqBlockToCandidate(mcqs[i], { grade: opts.grade });
    const result = await validateCandidate(candidate, {
      enableLlmGrader: opts.enableLlmGrader,
      llmGrade: opts.llmGrade,
    });
    llmCalls += result.llm_calls;

    if (result.ok) {
      kept.push(mcqs[i]);
    } else {
      rejections.push({ index: i, reason: result.category, detail: result.reason });
    }
  }

  return { kept, totalMcqs: mcqs.length, gated, rejections, llm_calls: llmCalls };
}

/**
 * ANTI-FAKE GUARDRAIL (BINDING CONTRACT): a real-practice assistant turn may
 * contain ONLY oracle-passed mcq blocks. This rebuilds the response so ANY prose
 * the model emitted (e.g. an "I generated 5 questions!" paragraph) is STRIPPED —
 * a turn can never CLAIM a quiz it did not actually produce as real, gated mcq
 * blocks. The route calls this with the survivors from `gatePracticeMcqs`.
 *
 * Returns null when `kept` is empty; the caller MUST then serve the graceful
 * bilingual fallback (never an empty or claim-only turn). Otherwise returns a
 * FoxyResponse whose blocks are EXACTLY the kept mcq blocks (title/subject
 * preserved). The kept blocks are a validated subset of the already
 * schema-validated input, so the result round-trips FoxyResponseSchema.
 */
export function buildGatedPracticeResponse(
  original: FoxyResponse,
  kept: FoxyMcqBlock[],
): FoxyResponse | null {
  if (kept.length === 0) return null;
  return {
    title: original.title,
    subject: original.subject,
    blocks: kept.map((m) => ({
      type: 'mcq' as const,
      stem: m.stem,
      options: [...m.options],
      correct_answer_index: m.correct_answer_index,
      explanation: m.explanation,
      ...(m.bloom_level ? { bloom_level: m.bloom_level } : {}),
      ...(m.difficulty ? { difficulty: m.difficulty } : {}),
      ...(m.label ? { label: m.label } : {}),
    })),
  };
}
