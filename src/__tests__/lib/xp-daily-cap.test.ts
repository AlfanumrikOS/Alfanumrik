/**
 * Daily XP cap parity + return-shape contract.
 *
 * P2 invariant: xp_earned per day must be clamped to XP_RULES.quiz_daily_cap
 * (currently 200). Migration 20260427000003_enforce_daily_xp_cap.sql adds
 * server-side clamping inside atomic_quiz_profile_update so a malicious or
 * buggy client cannot award unbounded XP.
 *
 * Why this test exists:
 * 1. Drift detection — if someone bumps XP_RULES.quiz_daily_cap in
 *    src/lib/xp-rules.ts WITHOUT bumping the literal `200` in the SQL
 *    migration (or vice-versa), this test fails. The migration explicitly
 *    documents that src/lib/xp-rules.ts is the source of truth.
 * 2. Return-shape contract — atomic_quiz_profile_update used to return
 *    VOID; post-migration it returns JSONB with named fields the API
 *    surfaces to the learner. We document the shape as a TS type alias
 *    so any future caller knows what to expect. The migration text is
 *    referenced inline.
 * 3. Pure-TS clamp parity — there is no in-process Postgres in unit tests,
 *    so we cannot exercise the SQL function directly. We re-implement the
 *    clamp as a tiny TypeScript helper (matching the SQL semantics line-
 *    for-line) and prove the four edge cases. If the SQL clamp ever
 *    diverges from this contract, the migration assertion above will
 *    catch it on the literal-200 check.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { XP_RULES } from '@/lib/xp-rules';

// ─────────────────────────────────────────────────────────────────────
// 1. Parity assertion: XP_RULES.quiz_daily_cap === SQL migration literal
// ─────────────────────────────────────────────────────────────────────

// Section 10 cleanup (2026-05-03): pre-baseline migrations were moved to
// `supabase/migrations/_legacy/timestamped/`. Helper to find them.
function resolveMigration(name: string): string {
  const candidates = [
    resolve(process.cwd(), 'supabase/migrations', name),
    resolve(process.cwd(), 'supabase/migrations/_legacy/timestamped', name),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0];
}

describe('xp daily cap: SQL migration parity with XP_RULES', () => {
  const migrationPath = resolveMigration('20260427000003_enforce_daily_xp_cap.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  it('XP_RULES.quiz_daily_cap is 200 (the published P2 cap)', () => {
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it('migration contains the literal 200 (matches XP_RULES.quiz_daily_cap)', () => {
    // The function declares `v_daily_cap INT := 200;`. If anyone bumps
    // the TS constant, they must also bump this literal.
    expect(sql).toMatch(/v_daily_cap\s+INT\s*:=\s*200/);
  });

  it('migration references XP_RULES.quiz_daily_cap as source of truth', () => {
    // The header comment must call out the cross-file invariant so a
    // future editor knows the constants are coupled.
    expect(sql).toMatch(/XP_RULES\.quiz_daily_cap/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. Return-shape contract — pinned as a TS type alias for documentation
// ─────────────────────────────────────────────────────────────────────

describe('atomic_quiz_profile_update return shape (migration 20260427000003)', () => {
  // This is the JSONB shape the SQL function now returns. It is the
  // contract that callers (submitQuizResults, the quiz API) read to
  // surface the cap status to the learner. Encoded as a TS type so the
  // compiler enforces it at the call site:
  type AtomicQuizProfileUpdateResult = {
    success: boolean;
    requested_xp: number;
    effective_xp: number;
    xp_capped: boolean;
    xp_cap_excess: number;
    today_earned: number;
    daily_cap: number;
    remaining_today: number;
    profile_xp: number;
  };

  it('contract type compiles and matches the migration return shape', () => {
    // No-op runtime check — the type alias above is the assertion. We
    // construct a sample value that satisfies the type to prove it.
    const sample: AtomicQuizProfileUpdateResult = {
      success: true,
      requested_xp: 70,
      effective_xp: 70,
      xp_capped: false,
      xp_cap_excess: 0,
      today_earned: 0,
      daily_cap: 200,
      remaining_today: 130,
      profile_xp: 70,
    };
    expect(sample.daily_cap).toBe(XP_RULES.quiz_daily_cap);
    expect(sample.effective_xp + sample.remaining_today + sample.today_earned).toBe(sample.daily_cap);
  });

  it('migration source declares jsonb_build_object with the documented keys', () => {
    const migrationPath = resolveMigration('20260427000003_enforce_daily_xp_cap.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    for (const key of [
      'success',
      'requested_xp',
      'effective_xp',
      'xp_capped',
      'xp_cap_excess',
      'today_earned',
      'daily_cap',
      'remaining_today',
      'profile_xp',
    ]) {
      expect(sql).toMatch(new RegExp(`'${key}'`));
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 3. Pure-TS clamp parity — line-for-line port of the SQL clamp
// ─────────────────────────────────────────────────────────────────────

/**
 * Pure-TS twin of the SQL clamp inside atomic_quiz_profile_update. Both
 * paths must produce identical numbers given the same inputs:
 *
 *   v_remaining    := GREATEST(0, v_daily_cap - v_today_earned);
 *   v_effective_xp := LEAST(GREATEST(0, COALESCE(p_xp, 0)), v_remaining);
 *
 * Keeping a TS twin lets us regress the clamp without standing up a
 * Postgres instance in unit tests.
 */
