/**
 * P0 user-experience fix — soft mode bypasses coverage precheck.
 *
 * User-reported issue (2026-04-28): a Class 7 student asked Foxy "Teach me:
 * Arithmetic Expressions" on Math chapter 2 where `cbse_syllabus.rag_status`
 * was not yet 'ready' (NCERT chunks not fully ingested in Phase 6 content
 * production). PR #427's coverage precheck correctly blocked the turn for
 * STRICT-mode callers — but it was also blocking SOFT-mode Foxy chat,
 * causing Foxy to refuse to teach when it should have fallen back to
 * "From general CBSE knowledge:" gracefully (Phase 2.C Edit 2 prompt rule).
 *
 * Fix: gate the coverage precheck on `request.mode === 'strict'`. Soft mode
 * (Foxy chat) skips the gate; strict mode (ncert-solver, quiz-generator-v2)
 * keeps it because those callers MUST cite chunks.
 *
 * This test pins the contract via static source inspection so a future
 * regression — someone removing the `mode === 'strict'` guard, or adding a
 * coverage check before the guard — fails CI immediately. The Deno
 * integration test in `supabase/functions/grounded-answer/__tests__/
 * pipeline.test.ts` exercises the runtime path with a stubbed Supabase
 * client (4 new tests: soft+not-ready bypass, soft+empty-chunks Claude
 * call, strict+not-ready abstain, strict+not-ready reason).
 *
 * Constraint: keep both `pipeline.ts` and `pipeline-stream.ts` in sync —
 * same gate logic in both. The streaming variant is currently soft-mode-
 * only at the route layer, but the contract must hold symmetrically.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const pipelinePath = resolve(
  process.cwd(),
  'supabase/functions/grounded-answer/pipeline.ts',
);
const pipelineStreamPath = resolve(
  process.cwd(),
  'supabase/functions/grounded-answer/pipeline-stream.ts',
);
const streamingMigrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260429000000_p1_foxy_streaming_flag.sql',
);

const pipelineSrc = readFileSync(pipelinePath, 'utf8');
const pipelineStreamSrc = readFileSync(pipelineStreamPath, 'utf8');

describe('Foxy soft-mode coverage-precheck skip (P0 fix 2026-04-28)', () => {
  it('pipeline.ts: coverage precheck is gated by `request.mode === "strict"`', () => {
    // The fix wraps the coverage call in a strict-mode-only branch. We
    // assert the literal guard string is present immediately above the
    // checkCoverage call. If a future edit drops the guard, this fails.
    //
    // Pattern: `if (request.mode === 'strict') { ... checkCoverage(...) ... }`
    const guardedCoverageRegex =
      /if\s*\(\s*request\.mode\s*===\s*['"]strict['"]\s*\)\s*\{[\s\S]*?checkCoverage\s*\(/;
    expect(pipelineSrc).toMatch(guardedCoverageRegex);
  });

  it('pipeline-stream.ts: coverage precheck is gated by `request.mode === "strict"` (parity)', () => {
    // Same gate must exist in the streaming variant — comments above it
    // explicitly call out the parity requirement with pipeline.ts.
    const guardedCoverageRegex =
      /if\s*\(\s*request\.mode\s*===\s*['"]strict['"]\s*\)\s*\{[\s\S]*?checkCoverage\s*\(/;
    expect(pipelineStreamSrc).toMatch(guardedCoverageRegex);
  });

  it('pipeline.ts: there is exactly ONE checkCoverage call (no soft-mode duplicate)', () => {
    // We never want a "soft-mode coverage check" sneak-in (e.g. someone
    // adding a second checkCoverage with different semantics). The contract
    // is binary: strict checks coverage, soft does not.
    const callMatches = pipelineSrc.match(/\bcheckCoverage\s*\(/g);
    expect(callMatches).not.toBeNull();
    expect(callMatches!.length).toBe(1);
  });

  it('pipeline-stream.ts: there is exactly ONE checkCoverage call (no soft-mode duplicate)', () => {
    const callMatches = pipelineStreamSrc.match(/\bcheckCoverage\s*\(/g);
    expect(callMatches).not.toBeNull();
    expect(callMatches!.length).toBe(1);
  });

  it('pipeline.ts: soft-mode bypass rationale is documented inline (drift-prevention)', () => {
    // The fix comment explicitly mentions "soft" and "general CBSE knowledge"
    // so a future maintainer understands WHY the gate exists. If the
    // comment disappears, this test fails — forcing a docs/code review.
    const commentBlock = pipelineSrc.match(
      /Soft mode[\s\S]{0,400}general CBSE knowledge/,
    );
    expect(commentBlock).not.toBeNull();
  });

  it('pipeline-stream.ts: soft-mode bypass rationale is documented inline (drift-prevention)', () => {
    const commentBlock = pipelineStreamSrc.match(
      /Soft mode[\s\S]{0,400}general CBSE knowledge/,
    );
    expect(commentBlock).not.toBeNull();
  });

  it('migration 20260429000000_p1_foxy_streaming_flag.sql: file exists and ff_foxy_streaming defaults to false', () => {
    // Unrelated to the coverage skip but pinned per spec — the streaming
    // feature flag must remain off by default so blocking JSON stays the
    // production path until streaming ships behind opt-in. The user asked
    // for this assertion to live in this test file as an "alive" signal
    // that the migration hasn't been deleted or repurposed.
    expect(existsSync(streamingMigrationPath)).toBe(true);
    const migSrc = readFileSync(streamingMigrationPath, 'utf8');
    // Pin: the INSERT row uses `is_enabled` = false (string match — the
    // migration uses a positional VALUES list: 'ff_foxy_streaming', false).
    expect(migSrc).toMatch(/'ff_foxy_streaming'\s*,\s*false\b/);
    // And the flag name is exactly 'ff_foxy_streaming' (not a typo variant).
    expect(migSrc).toContain("'ff_foxy_streaming'");
  });

  it('strict-mode coverage gate is the FIRST pipeline step (preserves abstain ordering for ncert-solver and quiz-generator-v2)', () => {
    // The fix must NOT change the order: strict-mode callers see
    // chapter_not_ready BEFORE any cache lookup, feature-flag check, or
    // circuit-breaker probe. We pin this by checking that the strict-mode
    // coverage block appears before the "Step 2. Cache lookup" comment.
    const stepOnePos = pipelineSrc.search(
      /if\s*\(\s*request\.mode\s*===\s*['"]strict['"]\s*\)\s*\{[\s\S]*?checkCoverage\s*\(/,
    );
    const stepTwoPos = pipelineSrc.indexOf('Step 2.');
    expect(stepOnePos).toBeGreaterThan(-1);
    expect(stepTwoPos).toBeGreaterThan(-1);
    expect(stepOnePos).toBeLessThan(stepTwoPos);
  });
});
