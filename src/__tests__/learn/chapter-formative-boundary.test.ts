/**
 * Boundary lock — chapter-page quiz is a FORMATIVE self-check, not the scored path.
 *
 * The learn chapter page (`src/app/learn/[subject]/[chapter]/page.tsx`) renders an
 * in-chapter quiz + performance report + completion surface. This is a *formative*
 * self-check: it must NEVER award XP, write a quiz_session, or otherwise flow
 * through the scored submission pipeline. The single authoritative scored path
 * lives at `/quiz` (`submitQuizResults()` → `atomic_quiz_profile_update()` RPC).
 *
 * Assessment (Phase 5c-1 condition) asked for a test that locks the
 * formative-vs-scored boundary so a future edit to the chapter page cannot
 * silently graft the scored path onto the self-check (double-award / P2 economy
 * breach) or split a quiz_session write outside submitQuizResults (P4 atomicity).
 *
 * These are source-canaries over the page text — cheap, deterministic, and they
 * fail loudly the moment the boundary is crossed.
 *
 * ── Score-display pin (Invariant 7 / P1) ──────────────────────────────────────
 * The report surface must show the exact `calculateScorePercent()` value, fed
 * straight into the MasteryRing. If a future re-skin swaps in a locally
 * recomputed percentage, the displayed score could silently diverge from the
 * canonical formula. We pin the derive-once → feed-through chain.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// __dirname = <project-root>/src/__tests__/learn ; ../../.. = project root
const PAGE_PATH = resolve(
  __dirname,
  '../../..',
  'src/app/learn/[subject]/[chapter]/page.tsx',
);
const source = readFileSync(PAGE_PATH, 'utf-8');

describe('chapter self-check stays off the scored submission path (P2/P4 boundary)', () => {
  it('never calls submitQuizResults (the scored entrypoint lives at /quiz)', () => {
    expect(source.includes('submitQuizResults')).toBe(false);
  });

  it('never invokes the atomic_quiz_profile_update RPC directly', () => {
    expect(source.includes('atomic_quiz_profile_update')).toBe(false);
  });

  it('never writes a quiz_sessions row (no INSERT path outside submitQuizResults)', () => {
    expect(/from\(\s*['"]quiz_sessions['"]\s*\)/.test(source)).toBe(false);
    expect(source.includes('quiz_sessions')).toBe(false);
  });
});

describe('report score display is the canonical calculateScorePercent value (P1 / Invariant 7)', () => {
  it('the report phase derives its percentage via calculateScorePercent(correctQ, totalQ)', () => {
    expect(source.includes("phase === 'report'")).toBe(true);
    expect(/const\s+pct\s*=\s*calculateScorePercent\(\s*correctQ\s*,\s*totalQ\s*\)/.test(source)).toBe(true);
  });

  it('feeds that derived pct straight into MasteryRing (no recomputed value at the ring)', () => {
    // The ring must be fed the already-derived `pct`, not an inline Math.round.
    expect(/<MasteryRing[\s\S]{0,200}?value=\{pct\}/.test(source)).toBe(true);
    expect(/<MasteryRing[\s\S]{0,200}?value=\{\s*Math\.round/.test(source)).toBe(false);
  });
});
