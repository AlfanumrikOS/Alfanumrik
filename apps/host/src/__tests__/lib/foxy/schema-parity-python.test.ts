/**
 * Cross-LANGUAGE parity test: the Python port of FOXY_STRUCTURED_OUTPUT_PROMPT
 * must be byte-identical to the TypeScript source of truth.
 *
 * Why this exists (Phase 2.2 — "MOL only on Python" Foxy seam):
 *   The Foxy grounded-answer pipeline can route its model-generation step to
 *   the Python MOL service (`POST {PYTHON_AI_BASE_URL}/v1/generate`). When a
 *   caller lets Python build the prompt (`structured="foxy"`), the Python
 *   prompt-builder appends its OWN copy of the strict FoxyResponse block-schema
 *   addendum: `python/services/ai/mol/foxy_structured_prompt.py`. That copy is a
 *   hand-maintained port of the TS constant. If the TS constant is edited and
 *   the Python port is not, Foxy's structured contract silently diverges
 *   between the two serving stacks — a P12 (AI Safety) surface where the model
 *   would be instructed by a stale schema.
 *
 *   The sibling test `schema-parity.test.ts` already pins the Node<->Deno
 *   copies (both TS template literals, compared as raw source). This test pins
 *   the third copy — Python — which the existing Python unit test only
 *   SUBSTRING spot-checks (`python/tests/unit/test_foxy_structured_prompt.py`).
 *   This is the authoritative byte-equality guard across the language boundary.
 *
 * How byte-equality is enforced across the language boundary:
 *   1. The TS constant is a TEMPLATE LITERAL: escapes are DOUBLED in source
 *      (`\\( ... \\)`, `\\frac`) so the RENDERED string carries LITERAL single
 *      backslashes (`\( ... \)`, `\frac`). We `import` the constant, so we hold
 *      the *rendered* value — exactly what is shipped to the LLM.
 *   2. The Python constant is a RAW triple-quoted string (`r"""..."""`): the
 *      text between the quotes IS the literal value (Python performs no escape
 *      processing on a raw string). So we can read the Python source as text and
 *      extract the raw literal verbatim, and it equals the rendered value.
 *   3. Both sides are LF-normalized (strip `\r`) so a CRLF checkout on Windows
 *      cannot produce a spurious mismatch.
 *   4. We assert exact string equality. No trimming, no whitespace collapsing —
 *      a stray leading/trailing newline in the port would (correctly) fail.
 *
 * If this test fails:
 *   The TS `FOXY_STRUCTURED_OUTPUT_PROMPT` was edited without regenerating the
 *   Python port (or vice-versa). Re-copy the RENDERED TS string into
 *   `foxy_structured_prompt.py`'s `r"""..."""` literal verbatim (single
 *   backslashes, not doubled — it is a raw string).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The RENDERED value of the TS source-of-truth constant (single backslashes).
import { FOXY_STRUCTURED_OUTPUT_PROMPT as TS_PROMPT } from '@alfanumrik/lib/foxy/schema';

// Repo root is six levels up from this test file:
//   apps/host/src/__tests__/lib/foxy/schema-parity-python.test.ts
//     -> foxy -> lib -> __tests__ -> src -> host -> apps -> <repo root>
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');

const PY_PATH = join(
  REPO_ROOT,
  'python',
  'services',
  'ai',
  'mol',
  'foxy_structured_prompt.py',
);

/** Strip carriage returns so a CRLF checkout compares equal to an LF one. */
function normalizeLf(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Extract the RAW value of `FOXY_STRUCTURED_OUTPUT_PROMPT = r"""...\"""` from a
 * Python source file.
 *
 * Requiring the `r` (raw-string) prefix is load-bearing: only a raw string lets
 * us treat the file text between the triple-quotes as the literal value. If the
 * port is ever changed to a non-raw string (`"""..."""` with escaped
 * backslashes), this extraction would no longer equal the runtime value, so we
 * fail loudly and tell the maintainer to keep it raw.
 */
function extractPythonRawPrompt(source: string, filePath: string): string {
  const re = /FOXY_STRUCTURED_OUTPUT_PROMPT\s*=\s*r"""([\s\S]*?)"""/;
  const match = source.match(re);
  if (!match) {
    throw new Error(
      `Could not find \`FOXY_STRUCTURED_OUTPUT_PROMPT = r"""..."""\` in ${filePath}. ` +
        'The port must remain a RAW triple-quoted string literal so its file ' +
        'text equals the runtime value (raw = no backslash escape processing). ' +
        'Either the constant was renamed, or it stopped being a raw string.',
    );
  }
  return match[1];
}

/** Index of the first differing character, or -1 if identical. */
function firstDivergence(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i;
  }
  return a.length === b.length ? -1 : n;
}

describe('FOXY_STRUCTURED_OUTPUT_PROMPT parity (TypeScript <-> Python port)', () => {
  it('finds the raw Python constant literal', () => {
    const pySource = readFileSync(PY_PATH, 'utf8');
    expect(() => extractPythonRawPrompt(pySource, PY_PATH)).not.toThrow();
  });

  it('renders the TS constant to literal single-backslash math escapes', () => {
    // Guards the compare's premise: TS_PROMPT is the RENDERED value, so the
    // math escapes must be single backslashes (`\frac`, `\( `), NOT the doubled
    // source form (`\\frac`). If this ever changes, the byte-compare below
    // becomes meaningless.
    expect(TS_PROMPT).toContain('\\frac{-b \\pm \\sqrt');
    expect(TS_PROMPT).not.toContain('\\\\frac');
  });

  it('keeps the Python port byte-identical to the rendered TS constant', () => {
    const pySource = readFileSync(PY_PATH, 'utf8');
    const pyBody = normalizeLf(extractPythonRawPrompt(pySource, PY_PATH));
    const tsBody = normalizeLf(TS_PROMPT);

    if (pyBody !== tsBody) {
      const at = firstDivergence(tsBody, pyBody);
      const window = 80;
      const tsSlice = JSON.stringify(tsBody.slice(Math.max(0, at - 20), at + window));
      const pySlice = JSON.stringify(pyBody.slice(Math.max(0, at - 20), at + window));
      throw new Error(
        'FOXY_STRUCTURED_OUTPUT_PROMPT drifted between the TypeScript source of ' +
          'truth and the Python port — keep in sync.\n' +
          `  TS (source of truth): packages/lib/src/foxy/schema.ts\n` +
          `  Python port:          ${PY_PATH}\n` +
          `  TS length:     ${tsBody.length} chars\n` +
          `  Python length: ${pyBody.length} chars\n` +
          `  First divergence at index ${at}:\n` +
          `    TS:     ${tsSlice}\n` +
          `    Python: ${pySlice}\n` +
          'The Python constant is a RAW string (r"""..."""): copy the RENDERED ' +
          'TS string verbatim with SINGLE backslashes (not doubled).',
      );
    }

    // Structured assertion so Vitest reports a clean pass/fail.
    expect(pyBody).toBe(tsBody);
  });

  it('keeps the port recognizably a Foxy contract (guards an emptied file)', () => {
    const pySource = readFileSync(PY_PATH, 'utf8');
    const body = extractPythonRawPrompt(pySource, PY_PATH);
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain('OUTPUT FORMAT (STRICT)');
    expect(body).toContain('type FoxyResponse');
    expect(body).toContain('SUBJECT RULES');
    expect(body).toContain('FEW-SHOT EXAMPLES');
  });
});
