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

import { repairIllegalJsonEscapes } from './json-escape-repair';

// ── Constants ────────────────────────────────────────────────────────────────

/** Max bytes for the entire serialized FoxyResponse payload. */
export const FOXY_MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB

/** Max length for any text or label field (chars). */
export const FOXY_MAX_TEXT_LEN = 2000;

/** Max length for any latex field (chars). KaTeX rendering is the consumer. */
export const FOXY_MAX_LATEX_LEN = 500;

/** Max length for a `mermaid` block's `code` field (chars). */
export const FOXY_MAX_MERMAID_CODE_LEN = 2000;

/** Max length for a `mermaid` block's `title` caption (chars). */
export const FOXY_MAX_MERMAID_TITLE_LEN = 120;

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
 *   - diagram      -- an image-retrieval query for a real labelled figure
 *                     (search_query only) -- NOT a drawable spec.
 *   - code         -- a code snippet (text + optional language).
 *   - mermaid      -- a drawable Mermaid diagram spec (`code` + optional
 *                     `title`). The `code` must lead with an allowlisted
 *                     diagram header and is sanitised in superRefine. Never
 *                     emitted until `ff_foxy_diagrams_v1` is ON (the model is
 *                     only told about it via the appended DIAGRAM_DIRECTIVE).
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
  'diagram',
  'code',
  'mermaid',
  'vertical_math',
  'map',
]);

