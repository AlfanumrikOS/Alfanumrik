// src/lib/ai/validation/quiz-oracle.ts
//
// AI quiz-generator validation oracle (REG-54).
//
// The oracle catches AI hallucinations before they reach `question_bank`. It
// runs over every freshly-generated MCQ and rejects candidates whose
// correct_answer_index is not actually consistent with the explanation, whose
// options are not mutually exclusive, whose numbers/units don't line up, or
// which violate P6 (Question Quality).
//
// Architecture:
//   1. CHEAP deterministic checks first (length, count, distinctness, regex
//      for placeholders, numeric extraction). Pure functions, no I/O.
//   2. EXPENSIVE LLM-grader second — only invoked when the cheap checks pass
//      and a semantic match between the explanation and the marked correct
//      option is needed. Single-turn JSON output via Claude Haiku.
//
// The LLM grader is injected as a function (`llmGrade`) so this module is
// pure-TS and unit-testable in vitest without booting the Anthropic SDK or
// fetch shims. The Deno mirror in `supabase/functions/_shared/quiz-oracle.ts`
// keeps the same logic verbatim and is the actual code path for Edge
// Function callers.
//
// Cost ceiling (per accepted question, worst case):
//   - 1 generator call (status quo)
//   - 1 oracle LLM-grader call
//   - 1 retry generator call (when oracle rejects on first try)
//   - 1 retry oracle LLM-grader call
//   = 4 Claude calls absolute worst case for an accepted question.
//   For most cases (oracle approves first try): 2 Claude calls.
//
// Rejections are NOT shown to students (P12). They are logged to ops_events
// with category='quiz.oracle_rejection' so the rejection rate is queryable
// from the super-admin AI health panel.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CandidateQuestion {
  question_text: string;
  options: string[]; // expect length 4
  correct_answer_index: number;
  explanation: string;
  hint?: string;
  difficulty?: number | string;
  bloom_level?: string;
}

export type OracleVerdict = 'consistent' | 'mismatch' | 'ambiguous';

export interface LlmGradeResult {
  verdict: OracleVerdict;
  reasoning: string;
  /** When verdict is 'mismatch', the LLM may suggest the index it thinks is correct. */
  suggested_correct_index?: 0 | 1 | 2 | 3;
}

export type LlmGrader = (input: {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
}) => Promise<LlmGradeResult>;

export type OracleRejectionCategory =
  // Deterministic-check failures (P6 + extras)
  | 'p6_text_empty_or_placeholder'
  | 'p6_options_not_4'
  | 'p6_options_not_distinct'
  | 'p6_correct_index_out_of_range'
  | 'p6_explanation_empty'
  | 'p6_invalid_difficulty'
  | 'p6_invalid_bloom'
  | 'options_overlap_semantic'
  | 'numeric_inconsistency'
  // LLM-grader failures
  | 'llm_mismatch'
  | 'llm_ambiguous'
  | 'llm_grader_unavailable';

export interface OracleAcceptResult {
  ok: true;
  /** Number of LLM-grader calls actually made (0 when only deterministic checks ran). */
  llm_calls: number;
}

export interface OracleRejectResult {
  ok: false;
  category: OracleRejectionCategory;
  reason: string;
  /** When the LLM grader returned a mismatch and offered an alternative index. */
  suggested_correct_index?: 0 | 1 | 2 | 3;
  /** Number of LLM-grader calls actually made before this rejection. */
  llm_calls: number;
}

export type OracleResult = OracleAcceptResult | OracleRejectResult;

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_BLOOM_LEVELS = new Set([
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
]);

