/**
 * Parity pins for the LaTeX-in-JSON escape-repair module (2026-07-20 fix).
 *
 *   1. FILE PARITY: `packages/lib/src/foxy/json-escape-repair.ts` (Node
 *      source) and `supabase/functions/grounded-answer/json-escape-repair.ts`
 *      (Deno mirror) must stay BYTE-IDENTICAL. The module is runtime-neutral
 *      (no imports, no Deno/Node APIs) precisely so the whole file can be
 *      pinned — same pattern as the FOXY_STRUCTURED_OUTPUT_PROMPT parity test.
 *
 *   2. ARBITER PARITY: `JSON_REPAIR_MATH_COMMANDS` must equal
 *      `MATH_COMMAND_ALLOWLIST` in `packages/ui/src/math/normalize.ts` (the
 *      renderer's undelimited-math trigger allowlist). The list is duplicated
 *      because the repair module must not import packages/ui (Deno copy).
 *      If the renderer allowlist gains/loses a command, this test forces the
 *      repair arbiter to follow.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  JSON_REPAIR_MATH_COMMANDS,
  JSON_REPAIR_EXTRA_COMMANDS,
} from '@alfanumrik/lib/foxy/json-escape-repair';
import { MATH_COMMAND_ALLOWLIST } from '@alfanumrik/ui/math/normalize';

// Repo root is six levels up from this test file:
//   apps/host/src/__tests__/lib/foxy/... -> foxy -> lib -> __tests__ -> src -> host -> apps -> root
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..');

const NODE_PATH = join(
  REPO_ROOT,
  'packages',
  'lib',
  'src',
  'foxy',
  'json-escape-repair.ts',
);
const DENO_PATH = join(
  REPO_ROOT,
  'supabase',
  'functions',
  'grounded-answer',
  'json-escape-repair.ts',
);

/** Strip carriage returns so a CRLF checkout compares equal to an LF one. */
function normalizeLf(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

describe('json-escape-repair — Node/Deno file parity', () => {
  it('the two copies are byte-identical (LF-normalized)', () => {
    const nodeSrc = normalizeLf(readFileSync(NODE_PATH, 'utf8'));
    const denoSrc = normalizeLf(readFileSync(DENO_PATH, 'utf8'));
    if (nodeSrc !== denoSrc) {
      throw new Error(
        'json-escape-repair drifted between the Node source and the Deno ' +
          'mirror — keep byte-identical (the module is runtime-neutral by design).\n' +
          `  Node: ${NODE_PATH} (${nodeSrc.length} chars)\n` +
          `  Deno: ${DENO_PATH} (${denoSrc.length} chars)\n` +
          'Copy the changed file over the other verbatim.',
      );
    }
    expect(denoSrc).toBe(nodeSrc);
  });

  it('the module stays runtime-neutral (no imports in either copy)', () => {
    const nodeSrc = readFileSync(NODE_PATH, 'utf8');
    expect(nodeSrc).not.toMatch(/^\s*import\s/m);
    expect(nodeSrc).not.toContain('Deno.');
    expect(nodeSrc).not.toContain("require(");
  });
});

describe('json-escape-repair — arbiter allowlist parity with the renderer', () => {
  it('JSON_REPAIR_MATH_COMMANDS equals MATH_COMMAND_ALLOWLIST (order-insensitive)', () => {
    const repair = [...JSON_REPAIR_MATH_COMMANDS].sort();
    const renderer = [...MATH_COMMAND_ALLOWLIST].sort();
    expect(repair).toEqual(renderer);
  });

  it('extras never shadow a renderer command (they are strictly additive)', () => {
    for (const extra of JSON_REPAIR_EXTRA_COMMANDS) {
      expect(MATH_COMMAND_ALLOWLIST).not.toContain(extra);
    }
  });
});