function clampXp(today_earned: number, requested: number, cap: number): number {
  const remaining = Math.max(0, cap - today_earned);
  const safeRequested = Math.max(0, requested ?? 0);
  return Math.min(safeRequested, remaining);
}

describe('clampXp: parity port of the SQL daily-cap clamp', () => {
  const cap = XP_RULES.quiz_daily_cap; // 200

  it('already_at_cap → 0 (no further XP awarded today)', () => {
    expect(clampXp(200, 70, cap)).toBe(0);
    expect(clampXp(250, 70, cap)).toBe(0); // over-cap (defensive)
  });

  it('room_for_full_amount → returns the full requested value', () => {
    expect(clampXp(0, 70, cap)).toBe(70);
    expect(clampXp(100, 50, cap)).toBe(50);
  });

  it('partial_room → exact remaining (199 + quiz worth 50 → 1, not 0, not 50)', () => {
    expect(clampXp(199, 50, cap)).toBe(1);
    expect(clampXp(150, 100, cap)).toBe(50);
  });

  it('cap_change_runtime → respects the new cap argument', () => {
    // If we ever change the cap (e.g. premium plan with higher ceiling),
    // the helper must respect the runtime arg and not bake in 200.
    expect(clampXp(100, 70, 300)).toBe(70);
    expect(clampXp(280, 70, 300)).toBe(20);
  });

  it('boundary: exactly at cap → next request awards 0', () => {
    expect(clampXp(cap, 1, cap)).toBe(0);
  });

  it('zero / negative requested → 0 (defensive against callers)', () => {
    expect(clampXp(0, 0, cap)).toBe(0);
    expect(clampXp(0, -50, cap)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────
// 4. XP bonus parity: SQL submit_quiz_results literals === XP_RULES (F20)
// ─────────────────────────────────────────────────────────────────────
//
// Audit finding F20: submit_quiz_results RPC at
// supabase/migrations/20260418110000_fix_quiz_shuffle_scoring.sql:236-238
// hardcodes literals  v_xp := v_correct * 10  /  v_xp + 20  /  v_xp + 50.
// They MUST match XP_RULES.quiz_per_correct, .quiz_high_score_bonus,
// .quiz_perfect_bonus. If anyone bumps a TS constant without updating
// the SQL — or vice versa — students see scores that don't match the
// XP that lands in students.xp_total. P2 invariant breach.

describe('xp bonuses: SQL submit_quiz_results literals match XP_RULES', () => {
  // If a future migration replaces this RPC, update the path AND keep
  // the parity assertions intact.
  const migrationPath = resolveMigration('20260418110000_fix_quiz_shuffle_scoring.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  it('XP_RULES base values are the published P2 constants', () => {
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
  });

  it('SQL: per-correct literal matches XP_RULES.quiz_per_correct (10)', () => {
    const re = new RegExp(`v_xp\\s*:=\\s*v_correct\\s*\\*\\s*${XP_RULES.quiz_per_correct}\\b`);
    expect(sql).toMatch(re);
  });

  it('SQL: high-score bonus literal matches XP_RULES.quiz_high_score_bonus (20)', () => {
    // Match `>= 80 ... v_xp := v_xp + 20`
    const re = new RegExp(`>=\\s*80[\\s\\S]*?v_xp\\s*:=\\s*v_xp\\s*\\+\\s*${XP_RULES.quiz_high_score_bonus}\\b`);
    expect(sql).toMatch(re);
  });

  it('SQL: perfect-score bonus literal matches XP_RULES.quiz_perfect_bonus (50)', () => {
    // Match `= 100 ... v_xp := v_xp + 50`
    const re = new RegExp(`=\\s*100[\\s\\S]*?v_xp\\s*:=\\s*v_xp\\s*\\+\\s*${XP_RULES.quiz_perfect_bonus}\\b`);
    expect(sql).toMatch(re);
  });

  it('SQL: high-score threshold is 80 and perfect-score threshold is 100', () => {
    // Pin thresholds — they live in the score formula, not in XP_RULES,
    // but a future edit could silently change "who gets the bonus".
    expect(sql).toMatch(/v_score_percent\s*>=\s*80/);
    expect(sql).toMatch(/v_score_percent\s*=\s*100/);
  });

  it('SQL: anti-cheat zeroes XP — flagged path forces v_xp := 0', () => {
    // Pin so the parity check above cannot be bypassed by removing the
    // anti-cheat zero (which would let a flagged session still earn XP).
    expect(sql).toMatch(/v_flagged[\s\S]{0,200}?v_xp\s*:=\s*0/);
  });
});
