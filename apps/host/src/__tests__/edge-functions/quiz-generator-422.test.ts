/**
 * REG-63 — quiz-generator hot path: 422 when validated count drops below
 * the minimum acceptable threshold (P6 question quality).
 *
 * Marking-Authenticity Wave 2 fixed the prior bug where the
 * `quiz-generator` Edge Function would `console.warn(...)` and silently
 * proceed to ship a too-short or stub quiz when the deterministic P6
 * validator dropped enough questions. The fix: emit HTTP 422 with
 * structured payload (`error: 'insufficient_validated_questions'`,
 * counts, dropped_reasons) so the client can retry with relaxed params.
 *
 * Strategy: static-source inspection of
 * `supabase/functions/quiz-generator/index.ts`. We assert:
 *   1. There is a `status: 422` Response with `error: 'insufficient_validated_questions'`.
 *   2. The 422 is gated on `validated.length < minCount`.
 *   3. The route does NOT just `console.warn` and continue when validation
 *      falls below threshold — there must be a return Response in the same
 *      branch, not just a warn-and-fall-through.
 *
 * This is a static-only test by design — Deno + Edge Function runtime is
 * not in process for Vitest, mirroring REG-37 / REG-50's parity-style tests.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const QUIZ_GENERATOR_PATH = resolve(
  process.cwd(),
  'supabase/functions/quiz-generator/index.ts',
);

describe('REG-63 — quiz-generator returns 422 on insufficient validated questions', () => {
  it('quiz-generator/index.ts exists', () => {
    expect(existsSync(QUIZ_GENERATOR_PATH)).toBe(true);
  });

  it('emits HTTP 422 with insufficient_validated_questions payload', () => {
    const src = readFileSync(QUIZ_GENERATOR_PATH, 'utf8');
    expect(src).toMatch(/status:\s*422/);
    expect(src).toContain("error: 'insufficient_validated_questions'");
  });

  it('gates the 422 on validated.length < minCount', () => {
    const src = readFileSync(QUIZ_GENERATOR_PATH, 'utf8');
    // Pin the literal guard so a future "soft" relaxation (validated.length === 0)
    // breaks this test loudly.
    expect(src).toMatch(/validated\.length\s*<\s*minCount/);
  });

  it('computes minCount as max(1, ceil(count / 2)) — half-or-more contract', () => {
    const src = readFileSync(QUIZ_GENERATOR_PATH, 'utf8');
    // The acceptance threshold is documented as "at least half of requested,
    // and at least 1". Pinning the formula guards against drift.
    expect(src).toMatch(/Math\.max\s*\(\s*1\s*,\s*Math\.ceil\s*\(\s*count\s*\/\s*2\s*\)\s*\)/);
  });

  it('returns the served/dropped counts in the 422 payload (forensic joinability)', () => {
    const src = readFileSync(QUIZ_GENERATOR_PATH, 'utf8');
    // Forensic team needs counts to triage which subjects/grades are
    // bleeding question-bank entries.
    expect(src).toMatch(/dropped:\s*droppedByValidator/);
    expect(src).toMatch(/served:\s*validated\.length/);
    expect(src).toMatch(/dropped_reasons/);
  });

  it('emits PostHog foxy_oracle_blocked with category=insufficient_validated_questions', () => {
    const src = readFileSync(QUIZ_GENERATOR_PATH, 'utf8');
    // Telemetry must fire on the 422 branch so the super-admin oracle
    // health panel sees the rejection rate.
    expect(src).toContain("category: 'insufficient_validated_questions'");
    // Same source attribution as the rest of the surface.
    expect(src).toContain("source: 'quiz-generator'");
  });

  it('does NOT silently warn-and-proceed when validation drops below threshold', () => {
    // The bug fixed in Wave 2 was: `console.warn(... dropped ...)` followed by
    // continuing to ship the (too-short) quiz. The fix introduces an early
    // `return new Response(... 422 ...)` BEFORE any subsequent ship-the-quiz
    // path. We pin the structural property: the 422 branch contains a
    // `return new Response` and is positioned at the validation gate.
    const src = readFileSync(QUIZ_GENERATOR_PATH, 'utf8');

    // The sub-string that must be present immediately around the validated <
    // minCount branch — pin the structure (return before ship).
    const guardBlock = src.match(
      /if\s*\(\s*validated\.length\s*<\s*minCount\s*\)[\s\S]{0,2000}?(return\s+new\s+Response)/,
    );
    expect(guardBlock, 'expected `if (validated.length < minCount) { ... return new Response(...) }` block').not.toBeNull();
  });
});
