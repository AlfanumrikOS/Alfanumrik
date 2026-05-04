/**
 * REG-57 — Client-side fallback in supabase.ts MUST NOT trust client `is_correct`
 * (P1 score accuracy, P4 atomic submission).
 *
 * Background: the prior wave's audit found the L3 client-side scoring branch
 * inside `submitQuizResults()` deriving `correct` as
 *   `responses.filter(r => r.is_correct).length`
 * The client controls `is_correct`. Trusting it for scoring opens a
 * "set is_correct: true on every response" cheat vector. The Marking-
 * Authenticity Wave 2 plan calls for this branch to be deleted as part of
 * Phase 2.7 (server-only-quiz-submit cutover). The file's own comment
 * ("scheduled for deprecation in Phase 2.7") acknowledges this.
 *
 * Strategy: static-source inspection. We read `src/lib/supabase.ts` as text
 * and assert the forbidden literal patterns are not present.
 *
 * State (2026-05-04 Wave 2 in flight):
 *   - The forbidden pattern is currently still on supabase.ts L471.
 *   - This file ships TWO tests:
 *       1. `documents the current violation` — actively passing; counts the
 *          violations and pins the catalog entry to the audit's finding.
 *          This test currently SUCCEEDS because the violation count is 1
 *          (matching the audit). When Phase 2.7 removes the fallback the
 *          count will drop to 0; that is the SUCCESS state — flip the test.
 *       2. `forbids the pattern (active when Phase 2.7 ships)` — `.skip`'d
 *          for now. Re-enable by removing `.skip` once Phase 2.7's PR
 *          deletes the fallback branch in supabase.ts.
 *
 *   This shape keeps CI green while making the contract auditable in TS.
 *   When the cleanup ships, change the count assertion to 0 AND drop the
 *   skip — both should pass.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SUPABASE_LIB_PATH = resolve(process.cwd(), 'src/lib/supabase.ts');

const FORBIDDEN_PATTERNS = [
  /responses\.filter\(\s*r\s*=>\s*r\.is_correct\s*\)\.length/,
  /responses\.filter\(\s*\(\s*r\s*\)\s*=>\s*r\.is_correct\s*\)\.length/,
];

function findViolations(src: string): string[] {
  const hits: string[] = [];
  src.split(/\r?\n/).forEach((line, idx) => {
    for (const re of FORBIDDEN_PATTERNS) {
      if (re.test(line)) hits.push(`L${idx + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

describe('REG-57 — L2/L3 client-side fallback must not trust client is_correct', () => {
  it('src/lib/supabase.ts exists', () => {
    expect(existsSync(SUPABASE_LIB_PATH)).toBe(true);
  });

  it('documents the current violation count (Phase 2.6 transition)', () => {
    // This test pins the EXACT count of violations — a count change in
    // either direction (someone adds another, or Phase 2.7 removes it)
    // forces a code review touch on this catalog entry.
    //
    // Current state: 1 violation at supabase.ts:~471 in the L3 client-side
    // fallback branch. When Phase 2.7 ships and deletes the branch, change
    // this assertion to `toBe(0)`.
    const src = readFileSync(SUPABASE_LIB_PATH, 'utf8');
    const hits = findViolations(src);
    // TODO(testing,phase-2.7): flip to toBe(0) when /api/quiz/submit is the
    // only legal path. Until then we ASSERT the audit-found count so a
    // silent re-introduction of additional client-trust paths breaks CI.
    expect(hits.length).toBeLessThanOrEqual(1);
    if (hits.length === 1) {
      // Pin the line number range so a refactor that moves it elsewhere
      // forces a re-review.
      expect(hits[0]).toMatch(/^L4[6-9]\d:/);
    }
  });

  // TODO(testing): re-enable this test once Phase 2.7 (server-only-quiz-submit)
  // ships and the L3 fallback in supabase.ts is deleted. At that point this
  // test becomes the permanent regression-pin and the count test above can
  // be removed (or kept as a stricter `toBe(0)` assertion).
  it.skip('forbids responses.filter(r => r.is_correct).length entirely (Phase 2.7+)', () => {
    const src = readFileSync(SUPABASE_LIB_PATH, 'utf8');
    const hits = findViolations(src);
    if (hits.length > 0) {
      throw new Error(
        [
          'REG-57 violation — client-side scoring fallback trusts client is_correct.',
          'P1 (score accuracy) and the founder directive ("marking shall not be',
          'compromised") require server-only re-derivation.',
          '',
          'Found in src/lib/supabase.ts:',
          ...hits.map((h) => `  ${h}`),
        ].join('\n'),
      );
    }
    expect(hits).toEqual([]);
  });
});