/** Block types that require a non-empty `text` field (i.e. not math, not mcq, not diagram). */
const TEXT_BEARING_TYPES = new Set([
  'paragraph',
  'step',
  'answer',
  'exam_tip',
  'definition',
  'example',
  'question',
  'code',
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
 * Allowlisted Mermaid diagram headers. The FIRST non-whitespace token of a
 * `mermaid` block's `code` MUST be one of these, or the block is rejected.
 * This is a hard grammar gate: an unknown/hostile diagram type never reaches
 * the renderer. Keep this set byte-identical to the Deno mirror in
 * `supabase/functions/grounded-answer/structured-schema.ts`.
 */
export const MERMAID_ALLOWED_HEADERS: ReadonlySet<string> = new Set([
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'mindmap',
  'pie',
  'timeline',
  'journey',
  'quadrantChart',
  'gitGraph',
]);

/**
 * Validate the `code` of a `mermaid` block. Returns an error string on
 * failure, or `null` when the code passes. Rules (mirror the Deno copy
 * EXACTLY -- change both or neither):
 *   1. Non-empty after trim.
 *   2. First non-whitespace token is an allowlisted diagram header.
 *   3. No `<script`, `javascript:`, `click ` interaction callbacks, or a
 *      `%%{init ...}` directive that overrides `htmlLabels`/`securityLevel`.
 *      Defense-in-depth: the renderer runs Mermaid with securityLevel:'strict',
 *      but we refuse to ship these constructs regardless (P12).
 */
export function validateMermaidCode(code: string): string | null {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return "mermaid 'code' must be non-empty";
  }
  const firstToken = (trimmed.match(/^\S+/) ?? [''])[0];
  if (!MERMAID_ALLOWED_HEADERS.has(firstToken)) {
    return `mermaid 'code' must start with an allowlisted diagram header (got "${firstToken.slice(0, 32)}")`;
  }
  const lower = trimmed.toLowerCase();
  if (lower.includes('<script')) {
    return "mermaid 'code' must not contain '<script'";
  }
  if (lower.includes('javascript:')) {
    return "mermaid 'code' must not contain 'javascript:'";
  }
  // `click` is a Mermaid interaction callback (JS binding / href). Match it as
  // a statement (line start + whitespace) so a node LABEL that merely contains
  // the word "click" is not a false positive.
  if (/(^|[\r\n])\s*click\s/i.test(trimmed)) {
    return "mermaid 'code' must not contain 'click' interaction callbacks";
  }
  if (
    lower.includes('%%{init') &&
    (lower.includes('htmllabels') || lower.includes('securitylevel'))
  ) {
    return "mermaid 'code' must not override htmlLabels/securityLevel via %%{init}";
  }
  return null;
}

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
  // ── Diagram-only field ────────────────────────────────────────────────────
  search_query: z
    .string()
    .min(3, 'diagram requires at least a 3 char search query')
    .max(200, 'search query exceeds 200 chars')
    .optional(),
  // ── Code-only field ───────────────────────────────────────────────────────
  language: z
    .string()
    .max(50, 'language exceeds 50 chars')
    .optional(),
  // ── Mermaid-only fields ────────────────────────────────────────────────────
  // Present iff `type === 'mermaid'` (enforced via superRefine below). `code`
  // is a drawable Mermaid diagram spec (allowlisted header + sanitised);
  // `title` is an optional short caption used as the legacy denormalized text.
  code: z
    .string()
    .min(1, 'mermaid code must be non-empty')
    .max(FOXY_MAX_MERMAID_CODE_LEN, `code exceeds ${FOXY_MAX_MERMAID_CODE_LEN} chars`)
    .optional(),
  title: z
    .string()
    .max(FOXY_MAX_MERMAID_TITLE_LEN, `title exceeds ${FOXY_MAX_MERMAID_TITLE_LEN} chars`)
    .optional(),
  // ── Vertical-math-only fields ────────────────────────────────────────────────
  // Present iff `type === 'vertical_math'`. Renders columnar arithmetic with
  // right-aligned digits, carry rows, and intermediate steps.
  operation: z
    .enum(['addition', 'subtraction', 'multiplication', 'long_division'])
    .optional(),
  operands: z
    .array(z.string().min(1).max(50))
    .min(2, 'vertical_math requires at least 2 operands')
    .max(10)
    .optional(),
  result: z.string().max(50).optional(),
  carry_row: z.array(z.string().max(10)).optional(),
  remainder: z.string().max(50).optional(),
  intermediate_steps: z.array(z.string().max(100)).max(20).optional(),
  // ── Map-only fields ──────────────────────────────────────────────────────────
  // Present iff `type === 'map'`. Renders geographic/political/thematic maps.
  map_type: z
    .enum(['political', 'physical', 'thematic', 'historical'])
    .optional(),
  region: z.string().max(200).optional(),
  markers: z
    .array(
      z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        label: z.string().max(200),
        description: z.string().max(500).optional(),
      })
    )
    .max(50)
    .optional(),
  highlighted_regions: z.array(z.string().max(100)).max(50).optional(),
  layers: z
    .array(
      z.enum([
        'rivers',
        'mountains',
        'trade_routes',
        'monsoon',
        'rainfall',
        'vegetation',
        'minerals',
      ])
    )
    .optional(),
  map_title: z.string().max(200).optional(),
});

