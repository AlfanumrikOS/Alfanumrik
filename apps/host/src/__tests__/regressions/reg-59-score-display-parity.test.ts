/**
 * REG-59 — Score display in QuizResults must come from the server response,
 * never recomputed client-side (P1 score accuracy).
 *
 * The submission response from `submitQuizResults()` (or
 * `/api/quiz/submit`) contains `score_percent`, `xp_earned`, `xp_capped`,
 * and `xp_uncapped`. The QuizResults component MUST surface those values
 * exactly as received. Recalculating in the component re-introduces the
 * "client says 80% but server says 70%" drift bug that REG-51 / REG-52 /
 * REG-53 already pinned at the server side.
 *
 * Strategy: static-source inspection. The `pct` and `xpEarned` references
 * in QuizResults.tsx must trace to `results.score_percent` and
 * `results.xp_earned`. Sub-category math (Bloom's per-level percentages,
 * MCQ-vs-Written subscore breakdown, distribution charts) is allowed —
 * those are display-only aggregates that don't override the headline score.
 *
 * What we forbid (in the headline path):
 *   - `Math.round((correct / total) * 100)` against the top-level scoring
 *   - any direct `correct / total * 100` for the displayed `pct`
 *
 * What we require:
 *   - `pct = results.score_percent` (or equivalent) for the headline.
 *   - `xpEarned={results.xp_earned}` passed to CelebrationOverlay.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const QUIZ_RESULTS_PATH = resolve(process.cwd(), 'src/components/quiz/QuizResults.tsx');

describe('REG-59 — QuizResults headline score comes from server response', () => {
  it('src/components/quiz/QuizResults.tsx exists', () => {
    expect(existsSync(QUIZ_RESULTS_PATH)).toBe(true);
  });

  it('uses results.score_percent for the headline pct (not a fresh computation)', () => {
    const src = readFileSync(QUIZ_RESULTS_PATH, 'utf8');

    // The canonical headline binding.
    expect(src).toMatch(/const\s+pct\s*=\s*results\.score_percent/);
  });

  it('passes xpEarned from results.xp_earned to CelebrationOverlay', () => {
    const src = readFileSync(QUIZ_RESULTS_PATH, 'utf8');
    expect(src).toMatch(/xpEarned=\{results\.xp_earned\}/);
  });

  it('reads xp_capped and xp_uncapped from the server response (cap banner parity)', () => {
    const src = readFileSync(QUIZ_RESULTS_PATH, 'utf8');
    // The Marking-Authenticity cap banner reads both flags directly off
    // the server response so the over-cap notice matches the SQL clamp.
    expect(src).toMatch(/results\.xp_capped/);
    expect(src).toMatch(/results\.xp_uncapped/);
  });

  it('does NOT redefine the headline pct from a (correct / total) ratio', () => {
    const src = readFileSync(QUIZ_RESULTS_PATH, 'utf8');

    // Forbid these specific re-derivation patterns at the *headline* binding.
    // We allow them inside sub-category aggregations (mcqResponses,
    // qsAtLevel, distribution counts) but not as the source of `pct`.
    const headlineRe = /const\s+pct\s*=\s*Math\.round/;
    expect(src).not.toMatch(headlineRe);

    const headlineRatioRe = /const\s+pct\s*=\s*\(.*correct.*\/.*total.*\)/;
    expect(src).not.toMatch(headlineRatioRe);

    // Forbid recomputing xp_earned on the client headline path.
    expect(src).not.toMatch(/const\s+xpEarned\s*=\s*Math\.round/);
    expect(src).not.toMatch(/const\s+xpEarned\s*=\s*correct\s*\*/);
  });

  it('handles idempotent_replay flag from the server (no double-celebration)', () => {
    const src = readFileSync(QUIZ_RESULTS_PATH, 'utf8');
    // Wave 2 added `idempotent_replay` short-circuit on the celebration
    // overlay. Pin the binding to keep the contract auditable.
    expect(src).toMatch(/results\.idempotent_replay/);
  });
});
