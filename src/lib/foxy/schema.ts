/**
 * ALFANUMRIK -- Foxy AI Tutor: Canonical Structured-Response Schema
 *
 * Migrates Foxy from raw markdown/text output to a strict JSON block structure.
 *
 * Why:
 *   1. Consistency across subjects (Math, Science, SST, English).
 *   2. Safe rendering (no markdown injection / mismatched LaTeX delimiters).
 *   3. Subject-aware UI (steps, definitions, examples, exam tips).
 *   4. Testability (deterministic shape + refinements).
 *
 * Product invariant compliance:
 *   P12 (AI Safety) -- this schema makes AI output MORE constrained, not less.
 *     Malformed output is rejected and the consumer falls back to safe rendering
 *     via `wrapAsParagraph`.
 *   P7 (Bilingual UI) -- `text` fields may be Hindi or English; technical terms
 *     (CBSE, XP, Bloom's) are not translated.
 *
 * No DOM/browser imports -- safe for Edge runtimes (Next.js API routes,
 * Supabase Edge Functions) and server-side helpers.
 */

import { z } from 'zod';

// ── Constants ────────────────────────────────────────────────────────────────

/** Max bytes for the entire serialized FoxyResponse payload. */
export const FOXY_MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB

/** Max length for any text or label field (chars). */
export const FOXY_MAX_TEXT_LEN = 2000;

/** Max length for any latex field (chars). KaTeX rendering is the consumer. */
export const FOXY_MAX_LATEX_LEN = 500;

/** Min/max blocks per response. */
export const FOXY_MIN_BLOCKS = 1;
export const FOXY_MAX_BLOCKS = 50;

/** Max chars for `wrapAsParagraph` raw input before truncation. */
export const FOXY_FALLBACK_MAX_CHARS = 8000;

/** Max paragraph blocks emitted by `wrapAsParagraph`. */
export const FOXY_FALLBACK_MAX_BLOCKS = 30;

// ── Block Schema ─────────────────────────────────────────────────────────────

/**
 * Allowed block types.
 *   - paragraph    -- prose explanation
 *   - step         -- numbered/sequenced step in a procedure
 *   - math         -- LaTeX-rendered math (KaTeX). text MUST be absent;
 *                     latex MUST be present and contain no `$`/`$$` delimiters
 *   - answer       -- the final answer / takeaway
 *   - exam_tip     -- CBSE exam-specific hint
 *   - definition   -- formal definition of a term
 *   - example      -- worked example
 *   - question     -- a probing question back to the student (Socratic, text-only)
 *   - mcq          -- a 4-option multiple-choice question (auditable, gated by
 *                     the quiz-oracle before emission so it satisfies P6)
 */
export const FoxyBlockTypeEnum = z.enum([
  'paragraph',
  'step',
  'math',
  'answer',
  'exam_tip',
  'definition',
  'example',
  'question',
  'mcq',
]);

/** Block types that require a non-empty `text` field (i.e. not math, not mcq). */
const TEXT_BEARING_TYPES = new Set([
  'paragraph',
  'step',
  'answer',
  'exam_tip',
  'definition',
  'example',
  'question',
]);

/** Bloom's taxonomy levels accepted on MCQ blocks. */
export const FoxyBloomLevelEnum = z.enum([
  'Remember',
  'Understand',
  'Apply',
  'Analyze',
  'Evaluate',
  'Create',
]);

/** Difficulty enum accepted on MCQ blocks (matches `question_bank` enum). */
export const FoxyDifficultyEnum = z.enum(['easy', 'medium', 'hard']);

/**
 * Internal raw shape -- we use `z.object().superRefine` to enforce
 * cross-field rules (text vs latex coupling, mcq required fields).
 */
