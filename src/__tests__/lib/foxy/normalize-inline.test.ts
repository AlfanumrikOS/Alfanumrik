/**
 * Unit tests for src/lib/foxy/normalize-inline.ts
 *
 * Pins the mechanical inline-math + markdown-emphasis normalizer:
 *   - `$$...$$`  -> `\[...\]` (display math)
 *   - `$...$`    -> `\(...\)` (inline math)
 *   - `**x**` / `__x__` -> `x` (paired emphasis stripped on plain-text only)
 *   - never corrupts content already in `\(`/`\[` form
 *   - never touches `code` blocks, `math.latex`, `mcq.*`, `diagram.*`
 *   - respects escaped `\$`
 *   - idempotent + pure (no mutation of input)
 *   - output stays within FoxyResponseSchema
 *
 * P12 (AI Safety): this is the defense-in-depth post-processor. These tests
 * pin that it canonicalises delimiters WITHOUT lowering the validation bar or
 * corrupting math/code.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeInlineField,
  normalizeFoxyResponseInline,
} from '@/lib/foxy/normalize-inline';
import { FoxyResponseSchema, type FoxyResponse } from '@/lib/foxy/schema';

describe('normalizeInlineField -- dollar delimiter conversion', () => {
  it('converts inline $...$ to \\(...\\)', () => {
    expect(normalizeInlineField('in $\\frac{3}{4}$, 3 is the numerator')).toBe(
      'in \\(\\frac{3}{4}\\), 3 is the numerator',
    );
  });

  it('converts display $$...$$ to \\[...\\]', () => {
    expect(normalizeInlineField('here: $$x = \\frac{1}{2}$$ done')).toBe(
      'here: \\[x = \\frac{1}{2}\\] done',
    );
  });

  it('converts multiple inline spans in one field', () => {
    expect(normalizeInlineField('$a$ and $b$ and $c$')).toBe(
      '\\(a\\) and \\(b\\) and \\(c\\)',
    );
  });

  it('handles a mix of display and inline', () => {
    expect(normalizeInlineField('inline $x$ then $$y$$')).toBe(
      'inline \\(x\\) then \\[y\\]',
    );
  });

  it('leaves an unbalanced trailing $ literal', () => {
    expect(normalizeInlineField('costs $5 today')).toBe('costs $5 today');
  });

  it('leaves an unbalanced trailing $$ literal', () => {
    expect(normalizeInlineField('weird $$ tail')).toBe('weird $$ tail');
  });

  it('respects escaped \\$ (currency, not math)', () => {
    // \$5 and \$10 are literal dollars; nothing between them should become math.
    expect(normalizeInlineField('pay \\$5 or \\$10')).toBe('pay \\$5 or \\$10');
  });

  it('does not touch content already in \\( ... \\) form', () => {
    const s = 'already \\( \\frac{3}{4} \\) inline';
    expect(normalizeInlineField(s)).toBe(s);
  });

  it('does not touch content already in \\[ ... \\] form', () => {
    const s = 'already \\[ x^2 + 1 \\] display';
    expect(normalizeInlineField(s)).toBe(s);
  });
});

describe('normalizeInlineField -- markdown emphasis stripping', () => {
  it('strips **bold** to bold', () => {
    expect(normalizeInlineField('this is **important** text')).toBe(
      'this is important text',
    );
  });

  it('strips __bold__ to bold', () => {
    expect(normalizeInlineField('this is __important__ text')).toBe(
      'this is important text',
    );
  });

  it('strips multiple emphasis pairs', () => {
    expect(normalizeInlineField('**a** and **b**')).toBe('a and b');
  });

  it('leaves single * and _ alone', () => {
    expect(normalizeInlineField('2 * 3 and snake_case_name')).toBe(
      '2 * 3 and snake_case_name',
    );
  });

  it('does NOT strip ** that appears inside inline math (LaTeX safety)', () => {
    // Contrived: `**` is not valid LaTeX, but we must never reach inside a
    // math segment. The plain-text `**real**` is stripped; the math segment
    // is preserved verbatim.
    const s = 'see \\( a^{**} \\) and **bold**';
    expect(normalizeInlineField(s)).toBe('see \\( a^{**} \\) and bold');
  });

  it('does NOT strip ** inside display math', () => {
    const s = 'eqn \\[ x**y \\] then **emph**';
    expect(normalizeInlineField(s)).toBe('eqn \\[ x**y \\] then emph');
  });
});

describe('normalizeInlineField -- combined + edge cases', () => {
  it('converts dollars AND strips emphasis in one pass', () => {
    expect(normalizeInlineField('**Note:** in $\\frac{3}{4}$, top is 3')).toBe(
      'Note: in \\(\\frac{3}{4}\\), top is 3',
    );
  });

  it('is idempotent', () => {
    const once = normalizeInlineField('**A** $x$ and $$y$$ and __B__');
    const twice = normalizeInlineField(once);
    expect(twice).toBe(once);
    expect(once).toBe('A \\(x\\) and \\[y\\] and B');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeInlineField('')).toBe('');
  });

  it('returns plain prose unchanged', () => {
    const s = 'The mitochondria is the powerhouse of the cell.';
    expect(normalizeInlineField(s)).toBe(s);
  });

  it('preserves Hindi / Devanagari text', () => {
    const s = 'अंश 3 है और हर 4 है $\\frac{3}{4}$ में';
    expect(normalizeInlineField(s)).toBe('अंश 3 है और हर 4 है \\(\\frac{3}{4}\\) में');
  });
});

describe('normalizeFoxyResponseInline -- response-level behavior', () => {
  function baseValid(blocks: FoxyResponse['blocks']): FoxyResponse {
    return { title: 'Test', subject: 'general', blocks };
  }

  it('normalizes text + label of prose blocks', () => {
    const r = baseValid([
      { type: 'definition', label: '**Key**', text: 'In $\\frac{3}{4}$, 3 is top.' },
      { type: 'example', text: '**bold** example' },
    ]);
    const out = normalizeFoxyResponseInline(r);
    expect(out.blocks[0].label).toBe('Key');
    expect(out.blocks[0].text).toBe('In \\(\\frac{3}{4}\\), 3 is top.');
    expect(out.blocks[1].text).toBe('bold example');
  });

  it('does NOT mutate the input object', () => {
    const r = baseValid([{ type: 'paragraph', text: '**x**' }]);
    const snapshot = JSON.parse(JSON.stringify(r));
    normalizeFoxyResponseInline(r);
    expect(r).toEqual(snapshot);
  });

  it('leaves code block text literal (no markdown/math conversion)', () => {
    const codeText = "x = a ** b  # power; cost is $5\nprint('$$')";
    const r = baseValid([
      { type: 'code', language: 'python', text: codeText },
    ]);
    const out = normalizeFoxyResponseInline(r);
    expect(out.blocks[0].text).toBe(codeText);
  });

  it('leaves math.latex untouched', () => {
    const r = baseValid([
      { type: 'paragraph', text: 'see below' },
      { type: 'math', latex: 'a ** b', label: '**Formula**' },
    ]);
    const out = normalizeFoxyResponseInline(r);
    // latex preserved verbatim...
    expect(out.blocks[1].latex).toBe('a ** b');
    // ...but the math block's prose label IS normalized.
    expect(out.blocks[1].label).toBe('Formula');
  });

  it('leaves mcq fields untouched', () => {
    const r = baseValid([
      {
        type: 'mcq',
        stem: 'What is $\\frac{1}{2} + \\frac{1}{2}$?',
        options: ['1', '2', '**0**', '0.5'],
        correct_answer_index: 0,
        explanation: 'Adding the halves gives $1$ exactly.',
      },
    ]);
    const out = normalizeFoxyResponseInline(r);
    expect(out.blocks[0].stem).toBe('What is $\\frac{1}{2} + \\frac{1}{2}$?');
    expect(out.blocks[0].options).toEqual(['1', '2', '**0**', '0.5']);
    expect(out.blocks[0].explanation).toBe('Adding the halves gives $1$ exactly.');
  });

  it('leaves diagram.search_query untouched', () => {
    const r = baseValid([
      { type: 'diagram', search_query: 'Human Heart $labeled$ diagram' },
    ]);
    const out = normalizeFoxyResponseInline(r);
    expect(out.blocks[0].search_query).toBe('Human Heart $labeled$ diagram');
  });

  it('output re-validates against FoxyResponseSchema', () => {
    const r = baseValid([
      { type: 'definition', text: 'In $\\frac{3}{4}$, 3 is the **numerator**.' },
      { type: 'math', latex: 'x = 1' },
    ]);
    const out = normalizeFoxyResponseInline({ ...r, subject: 'math' });
    expect(FoxyResponseSchema.safeParse(out).success).toBe(true);
  });

  it('is idempotent at the response level', () => {
    const r = baseValid([
      { type: 'paragraph', text: '**A** $x$ and $$y$$' },
      { type: 'code', text: 'a ** b' },
    ]);
    const once = normalizeFoxyResponseInline(r);
    const twice = normalizeFoxyResponseInline(once);
    expect(twice).toEqual(once);
  });
});
