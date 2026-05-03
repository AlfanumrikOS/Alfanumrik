// supabase/functions/grounded-answer/structured-schema.ts
//
// Deno-side validator + safe-fallback constructor for the Foxy structured
// response contract. Hand-rolled (no zod) to keep the Edge Function lean and
// avoid pulling a Deno-published copy of zod into the bundle.
//
// SOURCE OF TRUTH: src/lib/foxy/schema.ts (Zod). Refinements here mirror the
// Zod schema EXACTLY -- if you change one, change both. The Node-side test
// `src/__tests__/lib/foxy/structured-validator-parity.test.ts` (added later if
// needed) and the Deno-side `__tests__/structured-validator.test.ts` lock
// behavior down.
//
// Performance budget: parse + validate must run in <50ms in the happy path.
// The validator does a single pass over blocks, no recursion, no dynamic
// import, no async work. Whole-payload UTF-8 byte cap is computed once via
// TextEncoder.

// ── Constants (mirrors src/lib/foxy/schema.ts) ──────────────────────────────

export const FOXY_MAX_PAYLOAD_BYTES = 16 * 1024; // 16 KB
export const FOXY_MAX_TEXT_LEN = 2000;
export const FOXY_MAX_LATEX_LEN = 500;
export const FOXY_MIN_BLOCKS = 1;
export const FOXY_MAX_BLOCKS = 50;
export const FOXY_FALLBACK_MAX_CHARS = 8000;
export const FOXY_FALLBACK_MAX_BLOCKS = 30;
export const FOXY_MAX_TITLE_LEN = 120;

// ── Types (mirrors src/lib/foxy/schema.ts) ──────────────────────────────────

export type FoxyBlockType =
  | 'paragraph'
  | 'step'
  | 'math'
  | 'answer'
  | 'exam_tip'
  | 'definition'
  | 'example'
  | 'question';

export type FoxySubject = 'math' | 'science' | 'sst' | 'english' | 'general';

export interface FoxyBlock {
  type: FoxyBlockType;
  text?: string;
  label?: string;
  latex?: string;
}

export interface FoxyResponse {
  title: string;
  subject: FoxySubject;
  blocks: FoxyBlock[];
}

const ALLOWED_BLOCK_TYPES: ReadonlySet<FoxyBlockType> = new Set([
  'paragraph',
  'step',
  'math',
  'answer',
  'exam_tip',
  'definition',
  'example',
  'question',
]);

const ALLOWED_SUBJECTS: ReadonlySet<FoxySubject> = new Set([
  'math',
  'science',
  'sst',
  'english',
  'general',
]);

const TEXT_BEARING_TYPES: ReadonlySet<FoxyBlockType> = new Set([
  'paragraph',
  'step',
  'answer',
  'exam_tip',
  'definition',
  'example',
  'question',
]);

// ── Validator ───────────────────────────────────────────────────────────────

export type ValidationResult =
  | { ok: true; value: FoxyResponse }
  | { ok: false; reason: string };

/**
 * Validate an arbitrary unknown value against the Foxy structured-response
 * contract. Returns `{ ok: true, value }` on success or `{ ok: false, reason }`
 * with a human-readable reason on failure. Never throws.
 */
// deno-lint-ignore no-explicit-any
export function validateFoxyResponse(input: any): ValidationResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'payload must be a JSON object' };
  }

  const { title, subject, blocks } = input as Record<string, unknown>;

  // title
  if (typeof title !== 'string' || title.length === 0) {
    return { ok: false, reason: 'title is required' };
  }
  if (title.length > FOXY_MAX_TITLE_LEN) {
    return { ok: false, reason: `title exceeds ${FOXY_MAX_TITLE_LEN} chars` };
  }

  // subject
  if (typeof subject !== 'string' || !ALLOWED_SUBJECTS.has(subject as FoxySubject)) {
    return {
      ok: false,
      reason: `subject must be one of math|science|sst|english|general (got ${String(subject)})`,
    };
  }

  // blocks
  if (!Array.isArray(blocks)) {
    return { ok: false, reason: 'blocks must be an array' };
  }
  if (blocks.length < FOXY_MIN_BLOCKS) {
    return { ok: false, reason: `at least ${FOXY_MIN_BLOCKS} block required` };
  }
  if (blocks.length > FOXY_MAX_BLOCKS) {
    return { ok: false, reason: `at most ${FOXY_MAX_BLOCKS} blocks allowed` };
  }

  for (let i = 0; i < blocks.length; i++) {
    const blockResult = validateBlock(blocks[i], i);
    if (!blockResult.ok) {
      return blockResult;
    }
  }

  // Whole-payload byte cap. Compute AFTER block-level validation so we don't
  // pay the encoding cost on payloads we'd reject anyway.
  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(input)).length;
  } catch {
    return { ok: false, reason: 'payload is not JSON-serializable' };
  }
  if (bytes > FOXY_MAX_PAYLOAD_BYTES) {
    return {
      ok: false,
      reason: `payload exceeds ${FOXY_MAX_PAYLOAD_BYTES} bytes (got ${bytes})`,
    };
  }

  // Cast: shape verified above.
  return { ok: true, value: input as FoxyResponse };
}

