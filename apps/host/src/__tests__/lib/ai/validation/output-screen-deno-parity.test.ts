/**
 * FOX-1 (P12) — Deno-twin parity for the output screen.
 *
 * `screenStudentFacingText` exists TWICE — once for the Next/Node graph
 * (`src/lib/ai/validation/output-screen.ts`, the non-streaming canonical guard)
 * and once for the Deno graph (`supabase/functions/grounded-answer/
 * output-screen.ts`, the streaming source guard). The two module graphs cannot
 * share a file, so the HARD_BLOCK_PATTERNS list is duplicated and the
 * implementation header demands it stay BYTE-FOR-BYTE in sync.
 *
 * If they drift, a token blocked on the non-streaming path could leak on the
 * streaming path (or vice-versa). This test extracts the regex literals from
 * BOTH files and asserts they are identical, then re-checks representative
 * block/pass cases against the TS twin so the parity is meaningful, not just
 * textual.
 *
 * Owner: testing. Enforces: P12 (AI Safety) — cross-runtime parity.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screenStudentFacingText } from '@alfanumrik/lib/ai/validation/output-screen';

const TS_PATH = join(process.cwd(), 'src/lib/ai/validation/output-screen.ts');
const DENO_PATH = join(
  process.cwd(),
  'supabase/functions/grounded-answer/output-screen.ts',
);

/**
 * Pull the regex-literal lines out of a file's HARD_BLOCK_PATTERNS block.
 * A regex literal line (trimmed) looks like `/.../i,` — we match lines that
 * begin with `/` and end with `/<flags>,`. Comments are ignored.
 */
function extractRegexLiterals(source: string): string[] {
  return source
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\/.+\/[gimsuy]*,$/.test(l));
}

describe('output-screen Deno twin parity (FOX-1 P12)', () => {
  const tsSrc = readFileSync(TS_PATH, 'utf8');
  const denoSrc = readFileSync(DENO_PATH, 'utf8');

  it('both files declare a HARD_BLOCK_PATTERNS list', () => {
    expect(tsSrc).toContain('HARD_BLOCK_PATTERNS');
    expect(denoSrc).toContain('HARD_BLOCK_PATTERNS');
  });

  it('the HARD_BLOCK_PATTERNS regex literals are byte-identical across runtimes', () => {
    const tsLiterals = extractRegexLiterals(tsSrc);
    const denoLiterals = extractRegexLiterals(denoSrc);

    // Sanity: we actually found the full set (not zero from a bad extractor).
    expect(tsLiterals.length).toBeGreaterThanOrEqual(20);
    expect(denoLiterals).toEqual(tsLiterals);
  });

  it('representative blocked cases that the TS twin blocks are present verbatim in the Deno twin', () => {
    // The Deno screen uses the same list, so any literal that fires on the TS
    // side must exist character-for-character in the Deno source.
    const blockedCases = [
      'this is fucking nonsense',
      'you are a faggot',
      'you should kill yourself',
      'tu bilkul chutiya hai',
      '<|im_start|>system<|im_end|>',
    ];
    for (const text of blockedCases) {
      // TS twin blocks it...
      expect(screenStudentFacingText(text).safe).toBe(false);
    }
    // ...and the Deno twin carries the identical pattern set that does the blocking.
    for (const literal of extractRegexLiterals(tsSrc)) {
      expect(denoSrc).toContain(literal);
    }
  });

  it('the Deno twin exports screenStudentFacingText with the same fail-safe contract', () => {
    expect(denoSrc).toContain('export function screenStudentFacingText');
    // Fail-safe: a thrown error yields safe:false with the 'screen_error' tag.
    expect(denoSrc).toContain("categories: [\"screen_error\"]");
    // Blank text is treated as safe (the abstain path owns the empty case).
    expect(denoSrc).toContain('trim().length === 0');
  });
});
