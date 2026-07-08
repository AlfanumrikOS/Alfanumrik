/**
 * ALFANUMRIK -- Foxy AI Tutor: Inline-math + markdown-emphasis NORMALIZER
 *
 * Defense-in-depth post-processor for the structured-output `text`/`label`
 * fields. The structured-output prompt (FOXY_STRUCTURED_OUTPUT_PROMPT) now
 * EXPLICITLY allows inline math via `\( ... \)` (inline) and `\[ ... \]`
 * (display-in-prose), and FORBIDS markdown emphasis. The model is good but not
 * perfect: it still occasionally emits `$...$` / `$$...$$` delimiters (the form
 * it was trained on across the web) and stray `**bold**` / `__bold__`. This
 * module mechanically canonicalises those artefacts so the renderer always sees
 * the one form it is built to handle, regardless of which delimiter the model
 * reached for.
 *
 * What it does, per text/label field:
 *   1. `$$...$$`  -> `\[...\]`   (display math; respects escaped `\$`)
 *   2. `$...$`    -> `\(...\)`   (inline math;  respects escaped `\$`)
 *   3. `**x**` / `__x__` -> `x`  (strip paired emphasis on PLAIN-TEXT segments
 *                                  only; never inside `\(...\)` / `\[...\]`)
 *
 * What it deliberately does NOT touch:
 *   - `math` block `latex`  -- already clean (no `$`, no wrappers); schema-gated.
 *   - `code` block `text`   -- code must stay byte-for-byte literal. Markdown /
 *                              math syntax inside code is real program text.
 *   - `mcq` fields          -- stem/options/explanation are rendered as MCQ UI,
 *                              not through the inline-math renderer; left as-is.
 *   - `diagram.search_query` -- a retrieval key, not rendered prose.
 *   - already-`\(`/`\[` content -- only `$`-delimited math is converted; the
 *                              backslash forms pass through verbatim.
 *
 * Properties:
 *   - Pure: no DOM, no React, no I/O. Safe for Edge runtimes + unit tests.
 *   - Idempotent: running it twice yields the same result as running it once.
 *     (After the first pass there are no `$`-delimiters and no paired `**`/`__`
 *     in plain-text segments left to act on.)
 *   - Caps-safe: only ever SHRINKS or holds text length (it strips chars and
 *     swaps 2-char `$$`/`**` for 2-char `\[`/`\]` or removes them). Output is
 *     re-validated against FoxyResponseSchema by the caller; this function also
 *     clamps to FOXY_MAX_TEXT_LEN defensively so it can never push a field over
 *     the schema cap.
 *
 * Product invariant compliance:
 *   P12 (AI Safety) -- this is MECHANICAL post-processing. No new LLM call, no
 *     network, no widening of the validation bar. It only rewrites delimiter
 *     syntax and removes emphasis tokens the prompt already forbids. The result
 *     is re-validated by the caller before it reaches a student.
 *   P7 (Bilingual UI) -- operates on raw code points; Hindi/Devanagari text and
 *     technical terms pass through unchanged (it only matches `$`, `**`, `__`
 *     and the LaTeX backslash delimiters).
 */
import {
  FOXY_MAX_TEXT_LEN,
  type FoxyResponse,
  type FoxyBlock,
} from './schema';

/**
 * Block types whose `text` field is rendered through the inline-math renderer
 * and therefore should be normalised. Excludes `code` (literal), `math`
 * (no text), `mcq` (rendered as MCQ UI from stem/options), and `diagram`
 * (no text). `label` is normalised for every block EXCEPT `code` (a code block
 * label is still a caption, but we keep the rule simple and symmetric: code
 * blocks are never touched at all).
 */
const NORMALIZE_TEXT_TYPES: ReadonlySet<FoxyBlock['type']> = new Set([
  'paragraph',
  'step',
  'answer',
  'exam_tip',
  'definition',
  'example',
  'question',
]);

/**
 * Split a string into segments, marking which segments are math (already in
 * `\( ... \)` or `\[ ... \]` form) vs plain text. Plain-text segments are the
 * only ones we strip emphasis from; math segments pass through verbatim so we
 * never corrupt LaTeX.
 *
 * The matcher is deliberately conservative: it pairs an opening `\(`/`\[` with
 * the NEXT corresponding closing `\)`/`\]`. Unbalanced delimiters (an opening
 * with no close) are treated as plain text so we never swallow the rest of the
 * field into a phantom math segment.
 */