// deno-lint-ignore no-explicit-any
function validateBlock(block: any, index: number): ValidationResult {
  if (block === null || typeof block !== 'object' || Array.isArray(block)) {
    return { ok: false, reason: `blocks[${index}] must be an object` };
  }
  const { type, text, label, latex } = block as Record<string, unknown>;

  if (typeof type !== 'string' || !ALLOWED_BLOCK_TYPES.has(type as FoxyBlockType)) {
    return {
      ok: false,
      reason: `blocks[${index}].type must be one of paragraph|step|math|answer|exam_tip|definition|example|question (got ${String(type)})`,
    };
  }

  if (label !== undefined) {
    if (typeof label !== 'string') {
      return { ok: false, reason: `blocks[${index}].label must be a string` };
    }
    if (label.length > FOXY_MAX_TEXT_LEN) {
      return {
        ok: false,
        reason: `blocks[${index}].label exceeds ${FOXY_MAX_TEXT_LEN} chars`,
      };
    }
  }

  if (type === 'math') {
    if (text !== undefined) {
      return {
        ok: false,
        reason: `blocks[${index}] of type 'math' must not include a 'text' field`,
      };
    }
    if (typeof latex !== 'string' || latex.trim() === '') {
      return {
        ok: false,
        reason: `blocks[${index}] of type 'math' requires a non-empty 'latex' field`,
      };
    }
    if (latex.length > FOXY_MAX_LATEX_LEN) {
      return {
        ok: false,
        reason: `blocks[${index}].latex exceeds ${FOXY_MAX_LATEX_LEN} chars`,
      };
    }
    // KaTeX wrapping is the consumer's job; reject any `$` or `$$` delimiters.
    if (/\${1,2}/.test(latex)) {
      return {
        ok: false,
        reason: `blocks[${index}].latex must not contain '$' or '$$' delimiters`,
      };
    }
    return { ok: true, value: undefined as unknown as FoxyResponse };
  }

  // Non-math types: text required + non-empty after trim; latex forbidden.
  if (TEXT_BEARING_TYPES.has(type as FoxyBlockType)) {
    if (typeof text !== 'string' || text.trim() === '') {
      return {
        ok: false,
        reason: `blocks[${index}] of type '${type}' requires a non-empty 'text' field`,
      };
    }
    if (text.length > FOXY_MAX_TEXT_LEN) {
      return {
        ok: false,
        reason: `blocks[${index}].text exceeds ${FOXY_MAX_TEXT_LEN} chars`,
      };
    }
    if (latex !== undefined) {
      return {
        ok: false,
        reason: `blocks[${index}] of type '${type}' must not include a 'latex' field`,
      };
    }
  }

  return { ok: true, value: undefined as unknown as FoxyResponse };
}

// ── Subject-aware validation (mirrors src/lib/foxy/schema.ts) ───────────────

export type SubjectCheckResult =
  | { ok: true; warnings?: string[] }
  | { ok: false; reason: string };

/**
 * Apply subject-specific block-mix rules. Mirrors validateSubjectRules in
 * src/lib/foxy/schema.ts.
 *   - math:    warn if no math block; never reject.
 *   - science: math blocks <= 30% of total.
 *   - sst:     math blocks <= 20% of total (Economics %/growth, Geography
 *              scale/density, Statistics-for-Economics mean/median).
 *   - english: no math blocks.
 *   - general: no rules.
 */
