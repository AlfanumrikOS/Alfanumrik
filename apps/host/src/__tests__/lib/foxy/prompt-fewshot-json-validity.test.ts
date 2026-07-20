/**
 * Drift guard for the 2026-07-20 LaTeX-in-JSON escaping incident: every
 * few-shot example served in FOXY_STRUCTURED_OUTPUT_PROMPT MUST itself be
 * valid JSON, and math-bearing examples must carry DOUBLED backslashes.
 *
 * Why this exists: the few-shot examples previously showed LaTeX inside JSON
 * strings with single backslashes ("\\( ax^2 ... \\)" rendered as `\( ax^2
 * ... \)`) — illegal JSON escapes. The model imitated them, JSON.parse threw
 * at the first math-bearing block, and the rescue path silently dropped every
 * block after it (19/29 math turns in 48h). This test would have failed on
 * that prompt: it extracts each example object from the RENDERED prompt and
 * runs it through JSON.parse + the full FoxyResponseSchema.
 *
 * If this test fails after a prompt edit, someone reintroduced an
 * under-escaped example. Fix the example (double every LaTeX backslash in the
 * template-literal SOURCE means writing four backslashes), and mirror across
 * the Deno + Python copies (their own parity tests will chase you).
 */

import { describe, it, expect } from 'vitest';

import {
  FOXY_STRUCTURED_OUTPUT_PROMPT,
  FoxyResponseSchema,
} from '@alfanumrik/lib/foxy/schema';

/**
 * Extract every few-shot example object from the rendered prompt. Examples
 * are the blocks that start at a line beginning `{"title"` and end at the
 * next line that is exactly `]}`.
 */
function extractExamples(prompt: string): { heading: string; json: string }[] {
  const lines = prompt.split('\n');
  const out: { heading: string; json: string }[] = [];
  let heading = '';
  let buf: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith('## ')) heading = line;
    if (line.startsWith('{"title"')) buf = [line];
    else if (buf) {
      buf.push(line);
      if (line.trim() === ']}') {
        out.push({ heading, json: buf.join('\n') });
        buf = null;
      }
    }
  }
  return out;
}

const examples = extractExamples(FOXY_STRUCTURED_OUTPUT_PROMPT);

describe('FOXY_STRUCTURED_OUTPUT_PROMPT few-shot examples', () => {
  it('finds the full example set (currently 10)', () => {
    expect(examples.length).toBe(10);
  });

  it.each(examples.map((e) => [e.heading, e.json] as const))(
    '%s — parses as strict JSON',
    (_heading, json) => {
      expect(() => JSON.parse(json)).not.toThrow();
    },
  );

  it.each(examples.map((e) => [e.heading, e.json] as const))(
    '%s — validates against FoxyResponseSchema (the model imitates these verbatim)',
    (_heading, json) => {
      const result = FoxyResponseSchema.safeParse(JSON.parse(json));
      if (!result.success) {
        throw new Error(
          `Few-shot example fails the schema it teaches: ${result.error.message}`,
        );
      }
      expect(result.success).toBe(true);
    },
  );

  it('math-bearing examples decode to single-backslash LaTeX (proof the doubling is right)', () => {
    const quadratic = examples.find((e) => e.json.includes('Quadratic'));
    expect(quadratic).toBeDefined();
    const parsed = JSON.parse(quadratic!.json);
    const definition = parsed.blocks[0].text as string;
    // After JSON decoding the renderer receives `\( ... \)` and `\neq`.
    expect(definition).toContain('\\( ax^2 + bx + c = 0 \\)');
    expect(definition).toContain('\\neq');
    const formula = parsed.blocks[2].latex as string;
    expect(formula).toBe('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
  });

  it('the explicit JSON-escaping rule is present in the constraints', () => {
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toContain(
      'JSON ESCAPING FOR MATH (CRITICAL)',
    );
    // Rendered rule shows the doubled-vs-single contrast.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toContain('\\\\frac not \\frac');
  });
});