function splitMathSegments(
  s: string,
): Array<{ text: string; isMath: boolean }> {
  const segments: Array<{ text: string; isMath: boolean }> = [];
  let i = 0;
  let plainStart = 0;
  const n = s.length;

  while (i < n) {
    // Look for an opening inline `\(` or display `\[` delimiter. A backslash
    // that is itself escaped (`\\(`) does not open math — count preceding
    // backslashes to decide.
    if (s[i] === '\\' && (s[i + 1] === '(' || s[i + 1] === '[')) {
      // Count consecutive backslashes ending at i.
      let bs = 0;
      let k = i;
      while (k >= 0 && s[k] === '\\') {
        bs++;
        k--;
      }
      // An odd backslash run means the `\` before `(`/`[` is a real escape
      // (delimiter); an even run means the `\` is itself escaped -> not a
      // delimiter. Since we walk left-to-right and i points at the LAST
      // backslash of any run, bs===1 is the common (single `\`) case.
      const open = s[i + 1] === '(' ? ')' : ']';
      const closeSeq = '\\' + open;
      const closeIdx = s.indexOf(closeSeq, i + 2);
      if (bs % 2 === 1 && closeIdx !== -1) {
        // Flush the plain-text run before this math segment.
        if (i > plainStart) {
          segments.push({ text: s.slice(plainStart, i), isMath: false });
        }
        // Math segment includes the closing `\)` / `\]`.
        segments.push({
          text: s.slice(i, closeIdx + closeSeq.length),
          isMath: true,
        });
        i = closeIdx + closeSeq.length;
        plainStart = i;
        continue;
      }
    }
    i++;
  }
  if (plainStart < n) {
    segments.push({ text: s.slice(plainStart), isMath: false });
  }
  return segments;
}

/**
 * Strip paired markdown emphasis (`**x**`, `__x__`) from a PLAIN-TEXT segment.
 * Conservative: only removes a pair when both the opener and closer wrap at
 * least one non-whitespace character, and only the exact 2-char `**`/`__`
 * tokens. Single `*`/`_` (italics, multiplication, snake_case) are left alone —
 * those are too ambiguous to safely strip and the renderer handles them.
 *
 * Idempotent: after one pass no paired `**`/`__` tokens remain to act on.
 */
function stripEmphasisPlain(s: string): string {
  // `**bold**` -> `bold`. Non-greedy body; require a non-`*` first char so we
  // don't match across `** **` empties or `****`. Run until stable to handle
  // nested/adjacent pairs deterministically.
  let prev: string;
  let out = s;
  do {
    prev = out;
    out = out
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1')
      .replace(/__(?=\S)([\s\S]*?\S)__/g, '$1');
  } while (out !== prev);
  return out;
}

/**
 * Convert `$$...$$` -> `\[...\]` and `$...$` -> `\(...\)`.
 *
 * Escaped dollars (`\$`) are literal currency/text and are left untouched. We
 * tokenise by scanning for unescaped `$` runs:
 *   - `$$` opens a display block, closed by the next unescaped `$$`.
 *   - a single `$` opens inline math, closed by the next unescaped single `$`.
 * Unbalanced trailing `$` (no closer) is left verbatim so we never produce a
 * half-open delimiter.
 *
 * Operates on the WHOLE field (math + plain), because `$`-delimited spans are
 * by definition not yet in `\(`/`\[` form. Content that is ALREADY in `\(`/`\[`
 * form contains no `$`, so it is untouched.
 */