export function validateSubjectRules(parsed: FoxyResponse): SubjectCheckResult {
  const blocks = parsed.blocks;
  const totalBlocks = blocks.length;
  const mathBlockCount = blocks.filter((b) => b.type === 'math').length;
  const warnings: string[] = [];

  switch (parsed.subject) {
    case 'math': {
      if (mathBlockCount === 0) {
        warnings.push(
          'subject=math but no math blocks present; expected at least one',
        );
      }
      return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
    }
    case 'science': {
      const ratio = totalBlocks === 0 ? 0 : mathBlockCount / totalBlocks;
      if (ratio > 0.3) {
        return {
          ok: false,
          reason:
            `subject=science permits math blocks only for formulas (max 30% of blocks); ` +
            `got ${mathBlockCount}/${totalBlocks} (${Math.round(ratio * 100)}%)`,
        };
      }
      return { ok: true };
    }
    case 'sst': {
      // Cap math blocks at 20% of total. Strict `>` ensures small-N degenerate
      // cases (e.g. 1 block / 1 math, ratio 1.0) still reject. Permits CBSE
      // Class 9-10 Economics percentage/growth, Class 11-12 Statistics-for-
      // Economics mean/median, and Geography scale/density formulas.
      const ratio = totalBlocks === 0 ? 0 : mathBlockCount / totalBlocks;
      if (ratio > 0.2) {
        return {
          ok: false,
          reason:
            `subject=sst permits math blocks sparingly (max 20% of blocks); ` +
            `got ${mathBlockCount}/${totalBlocks} (${Math.round(ratio * 100)}%)`,
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

// ── Safe-fallback constructor (mirrors wrapAsParagraph) ─────────────────────

/**
 * Build a guaranteed-valid FoxyResponse from arbitrary raw text. Used when
 * Claude returns non-JSON, malformed JSON, or schema-failing JSON.
 *
 * Truncates to FOXY_FALLBACK_MAX_CHARS, splits on blank lines, caps blocks at
 * FOXY_FALLBACK_MAX_BLOCKS (overflow folded into final block, then truncated
 * to FOXY_MAX_TEXT_LEN). Always returns a payload that passes
 * validateFoxyResponse.
 */
export function wrapAsParagraph(
  rawText: string,
  opts: { title?: string; subject?: FoxySubject } = {},
): FoxyResponse {
  const title = (opts.title ?? 'Foxy').slice(0, FOXY_MAX_TITLE_LEN) || 'Foxy';
  const subject: FoxySubject = opts.subject ?? 'general';

  const safe = (typeof rawText === 'string' ? rawText : '').slice(
    0,
    FOXY_FALLBACK_MAX_CHARS,
  );

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
    const head = rawParas.slice(0, FOXY_FALLBACK_MAX_BLOCKS - 1);
    const tail = rawParas.slice(FOXY_FALLBACK_MAX_BLOCKS - 1).join('\n\n');
    paras = [...head, tail];
  }

  const blocks: FoxyBlock[] = paras.map((p) => ({
    type: 'paragraph' as const,
    text: p.slice(0, FOXY_MAX_TEXT_LEN),
  }));

  return {
    title,
    subject,
    blocks,
  };
}

// ── Denormalized text builder ───────────────────────────────────────────────

/**
 * Concatenate the human-readable contents of a structured FoxyResponse into a
 * single string suitable for storage in `foxy_chat_messages.content` (legacy
 * TEXT column). Math blocks are wrapped in `$$...$$` so the legacy renderer
 * can still display them. Order preserves block order; double-newline
 * between blocks for readability.
 */
export function denormalizeFoxyResponse(parsed: FoxyResponse): string {
  const parts: string[] = [];
  for (const block of parsed.blocks) {
    if (block.type === 'math') {
      const latex = block.latex ?? '';
      if (latex.trim().length > 0) {
        parts.push(`$$${latex}$$`);
      }
    } else if (typeof block.text === 'string' && block.text.trim().length > 0) {
      parts.push(block.text);
    }
  }
  return parts.join('\n\n');
}