const FoxyBlockBase = z.object({
  type: FoxyBlockTypeEnum,
  text: z
    .string()
    .max(FOXY_MAX_TEXT_LEN, `text exceeds ${FOXY_MAX_TEXT_LEN} chars`)
    .optional(),
  label: z
    .string()
    .max(FOXY_MAX_TEXT_LEN, `label exceeds ${FOXY_MAX_TEXT_LEN} chars`)
    .optional(),
  latex: z
    .string()
    .max(FOXY_MAX_LATEX_LEN, `latex exceeds ${FOXY_MAX_LATEX_LEN} chars`)
    .optional(),
  // ── MCQ-only fields (Phase 3 marking-authenticity remediation) ────────────
  // Present iff `type === 'mcq'`. Schema enforces this via superRefine below.
  // The MCQ block is the auditable variant of the (text-only, Socratic)
  // `question` block: it carries 4 options and a graded correct index so
  // the client can render real MCQ UI and the server can later mark
  // submissions through the snapshot/grading pipeline (P1, P4, P6).
  stem: z
    .string()
    .min(10, 'mcq stem requires at least 10 chars')
    .max(FOXY_MAX_TEXT_LEN, `stem exceeds ${FOXY_MAX_TEXT_LEN} chars`)
    .optional(),
  options: z
    .array(z.string().min(1, 'option must be non-empty').max(FOXY_MAX_TEXT_LEN))
    .length(4, 'mcq must have exactly 4 options (P6)')
    .optional(),
  correct_answer_index: z.number().int().min(0).max(3).optional(),
  explanation: z
    .string()
    .min(10, 'mcq explanation requires at least 10 chars')
    .max(FOXY_MAX_TEXT_LEN, `explanation exceeds ${FOXY_MAX_TEXT_LEN} chars`)
    .optional(),
  bloom_level: FoxyBloomLevelEnum.optional(),
  difficulty: FoxyDifficultyEnum.optional(),
});

export const FoxyBlockSchema = FoxyBlockBase.superRefine((block, ctx) => {
  const { type, text, latex, stem, options, correct_answer_index, explanation } =
    block;

  // MCQ-only field set leaks onto non-mcq blocks would let malformed AI
  // output silently parse. Forbid mcq-only fields anywhere except an mcq.
  const MCQ_ONLY_FIELDS: Array<
    'stem' | 'options' | 'correct_answer_index' | 'explanation'
  > = ['stem', 'options', 'correct_answer_index', 'explanation'];

  if (type === 'math') {
    if (text !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: "blocks of type 'math' must not include a 'text' field",
      });
    }
    if (latex === undefined || latex.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['latex'],
        message: "blocks of type 'math' require a non-empty 'latex' field",
      });
      return;
    }
    // KaTeX wrapping is the consumer's job; reject any `$` or `$$` delimiters.
    if (/\${1,2}/.test(latex)) {
      ctx.addIssue({
        code: 'custom',
        path: ['latex'],
        message:
          "'latex' must not contain '$' or '$$' delimiters; consumer wraps with KaTeX",
      });
    }
    for (const f of MCQ_ONLY_FIELDS) {
      if (block[f] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: `blocks of type 'math' must not include '${f}'`,
        });
      }
    }
    return;
  }

  if (type === 'mcq') {
    // MCQ blocks: stem/options/correct_answer_index/explanation required.
    // text/latex/label are not used (UI renders stem + options directly).
    if (text !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: "blocks of type 'mcq' must not include a 'text' field; use 'stem'",
      });
    }
    if (latex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['latex'],
        message: "blocks of type 'mcq' must not include a 'latex' field",
      });
    }
    if (stem === undefined || stem.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['stem'],
        message: "blocks of type 'mcq' require a non-empty 'stem'",
      });
    }
    if (!Array.isArray(options) || options.length !== 4) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: "blocks of type 'mcq' require exactly 4 'options' (P6)",
      });
    } else {
      // P6: distinct, non-empty options.
      const trimmed = options.map((o) => o.trim().toLowerCase());
      if (trimmed.some((o) => o.length === 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'mcq options must all be non-empty after trim',
        });
      } else if (new Set(trimmed).size !== 4) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'mcq options must be distinct (case-insensitive)',
        });
      }
    }
    if (
      typeof correct_answer_index !== 'number' ||
      !Number.isInteger(correct_answer_index) ||
      correct_answer_index < 0 ||
      correct_answer_index > 3
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['correct_answer_index'],
        message:
          "blocks of type 'mcq' require integer 'correct_answer_index' in 0..3",
      });
    }
    if (explanation === undefined || explanation.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['explanation'],
        message: "blocks of type 'mcq' require a non-empty 'explanation'",
      });
    }
    return;
  }

  // Non-math, non-mcq types: text required; latex forbidden; mcq-only
  // fields forbidden.
  if (TEXT_BEARING_TYPES.has(type)) {
    if (text === undefined || text.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: `blocks of type '${type}' require a non-empty 'text' field`,
      });
    }
    if (latex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['latex'],
        message: `blocks of type '${type}' must not include a 'latex' field`,
      });
    }
    for (const f of MCQ_ONLY_FIELDS) {
      if (block[f] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: `blocks of type '${type}' must not include '${f}'`,
        });
      }
    }
  }
});