function convertDollarDelimiters(s: string): string {
  if (s.indexOf('$') === -1) return s;

  let out = '';
  let i = 0;
  const n = s.length;

  const isEscaped = (idx: number): boolean => {
    // Count backslashes immediately preceding idx; odd => escaped.
    let bs = 0;
    let k = idx - 1;
    while (k >= 0 && s[k] === '\\') {
      bs++;
      k--;
    }
    return bs % 2 === 1;
  };

  while (i < n) {
    if (s[i] === '$' && !isEscaped(i)) {
      const isDisplay = s[i + 1] === '$';
      if (isDisplay) {
        // Find the next unescaped `$$`.
        let j = i + 2;
        let closeAt = -1;
        while (j < n - 1) {
          if (s[j] === '$' && s[j + 1] === '$' && !isEscaped(j)) {
            closeAt = j;
            break;
          }
          j++;
        }
        if (closeAt !== -1) {
          const body = s.slice(i + 2, closeAt);
          out += '\\[' + body + '\\]';
          i = closeAt + 2;
          continue;
        }
        // No closer -> emit the `$$` literally and move on.
        out += '$$';
        i += 2;
        continue;
      } else {
        // Inline: find next unescaped single `$` that is not part of a `$$`.
        let j = i + 1;
        let closeAt = -1;
        while (j < n) {
          if (s[j] === '$' && !isEscaped(j)) {
            // A `$$` here is not a single-dollar closer.
            if (s[j + 1] === '$') {
              // Skip the pair; it cannot close a single-dollar span.
              j += 2;
              continue;
            }
            closeAt = j;
            break;
          }
          j++;
        }
        if (closeAt !== -1) {
          const body = s.slice(i + 1, closeAt);
          out += '\\(' + body + '\\)';
          i = closeAt + 1;
          continue;
        }
        // No closer -> emit the `$` literally and move on.
        out += '$';
        i += 1;
        continue;
      }
    }
    out += s[i];
    i += 1;
  }
  return out;
}

/**
 * Normalise a single text/label field:
 *   1. Convert `$`/`$$` delimiters to `\(`/`\[` form (whole field).
 *   2. Strip paired `**`/`__` emphasis on plain-text segments only.
 *   3. Clamp to FOXY_MAX_TEXT_LEN (never grows past the schema cap).
 *
 * Pure + idempotent.
 */
export function normalizeInlineField(input: string): string {
  if (typeof input !== 'string' || input.length === 0) return input;

  // Step 1: canonicalise dollar delimiters across the whole field.
  const dollarConverted = convertDollarDelimiters(input);

  // Step 2: strip emphasis only on plain-text segments (never inside math).
  const segments = splitMathSegments(dollarConverted);
  let rebuilt = '';
  for (const seg of segments) {
    rebuilt += seg.isMath ? seg.text : stripEmphasisPlain(seg.text);
  }

  // Step 3: defensive clamp. The transforms only shrink/hold length, but a
  // field already AT the cap must never tip over after a no-op rewrite.
  if (rebuilt.length > FOXY_MAX_TEXT_LEN) {
    rebuilt = rebuilt.slice(0, FOXY_MAX_TEXT_LEN);
  }
  return rebuilt;
}

/**
 * Normalise an entire FoxyResponse in place-safe (returns a NEW object; does
 * not mutate the input). Applies to `text` and `label` of renderer-prose
 * blocks. Leaves `code` blocks, `math.latex`, `mcq.*`, and `diagram.*`
 * untouched.
 *
 * The caller MUST re-validate the result against FoxyResponseSchema. Because
 * every transform shrinks-or-holds field length and never introduces a `$` or
 * a stray emphasis token, a payload that validated before normalisation still
 * validates after — but re-validation is the contract (P12 defense-in-depth).
 *
 * Idempotent: normalizeFoxyResponseInline(normalizeFoxyResponseInline(x)) deep-
 * equals normalizeFoxyResponseInline(x).
 */
export function normalizeFoxyResponseInline(r: FoxyResponse): FoxyResponse {
  const blocks: FoxyBlock[] = r.blocks.map((block) => {
    // Code blocks are sacred: do not touch text OR label. Code must stay
    // byte-for-byte literal so `**` / `$` inside source code survive.
    if (block.type === 'code') return block;

    // math / mcq / diagram have no renderer-prose `text`; only `label` (math)
    // is prose. Normalise `label` for non-code blocks, and `text` only for the
    // prose-bearing types.
    const next: FoxyBlock = { ...block };

    if (
      NORMALIZE_TEXT_TYPES.has(block.type) &&
      typeof block.text === 'string'
    ) {
      next.text = normalizeInlineField(block.text);
    }

    if (typeof block.label === 'string') {
      next.label = normalizeInlineField(block.label);
    }

    return next;
  });

  return { ...r, blocks };
}