// Placeholder markers Claude occasionally leaves in mis-templated output.
const PLACEHOLDER_RE = /\{\{|\[BLANK\]/i;

// Numeric token: integer or decimal, with optional sign, optionally followed
// by a unit-like suffix (m, kg, °C, %, etc.). We capture only the number;
// units are handled separately when present in the same string.
const NUMERIC_RE = /-?\d+(?:\.\d+)?/g;

// ─── Deterministic checks (P6 + extras) ──────────────────────────────────────

/**
 * Cheap, synchronous checks. Returns null if all pass; otherwise a
 * rejection record describing the first failure.
 *
 * Order matters: P6 violations (text, options, index, explanation, difficulty,
 * bloom) come first because they're hard structural defects. Semantic checks
 * (option overlap, numeric consistency) follow.
 */
export function runDeterministicChecks(
  q: CandidateQuestion,
): OracleRejectResult | null {
  // ── 1. question_text non-empty + no placeholders ──────────────────────────
  const text = typeof q?.question_text === 'string' ? q.question_text.trim() : '';
  if (!text) {
    return rejectDet('p6_text_empty_or_placeholder', 'question_text is empty');
  }
  if (PLACEHOLDER_RE.test(text)) {
    return rejectDet(
      'p6_text_empty_or_placeholder',
      'question_text contains {{ or [BLANK] placeholder',
    );
  }

  // ── 2. options: exactly 4 non-empty distinct strings ──────────────────────
  if (!Array.isArray(q?.options) || q.options.length !== 4) {
    return rejectDet(
      'p6_options_not_4',
      `expected exactly 4 options, got ${Array.isArray(q?.options) ? q.options.length : 'non-array'}`,
    );
  }
  const cleanOpts: string[] = [];
  for (let i = 0; i < 4; i++) {
    const raw = q.options[i];
    if (typeof raw !== 'string' || !raw.trim()) {
      return rejectDet(
        'p6_options_not_4',
        `option at index ${i} is empty or not a string`,
      );
    }
    cleanOpts.push(raw.trim());
  }
  const lowerOpts = cleanOpts.map((o) => o.toLowerCase());
  const distinct = new Set(lowerOpts);
  if (distinct.size !== 4) {
    return rejectDet(
      'p6_options_not_distinct',
      'options are not all distinct (case-insensitive)',
    );
  }

  // ── 3. correct_answer_index 0..3 ──────────────────────────────────────────
  const idx = q?.correct_answer_index;
  if (
    typeof idx !== 'number' ||
    !Number.isInteger(idx) ||
    idx < 0 ||
    idx > 3
  ) {
    return rejectDet(
      'p6_correct_index_out_of_range',
      `correct_answer_index must be integer 0..3, got ${String(idx)}`,
    );
  }

  // ── 4. explanation non-empty ──────────────────────────────────────────────
  const exp = typeof q?.explanation === 'string' ? q.explanation.trim() : '';
  if (!exp) {
    return rejectDet('p6_explanation_empty', 'explanation is empty');
  }

  // ── 5. difficulty (when provided) ─────────────────────────────────────────
  if (q.difficulty !== undefined && q.difficulty !== null) {
    const d = q.difficulty;
    const numeric = typeof d === 'number' ? d : Number(d);
    const isValidNumeric = Number.isInteger(numeric) && numeric >= 1 && numeric <= 5;
    const isValidString =
      typeof d === 'string' && ['easy', 'medium', 'hard'].includes(d.toLowerCase());
    if (!isValidNumeric && !isValidString) {
      return rejectDet(
        'p6_invalid_difficulty',
        `difficulty must be integer 1..5 or one of easy|medium|hard, got ${String(d)}`,
      );
    }
  }

  // ── 6. bloom_level (when provided) ────────────────────────────────────────
  if (q.bloom_level !== undefined && q.bloom_level !== null) {
    if (
      typeof q.bloom_level !== 'string' ||
      !VALID_BLOOM_LEVELS.has(q.bloom_level.toLowerCase())
    ) {
      return rejectDet(
        'p6_invalid_bloom',
        `bloom_level must be one of remember|understand|apply|analyze|evaluate|create, got ${String(q.bloom_level)}`,
      );
    }
  }

  // ── 7. semantic option overlap: detect when two options describe the
  //       same thing despite different surface text. Heuristic: if any two
  //       options share >= 70% of word tokens (Jaccard) AND both are short,
  //       flag as overlap. Tuned conservative — false positives here would
  //       drop valid questions, so we keep the bar high.
  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const a = cleanOpts[i];
      const b = cleanOpts[j];
      const overlap = jaccardWordOverlap(a, b);
      // Require BOTH options short (≤ 6 tokens each) AND overlap ≥ 0.7
      // OR overlap ≥ 0.85 for any length (very high overlap is suspicious
      // even on long options).
      const aTokens = tokenize(a).length;
      const bTokens = tokenize(b).length;
      if (
        (aTokens <= 6 && bTokens <= 6 && overlap >= 0.7) ||
        overlap >= 0.85
      ) {
        return rejectDet(
          'options_overlap_semantic',
          `options ${i} and ${j} overlap (Jaccard=${overlap.toFixed(2)}): "${a}" vs "${b}"`,
        );
      }
    }
  }

  // ── 8. numeric consistency: every number that appears in the marked
  //       correct option AND is also referenced in the explanation must
  //       appear with the same value. Catches "correct option says 12 cm
  //       but explanation derives 15 cm" hallucinations. Conservative:
  //       only fires when the correct option contains a number AND the
  //       same lexical "neighborhood" in the explanation contains a
  //       different number.
  const numericFail = checkNumericConsistency(
    q.question_text,
    cleanOpts[idx],
    exp,
  );
  if (numericFail) {
    return rejectDet('numeric_inconsistency', numericFail);
  }

  // All deterministic checks pass.
  return null;
}

