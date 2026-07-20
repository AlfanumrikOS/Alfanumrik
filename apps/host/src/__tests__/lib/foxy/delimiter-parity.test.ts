import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * GUARD #4 — Foxy MATH-DELIMITER PARITY across every prompt/template source.
 *
 * A student must never see a bare `$`/`$$` math delimiter leak, and every Foxy
 * prompt that can steer the model toward LaTeX must agree on ONE convention:
 *   - inline math inside a "text" field:   \( ... \)
 *   - display math inside prose:           \[ ... \]
 *   - a standalone "math" block "latex":   BARE LaTeX, NO delimiters at all.
 *   - bare `$` / `$$` is FORBIDDEN everywhere.
 *
 * This guard pins that contract across the five prompt sources that the math
 * pipeline + structured renderer depend on, so a future edit to any one of them
 * can't silently drift the convention (which is how `$x$` leaks into the chat
 * bubble — KaTeX never fires and the student sees raw `$`).
 *
 * The assertion is robust by design: these prompts legitimately CONTAIN the
 * characters `$`/`$$` inside the literal prohibition phrasing (`NEVER use bare
 * "$" or "$$"`). We therefore assert (a) the prohibition phrasing is present,
 * (b) the `\( \)` / `\[ \]` convention is present, and (c) every `$`-run in the
 * source is part of the prohibition phrasing, never wrapping a LaTeX token.
 *
 * Owner: testing. Reviewer: ai-engineer (prompt content), assessment (P7/P12).
 */

import { FOXY_STRUCTURED_OUTPUT_PROMPT } from '@alfanumrik/lib/foxy/schema';
import { getNcertSystemPrompt, getDefaultMathPrompt } from '@alfanumrik/lib/math/ncert-prompts';
import { normalizeFoxyResponseInline } from '@alfanumrik/lib/foxy/normalize-inline';
import type { FoxyResponse } from '@alfanumrik/lib/foxy/schema';

const REPO_ROOT = process.cwd();

// foxy-system.ts (the Next-side safety rails) — read its source text so we can
// assert on the prompt strings it emits without importing its builder graph.
const FOXY_SYSTEM_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/ai/prompts/foxy-system.ts'),
  'utf8',
);

// foxy_tutor_v1.txt (the grounded-answer Edge Function template).
const FOXY_TEMPLATE_PATH = join(
  REPO_ROOT,
  'supabase/functions/grounded-answer/prompts/foxy_tutor_v1.txt',
);

// The CONTEXT calls the inline normalizer "inline.ts"; on disk it is
// normalize-inline.ts. Read its source to assert it documents the same
// canonicalisation target ($ -> \( / \[).
const NORMALIZE_INLINE_SRC = readFileSync(
  join(REPO_ROOT, 'src/lib/foxy/normalize-inline.ts'),
  'utf8',
);

/**
 * Assert that every `$`-run in `src` sits inside the literal prohibition
 * phrasing (i.e. quoted as `"$"` / `"$$"` or preceded by "bare"), never as a
 * live delimiter wrapping a LaTeX token like `$x^2$`. We look at a small window
 * around each `$` run and require it to be quoted.
 */
function everyDollarIsProhibitionPhrasing(src: string): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  const re = /\${1,2}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const start = Math.max(0, m.index - 8);
    const end = Math.min(src.length, m.index + m[0].length + 8);
    const window = src.slice(start, end);
    // Allowed: the dollar run is immediately wrapped in double quotes ("$"/"$$")
    // — that's the documented prohibition token.
    const quoted = /"\${1,2}"/.test(window);
    if (!quoted) offenders.push(window.replace(/\n/g, ' '));
  }
  return { ok: offenders.length === 0, offenders };
}

describe('GUARD #4 — schema FOXY_STRUCTURED_OUTPUT_PROMPT', () => {
  it('forbids bare $/$$ and mandates the \\( \\) / \\[ \\] convention', () => {
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/Do NOT use "\$" or "\$\$"/);
    // Inline + display convention present.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toContain('\\( ... \\)');
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toContain('\\[ ... \\]');
    // math-block latex must carry NO delimiters.
    expect(FOXY_STRUCTURED_OUTPUT_PROMPT).toMatch(/latex[\s\S]*NOT contain "\$" or "\$\$"/);
  });

  it('every $ in the prompt is part of the prohibition phrasing, never a live delimiter', () => {
    const { ok, offenders } = everyDollarIsProhibitionPhrasing(FOXY_STRUCTURED_OUTPUT_PROMPT);
    expect(ok, `bare $ delimiter(s) found: ${JSON.stringify(offenders)}`).toBe(true);
  });
});

