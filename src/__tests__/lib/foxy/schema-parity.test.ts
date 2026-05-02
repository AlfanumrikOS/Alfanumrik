/**
 * Parity test: FOXY_STRUCTURED_OUTPUT_PROMPT must be byte-identical between
 * the Next.js (Node/Zod) source of truth and the Deno-side mirror that ships
 * inside the grounded-answer Edge Function bundle.
 *
 * Why this exists:
 *   The Edge Function lives in `supabase/functions/grounded-answer/` and runs
 *   on Deno. It cannot import from `src/` because Deno-TS and Next-TS have
 *   separate module graphs and Deno does not honor the `@/*` path alias. So
 *   the addendum is duplicated into `structured-prompt.ts`. If anyone updates
 *   one copy without the other, Foxy's prompt diverges between the new Next.js
 *   route (`src/app/api/foxy/route.ts`) and the Edge Function pipeline -- a
 *   silent regression in AI behavior.
 *
 * What this checks:
 *   1. The literal contents of `FOXY_STRUCTURED_OUTPUT_PROMPT` (the template
 *      literal between back-ticks) are byte-identical across the two files.
 *   2. Both files actually export the constant (regex extraction sanity).
 *
 * If this test fails:
 *   The error message says "FOXY_STRUCTURED_OUTPUT_PROMPT drifted between
 *   Next.js and Edge Function -- keep in sync." Whoever changed one copy must
 *   copy the change into the other file verbatim.
 *
 * Implementation note:
 *   We do NOT import the Deno file as a module -- it uses Deno-only syntax in
 *   sibling files (`Deno.env.get`) and would fail to resolve in Vitest. We
 *   read both files as text via `node:fs` and pull the constant body out with
 *   a regex. The template literal content (including escapes like `\\\\cdot`)
 *   is compared exactly as it appears in the source file -- we are checking
 *   what gets shipped to the LLM, character-for-character.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Repo root is two levels up from this test file:
//   src/__tests__/lib/foxy/schema-parity.test.ts -> repo root
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const NODE_PATH = join(REPO_ROOT, 'src', 'lib', 'foxy', 'schema.ts');
const DENO_PATH = join(
  REPO_ROOT,
  'supabase',
  'functions',
  'grounded-answer',
  'structured-prompt.ts',
);

/**
 * Extract the body of `export const FOXY_STRUCTURED_OUTPUT_PROMPT = \`...\`;`
 * from a TypeScript source file.
 *
 * Matches:
 *   export const FOXY_STRUCTURED_OUTPUT_PROMPT = `<body>`.trim();
 *   export const FOXY_STRUCTURED_OUTPUT_PROMPT = `<body>`;
 *
 * Does not attempt to handle nested back-ticks (the addendum doesn't use any).
 */
function extractPromptBody(source: string, filePath: string): string {
  // Use a non-greedy match for the body inside back-ticks. The `[\s\S]` class
  // matches across newlines (the body is multi-line). We tolerate optional
  // `.trim()` and trailing semicolon.
  const re = /export\s+const\s+FOXY_STRUCTURED_OUTPUT_PROMPT\s*=\s*`([\s\S]*?)`(?:\.trim\(\))?\s*;?/;
  const match = source.match(re);
  if (!match) {
    throw new Error(
      `Could not find \`export const FOXY_STRUCTURED_OUTPUT_PROMPT = \`...\`\` in ${filePath}. ` +
        `Either the constant was renamed/removed, or the export style changed and this regex needs an update.`,
    );
  }
  return match[1];
}

describe('FOXY_STRUCTURED_OUTPUT_PROMPT parity (Next.js <-> Edge Function)', () => {
  it('extracts the prompt constant from both source files', () => {
    const nodeSource = readFileSync(NODE_PATH, 'utf8');
    const denoSource = readFileSync(DENO_PATH, 'utf8');

    expect(() => extractPromptBody(nodeSource, NODE_PATH)).not.toThrow();
    expect(() => extractPromptBody(denoSource, DENO_PATH)).not.toThrow();
  });

  it('keeps the prompt body byte-identical across Node and Deno copies', () => {
    const nodeSource = readFileSync(NODE_PATH, 'utf8');
    const denoSource = readFileSync(DENO_PATH, 'utf8');

    const nodeBody = extractPromptBody(nodeSource, NODE_PATH);
    const denoBody = extractPromptBody(denoSource, DENO_PATH);

    if (nodeBody !== denoBody) {
      throw new Error(
        'FOXY_STRUCTURED_OUTPUT_PROMPT drifted between Next.js and Edge Function -- keep in sync.\n' +
          `  Node copy: ${NODE_PATH}\n` +
          `  Deno copy: ${DENO_PATH}\n` +
          `  Node length: ${nodeBody.length} chars\n` +
          `  Deno length: ${denoBody.length} chars\n` +
          'Whoever updated one file must copy the change into the other file verbatim.',
      );
    }

    // Hard assertion (defensive — the throw above already failed, but this
    // line gives Vitest a clean expect() so the report is structured).
    expect(denoBody).toBe(nodeBody);
  });

  it('keeps the prompt non-empty and recognizably a Foxy contract', () => {
    // Sanity: catch the case where someone empties one or both files. The
    // body must contain at least the marquee phrases that define the
    // contract: "OUTPUT FORMAT (STRICT)" and the FoxyResponse type signature.
    const nodeSource = readFileSync(NODE_PATH, 'utf8');
    const body = extractPromptBody(nodeSource, NODE_PATH);

    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain('OUTPUT FORMAT (STRICT)');
    expect(body).toContain('type FoxyResponse');
    expect(body).toContain('SUBJECT RULES');
  });
});