export const FoxyBlockSchema = FoxyBlockBase.superRefine((block, ctx) => {
  const { type, text, latex, stem, options, correct_answer_index, explanation, search_query, code } =
    block;

  // MCQ-only field set leaks onto non-mcq blocks would let malformed AI
  // output silently parse. Forbid mcq-only fields anywhere except an mcq.
  const MCQ_ONLY_FIELDS: Array<
    'stem' | 'options' | 'correct_answer_index' | 'explanation'
  > = ['stem', 'options', 'correct_answer_index', 'explanation'];

  // Mermaid-only field set. Same rationale as MCQ_ONLY_FIELDS: forbid these
  // anywhere except a mermaid block so a stray `code`/`title` cannot ride on
  // a paragraph/math/etc. block.
  const MERMAID_ONLY_FIELDS: Array<'code' | 'title'> = ['code', 'title'];

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
    for (const f of MERMAID_ONLY_FIELDS) {
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

  if (type === 'diagram') {
    if (text !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: "blocks of type 'diagram' must not include a 'text' field",
      });
    }
    if (latex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['latex'],
        message: "blocks of type 'diagram' must not include a 'latex' field",
      });
    }
    if (search_query === undefined || search_query.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['search_query'],
        message: "blocks of type 'diagram' require a non-empty 'search_query' field",
      });
    }
    return;
  }

  if (type === 'mermaid') {
    // Drawable Mermaid diagram. `code` required + allowlisted header +
    // sanitised. `text`/`latex` forbidden (the diagram lives in `code`); mcq
    // fields forbidden. `title` is validated by the field schema (<=120).
    if (text !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: "blocks of type 'mermaid' must not include a 'text' field",
      });
    }
    if (latex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['latex'],
        message: "blocks of type 'mermaid' must not include a 'latex' field",
      });
    }
    if (code === undefined || code.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['code'],
        message: "blocks of type 'mermaid' require a non-empty 'code' field",
      });
      return;
    }
    const mermaidErr = validateMermaidCode(code);
    if (mermaidErr) {
      ctx.addIssue({ code: 'custom', path: ['code'], message: mermaidErr });
    }
    for (const f of MCQ_ONLY_FIELDS) {
      if (block[f] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: `blocks of type 'mermaid' must not include '${f}'`,
        });
      }
    }
    return;
  }

  if (type === 'vertical_math') {
    // Vertical math blocks: operation + operands + result required.
    // text/latex/mcq/mermaid fields forbidden.
    if (text !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: "blocks of type 'vertical_math' must not include a 'text' field",
      });
    }
    if (latex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['latex'],
        message: "blocks of type 'vertical_math' must not include a 'latex' field",
      });
    }
    if (!block.operation) {
      ctx.addIssue({
        code: 'custom',
        path: ['operation'],
        message: "blocks of type 'vertical_math' require an 'operation' field",
      });
    }
    if (!Array.isArray(block.operands) || block.operands.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['operands'],
        message: "blocks of type 'vertical_math' require at least 2 'operands'",
      });
    }
    if (block.result === undefined || block.result.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['result'],
        message: "blocks of type 'vertical_math' require a non-empty 'result'",
      });
    }
    for (const f of MCQ_ONLY_FIELDS) {
      if (block[f] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: `blocks of type 'vertical_math' must not include '${f}'`,
        });
      }
    }
    for (const f of MERMAID_ONLY_FIELDS) {
      if (block[f] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: `blocks of type 'vertical_math' must not include '${f}'`,
        });
      }
    }
    return;
  }

  if (type === 'map') {
    // Map blocks: map_type + region required. text/latex/mcq/mermaid forbidden.
    if (text !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message: "blocks of type 'map' must not include a 'text' field",
      });
    }
    if (latex !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['latex'],
        message: "blocks of type 'map' must not include a 'latex' field",
      });
    }
    if (!block.map_type) {
      ctx.addIssue({
        code: 'custom',
        path: ['map_type'],
        message: "blocks of type 'map' require a 'map_type' field",
      });
    }
    if (!block.region || block.region.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['region'],
        message: "blocks of type 'map' require a non-empty 'region' field",
      });
    }
    for (const f of MCQ_ONLY_FIELDS) {
      if (block[f] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: `blocks of type 'map' must not include '${f}'`,
        });
      }
    }
    for (const f of MERMAID_ONLY_FIELDS) {
      if (block[f] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [f],
          message: `blocks of type 'map' must not include '${f}'`,
        });
      }
    }
    return;
  }

  // Non-math, non-mcq, non-diagram, non-mermaid, non-vertical_math, non-map
  // types: text required; latex forbidden; mcq-only + mermaid-only fields forbidden.
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
    for (const f of MERMAID_ONLY_FIELDS) {
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

/** Lesson step enum for interactive lesson mode (Phase 6). */
export const FoxyLessonStepEnum = z.enum([
  'hook',
  'explanation',
  'worked_example',
  'guided_practice',
  'independent_practice',
  'reflection',
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
    // ── Interactive lesson mode fields (Phase 6, optional) ─────────────────
    lesson_step: FoxyLessonStepEnum.optional(),
    check_question: FoxyBlockSchema.optional(),
    auto_advance: z.boolean().optional(),
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
export type FoxyLessonStep = z.infer<typeof FoxyLessonStepEnum>;

/** Narrowed type for a vertical math block. */
export type FoxyVerticalMathBlock = {
  type: 'vertical_math';
  operation: 'addition' | 'subtraction' | 'multiplication' | 'long_division';
  operands: string[];
  result: string;
  carry_row?: string[];
  remainder?: string;
  intermediate_steps?: string[];
  label?: string;
};

/** Type guard: narrows a FoxyBlock to FoxyVerticalMathBlock. */
export function isFoxyVerticalMathBlock(block: FoxyBlock): block is FoxyVerticalMathBlock {
  return (
    block.type === 'vertical_math' &&
    typeof (block as { operation?: unknown }).operation === 'string' &&
    Array.isArray((block as { operands?: unknown }).operands) &&
    typeof (block as { result?: unknown }).result === 'string'
  );
}

/** Narrowed type for a map block. */
export type FoxyMapBlock = {
  type: 'map';
  map_type: 'political' | 'physical' | 'thematic' | 'historical';
  region: string;
  markers?: Array<{ lat: number; lng: number; label: string; description?: string }>;
  highlighted_regions?: string[];
  layers?: Array<'rivers' | 'mountains' | 'trade_routes' | 'monsoon' | 'rainfall' | 'vegetation' | 'minerals'>;
  map_title?: string;
  label?: string;
};

/** Type guard: narrows a FoxyBlock to FoxyMapBlock. */
export function isFoxyMapBlock(block: FoxyBlock): block is FoxyMapBlock {
  return (
    block.type === 'map' &&
    typeof (block as { map_type?: unknown }).map_type === 'string' &&
    typeof (block as { region?: unknown }).region === 'string'
  );
}

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

/**
 * Narrowed type for a Mermaid diagram block. Useful for the renderer (Wave 2)
 * and any consumer that needs `code`/`title` without threading optional chains.
 */
export type FoxyMermaidBlock = {
  type: 'mermaid';
  code: string;
  title?: string;
  label?: string;
};

/** Type guard: narrows a FoxyBlock to FoxyMermaidBlock when it is a Mermaid block. */
export function isFoxyMermaidBlock(block: FoxyBlock): block is FoxyMermaidBlock {
  return (
    block.type === 'mermaid' &&
    typeof (block as { code?: unknown }).code === 'string' &&
    (block as { code: string }).code.trim().length > 0
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
  const stripped = stripFences(rawText);
  if (!stripped.startsWith('{')) return null;

  // Pre-repair illegal JSON escapes (e.g. under-escaped LaTeX like `\(` /
  // `\frac` inside string values) BEFORE the truncation walk, so rescue only
  // fires for TRUE truncation and never drops blocks because of an escaping
  // artefact. Idempotent + conservative — see json-escape-repair.ts.
  const candidate = repairIllegalJsonEscapes(stripped).repaired;

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
  // Repair illegal escapes first so `JSON.parse` of each captured value does
  // not silently drop sentences containing under-escaped LaTeX (`\(`, `\frac`).
  const repairedText = repairIllegalJsonEscapes(rawText).repaired;
  const result: string[] = [];
  const re = /"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(repairedText)) !== null) {
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
        text: string,                             // non-empty, <= 2000 chars. Inline math allowed: \\( ... \\) inline, \\[ ... \\] display-in-prose
        label?: string }                          // optional caption, <= 2000 chars
    | { type: "math",
        latex: string,                            // non-empty, <= 500 chars, NO "$" delimiters (standalone display equation)
        label?: string }
    | { type: "diagram",
        search_query: string }                    // e.g. "Human Heart labeled diagram Class 10"
    | { type: "code",
        text: string,                             // actual code snippet
        language?: string }                       // e.g. "python", "cpp"
    | { type: "mcq",                              // 4-option multiple choice (use ONLY in quiz/practice modes)
        stem: string,                             // 10..2000 chars, the question prompt
        options: [string, string, string, string],// EXACTLY 4 distinct non-empty options
        correct_answer_index: 0 | 1 | 2 | 3,
        explanation: string,                      // 10..2000 chars, why the correct answer is correct
        bloom_level?: "Remember"|"Understand"|"Apply"|"Analyze"|"Evaluate"|"Create",
        difficulty?: "easy"|"medium"|"hard",
        label?: string }
    | { type: "vertical_math",                    // columnar arithmetic (only when VERTICAL MATH DIRECTIVE is active)
        operation: "addition"|"subtraction"|"multiplication"|"long_division",
        operands: string[],                       // at least 2 number strings
        result: string,                           // answer string
        carry_row?: string[],                     // carry digits for addition/subtraction
        remainder?: string,                       // remainder for division
        intermediate_steps?: string[],            // partial products or division steps
        label?: string }
    | { type: "map",                              // geographic/political map (only when MAP DIRECTIVE is active)
        map_type: "political"|"physical"|"thematic"|"historical",
        region: string,                           // e.g. "India", "South Asia"
        map_title?: string,                       // display title
        markers?: Array<{lat: number, lng: number, label: string, description?: string}>,
        highlighted_regions?: string[],           // state/region names to highlight
        layers?: Array<"rivers"|"mountains"|"trade_routes"|"monsoon"|"rainfall"|"vegetation"|"minerals"> }
  >,
  lesson_step?: "hook"|"explanation"|"worked_example"|"guided_practice"|"independent_practice"|"reflection",
  check_question?: /* single block */,            // MCQ gating progression (lesson mode only)
  auto_advance?: boolean                          // auto-advance after voice (lesson mode only)
}

Constraints:
- 1 to 50 blocks total.
- Whole payload <= 16 KB.
- Markdown emphasis is FORBIDDEN anywhere in any field. No "**", no "__", no "#", no ">", no markdown lists. Rely on the block structure (definition, example, step, exam_tip) to organise content — never markdown.
- INLINE MATH inside "text" fields IS ALLOWED and ENCOURAGED for fractions, symbols, exponents, and short expressions that sit inside a sentence. Use \\( ... \\) for inline math and \\[ ... \\] for a display equation within prose. Example (raw JSON, backslashes doubled per the JSON ESCAPING rule below): "In \\\\( \\\\frac{3}{4} \\\\), 3 is the numerator and 4 is the denominator." Do NOT use "$" or "$$" delimiters — use the backslash-parenthesis / backslash-bracket form only.
- JSON ESCAPING FOR MATH (CRITICAL): inside JSON string values, every LaTeX backslash MUST be doubled (\\\\frac not \\frac, \\\\( not \\( ). A single backslash before "(", ")", "[", "]" or a LaTeX command letter is an ILLEGAL JSON escape — it breaks JSON.parse and the student sees nothing. Write "\\\\( \\\\frac{1}{2} \\\\)" in the raw JSON; after JSON decoding the renderer receives \\( \\frac{1}{2} \\). The FEW-SHOT EXAMPLES below show correctly doubled raw JSON.
- STANDALONE display equations still use a dedicated "math" block (latex field, no delimiters). Use a "math" block when the equation is the focus of its own line; use inline \\( ... \\) when math is woven into a sentence.
- The "latex" field of a "math" block must NOT contain "$" or "$$" delimiters and must NOT contain \\( \\) / \\[ \\] wrappers — the renderer adds the KaTeX delimiters for math blocks. (The \\( \\) / \\[ \\] wrappers are ONLY for inline math written inside a "text" field.)
- "text" must be non-empty after trim.
- "math" blocks must not include "text"; non-math blocks must not include "latex".
- "diagram" blocks must not include "text" or "latex".
- Bilingual: write "text" in the user's language (English, Hindi, or Hinglish).
  Do NOT translate technical terms: CBSE, XP, Bloom's, NCERT, IRT.
- Use "step" blocks ONLY for actual sequential steps (calculations, derivations, sequential procedures). Do NOT use them for static facts, classifications, or definitions.
- Do NOT include the word "Step" or the step number in the "label" or "text" of step blocks. The UI renderer automatically numbers and formats them. Use "label" only for brief sub-topic context (e.g., "Given", "Formula", "Calculation") or omit it.

# SUBJECT RULES

- subject="math":     include at least one "math" block. Never write long prose.
- subject="science":  "math" blocks allowed only as formulas, max 30% of blocks. Use "diagram" blocks for structures/processes.
- subject="sst":      "math" blocks allowed sparingly, max 20% of blocks (e.g., for percentages, growth rates, scale, density, statistics). Use "diagram" blocks for maps/cycles.
- subject="english":  NO "math" blocks. NO "diagram" blocks.
- subject="general":  no extra rules; use only if the topic is genuinely cross-subject.

# FEW-SHOT EXAMPLES

## Math (Class 10, Quadratic numerical) — note inline math inside text fields, with every LaTeX backslash DOUBLED for JSON
{"title":"Solving a Quadratic Equation","subject":"math","blocks":[
  {"type":"definition","text":"A quadratic equation has the form \\\\( ax^2 + bx + c = 0 \\\\), where \\\\( a \\\\neq 0 \\\\)."},
  {"type":"step","label":"Given","text":"The equation is \\\\( x^2 - 5x + 6 = 0 \\\\)."},
  {"type":"math","label":"Formula","latex":"x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}"},
  {"type":"step","label":"Substitution","text":"Here \\\\( a = 1 \\\\), \\\\( b = -5 \\\\), \\\\( c = 6 \\\\)."},
  {"type":"math","label":"Calculation","latex":"x = \\\\frac{5 \\\\pm \\\\sqrt{25 - 24}}{2}"},
  {"type":"answer","text":"\\\\( x = 3 \\\\) or \\\\( x = 2 \\\\)."},
  {"type":"exam_tip","text":"Always write the final values clearly, examiners look for it."},
  {"type":"question","text":"Now try solving \\\\( x^2 - 4x + 4 = 0 \\\\)."}
]}

## Math (Class 6, Fractions) — inline fractions woven into a sentence (JSON-doubled backslashes)
{"title":"Understanding Fractions","subject":"math","blocks":[
  {"type":"definition","text":"A fraction shows a part of a whole. In \\\\( \\\\frac{3}{4} \\\\), 3 is the numerator and 4 is the denominator."},
  {"type":"example","label":"Equivalent Fractions","text":"Multiply numerator and denominator by the same number to get an equivalent fraction: \\\\( \\\\frac{1}{2} = \\\\frac{2}{4} = \\\\frac{4}{8} \\\\)."},
  {"type":"question","text":"Is \\\\( \\\\frac{3}{6} \\\\) equivalent to \\\\( \\\\frac{1}{2} \\\\)? Why?"}
]}

## Biology (Class 10, Process with diagram)
{"title":"Human Digestive System","subject":"science","blocks":[
  {"type":"paragraph","label":"Overview","text":"Digestion is the breakdown of large insoluble food molecules into small water-soluble food molecules."},
  {"type":"diagram","search_query":"Human Digestive System Class 10 NCERT diagram"},
  {"type":"step","label":"Mouth","text":"Digestion begins here with salivary amylase breaking down starch."},
  {"type":"step","label":"Stomach","text":"Gastric juices and HCl break down proteins."},
  {"type":"step","label":"Small Intestine","text":"Complete digestion occurs here and nutrients are absorbed."},
  {"type":"paragraph","label":"Summary","text":"The process ensures our body gets the energy it needs from food."},
  {"type":"question","text":"What role does the liver play in this process?"}
]}

## Chemistry (Class 11, Reaction)
{"title":"Haber Process","subject":"science","blocks":[
  {"type":"paragraph","label":"Reaction Overview","text":"The Haber process is the industrial implementation of the reaction of nitrogen gas with hydrogen gas to produce ammonia."},
  {"type":"math","latex":"N_2(g) + 3H_2(g) \\\\rightleftharpoons 2NH_3(g)"},
  {"type":"paragraph","label":"Reactants & Conditions","text":"It requires an iron catalyst, a temperature of about 450 degrees Celsius, and a pressure of 200 atmospheres."},
  {"type":"paragraph","label":"Uses","text":"Ammonia is primarily used to make agricultural fertilizers."},
  {"type":"question","text":"Why is a high pressure used in this specific reaction according to Le Chatelier's principle?"}
]}

## Physics (Class 9, Numerical)
{"title":"Finding Deceleration of a Car","subject":"science","blocks":[
  {"type":"step","label":"Given","text":"Initial velocity u = 20 m/s, final velocity v = 0 m/s (car stops), time t = 4 s."},
  {"type":"math","label":"Formula","latex":"a = \\\\frac{v - u}{t}"},
  {"type":"exam_tip","text":"Always check units — velocity in m/s and time in s gives acceleration in m/s squared."},
  {"type":"step","label":"Substitution","text":"Put values: a = (0 - 20) / 4"},
  {"type":"math","label":"Calculation","latex":"a = \\\\frac{-20}{4} = -5 \\\\text{ m/s}^2"},
  {"type":"answer","text":"The deceleration is 5 m/s squared (negative sign shows the car is slowing down)."},
  {"type":"question","text":"A bike moving at 15 m/s stops in 3 seconds. What is its deceleration?"}
]}

## History / SST (Class 10, Long Answer)
{"title":"Causes of the French Revolution","subject":"sst","blocks":[
  {"type":"paragraph","label":"Historical Background","text":"The French Revolution (1789-1799) was a period of radical political and social transformation in France. Society was divided into three estates: the clergy, nobility, and the Third Estate — with all tax burdens on the Third Estate."},
  {"type":"paragraph","label":"Key Event","text":"The storming of the Bastille on 14 July 1789 marked the symbolic start of the revolution. The Bastille was a royal prison representing royal tyranny."},
  {"type":"paragraph","label":"Causes","text":"Three main causes were: (1) Social inequality between the three estates, (2) Economic crisis worsened by France's involvement in the American War, and (3) Enlightenment ideas of liberty and equality spread by philosophers like Voltaire and Rousseau."},
  {"type":"paragraph","label":"Effects","text":"The monarchy was abolished, Louis XVI was executed in 1793, and France became a republic. The Declaration of the Rights of Man and Citizen was passed."},
  {"type":"exam_tip","text":"In the board exam, list causes as numbered points and always mention at least one Enlightenment thinker for full marks."},
  {"type":"question","text":"How did Enlightenment ideas contribute to the French Revolution? Name two philosophers."}
]}

## English (Grammar)
{"title":"Active and Passive Voice","subject":"english","blocks":[
  {"type":"definition","label":"The Rule","text":"In Active Voice, the subject performs the action: Subject to Verb to Object. In Passive Voice, the subject receives the action: Object to is/was plus past participle to by Subject."},
  {"type":"example","label":"Active vs Passive","text":"Active: Riya wrote the letter. Riya is doing the action. Passive: The letter was written by Riya. The letter is receiving the action."},
  {"type":"paragraph","label":"Common Mistake","text":"Students often forget to change the tense of the verb when converting. If the active verb is writes (present), the passive must be is written — not was written."},
  {"type":"question","text":"Convert to passive voice: The teacher corrects the homework every day."}
]}

## Accountancy (Class 11, Journal Entry)
{"title":"Journal Entry for Cash Purchase","subject":"general","blocks":[
  {"type":"definition","label":"Transaction Analysis","text":"When goods are purchased for cash, two accounts are affected: Purchases Account (nominal, increases expense) and Cash Account (real, asset decreases)."},
  {"type":"paragraph","label":"Accounting Rule Applied","text":"Debit what comes in, Credit what goes out (Real Account rule). Purchases increase so Purchases A/c is Debited. Cash goes out so Cash A/c is Credited."},
  {"type":"paragraph","label":"Journal Entry","text":"Date | Particulars | L.F. | Debit (Rs.) | Credit (Rs.)\\n— | Purchases A/c Dr. | | 5,000 | \\n  | To Cash A/c | | | 5,000\\n  | (Being goods purchased for cash) | | |"},
  {"type":"exam_tip","text":"Always write the narration in brackets below the entry. Missing narration loses 1 mark in CBSE boards."},
  {"type":"question","text":"Pass the journal entry: Furniture purchased for office use for Rs. 12,000 cash."}
]}

## Economics (Class 12, Concept with diagram)
{"title":"The Demand Curve","subject":"sst","blocks":[
  {"type":"definition","text":"The demand curve is a graphical representation showing the inverse relationship between the price of a commodity and the quantity demanded, keeping all other factors constant (ceteris paribus)."},
  {"type":"diagram","search_query":"Demand Curve downward sloping Economics Class 11 CBSE NCERT graph"},
  {"type":"paragraph","label":"Why It Slopes Downward","text":"As price rises, consumers buy less because (1) the commodity becomes relatively expensive compared to substitutes (Substitution Effect), and (2) the consumer's real purchasing power falls (Income Effect). Both effects reduce quantity demanded when price increases."},
  {"type":"example","label":"Real-World Example","text":"When petrol prices rise, people use their cars less and switch to public transport. This is the demand curve at work in real life."},
  {"type":"exam_tip","text":"Movement along the demand curve = change in price only. Shift of the demand curve = change in any other factor (income, taste, related goods)."},
  {"type":"question","text":"Explain the difference between a movement along the demand curve and a shift of the demand curve with examples."}
]}

## Computer Science (Class 12, Programming)
{"title":"Fibonacci Series in Python","subject":"general","blocks":[
  {"type":"paragraph","label":"Problem Restatement","text":"We need to print a sequence where each number is the sum of the two numbers before it: 0, 1, 1, 2, 3, 5, 8 and so on. We must print the first n terms of this series."},
  {"type":"paragraph","label":"Logic Explanation","text":"Start with the first two known terms (0 and 1). Use a loop to repeatedly calculate the next term by adding the last two, then shift the window forward."},
  {"type":"code","language":"python","text":"def fibonacci(n):\\n    a, b = 0, 1\\n    for i in range(n):\\n        print(a, end=' ')\\n        a, b = b, a + b\\n\\nn = int(input('Enter number of terms: '))\\nfibonacci(n)"},
  {"type":"paragraph","label":"Expected Output","text":"For n = 7, output is: 0 1 1 2 3 5 8"},
  {"type":"paragraph","label":"Line-by-Line Explanation","text":"a, b = 0, 1 initialises the first two terms. Inside the loop, we print a (the current term), then shift: a becomes b and b becomes a+b (the new next term). This continues n times."},
  {"type":"question","text":"Modify the above program to print the Fibonacci series up to a given sum limit (e.g., stop when the sum exceeds 100) instead of n terms."}
]}

Return ONLY the JSON object. Nothing else.
`.trim();
