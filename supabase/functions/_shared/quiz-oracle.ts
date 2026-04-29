// supabase/functions/_shared/quiz-oracle.ts
//
// Deno mirror of `src/lib/ai/validation/quiz-oracle.ts` (REG-54).
//
// The authoritative source lives in the Next.js tree because that's where
// the unit tests run. Both files MUST stay byte-equivalent in their pure
// logic — only the surrounding imports (none here) and inline grader call
// site differ. If you change one, change both in the same PR.
//
// Cost ceiling per accepted question (worst case): 4 Claude calls
//   1 generator + 1 grader + 1 retry-generator + 1 retry-grader.
// Most accepted questions: 2 Claude calls (1 generator + 1 grader-approves).
//
// Used by:
//   - supabase/functions/quiz-generator/index.ts (runtime adapter — see note)
//   - supabase/functions/bulk-question-gen/index.ts
//
// Note: quiz-generator currently SELECTS from question_bank (no LLM in the
// hot path), so the oracle is a no-op there until quiz-generator is wired
// to a generator path. bulk-question-gen IS the live AI generation path
// and IS wired to call this module.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CandidateQuestion {
  question_text: string;
  options: string[];
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
  suggested_correct_index?: 0 | 1 | 2 | 3;
}

export type LlmGrader = (input: {
  question_text: string;
  options: string[];
  correct_answer_index: number;
  explanation: string;
}) => Promise<LlmGradeResult>;

export type OracleRejectionCategory =
  | 'p6_text_empty_or_placeholder'
  | 'p6_options_not_4'
  | 'p6_options_not_distinct'
  | 'p6_correct_index_out_of_range'
  | 'p6_explanation_empty'
  | 'p6_invalid_difficulty'
  | 'p6_invalid_bloom'
  | 'options_overlap_semantic'
  | 'numeric_inconsistency'
  | 'llm_mismatch'
  | 'llm_ambiguous'
  | 'llm_grader_unavailable';

export interface OracleAcceptResult {
  ok: true;
  llm_calls: number;
}

export interface OracleRejectResult {
  ok: false;
  category: OracleRejectionCategory;
  reason: string;
  suggested_correct_index?: 0 | 1 | 2 | 3;
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

const PLACEHOLDER_RE = /\{\{|\[BLANK\]/i;
const NUMERIC_RE = /-?\d+(?:\.\d+)?/g;

// ─── Deterministic checks ───────────────────────────────────────────────────

export function runDeterministicChecks(
  q: CandidateQuestion,
): OracleRejectResult | null {
  const text = typeof q?.question_text === 'string' ? q.question_text.trim() : '';
  if (!text) return rejectDet('p6_text_empty_or_placeholder', 'question_text is empty');
  if (PLACEHOLDER_RE.test(text)) {
    return rejectDet(
      'p6_text_empty_or_placeholder',
      'question_text contains {{ or [BLANK] placeholder',
    );
  }

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
      return rejectDet('p6_options_not_4', `option at index ${i} is empty or not a string`);
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

  const exp = typeof q?.explanation === 'string' ? q.explanation.trim() : '';
  if (!exp) return rejectDet('p6_explanation_empty', 'explanation is empty');

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

  for (let i = 0; i < 4; i++) {
    for (let j = i + 1; j < 4; j++) {
      const a = cleanOpts[i];
      const b = cleanOpts[j];
      const overlap = jaccardWordOverlap(a, b);
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

  const numericFail = checkNumericConsistency(q.question_text, cleanOpts[idx], exp);
  if (numericFail) return rejectDet('numeric_inconsistency', numericFail);

  return null;
}

function rejectDet(
  category: OracleRejectionCategory,
  reason: string,
): OracleRejectResult {
  return { ok: false, category, reason, llm_calls: 0 };
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

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

export function checkNumericConsistency(
  questionText: string,
  correctOptionText: string,
  explanation: string,
): string | null {
  const optNumbers = extractNumbers(correctOptionText);
  if (optNumbers.length === 0) return null;
  const expNumbers = extractNumbers(explanation);
  if (expNumbers.length === 0) return null;

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
  enableLlmGrader?: boolean;
  llmGrade?: LlmGrader;
}

export async function validateCandidate(
  q: CandidateQuestion,
  opts: ValidateOptions = {},
): Promise<OracleResult> {
  const detFail = runDeterministicChecks(q);
  if (detFail) return detFail;

  if (!opts.enableLlmGrader) {
    return { ok: true, llm_calls: 0 };
  }

  if (typeof opts.llmGrade !== 'function') {
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

  return {
    ok: false,
    category: 'llm_ambiguous',
    reason: graded.reasoning?.slice(0, 300) || 'LLM grader returned ambiguous',
    llm_calls: 1,
  };
}

// ─── LLM-grade response parser ──────────────────────────────────────────────

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

// ─── Cache for identical candidates ─────────────────────────────────────────

/**
 * In-memory cache keyed by hash(question_text + options[]). Avoids re-grading
 * identical candidates across a single Edge Function isolate. Cleared on
 * cold start. Cap at 200 entries (LRU-ish — oldest deleted first).
 */
const oracleCache = new Map<string, OracleResult>();
const ORACLE_CACHE_CAP = 200;

export function makeCandidateCacheKey(q: CandidateQuestion): string {
  // Tiny FNV-1a 32-bit hash — Edge Functions don't have access to crypto.subtle
  // synchronously and we don't need cryptographic security here; identical
  // strings must collide and that's it.
  const s =
    `${q.question_text.trim()}\n` +
    `${q.options.map((o) => o.trim()).join('\n')}\n` +
    `idx=${q.correct_answer_index}\n` +
    `exp=${q.explanation.trim()}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

export function getCachedResult(key: string): OracleResult | undefined {
  return oracleCache.get(key);
}

export function setCachedResult(key: string, result: OracleResult): void {
  if (oracleCache.size >= ORACLE_CACHE_CAP) {
    // Drop the oldest entry. Map preserves insertion order so first-key works.
    const firstKey = oracleCache.keys().next().value;
    if (firstKey !== undefined) oracleCache.delete(firstKey);
  }
  oracleCache.set(key, result);
}

export function clearOracleCache(): void {
  oracleCache.clear();
}
