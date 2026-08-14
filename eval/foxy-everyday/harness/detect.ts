// eval/foxy-everyday/harness/detect.ts
//
// Everyday-example rubric — D0, the PRIMARY BINARY. Deterministic, pure, and
// deliberately LLM-free: "did the response contain at least one non-empty
// `example` block?" is a JSON-parse question, and paying a judge to answer a
// parse question would be both wasteful and less reliable.
//
// Offline tooling; never imported by production code.
//
// ── The three outcomes, and why the middle one matters ───────────────────────
//   parsed + has example   -> D0 PASS. Goes to the judge (the only tokens spent).
//   parsed + no example    -> D0 FAIL. Response-level FAIL. No judge call.
//   NOT parsed             -> D0 FAIL with `malformed = true`. Still a FAIL, NOT
//                             inconclusive: we HAVE the response and it is
//                             broken. In production a malformed payload trips
//                             the structured-output validator and the consumer
//                             falls back to wrapAsParagraph, so the student gets
//                             an answer with no example block — a real product
//                             failure, and the rubric records it as one.
// Only a response we NEVER SAW (transport error / missing capture record) is
// INCONCLUSIVE, and that judgement is made in run-eval.ts, not here.
//
// ── Parser tolerance ─────────────────────────────────────────────────────────
// We strip a markdown code fence before parsing, the same recovery the shipped
// FoxyResponse parser and eval/rag/harness/relevance-judge.ts perform. We do NOT
// attempt any deeper repair (no brace-balancing, no json-escape-repair port): a
// payload that needs surgery to parse is not a payload the student's renderer
// would have handled either, and repairing it here would flatter the result.

import { MIN_EXAMPLE_TEXT_CHARS, REQUIRED_BLOCK_TYPE } from './rubric';

/** The D0 outcome for one response. */
export interface DetectResult {
  /** False when the raw text is not parseable JSON with a `blocks` array. */
  parsed: boolean;
  /** True when >= 1 `example` block carries text of at least the minimum length. */
  hasExample: boolean;
  /** The trimmed text of every qualifying `example` block, in document order. */
  exampleTexts: string[];
  /** Count of `example` blocks seen, INCLUDING ones too short to qualify. */
  exampleBlockCount: number;
  /** Total block count (context for the report; 0 when unparsed). */
  blockCount: number;
  /** Present when `parsed` is false — why the parse failed. */
  parseError?: string;
}

/** Strip one leading/trailing markdown fence, if present. */
function stripFences(s: string): string {
  let out = s.trim();
  if (out.startsWith('```')) {
    out = out.replace(/^```(?:json|javascript|js)?\s*/i, '');
    out = out.replace(/```\s*$/i, '');
    out = out.trim();
  }
  return out;
}

/**
 * Run D0 over one raw response string. PURE, never throws.
 *
 * A block qualifies when `type === 'example'` AND its trimmed `text` is at least
 * MIN_EXAMPLE_TEXT_CHARS long. The `label` field is intentionally ignored: the
 * directive puts the example in `text`, and counting a block whose only content
 * is a caption would let `{"type":"example","label":"Real-World Example",
 * "text":""}` pass a gate it plainly should not.
 */
export function detectExampleBlock(raw: string): DetectResult {
  const empty: DetectResult = {
    parsed: false,
    hasExample: false,
    exampleTexts: [],
    exampleBlockCount: 0,
    blockCount: 0,
  };

  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ...empty, parseError: 'raw response is empty' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch (err) {
    return {
      ...empty,
      parseError: `not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...empty, parseError: 'parsed payload is not a JSON object' };
  }

  const blocks = (parsed as Record<string, unknown>).blocks;
  if (!Array.isArray(blocks)) {
    return { ...empty, parseError: 'payload has no `blocks` array' };
  }

  const exampleTexts: string[] = [];
  let exampleBlockCount = 0;

  for (const b of blocks) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    const block = b as Record<string, unknown>;
    if (block.type !== REQUIRED_BLOCK_TYPE) continue;
    exampleBlockCount += 1;
    const text = typeof block.text === 'string' ? block.text.trim() : '';
    if (text.length >= MIN_EXAMPLE_TEXT_CHARS) exampleTexts.push(text);
  }

  return {
    parsed: true,
    hasExample: exampleTexts.length > 0,
    exampleTexts,
    exampleBlockCount,
    blockCount: blocks.length,
  };
}

/**
 * Extract the non-example prose of a response, so the judge can check that the
 * example is RELEVANT to the answer and that it does not assert facts the answer
 * never grounded (dimensions `relevant` and `factually_safe`).
 *
 * Returns a bounded, plain-text projection of every non-example block's
 * text/latex/stem. Bounded because the judge context must not be blown by a
 * 16 KB payload; truncation is at the END, so the opening explanation (the part
 * the example is supposed to illustrate) always survives.
 */
export function extractAnswerContext(raw: string, maxChars = 3000): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(raw));
  } catch {
    return '';
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';

  const obj = parsed as Record<string, unknown>;
  const blocks = Array.isArray(obj.blocks) ? obj.blocks : [];
  const parts: string[] = [];

  if (typeof obj.title === 'string' && obj.title.length > 0) parts.push(`TITLE: ${obj.title}`);

  for (const b of blocks) {
    if (!b || typeof b !== 'object' || Array.isArray(b)) continue;
    const block = b as Record<string, unknown>;
    if (block.type === REQUIRED_BLOCK_TYPE) continue; // the example itself is passed separately
    const type = typeof block.type === 'string' ? block.type : 'block';
    const text =
      (typeof block.text === 'string' && block.text) ||
      (typeof block.latex === 'string' && block.latex) ||
      (typeof block.stem === 'string' && block.stem) ||
      '';
    if (text) parts.push(`[${type}] ${text}`);
  }

  const joined = parts.join('\n');
  return joined.length > maxChars ? `${joined.slice(0, maxChars)}\n…[truncated]` : joined;
}