describe('GUARD #4 — foxy-system.ts safety rails', () => {
  // 2026-07-20 (math-format ramp alignment): foxy-system.ts builds its prompt
  // in a plain template literal, so math tokens are now written with DOUBLED
  // backslashes in source (`\\( ... \\)`) to emit real `\( ... \)` bytes at
  // runtime — the old single-backslash form emitted mangled `( ... )`
  // pseudo-parens. These source assertions therefore look for the escaped
  // form; the RUNTIME bytes are pinned in math-density-drift-guard.test.ts.
  it('instructs the \\( \\) / \\[ \\] convention and bans bare $/$$', () => {
    expect(FOXY_SYSTEM_SRC).toContain('\\\\( ... \\\\)');
    expect(FOXY_SYSTEM_SRC).toContain('\\\\[ ... \\\\]');
    expect(FOXY_SYSTEM_SRC).toMatch(/NEVER use bare "\$" or "\$\$"/);
  });

  it('agrees with schema.ts on the delimiter convention (both name \\( \\) and \\[ \\])', () => {
    const tokens: Array<[string, string]> = [
      // [escaped source form in foxy-system.ts, runtime form in schema prompt]
      ['\\\\( ... \\\\)', '\\( ... \\)'],
      ['\\\\[ ... \\\\]', '\\[ ... \\]'],
    ];
    for (const [srcToken, schemaToken] of tokens) {
      expect(FOXY_SYSTEM_SRC, `foxy-system missing ${srcToken}`).toContain(srcToken);
      expect(FOXY_STRUCTURED_OUTPUT_PROMPT, `schema prompt missing ${schemaToken}`).toContain(schemaToken);
    }
  });
});

describe('GUARD #4 — foxy_tutor_v1.txt grounded template', () => {
  it('exists and bans bare $/$$ while naming the \\( \\) / \\[ \\] convention', () => {
    expect(existsSync(FOXY_TEMPLATE_PATH)).toBe(true);
    const tmpl = readFileSync(FOXY_TEMPLATE_PATH, 'utf8');
    expect(tmpl).toMatch(/NEVER use bare "\$" or "\$\$"/);
    expect(tmpl).toContain('\\(');
    expect(tmpl).toContain('\\[');
  });

  it('every $ in the template is part of the prohibition phrasing', () => {
    const tmpl = readFileSync(FOXY_TEMPLATE_PATH, 'utf8');
    const { ok, offenders } = everyDollarIsProhibitionPhrasing(tmpl);
    expect(ok, `bare $ delimiter(s) in foxy_tutor_v1.txt: ${JSON.stringify(offenders)}`).toBe(true);
  });
});

describe('GUARD #4 — ncert-prompts.ts (math solver prompts)', () => {
  // Representative seeded chapters + the grade default.
  const prompts: Array<[string, string]> = [
    ['6 fractions', getNcertSystemPrompt('6', 'fractions')],
    ['10 quadratics', getNcertSystemPrompt('10', 'quadratics')],
    ['10 trigonometry', getNcertSystemPrompt('10', 'trigonometry')],
    ['9 motion', getNcertSystemPrompt('9', 'motion')],
    ['grade default', getDefaultMathPrompt('8')],
  ];

  for (const [name, prompt] of prompts) {
    it(`${name}: bans bare $/$$ and names the \\( \\) inline + bare-latex math-block convention`, () => {
      // The shared solver rules block is present in every prompt.
      expect(prompt).toMatch(/NEVER use bare "\$" or "\$\$"/i);
      expect(prompt).toContain('\\( ... \\)');
      expect(prompt).toContain('\\[ ... \\]');
      expect(prompt).toMatch(/BARE LaTeX with NO delimiters/i);
    });

    it(`${name}: every $ is prohibition phrasing (no live delimiter leaks)`, () => {
      const { ok, offenders } = everyDollarIsProhibitionPhrasing(prompt);
      expect(ok, `bare $ in ${name}: ${JSON.stringify(offenders)}`).toBe(true);
    });
  }
});

describe('GUARD #4 — normalize-inline.ts canonicalisation target', () => {
  it('documents the $ -> \\( / \\[ canonicalisation (the runtime safety net)', () => {
    // The normalizer is the mechanical backstop: if the model emits $...$ anyway,
    // it rewrites to \( ... \) before the renderer sees it.
    expect(NORMALIZE_INLINE_SRC).toContain('\\[');
    expect(NORMALIZE_INLINE_SRC).toContain('\\(');
    expect(NORMALIZE_INLINE_SRC).toMatch(/\$\$/); // it matches $$ to convert it
  });

  it('a math-block latex carrying no delimiters is left untouched by the normalizer', () => {
    const resp: FoxyResponse = {
      title: 'Quadratic',
      subject: 'math',
      blocks: [
        { type: 'math', latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
        { type: 'answer', text: 'x = 3 or x = 2' },
      ],
    };
    const out = normalizeFoxyResponseInline(resp);
    const mathBlock = out.blocks.find((b) => b.type === 'math') as { latex?: string };
    // math.latex is delimiter-free and stays delimiter-free (no $, no \( wrappers).
    expect(mathBlock.latex).toBe('x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}');
    expect(mathBlock.latex).not.toMatch(/\$/);
  });

  it('a bare $-delimited inline fragment in a text field is rewritten to \\( \\) (no bare $ survives)', () => {
    const resp: FoxyResponse = {
      title: 'Fractions',
      subject: 'math',
      blocks: [
        { type: 'definition', text: 'In $\\frac{3}{4}$, 3 is the numerator.' },
        { type: 'answer', text: 'It is a proper fraction.' },
      ],
    };
    const out = normalizeFoxyResponseInline(resp);
    const def = out.blocks.find((b) => b.type === 'definition') as { text?: string };
    expect(def.text).toContain('\\(');
    expect(def.text).not.toMatch(/(^|[^\\])\$/); // no UNescaped bare $ left
  });
});