// ── Response Schema ──────────────────────────────────────────────────────────

export const FoxySubjectEnum = z.enum([
  'math',
  'science',
  'sst',
  'english',
  'general',
]);

export const FoxyResponseSchema = z
  .object({
    title: z
      .string()
      .min(1, 'title is required')
      .max(120, 'title exceeds 120 chars'),
    subject: FoxySubjectEnum,
    blocks: z
      .array(FoxyBlockSchema)
      .min(FOXY_MIN_BLOCKS, `at least ${FOXY_MIN_BLOCKS} block required`)
      .max(FOXY_MAX_BLOCKS, `at most ${FOXY_MAX_BLOCKS} blocks allowed`),
  })
  .superRefine((value, ctx) => {
    // Whole-payload size check. UTF-8 byte length, computed after parse.
    let bytes = 0;
    try {
      bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    } catch {
      // Cyclic/non-serializable -- z.object would have caught primitives,
      // but defend anyway.
      ctx.addIssue({
        code: 'custom',
        message: 'payload is not JSON-serializable',
      });
      return;
    }
    if (bytes > FOXY_MAX_PAYLOAD_BYTES) {
      ctx.addIssue({
        code: 'custom',
        message: `payload exceeds ${FOXY_MAX_PAYLOAD_BYTES} bytes (got ${bytes})`,
      });
    }
  });

// ── Type Exports ─────────────────────────────────────────────────────────────

export type FoxyBlockType = z.infer<typeof FoxyBlockTypeEnum>;
export type FoxyBlock = z.infer<typeof FoxyBlockSchema>;
export type FoxyResponse = z.infer<typeof FoxyResponseSchema>;
export type FoxySubject = z.infer<typeof FoxySubjectEnum>;
export type FoxyBloomLevel = z.infer<typeof FoxyBloomLevelEnum>;
export type FoxyDifficulty = z.infer<typeof FoxyDifficultyEnum>;

/**
 * Narrowed type for an MCQ block. Useful when a downstream consumer
 * (e.g. quiz UI, oracle gate) needs the four MCQ-specific fields without
 * threading optional-undefined chains.
 */
export type FoxyMcqBlock = {
  type: 'mcq';
  stem: string;
  options: [string, string, string, string];
  correct_answer_index: 0 | 1 | 2 | 3;
  explanation: string;
  bloom_level?: FoxyBloomLevel;
  difficulty?: FoxyDifficulty;
  label?: string;
};

/** Type guard: narrows a FoxyBlock to FoxyMcqBlock when it is an MCQ. */
export function isFoxyMcqBlock(block: FoxyBlock): block is FoxyMcqBlock {
  return (
    block.type === 'mcq' &&
    typeof (block as { stem?: unknown }).stem === 'string' &&
    Array.isArray((block as { options?: unknown }).options) &&
    ((block as { options?: unknown[] }).options ?? []).length === 4 &&
    typeof (block as { correct_answer_index?: unknown })
      .correct_answer_index === 'number' &&
    typeof (block as { explanation?: unknown }).explanation === 'string'
  );
}

// ── Subject-Aware Validation ─────────────────────────────────────────────────

