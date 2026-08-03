import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { XP_RULES } from '@alfanumrik/lib/xp-config';

/**
 * P0-3 (2026-08-03) — P2 XP literal parity in Deno-land Edge Functions.
 *
 * `supabase/functions/parent-report-generator/index.ts` and
 * `supabase/functions/parent-portal/index.ts` re-derive per-quiz XP for parent
 * reports/dashboards. Deno cannot import `packages/lib/src/xp-config.ts`, so
 * the P2 constants are RE-TYPED as raw literals there (with provenance
 * comments). Before the fix, parent-report-generator awarded a drifted
 * `+ 25` high-score bonus and a flat `? 30 : 0` per-quiz prev-week estimate,
 * and parent-portal dropped both bonuses entirely — all P2 violations shown
 * to parents.
 *
 * This static canary pins the canonical literals in BOTH files against
 * XP_RULES so future Deno-land drift fails CI. Companion to the SQL-side
 * guard `xp-sql-literal-parity.test.ts` (SLC-2) — same grep-the-source
 * house pattern (comments cannot satisfy the code-shaped regexes below).
 */

// Repo root anchored from this file (apps/host/src/__tests__/ → 4 levels up)
// so resolution works regardless of the vitest cwd.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const EDGE_FUNCTIONS = [
  'supabase/functions/parent-report-generator/index.ts',
  'supabase/functions/parent-portal/index.ts',
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, rel), 'utf8');
}

// Code-shaped extractors — tied to the executable expressions, so the
// `// P2: XP_RULES.quiz_high_score_bonus=20` provenance comments can never
// satisfy a match on their own.
const RE_PER_CORRECT = /correct\s*\*\s*(\d+)/g; // `let xp = correct * 10`
const RE_HIGH_BONUS = />=\s*80\)\s*xp\s*\+=\s*(\d+)/g; // `if (scorePercent >= 80) xp += 20`
const RE_PERFECT_BONUS = /===\s*100\)\s*xp\s*\+=\s*(\d+)/g; // `if (scorePercent === 100) xp += 50`
const RE_ANY_XP_INCREMENT = /\bxp\s*\+=\s*(\d+)/g; // sweep: every xp increment literal

describe('P2 XP literal parity — parent-facing Deno Edge Functions', () => {
  it('canonical anchor: XP_RULES is 10 / +20 (>=80) / +50 (===100)', () => {
    // Changing these is a P2 invariant change (user approval required) AND
    // must be mirrored into both Deno files — the per-file asserts enforce it.
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
  });

  for (const rel of EDGE_FUNCTIONS) {
    describe(rel, () => {
      const src = read(rel);

      it('per-correct multiplier present and equals XP_RULES.quiz_per_correct', () => {
        const values = [...src.matchAll(RE_PER_CORRECT)].map((m) => Number(m[1]));
        expect(values.length).toBeGreaterThanOrEqual(1); // guards vacuous pass
        for (const v of values) expect(v).toBe(XP_RULES.quiz_per_correct);
      });

      it('high-score bonus gated on >= 80 and equals XP_RULES.quiz_high_score_bonus', () => {
        const values = [...src.matchAll(RE_HIGH_BONUS)].map((m) => Number(m[1]));
        expect(values.length).toBeGreaterThanOrEqual(1);
        for (const v of values) expect(v).toBe(XP_RULES.quiz_high_score_bonus);
      });

      it('perfect bonus gated on === 100 and equals XP_RULES.quiz_perfect_bonus', () => {
        const values = [...src.matchAll(RE_PERFECT_BONUS)].map((m) => Number(m[1]));
        expect(values.length).toBeGreaterThanOrEqual(1);
        for (const v of values) expect(v).toBe(XP_RULES.quiz_perfect_bonus);
      });

      it('drift sweep: every `xp +=` literal is a canonical bonus (20 or 50)', () => {
        const values = [...src.matchAll(RE_ANY_XP_INCREMENT)].map((m) => Number(m[1]));
        expect(values.length).toBeGreaterThanOrEqual(2);
        for (const v of values) {
          expect([XP_RULES.quiz_high_score_bonus, XP_RULES.quiz_perfect_bonus]).toContain(v);
        }
      });

      it('the pre-fix drifted literals never reappear (+25 bonus, flat ?30:0 estimate)', () => {
        expect(src).not.toMatch(/\+=?\s*25\b/);
        expect(src).not.toMatch(/\?\s*30\s*:\s*0/);
      });
    });
  }
});

/**
 * PROPOSED REGRESSION CATALOG ROW (orchestrator assigns the REG id):
 *   REG-337: xp_edge_function_literal_parity
 *     asserts  | parent-report-generator + parent-portal Deno sources carry the
 *              | canonical P2 literals (correct*10, +20 @ >=80, +50 @ ===100),
 *              | no non-canonical xp increments, no regressed +25 / ?30:0 shapes.
 *     location | apps/host/src/__tests__/xp-edge-function-literal-parity.test.ts
 *     invariant| P2 (XP Economy)
 */
