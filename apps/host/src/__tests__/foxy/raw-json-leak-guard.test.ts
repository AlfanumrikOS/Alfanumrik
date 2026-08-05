/**
 * FOXY-RAWJSON (2026-08-05) — CEO-reported live production incident.
 *
 * A Grade-6 student typed `9x+5` on /foxy (Mathematics, Ch 4 "Expressions
 * using Letter-Numbers") and Foxy replied with the RAW structured envelope
 * rendered verbatim in a monospace code block. The JSON was well-formed
 * prefix-wise and the CONTENT was correct — the failure was entirely in the
 * envelope parse/render path:
 *
 *   1. The payload was TRUNCATED (cut mid-string inside the `blocks` array).
 *   2. `recoverFoxyResponseFromText` used a bare `JSON.parse`, so truncation
 *      (and under-escaped LaTeX, the other observed failure mode) made it
 *      return `null`.
 *   3. Every caller treated `null` as "render the string as markdown". A
 *      pretty-printed JSON envelope indented with 2 spaces is, to a markdown
 *      renderer, an INDENTED CODE BLOCK — hence the monospace dump.
 *
 * These tests pin the two guarantees that close it:
 *   A. Recovery now survives truncation + illegal JSON escapes (it reuses the
 *      already-hardened `rescueFromTruncatedJson`, which still validates
 *      against `FoxyResponseSchema` — P12's bar is unchanged).
 *   B. `coerceStudentFacingStructured` / `coerceStudentFacingText` make
 *      "no raw JSON ever reaches a student" UNCONDITIONAL: for JSON-shaped
 *      input they can never return `null` / echo the input back.
 *
 * Invariants: P12 (no unfiltered LLM output to students), P7 (the terminal
 * fallback copy is bilingual EN + Hinglish).
 */
import { describe, it, expect } from 'vitest';
import {
  recoverFoxyResponseFromText,
  coerceStudentFacingStructured,
  coerceStudentFacingText,
} from '@alfanumrik/lib/foxy/recover-from-text';
import { isJsonShapedRawText } from '@alfanumrik/lib/foxy/schema';

/**
 * The production payload from the CEO screenshot, reproduced verbatim in
 * shape: pretty-printed with 2-space indent, `$ ... $` math delimiters, LaTeX
 * with correctly-doubled backslashes (`\\times`), and CUT OFF mid-array — the
 * screenshot's last visible line is a bare `{`.
 */
const TRUNCATED_PROD_PAYLOAD = `{
  "title": "Understanding Expressions with Letter-Numbers",
  "subject": "math",
  "blocks": [
    {
      "type": "paragraph",
      "label": "What You've Written",
      "text": "You've written $ 9x + 5 $. This is an algebraic expression — a combination of numbers, letters (called variables), and operations."
    },
    {
      "type": "definition",
      "label": "Breaking It Down",
      "text": "In $ 9x + 5 $: the term $ 9x $ means 9 times the unknown number x, and the term $ 5 $ is a constant."
    },
    {
      "type": "example",
      "label": "Finding the Value",
      "text": "If x = 2, then $ 9x + 5 = 9 \\\\times 2 + 5 = 18 + 5 = 23 $. If x = 3, then $ 9x + 5 = 9 \\\\times 3 + 5`;

/**
 * The other observed failure mode: a COMPLETE payload whose LaTeX backslashes
 * were NOT doubled, so `\\times` is an illegal JSON escape and `JSON.parse`
 * aborts on the whole document.
 */
const UNDER_ESCAPED_PAYLOAD =
  '{"title":"Expressions using Letter-Numbers","subject":"math","blocks":[' +
  '{"type":"paragraph","text":"Here 9x means 9 \\times x."},' +
  '{"type":"answer","text":"The expression is 9x + 5."}]}';

describe('FOXY-RAWJSON — recoverFoxyResponseFromText survives the prod failure modes', () => {
  it('recovers the complete blocks from the TRUNCATED production payload', () => {
    const recovered = recoverFoxyResponseFromText(TRUNCATED_PROD_PAYLOAD);

    // Before the fix this was `null` — which is what let the raw JSON fall
    // through to the markdown renderer.
    expect(recovered).not.toBeNull();
    expect(recovered!.title).toBe('Understanding Expressions with Letter-Numbers');
    expect(recovered!.subject).toBe('math');
    // The two blocks that completed before the cut are salvaged; the partial
    // third is dropped (rescue never lowers the schema bar to keep it).
    expect(recovered!.blocks.length).toBeGreaterThanOrEqual(2);
    const firstText = (recovered!.blocks[0] as { text?: string }).text ?? '';
    expect(firstText).toContain('algebraic expression');
  });

  it('recovers a payload whose LaTeX backslashes were under-escaped', () => {
    const recovered = recoverFoxyResponseFromText(UNDER_ESCAPED_PAYLOAD);
    expect(recovered).not.toBeNull();
    expect(recovered!.blocks.length).toBe(2);
  });

  it('still returns null for genuine prose (no false positives)', () => {
    expect(recoverFoxyResponseFromText('Let us solve 9x + 5 together!')).toBeNull();
    expect(recoverFoxyResponseFromText('')).toBeNull();
    expect(recoverFoxyResponseFromText(null)).toBeNull();
  });
});