/**
 * Discriminated result of the subject rule check.
 *  - { ok: true, warnings? }         -- response is acceptable.
 *  - { ok: false, reason }           -- response violates a hard subject rule.
 *
 * Rules:
 *   - math:    expect at least one `math` block; warn (not reject) if missing.
 *   - science: `math` blocks are allowed only as formulas, capped at 30% of
 *              total blocks. Reject if ratio exceeds 30%.
 *   - sst:     `math` blocks allowed sparingly (Economics percentages/growth
 *              rates, Geography scale/density, Statistics-for-Economics
 *              mean/median), capped at 20% of total blocks. Reject if ratio
 *              exceeds 20%.
 *   - english: reject if any `math` block is present.
 *   - general: no extra rules.
 */
export type SubjectCheckResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; reason: string };

export function validateSubjectRules(
  parsed: FoxyResponse
): SubjectCheckResult {
  const blocks = parsed.blocks;
  const totalBlocks = blocks.length;
  const mathBlockCount = blocks.filter((b) => b.type === 'math').length;
  const warnings: string[] = [];

  switch (parsed.subject) {
    case 'math': {
      if (mathBlockCount === 0) {
        warnings.push(
          'subject=math but no math blocks present; expected at least one'
        );
      }
      return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
    }
    case 'science': {
      // Cap math blocks at 30% of total. Use ceil-style guard so that for very
      // small N (e.g. 1 block, 1 math) we still reject (ratio = 1.0 > 0.3).
      // Empty totalBlocks shouldn't reach here (schema enforces >=1).
      const ratio = totalBlocks === 0 ? 0 : mathBlockCount / totalBlocks;
      if (ratio > 0.3) {
        return {
          ok: false,
          reason: `subject=science permits math blocks only for formulas (max 30% of blocks); got ${mathBlockCount}/${totalBlocks} (${Math.round(ratio * 100)}%)`,
        };
      }
      return { ok: true };
    }
    case 'sst': {
      // Cap math blocks at 20% of total. Same shape as science: strict `>`
      // ensures small-N degenerate cases (e.g. 1 block / 1 math, ratio 1.0)
      // still reject. CBSE Class 9-10 Economics (Sectors, Money & Credit) and
      // Class 11-12 Statistics-for-Economics use mean/median/percentage/growth
      // formulas; Geography uses scale/density formulas. 20% cap permits these
      // sparingly while keeping SST primarily prose-driven.
      const ratio = totalBlocks === 0 ? 0 : mathBlockCount / totalBlocks;
      if (ratio > 0.2) {
        return {
          ok: false,
          reason: `subject=sst permits math blocks sparingly (max 20% of blocks); got ${mathBlockCount}/${totalBlocks} (${Math.round(ratio * 100)}%)`,
        };
      }
      return { ok: true };
    }
    case 'english': {
      if (mathBlockCount > 0) {
        return {
          ok: false,
          reason: `subject=${parsed.subject} must not contain any math blocks (got ${mathBlockCount})`,
        };
      }
      return { ok: true };
    }
    case 'general':
    default:
      return { ok: true };
  }
}

// ── Safe-Fallback Constructor ────────────────────────────────────────────────

/**
 * Detect whether `rawText` looks like a structured-output JSON payload (with
 * or without a markdown fence). When true, `wrapAsParagraph` MUST NOT emit
 * the input as paragraph text — that's what produced the May-2026 "raw JSON
 * in chat bubble" regression. Conservative matcher: only flags inputs whose
 * first non-fence/whitespace character is `{` or `[`.
 *
 * Mirrors `isJsonShapedRawText` in the Deno copy
 * (`supabase/functions/grounded-answer/structured-schema.ts`). Keep the two
 * in sync — drift means the Node side and Edge Function side disagree on
 * what "looks like JSON".
 */
