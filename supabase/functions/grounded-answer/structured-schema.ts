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
  | 'question'
  | 'diagram'
  | 'code';

export type FoxySubject = 'math' | 'science' | 'sst' | 'english' | 'general';

export interface FoxyBlock {
  type: FoxyBlockType;
  text?: string;
  label?: string;
  latex?: string;
  // diagram-only
  search_query?: string;
  // code-only
  language?: string;
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
  'diagram',
  'code',
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
  'code',
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
      reason: `blocks[${index}].type must be one of paragraph|step|math|answer|exam_tip|definition|example|question|diagram|code (got ${String(type)})`,
    };
  }

  // diagram blocks: require search_query, no text/latex
  if (type === 'diagram') {
    const { search_query } = block as Record<string, unknown>;
    if (typeof search_query !== 'string' || search_query.trim() === '') {
      return {
        ok: false,
        reason: `blocks[${index}] of type 'diagram' requires a non-empty 'search_query' field`,
      };
    }
    return { ok: true, value: undefined as unknown as FoxyResponse };
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
 * Detect whether `rawText` is a Foxy JSON payload (possibly inside a markdown
 * fence). When true, wrapAsParagraph MUST NOT emit it as paragraph text — the
 * student would see literal `{"title":...}` in their chat. Conservative
 * matcher: only flags payloads that LOOK like a structured-output attempt
 * (leading `{`/`[` after optional fence + whitespace) so it never trips on
 * legitimate prose that mentions JSON.
 */
function isJsonShapedRawText(rawText: string): boolean {
  if (typeof rawText !== 'string') return false;
  const stripped = rawText.replace(/^[\s`]*(?:json|javascript|js)?\s*/i, '');
  return /^[{[]/.test(stripped);
}

/**
 * Strip markdown code fences (```json … ``` or bare ``` … ```) — single-pass,
 * never throws. Mirrors stripCodeFence in pipeline.ts so fallback paths in
 * structured-schema can reuse the same normalisation.
 */
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
  const v = validateFoxyResponse(parsed);
  return v.ok ? v.value : null;
}

/**
 * Append unmatched closing brackets/braces to balance a truncated JSON slice.
 * Walks the string with a tiny state machine that respects string literals
 * and escape sequences so a `{` inside `"foo {"` is not counted as an open.
 *
 * Used by `rescueFromTruncatedJson` to recover whatever blocks Claude
 * managed to emit before max_tokens cut the response.
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
 * Truncation rescue. Common Haiku failure mode: max_tokens cuts mid-block,
 * leaving JSON like `{"title":"…","blocks":[{...},{...},{"type":"step",
 * "text":"Observa` — every block before the cutoff is complete and valid,
 * we just need to drop the trailing partial block and close the structure.
 *
 * Strategy: walk backward from the last `}` looking for slices whose
 * `closeUnbalancedJson` extension parses AND validates as a FoxyResponse.
 * Returns null if no such slice exists.
 *
 * P12 alignment: this NEVER lowers the validation bar. The candidate must
 * still pass validateFoxyResponse — a partial schema-failing recovery is
 * worse than the friendly fallback, so we bail rather than ship junk.
 */
export function rescueFromTruncatedJson(rawText: string): FoxyResponse | null {
  if (typeof rawText !== 'string' || rawText.length === 0) return null;
  const candidate = stripFences(rawText);
  if (!candidate.startsWith('{')) return null;

  // First try the candidate verbatim (covers the case where the JSON is
  // intact but parseStreamingFoxy failed for some other reason).
  const direct = tryParseFoxy(candidate);
  if (direct) return direct;

  // Walk backward through `}` boundaries, balancing brackets at each step.
  // Bound the loop at 50 iterations so a pathological input cannot pin the
  // event loop.
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
 * the broken JSON via regex so we can at least show the human-readable
 * sentences Claude wrote. Used when `rescueFromTruncatedJson` couldn't
 * recover a valid FoxyResponse (e.g. truncation cut mid-string).
 *
 * Returns recovered strings in document order. JSON-decodes each capture so
 * `\n`, `\"`, etc. are unescaped properly.
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
 * Bilingual "I got cut off" message used when raw JSON cannot be recovered
 * via rescue or text-field extraction. Inline EN + Hinglish so the message
 * lands for both English-medium and Hindi-medium students until language is
 * plumbed into this layer.
 */
const FOXY_TRUNCATION_FALLBACK_TEXT =
  'Sorry — my answer got cut off. Could you re-ask, ideally one question at a time? ' +
  'Maafi, mera jawab beech mein ruk gaya. Ek-ek karke sawal poochho na?';

/**
 * Build a guaranteed-valid FoxyResponse from arbitrary raw text. Used when
 * Claude returns non-JSON, malformed JSON, or schema-failing JSON.
 *
 * **Critical contract: this function must NEVER produce a paragraph block
 * whose text is JSON-shaped.** That was the May-2026 production regression:
 * Haiku truncated mid-JSON, JSON.parse failed, and the prior implementation
 * dutifully wrapped the raw `{"title":"…","blocks":[…` string into a
 * paragraph, which the renderer faithfully displayed to students. The fix:
 * detect JSON-shaped input and route through rescue → text extraction →
 * friendly bilingual fallback, in that order. The legacy prose-wrapping
 * branch only runs when the input is genuinely prose.
 */
export function wrapAsParagraph(
  rawText: string,
  opts: { title?: string; subject?: FoxySubject } = {},
): FoxyResponse {
  const title = (opts.title ?? 'Foxy').slice(0, FOXY_MAX_TITLE_LEN) || 'Foxy';
  const subject: FoxySubject = opts.subject ?? 'general';

  // ── JSON-shaped input: NEVER fall through to paragraph wrapping ──
  if (isJsonShapedRawText(rawText)) {
    // Tier 1: truncation rescue. Recovers all complete blocks before the
    // max_tokens cutoff (the most common failure mode in production).
    const rescued = rescueFromTruncatedJson(rawText);
    if (rescued) {
      // Honour the caller-supplied subject hint when the rescued payload
      // disagrees only on subject (e.g. caller knows it's 'science' but
      // model emitted 'general'). Skip when caller didn't pass a hint.
      if (opts.subject && rescued.subject !== opts.subject) {
        return { ...rescued, subject: opts.subject };
      }
      return rescued;
    }

    // Tier 2: regex-extract `"text"` field values when JSON is too damaged
    // to parse. Recovers the human content even if structure is broken.
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

    // Tier 3: friendly bilingual fallback. NEVER raw JSON.
    return {
      title,
      subject,
      blocks: [{ type: 'paragraph', text: FOXY_TRUNCATION_FALLBACK_TEXT }],
    };
  }

  // ── Legacy prose-wrapping branch (unchanged) ──
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