describe('FOXY-RAWJSON — coerceStudentFacingStructured is an UNCONDITIONAL P12 guard', () => {
  const jsonShapedInputs: Array<[string, string]> = [
    ['truncated production payload', TRUNCATED_PROD_PAYLOAD],
    ['under-escaped LaTeX payload', UNDER_ESCAPED_PAYLOAD],
    ['fenced envelope', '```json\n{"title":"T","subject":"math","blocks":[{"type":"paragraph","text":"hello"}]}\n```'],
    // Irrecoverable: cut before a single block completed, so neither rescue nor
    // "text"-field extraction can salvage anything.
    ['irrecoverable stub', '{"title":"Understanding Expressions","subject":"math","blocks":[{"type":"para'],
    // Structurally valid JSON that is NOT a FoxyResponse at all.
    ['foreign JSON object', '{"error":"upstream failed","code":500}'],
    ['bare JSON array', '[{"type":"paragraph","text":"x"}]'],
  ];

  it.each(jsonShapedInputs)('never returns null for JSON-shaped input: %s', (_label, raw) => {
    expect(isJsonShapedRawText(raw)).toBe(true);
    const coerced = coerceStudentFacingStructured(raw);
    expect(coerced).not.toBeNull();
    expect(coerced!.blocks.length).toBeGreaterThan(0);
  });

  it.each(jsonShapedInputs)(
    'never emits a block whose student-visible text is itself JSON-shaped: %s',
    (_label, raw) => {
      const coerced = coerceStudentFacingStructured(raw)!;
      for (const block of coerced.blocks as Array<Record<string, unknown>>) {
        const text = typeof block.text === 'string' ? block.text : '';
        if (text.length === 0) continue;
        expect(isJsonShapedRawText(text)).toBe(false);
        // Belt and braces: no envelope keys leaking into rendered prose.
        expect(text).not.toContain('"blocks"');
        expect(text).not.toContain('"correct_answer_index"');
      }
    },
  );

  it('falls back to the bilingual truncation message when nothing is salvageable (P7)', () => {
    const coerced = coerceStudentFacingStructured(
      '{"title":"Understanding Expressions","subject":"math","blocks":[{"type":"para',
    )!;
    const text = (coerced.blocks[0] as { text?: string }).text ?? '';
    expect(text).toContain('my answer got cut off');
    // Hinglish half — P7 bilingual.
    expect(text).toContain('Maafi');
  });

  it('returns null for genuine prose so the normal markdown path is unchanged', () => {
    expect(coerceStudentFacingStructured('Great question! Let us break 9x + 5 down.')).toBeNull();
    expect(coerceStudentFacingStructured('')).toBeNull();
    expect(coerceStudentFacingStructured(undefined)).toBeNull();
  });
});

describe('FOXY-RAWJSON — coerceStudentFacingText (the string/mobile surface)', () => {
  it('is BYTE-IDENTICAL for prose (zero happy-path behaviour change)', () => {
    const prose =
      'Step 1: An expression combines numbers and letters.\n\nStep 2: In 9x + 5, x is the variable.';
    expect(coerceStudentFacingText(prose)).toBe(prose);
    expect(coerceStudentFacingText('')).toBe('');
  });

  it('never echoes JSON-shaped input back to the caller', () => {
    for (const [, raw] of [
      ['truncated', TRUNCATED_PROD_PAYLOAD],
      ['under-escaped', UNDER_ESCAPED_PAYLOAD],
      ['irrecoverable', '{"title":"X","subject":"math","blocks":[{"type":"para'],
    ] as Array<[string, string]>) {
      const out = coerceStudentFacingText(raw);
      expect(out).not.toBe(raw);
      expect(isJsonShapedRawText(out)).toBe(false);
      expect(out).not.toContain('"blocks"');
    }
  });

  it('produces the readable denormalized rendering for the production payload', () => {
    const out = coerceStudentFacingText(TRUNCATED_PROD_PAYLOAD);
    expect(out).toContain('Understanding Expressions with Letter-Numbers');
    expect(out).toContain('algebraic expression');
    expect(out.startsWith('{')).toBe(false);
  });
});