function isJsonShapedRawText(rawText: string): boolean {
  if (typeof rawText !== 'string') return false;
  const stripped = rawText.replace(/^[\s`]*(?:json|javascript|js)?\s*/i, '');
  return /^[{[]/.test(stripped);
}

/** Strip ```json … ``` (or bare ```) fences. Single-pass, never throws. */
function stripFences(s: string): string {
  let out = s.trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json|javascript|js)?\s*/i, '');
    out = out.replace(/```\s*$/i, '');
    out = out.trim();
  }
  return out;
}

function tryParseFoxy(s: string): FoxyResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }
  const result = FoxyResponseSchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * Append unmatched closing brackets/braces to balance a truncated JSON slice.
 * Walks the string with a tiny state machine that respects string literals
 * and escape sequences so a `{` inside `"foo {"` is not counted as an open.
 */
function closeUnbalancedJson(s: string): string {
  let openBraces = 0;
  let openBrackets = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') openBraces++;
    else if (ch === '}') openBraces--;
    else if (ch === '[') openBrackets++;
    else if (ch === ']') openBrackets--;
  }
  let suffix = '';
  if (openBrackets > 0) suffix += ']'.repeat(openBrackets);
  if (openBraces > 0) suffix += '}'.repeat(openBraces);
  return s + suffix;
}

/**
 * Truncation rescue. When Haiku hits max_tokens mid-block it leaves JSON like
 * `{"title":"…","blocks":[{...},{...},{"type":"step","text":"Observa` —
 * every block before the cutoff is complete and valid; we just need to drop
 * the trailing partial block and close the structure. Walks backward through
 * `}` boundaries looking for slices whose `closeUnbalancedJson` extension
 * parses AND validates. Returns null if no slice validates.
 *
 * P12: never lowers the validation bar — must still pass FoxyResponseSchema.
 *
 * Mirrors the Deno copy. Keep in sync.
 */
export function rescueFromTruncatedJson(rawText: string): FoxyResponse | null {
  if (typeof rawText !== 'string' || rawText.length === 0) return null;
  const candidate = stripFences(rawText);
  if (!candidate.startsWith('{')) return null;

  const direct = tryParseFoxy(candidate);
  if (direct) return direct;

  let cut = candidate.lastIndexOf('}');
  for (let i = 0; i < 50 && cut > 0; i++) {
    const slice = candidate.slice(0, cut + 1).replace(/,\s*$/, '');
    const closed = closeUnbalancedJson(slice);
    const parsed = tryParseFoxy(closed);
    if (parsed) return parsed;
    cut = candidate.lastIndexOf('}', cut - 1);
  }
  return null;
}

/**
 * Last-resort content extraction. Pulls every `"text"` field value out of
 * broken JSON via regex so we can show the human-readable sentences Claude
 * wrote. Used when truncation cuts mid-string and rescue can't recover a
 * complete structure. Returns recovered strings in document order.
 *
 * Mirrors the Deno copy. Keep in sync.
 */
export function extractTextFieldsFromBrokenJson(rawText: string): string[] {
  if (typeof rawText !== 'string' || rawText.length === 0) return [];
  const result: string[] = [];
  const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rawText)) !== null) {
    try {
      const decoded = JSON.parse(`"${m[1]}"`);
      if (typeof decoded === 'string' && decoded.trim().length > 0) {
        result.push(decoded);
      }
    } catch {
      // Skip malformed escape sequences silently.
    }
  }
  return result;
}

/**
 * Bilingual "I got cut off" fallback used when neither rescue nor text
 * extraction can recover content from JSON-shaped input. Inline EN + Hinglish
 * so it lands for both English-medium and Hindi-medium students until
 * language is plumbed into this layer.
 */
const FOXY_TRUNCATION_FALLBACK_TEXT =
  'Sorry — my answer got cut off. Could you re-ask, ideally one question at a time? ' +
  'Maafi, mera jawab beech mein ruk gaya. Ek-ek karke sawal poochho na?';

/**
 * Build a guaranteed-valid FoxyResponse from arbitrary raw text.
 *
 * Used when AI returns non-JSON, malformed JSON, or schema-failing JSON.
 *
 * **Critical contract: this function must NEVER produce a paragraph block
 * whose text is JSON-shaped.** That was the May-2026 production regression:
 * Haiku truncated mid-JSON, JSON.parse failed, and the prior implementation
 * dutifully wrapped the raw `{"title":"…","blocks":[…` string into a
 * paragraph, which the renderer faithfully displayed to students. The fix:
 * detect JSON-shaped input and route through rescue → text extraction →
 * friendly bilingual fallback, in that order. The legacy prose-wrapping
 * branch only runs when the input is genuinely prose.
 *
 * Behavior (prose path, unchanged):
 *   - Truncate input to FOXY_FALLBACK_MAX_CHARS.
 *   - Split on double-newline into paragraph blocks.
 *   - Cap at FOXY_FALLBACK_MAX_BLOCKS; the final block carries any overflow,
 *     itself truncated to FOXY_MAX_TEXT_LEN.
 *   - Always returns a parseable FoxyResponse (i.e. round-trips through
 *     FoxyResponseSchema.parse). Caller does not need to revalidate.
 */
export function wrapAsParagraph(
  rawText: string,
  opts: { title?: string; subject?: FoxySubject } = {}
): FoxyResponse {
  const title = (opts.title ?? 'Foxy').slice(0, 120) || 'Foxy';
  const subject: FoxySubject = opts.subject ?? 'general';

  // ── JSON-shaped input: NEVER fall through to paragraph wrapping ──
  if (isJsonShapedRawText(rawText)) {
    const rescued = rescueFromTruncatedJson(rawText);
    if (rescued) {
      // Honour caller's subject hint when the rescued payload disagrees.
      if (opts.subject && rescued.subject !== opts.subject) {
        return { ...rescued, subject: opts.subject };
      }
      return rescued;
    }

    const extracted = extractTextFieldsFromBrokenJson(rawText);
    if (extracted.length > 0) {
      const blocks: FoxyBlock[] = extracted
        .slice(0, FOXY_FALLBACK_MAX_BLOCKS)
        .map((p) => ({
          type: 'paragraph' as const,
          text: p.slice(0, FOXY_MAX_TEXT_LEN),
        }));
      return { title, subject, blocks };
    }

    return {
      title,
      subject,
      blocks: [{ type: 'paragraph', text: FOXY_TRUNCATION_FALLBACK_TEXT }],
    };
  }

  // ── Legacy prose-wrapping branch (unchanged) ──
  const safe = (typeof rawText === 'string' ? rawText : '').slice(
    0,
    FOXY_FALLBACK_MAX_CHARS
  );

  // Split on blank lines (double newline, possibly with whitespace).
  const rawParas = safe
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  let paras: string[];
  if (rawParas.length === 0) {
    paras = ['Foxy is taking a short break. Try again in a minute!'];
  } else if (rawParas.length <= FOXY_FALLBACK_MAX_BLOCKS) {
    paras = rawParas;
  } else {
    // Keep first (FOXY_FALLBACK_MAX_BLOCKS - 1) paragraphs, fold remainder
    // into the final block.
    const head = rawParas.slice(0, FOXY_FALLBACK_MAX_BLOCKS - 1);
    const tail = rawParas.slice(FOXY_FALLBACK_MAX_BLOCKS - 1).join('\n\n');
    paras = [...head, tail];
  }

  const blocks: FoxyBlock[] = paras.map((p) => ({
    type: 'paragraph' as const,
    text: p.slice(0, FOXY_MAX_TEXT_LEN),
  }));

  // Defensive: if title somehow ended empty after slicing (it shouldn't),
  // fall back to a constant.
  return {
    title,
    subject,
    blocks,
  };
}

// ── Prompt Addendum ──────────────────────────────────────────────────────────

/**
 * Appended to the `foxy_tutor_v1` system prompt at inference time to enforce
 * the structured-output contract above. The next agent will wire this into
 * the prompt template; this file only exports the constant.
 *
 * Notes:
 *   - Hard JSON-only requirement (no markdown fences, no commentary).
 *   - LaTeX rules: only inside `latex` field, never inside `text`; no `$` /
 *     `$$` delimiters (the renderer wraps with KaTeX).
 *   - Bilingual: text fields may be Hindi or English depending on the user's
 *     language; technical terms (CBSE, XP, Bloom's) are not translated.
 *   - Few-shot examples are intentionally minimal (2-3 blocks each) to keep
 *     the addendum well under prompt budget.
 */
export const FOXY_STRUCTURED_OUTPUT_PROMPT = `
# OUTPUT FORMAT (STRICT)

Return ONLY valid JSON. No prose, no markdown fences, no commentary, no leading text.

The JSON object MUST match this TypeScript type exactly:

type FoxyResponse = {
  title: string,                                  // 1..120 chars
  subject: "math" | "science" | "sst" | "english" | "general",
  blocks: Array<
    | { type: "paragraph" | "step" | "answer" | "exam_tip" | "definition" | "example" | "question",
        text: string,                             // non-empty, <= 2000 chars
        label?: string }                          // optional caption, <= 2000 chars
    | { type: "math",
        latex: string,                            // non-empty, <= 500 chars, NO "$" delimiters
        label?: string }
    | { type: "mcq",                              // 4-option multiple choice (use ONLY in quiz/practice modes)
        stem: string,                             // 10..2000 chars, the question prompt
        options: [string, string, string, string],// EXACTLY 4 distinct non-empty options
        correct_answer_index: 0 | 1 | 2 | 3,
        explanation: string,                      // 10..2000 chars, why the correct answer is correct
        bloom_level?: "Remember"|"Understand"|"Apply"|"Analyze"|"Evaluate"|"Create",
        difficulty?: "easy"|"medium"|"hard",
        label?: string }
  >
}

Constraints:
- 1 to 50 blocks total.
- Whole payload <= 16 KB; keep response under ~4000 chars total.
- Markdown is FORBIDDEN anywhere in any field. No "**", no "#", no ">", no markdown lists.
- LaTeX is allowed ONLY inside the "latex" field of math blocks. Never inside "text".
- Do NOT wrap latex in "$" or "$$". The renderer adds KaTeX delimiters.
- "text" must be non-empty after trim.
- "math" blocks must not include "text"; non-math blocks must not include "latex".
- Bilingual: write "text" in the user's language (English, Hindi, or Hinglish).
  Do NOT translate technical terms: CBSE, XP, Bloom's, NCERT, IRT.

# SUBJECT RULES

- subject="math":     include at least one "math" block.
- subject="science":  "math" blocks allowed only as formulas, max 30% of blocks.
- subject="sst":      "math" blocks allowed sparingly, max 20% of blocks (e.g., for percentages, growth rates, scale, density, statistics).
- subject="english":  NO "math" blocks.
- subject="general":  no extra rules; use only if the topic is genuinely cross-subject.

# FEW-SHOT EXAMPLES

## Math (Class 7, linear equations)
{"title":"Solving 2x + 3 = 11","subject":"math","blocks":[
  {"type":"step","label":"Step 1","text":"Subtract 3 from both sides to isolate the variable term."},
  {"type":"math","latex":"2x = 8"},
  {"type":"answer","text":"x = 4"}
]}

## Science (Class 9, Newton's second law)
{"title":"Newton's Second Law","subject":"science","blocks":[
  {"type":"definition","label":"Definition","text":"Force equals mass times acceleration."},
  {"type":"math","latex":"F = m \\\\cdot a"},
  {"type":"example","text":"A 2 kg ball pushed at 3 m/s^2 needs 6 N of force."}
]}

## SST (Class 8, Constitution of India)
{"title":"Preamble of the Constitution","subject":"sst","blocks":[
  {"type":"paragraph","text":"The Preamble declares India a sovereign, socialist, secular, democratic republic."},
  {"type":"exam_tip","text":"In CBSE exams, remember the four pillars: Justice, Liberty, Equality, Fraternity."}
]}

## English (Class 6, parts of speech)
{"title":"Nouns vs Pronouns","subject":"english","blocks":[
  {"type":"definition","label":"Noun","text":"A noun names a person, place, thing, or idea."},
  {"type":"example","text":"In 'Riya read her book', 'Riya' and 'book' are nouns; 'her' is a pronoun."}
]}

Return ONLY the JSON object. Nothing else.
`.trim();