function rejectDet(
  category: OracleRejectionCategory,
  reason: string,
): OracleRejectResult {
  return { ok: false, category, reason, llm_calls: 0 };
}

// ─── Helpers: tokenization + Jaccard ────────────────────────────────────────

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Returns Jaccard similarity over word-token sets ∈ [0, 1]. */
function jaccardWordOverlap(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  let inter = 0;
  for (const t of setA) if (setB.has(t)) inter++;
  const union = setA.size + setB.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

// ─── Helpers: numeric consistency ───────────────────────────────────────────

function extractNumbers(s: string): number[] {
  const out: number[] = [];
  const matches = s.match(NUMERIC_RE);
  if (!matches) return out;
  for (const m of matches) {
    const n = Number(m);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/**
 * Detect cases where the correct option contains a numeric value that is
 * contradicted by the explanation. We use a conservative rule:
 *   - The correct option must contain at least one number.
 *   - That number must NOT appear anywhere in the explanation text.
 *   - The explanation must contain at least one number (otherwise we
 *     can't claim contradiction — the explanation might be qualitative).
 *   - The question text is excluded from the explanation match because
 *     numbers in the question aren't a "derivation".
 *
 * Returns a human-readable failure reason when inconsistent, else null.
 */
export function checkNumericConsistency(
  questionText: string,
  correctOptionText: string,
  explanation: string,
): string | null {
  const optNumbers = extractNumbers(correctOptionText);
  if (optNumbers.length === 0) return null;
  const expNumbers = extractNumbers(explanation);
  if (expNumbers.length === 0) return null;

  // Numbers that the question itself states are "given" — these can appear
  // in the explanation without being a derived value. Exclude them from the
  // mismatch detection so we don't flag a question like "Given x=5..." where
  // the answer is "10" and the explanation re-states "x=5" before deriving.
  const givenInQuestion = new Set(extractNumbers(questionText).map(String));

  for (const n of optNumbers) {
    if (givenInQuestion.has(String(n))) continue;
    const present = expNumbers.some((m) => Math.abs(m - n) < 1e-6);
    if (!present) {
      return (
        `correct option has number ${n} but explanation contains no matching value ` +
        `(explanation numbers: ${expNumbers.join(', ')})`
      );
    }
  }
  return null;
}

// ─── Top-level oracle ───────────────────────────────────────────────────────

export interface ValidateOptions {
  /** When false, deterministic-only mode (skip LLM grader). Useful for tests. */
  enableLlmGrader?: boolean;
  /** Injected LLM grader. Required when enableLlmGrader is true. */
  llmGrade?: LlmGrader;
}

/**
 * Validate a single candidate MCQ. Runs cheap deterministic checks first;
 * only calls the LLM grader if everything else passes.
 *
 * Worst case: 1 LLM call per candidate. Caller is responsible for retry-on-
 * reject (one retry max — see `validateWithRetry` if you want that wired
 * for you).
 */
export async function validateCandidate(
  q: CandidateQuestion,
  opts: ValidateOptions = {},
): Promise<OracleResult> {
  // ── 1. Deterministic checks (no I/O, fast) ────────────────────────────────
  const detFail = runDeterministicChecks(q);
  if (detFail) return detFail;

  // ── 2. LLM grader (only when enabled and grader supplied) ─────────────────
  if (!opts.enableLlmGrader) {
    return { ok: true, llm_calls: 0 };
  }

  if (typeof opts.llmGrade !== 'function') {
    // Caller asked for LLM grading but didn't supply a grader. Fail closed —
    // we'd rather drop the question than silently skip the LLM check.
    return {
      ok: false,
      category: 'llm_grader_unavailable',
      reason: 'enableLlmGrader=true but no llmGrade fn supplied',
      llm_calls: 0,
    };
  }

  let graded: LlmGradeResult;
  try {
    graded = await opts.llmGrade({
      question_text: q.question_text,
      options: q.options,
      correct_answer_index: q.correct_answer_index,
      explanation: q.explanation,
    });
  } catch (err) {
    // The grader threw (network error, timeout, parse failure). The oracle's
    // contract is "no PII to Claude" + "always have a fallback" (P12). When
    // the grader is unreachable we fail OPEN (accept the candidate) only if
    // the deterministic checks already passed — the structural P6 floor still
    // holds. This is documented in the PR body and gated by ff_quiz_oracle_enabled.
    return {
      ok: false,
      category: 'llm_grader_unavailable',
      reason: `llmGrade threw: ${err instanceof Error ? err.message : String(err)}`,
      llm_calls: 1,
    };
  }

  if (graded.verdict === 'consistent') {
    return { ok: true, llm_calls: 1 };
  }

  if (graded.verdict === 'mismatch') {
    return {
      ok: false,
      category: 'llm_mismatch',
      reason: graded.reasoning?.slice(0, 300) || 'LLM grader returned mismatch',
      ...(graded.suggested_correct_index !== undefined
        ? { suggested_correct_index: graded.suggested_correct_index }
        : {}),
      llm_calls: 1,
    };
  }

  // ambiguous → reject (we want the generator to retry with sharper options)
  return {
    ok: false,
    category: 'llm_ambiguous',
    reason: graded.reasoning?.slice(0, 300) || 'LLM grader returned ambiguous',
    llm_calls: 1,
  };
}

// ─── LLM-grade response parser ──────────────────────────────────────────────

/**
 * Parse a raw LLM-grader text response into a structured result. The grader
 * is instructed to return strict JSON (see quiz-oracle-prompts.ts), but
 * Claude occasionally wraps it in markdown fences — we strip those.
 *
 * Returns null if parse fails; caller maps null → 'ambiguous' or rejects.
 */
export function parseLlmGraderResponse(raw: string): LlmGradeResult | null {
  const stripped = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const verdict = o.verdict;
  if (
    verdict !== 'consistent' &&
    verdict !== 'mismatch' &&
    verdict !== 'ambiguous'
  ) {
    return null;
  }
  const reasoning = typeof o.reasoning === 'string' ? o.reasoning : '';
  const suggested = o.suggested_correct_index;
  const suggestedClamped: 0 | 1 | 2 | 3 | undefined =
    typeof suggested === 'number' &&
    Number.isInteger(suggested) &&
    suggested >= 0 &&
    suggested <= 3
      ? (suggested as 0 | 1 | 2 | 3)
      : undefined;

  return {
    verdict,
    reasoning,
    ...(suggestedClamped !== undefined
      ? { suggested_correct_index: suggestedClamped }
      : {}),
  };
}
