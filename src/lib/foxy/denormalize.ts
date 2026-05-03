/**
 * ALFANUMRIK -- Foxy AI Tutor: Structured Response Denormalizer
 *
 * Converts a structured `FoxyResponse` (block JSON) into a flat string suitable
 * for storing in `foxy_chat_messages.content TEXT`. The TEXT column stays as a
 * human-readable rendering for:
 *   - Legacy reads (mobile app + admin tooling that haven't adopted structured)
 *   - Search / analytics (LIKE queries don't work on JSONB block trees)
 *   - The renderer's backwards-compat fallback when `structured IS NULL`
 *
 * Output format (newline-separated):
 *   <title>
 *
 *   <block-text-1>
 *   Step N: <step-text>     (for `step` blocks; preserves order)
 *   $$ <latex> $$            (for `math` blocks; LaTeX wrapped in KaTeX delimiters)
 *   <block-text-N>
 *
 * Hard cap: 8 KB output. If the denormalized text exceeds this, it is truncated
 * with an ellipsis ("…") so the TEXT column never blows up. The 8 KB cap is
 * smaller than the 16 KB `FOXY_MAX_PAYLOAD_BYTES` cap on the JSONB payload
 * itself because the denormalized form is intentionally lossy and the JSONB
 * column is the source of truth when present.
 *
 * Product invariant compliance:
 *   P12 (AI Safety) -- this helper does NOT validate; it is a 1-way transform
 *     from already-validated structured input to a flat string. Callers MUST
 *     validate via FoxyResponseSchema.safeParse() before invoking.
 *   P13 (Data Privacy) -- output contains AI text only, no user PII; safe to
 *     log via the redacting logger.
 */
import type { FoxyResponse, FoxyBlock } from './schema';

/** Hard cap on the denormalized output size (bytes ~= chars for ASCII). */
export const FOXY_DENORMALIZE_MAX_CHARS = 8 * 1024; // 8 KB

/**
 * Convert a validated FoxyResponse into a flat newline-separated string.
 *
 * Caller MUST have already validated `r` against `FoxyResponseSchema`. This
 * function trusts its input and does not re-validate. Math blocks are wrapped
 * with `$$ ... $$` KaTeX delimiters; the `latex` field of a math block is
 * guaranteed (by the schema) to be non-empty and to contain no `$` characters,
 * so the delimiter wrap is unambiguous.
 *
 * Step blocks are numbered in the order they appear (1-indexed). The numbering
 * resets per call -- multi-step problems only number their own steps.
 *
 * If the assembled output exceeds FOXY_DENORMALIZE_MAX_CHARS, it is truncated
 * to (cap - 1) chars and an ellipsis ("…") is appended so the result is still
 * a valid UTF-8 string under the cap.
 */
export function denormalizeFoxyResponse(r: FoxyResponse): string {
  // Title first; always present per schema (1..120 chars, validated upstream).
  const lines: string[] = [r.title];

  let stepCounter = 0;
  for (const block of r.blocks as FoxyBlock[]) {
    switch (block.type) {
      case 'math': {
        // Schema guarantees `latex` is present, non-empty, and contains no
        // `$`/`$$` delimiters. Wrap with `$$ ... $$` for KaTeX-style display.
        const latex = (block.latex ?? '').trim();
        if (latex.length > 0) {
          lines.push(`$$ ${latex} $$`);
        }
        break;
      }
      case 'step': {
        stepCounter += 1;
        // Schema guarantees `text` is present and non-empty for non-math types.
        const text = (block.text ?? '').trim();
        if (text.length > 0) {
          lines.push(`Step ${stepCounter}: ${text}`);
        }
        break;
      }
      case 'paragraph':
      case 'answer':
      case 'exam_tip':
      case 'definition':
      case 'example':
      case 'question': {
        const text = (block.text ?? '').trim();
        if (text.length > 0) {
          lines.push(text);
        }
        break;
      }
      default: {
        // Defensive: schema enum is closed, but if a future block type is
        // added we don't want to throw -- skip silently. Validation happens
        // upstream via FoxyResponseSchema.
        break;
      }
    }
  }

  const joined = lines.join('\n');

  if (joined.length > FOXY_DENORMALIZE_MAX_CHARS) {
    // Reserve 1 char for the ellipsis so the final string fits under cap.
    return `${joined.slice(0, FOXY_DENORMALIZE_MAX_CHARS - 1)}…`;
  }
  return joined;
}
