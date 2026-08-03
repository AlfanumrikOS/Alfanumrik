/**
 * select_quiz_questions_rag verification-gate: Rung E0/E1 ladder decision.
 *
 * Mirrors reg-172-pool-reset-tiny-chapter.test.ts's pattern: a small, DB-free
 * REPLICA of the SQL's own tier decision (migration
 * `20260802100000_select_quiz_questions_rag_verification_gate.sql`:
 * `v_use_strict := v_pair_enforced AND v_verified_pool >= p_count;`), pinned
 * with table-driven cases per spec §6.3.
 *
 * This function is a TEST-MIRROR of the SQL logic, not a shared production
 * implementation the RPC calls into — the RPC is plpgsql, this is its TS
 * decision-table twin, exactly analogous to how `shouldResetPool()` mirrors
 * the REG-172 SQL guard rather than being called by it. Per spec §6.3 this
 * lives "wherever architect judges appropriate" since there is no current TS
 * caller that needs a real (non-mirror) implementation of this decision —
 * per spec §2.2's own rationale, "the enforcement decision lives entirely
 * inside the RPC," so no route handler branches on it.
 *
 * Deterministic, no DB. Spec:
 * docs/superpowers/specs/2026-08-02-quiz-rag-verification-gate-correctness.md §6.3.
 */
import { describe, it, expect } from 'vitest';

export type VerificationTier = 'strict' | 'relaxed';

/**
 * Replicates the Rung E0/E1 decision from migration
 * `20260802100000_select_quiz_questions_rag_verification_gate.sql`:
 *   v_use_strict := v_pair_enforced AND v_verified_pool >= p_count;
 *
 * 'strict'  -> Rung E0 (verified_against_ncert=true AND verification_state='verified')
 * 'relaxed' -> Rung E1 (pair enforced but locally thin) OR the unenforced
 *              default — both are the SAME Tier-0-only filter (spec §3.1's
 *              table: E1 and "default — unenforced" share one predicate row).
 */
export function selectVerificationTier(
  pairEnforced: boolean,
  verifiedPoolCount: number,
  requestedCount: number,
): VerificationTier {
  return pairEnforced && verifiedPoolCount >= requestedCount ? 'strict' : 'relaxed';
}

describe('select_quiz_questions_rag verification gate: Rung E0/E1 decision', () => {
  it('pair not enforced -> always relaxed, regardless of verified pool size', () => {
    expect(selectVerificationTier(false, 0, 10)).toBe('relaxed');
    expect(selectVerificationTier(false, 100, 10)).toBe('relaxed');
    expect(selectVerificationTier(false, 10, 10)).toBe('relaxed');
  });

  it('pair enforced, verified pool >= requested count -> strict (Rung E0)', () => {
    expect(selectVerificationTier(true, 15, 10)).toBe('strict');
    expect(selectVerificationTier(true, 10, 10)).toBe('strict'); // boundary, inclusive >=
  });

  it('pair enforced, verified pool < requested count -> relaxed (Rung E1)', () => {
    expect(selectVerificationTier(true, 9, 10)).toBe('relaxed');
    expect(selectVerificationTier(true, 0, 10)).toBe('relaxed');
  });

  it('boundary: pool === requested count is inclusive strict, per spec §3.1\'s ">="', () => {
    expect(selectVerificationTier(true, 5, 5)).toBe('strict');
    expect(selectVerificationTier(true, 4, 5)).toBe('relaxed');
    expect(selectVerificationTier(true, 6, 5)).toBe('strict');
  });

  it('zero requested count: an enforced pair with zero verified pool still resolves to strict (0 >= 0)', () => {
    // Edge case not explicitly enumerated by spec §6.3 but implied by the
    // ">=" semantics: p_count=0 is not a realistic caller value (all three
    // call sites request >= 1), but the decision function must not throw or
    // behave inconsistently if it is ever passed.
    expect(selectVerificationTier(true, 0, 0)).toBe('strict');
    expect(selectVerificationTier(false, 0, 0)).toBe('relaxed');
  });

  it('E1 and the unenforced default are the SAME outcome (spec §3.1: both "relaxed", Tier-0 only)', () => {
    const e1 = selectVerificationTier(true, 3, 10); // enforced but thin
    const unenforcedDefault = selectVerificationTier(false, 3, 10); // not enforced
    expect(e1).toBe(unenforcedDefault);
    expect(e1).toBe('relaxed');
  });
});
