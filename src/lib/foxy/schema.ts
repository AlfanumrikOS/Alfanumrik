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
 *   - question     -- a probing question back to the student (Socratic)
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
]);

/** Block types that require a non-empty `text` field (i.e. not math). */
const TEXT_BEARING_TYPES = new Set([
  'paragraph',
  'step',
  'answer',
  'exam_tip',
  'definition',
  'example',
  'question',
]);

/**
 * Internal raw shape -- we use `z.object().superRefine` to enforce
 * cross-field rules (text vs latex coupling).
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
});

export const FoxyBlockSchema = FoxyBlockBase.superRefine((block, ctx) => {
  const { type, text, latex } = block;

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
    return;
  }

  // Non-math types: text is required and non-empty after trim; latex forbidden.
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
 * Build a guaranteed-valid FoxyResponse from arbitrary raw text.
 *
 * Used when AI returns non-JSON, malformed JSON, or schema-failing JSON.
 *
 * Behavior:
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
