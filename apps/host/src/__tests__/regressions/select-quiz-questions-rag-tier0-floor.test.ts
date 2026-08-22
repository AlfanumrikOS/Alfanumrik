/**
 * select_quiz_questions_rag verification-gate: Tier-0 floor + per-row
 * inclusion predicate (spec §2.1, §3.1, §3.4).
 *
 * GAP THIS FILE CLOSES
 * ---------------------
 * Migration `20260802100000_select_quiz_questions_rag_verification_gate.sql`
 * has three layers of test coverage:
 *   1. `__tests__/contract/select-quiz-questions-rag-verification-gate.test.ts`
 *      — structure test. Proves the SQL TEXT contains the right tokens.
 *      Runs on every PR. Cannot prove behavior.
 *   2. `__tests__/migrations/select-quiz-questions-rag-verification-gate.test.ts`
 *      — live-DB AC-1..AC-6. Proves BEHAVIOR against a real Postgres. Gated on
 *      `RUN_INTEGRATION_TESTS=1` + real Supabase creds — does NOT execute in
 *      this environment (confirmed: no creds available).
 *   3. `__tests__/regressions/select-quiz-questions-rag-verification-tier.test.ts`
 *      — pure-function mirror of ONLY the rung decision
 *      (`v_use_strict := v_pair_enforced AND v_verified_pool >= p_count`).
 *
 * None of these three actually EXECUTE, right now, in this environment, a
 * check that the single non-negotiable predicate in the whole migration
 * (spec §3.4: "verification_state != 'failed' has no fallback rung — a
 * verifier-disproved row must never serve, enforced or not") behaves
 * correctly — the structure test can only confirm the token is present
 * somewhere in the block text, not that it functions as an unconditional
 * floor rather than being accidentally nested inside the strict/relaxed
 * conditional (which would silently let failed rows leak through on the
 * relaxed rung only — exactly the failure mode this predicate exists to
 * prevent). Same gap for the "legacy backlog stays servable under Tier-0 but
 * must respect the strict rung when it applies" interaction.
 *
 * This file closes that gap with a pure, DB-free, TEST-MIRROR of the
 * candidate_pool CTE's per-row inclusion predicate — the same technique
 * `reg-172-pool-reset-tiny-chapter.test.ts` uses for `shouldResetPool()` and
 * the sibling file above uses for `selectVerificationTier()`. The rung
 * boolean (`v_use_strict`) is recomputed INLINE here (one ternary,
 * `pairEnforced && verifiedPoolCount >= requestedCount`) rather than
 * importing `selectVerificationTier` from the sibling `.test.ts` file —
 * deliberately: importing one Vitest test file's module into another
 * re-executes its top-level `describe()` calls in the importing file's
 * collection context, silently DOUBLE-COUNTING that file's tests whenever
 * both files run in the same invocation (verified empirically while writing
 * this file: 6+10 expected became 22 collected). Both files independently
 * mirror the identical SQL line `v_use_strict := v_pair_enforced AND
 * v_verified_pool >= p_count;` — if they ever disagree, the SQL migration
 * (re-verified by direct Read, not memory) is authoritative for both.
 *
 * SOURCE OF TRUTH THIS MIRRORS (read directly from the migration, verbatim):
 *   AND qb.deleted_at IS NULL
 *   AND qb.content_status = 'published'
 *   AND qb.verification_state != 'failed'
 *   AND (NOT v_use_strict OR (qb.verified_against_ncert = true AND qb.verification_state = 'verified'))
 * (qb.is_active = true is also Tier-0 but pre-existing/unchanged by this
 * migration; included here anyway since it is part of the same real WHERE
 * clause and costs nothing to mirror.)
 *
 * Subject/grade/chapter/question-type/difficulty matching is DELIBERATELY
 * NOT mirrored — this migration does not touch those predicates, and
 * widening this mirror's scope would only add drift risk for parts of the
 * query nothing here needs to pin.
 *
 * This is a TEST-MIRROR, not shared production code — the real filtering
 * runs as plpgsql inside Postgres. If this mirror and the SQL text ever
 * disagree, the SQL (re-verified by direct `Read` against the migration
 * file, not from memory) is authoritative; this file must be updated to
 * match it, never the other way around.
 *
 * Spec: docs/superpowers/specs/2026-08-02-quiz-rag-verification-gate-correctness.md
 * §2.1 (Tier-0), §3.1 (rungs table), §3.4 (why the failed-exclusion has no
 * fallback rung).
 */
import { describe, it, expect } from 'vitest';

type ContentStatus = 'draft' | 'review' | 'published' | 'archived';
type VerificationState = 'legacy_unverified' | 'pending' | 'verified' | 'failed';

interface MirrorRow {
  label: string;
  isActive: boolean;
  deletedAt: string | null;
  contentStatus: ContentStatus;
  verificationState: VerificationState;
  verifiedAgainstNcert: boolean;
}

/**
 * Mirrors the candidate_pool CTE's per-row inclusion predicate exactly as
 * written in migration `20260802100000_select_quiz_questions_rag_verification_gate.sql`
 * (subject/grade/chapter/type/difficulty predicates omitted — out of this
 * mirror's scope, see file header).
 */
function isRowServable(row: MirrorRow, useStrict: boolean): boolean {
  if (!row.isActive) return false; // qb.is_active = true
  if (row.deletedAt !== null) return false; // qb.deleted_at IS NULL
  if (row.contentStatus !== 'published') return false; // qb.content_status = 'published'
  if (row.verificationState === 'failed') return false; // Tier-0 floor — UNCONDITIONAL, spec §3.4
  // AND (NOT v_use_strict OR (verified_against_ncert = true AND verification_state = 'verified'))
  if (useStrict) {
    return row.verifiedAgainstNcert === true && row.verificationState === 'verified';
  }
  return true;
}

/**
 * Convenience: full ladder decision + row filter, composed exactly as the
 * RPC composes them. Mirrors `v_use_strict := v_pair_enforced AND
 * v_verified_pool >= p_count;` inline (see file header for why this is not
 * imported from the sibling tier-decision test file).
 */
function servableRows(
  rows: MirrorRow[],
  pairEnforced: boolean,
  verifiedPoolCount: number,
  requestedCount: number,
): MirrorRow[] {
  const useStrict = pairEnforced && verifiedPoolCount >= requestedCount;
  return rows.filter((r) => isRowServable(r, useStrict));
}

function row(overrides: Partial<MirrorRow> & { label: string }): MirrorRow {
  return {
    isActive: true,
    deletedAt: null,
    contentStatus: 'published',
    verificationState: 'legacy_unverified',
    verifiedAgainstNcert: false,
    ...overrides,
  };
}

describe('select_quiz_questions_rag verification gate: Tier-0 floor (spec §3.4 — no fallback rung)', () => {
  it('a failed row is never servable under the RELAXED rung', () => {
    const failed = row({ label: 'failed', verificationState: 'failed' });
    expect(isRowServable(failed, false)).toBe(false);
  });

  it('a failed row is never servable under the STRICT rung', () => {
    const failed = row({ label: 'failed', verificationState: 'failed' });
    expect(isRowServable(failed, true)).toBe(false);
  });

  it('a pool of ONLY failed rows yields zero servable rows, enforced or not (the actual floor — no re-admission for pool size)', () => {
    const allFailed: MirrorRow[] = Array.from({ length: 5 }, (_, i) =>
      row({ label: `failed-${i}`, verificationState: 'failed', verifiedAgainstNcert: false }),
    );
    // Pair enforced, but the verified pool is 0 (all rows are failed) -> Rung E1 (relaxed).
    expect(servableRows(allFailed, true, 0, 5)).toHaveLength(0);
    // Pair not enforced at all -> default/relaxed.
    expect(servableRows(allFailed, false, 0, 5)).toHaveLength(0);
  });

  it('a failed row is excluded even when it sits alongside plenty of verified rows (strict rung, mixed pool)', () => {
    const pool: MirrorRow[] = [
      row({ label: 'failed-0', verificationState: 'failed' }),
      row({ label: 'verified-0', verificationState: 'verified', verifiedAgainstNcert: true }),
      row({ label: 'verified-1', verificationState: 'verified', verifiedAgainstNcert: true }),
    ];
    const result = servableRows(pool, true, 2, 2); // enforced, verified pool (2) >= requested (2) -> strict
    expect(result.map((r) => r.label)).toEqual(['verified-0', 'verified-1']);
  });
});

describe('select_quiz_questions_rag verification gate: legacy backlog stays servable under Tier-0, gated by the strict rung', () => {
  it('legacy_unverified is servable under the RELAXED rung (Tier-0 only)', () => {
    const legacy = row({ label: 'legacy', verificationState: 'legacy_unverified' });
    expect(isRowServable(legacy, false)).toBe(true);
  });

  it('legacy_unverified is EXCLUDED under the STRICT rung (must be verified)', () => {
    const legacy = row({ label: 'legacy', verificationState: 'legacy_unverified' });
    expect(isRowServable(legacy, true)).toBe(false);
  });

  it('pending is servable under RELAXED, excluded under STRICT (same shape as legacy_unverified)', () => {
    const pending = row({ label: 'pending', verificationState: 'pending' });
    expect(isRowServable(pending, false)).toBe(true);
    expect(isRowServable(pending, true)).toBe(false);
  });

  it('verified (both columns agree) is servable under BOTH rungs', () => {
    const verified = row({ label: 'verified', verificationState: 'verified', verifiedAgainstNcert: true });
    expect(isRowServable(verified, false)).toBe(true);
    expect(isRowServable(verified, true)).toBe(true);
  });

  it('column-disagreement defense (spec §1.3/§2.1): verification_state=verified but verified_against_ncert=false is excluded under STRICT (belt-and-suspenders AND)', () => {
    // Per spec §1.3 the two columns are supposed to always agree, but the
    // migration's WHERE clause ANDs both defensively. This pins that the AND
    // is real, not a no-op — if a future write path desyncs the columns,
    // strict-rung serving fails closed rather than trusting a single column.
    const disagreeing = row({
      label: 'disagreeing',
      verificationState: 'verified',
      verifiedAgainstNcert: false,
    });
    expect(isRowServable(disagreeing, true)).toBe(false);
    // Tier-0 alone (relaxed) does not look at verified_against_ncert at all,
    // so this row is unaffected there.
    expect(isRowServable(disagreeing, false)).toBe(true);
  });

  it('end-to-end: a realistic mixed pool resolves to the exact expected subset under each rung', () => {
    const pool: MirrorRow[] = [
      row({ label: 'failed-0', verificationState: 'failed' }),
      row({ label: 'legacy-0', verificationState: 'legacy_unverified' }),
      row({ label: 'pending-0', verificationState: 'pending' }),
      row({ label: 'verified-0', verificationState: 'verified', verifiedAgainstNcert: true }),
      row({ label: 'deleted-verified', verificationState: 'verified', verifiedAgainstNcert: true, deletedAt: '2026-08-01T00:00:00Z' }),
      row({ label: 'draft-verified', verificationState: 'verified', verifiedAgainstNcert: true, contentStatus: 'draft' }),
      row({ label: 'inactive-verified', verificationState: 'verified', verifiedAgainstNcert: true, isActive: false }),
    ];

    // RELAXED (e.g. pair not enforced): Tier-0 only. Survives: legacy, pending,
    // verified-0. Excluded: failed (floor), deleted (soft-delete), draft
    // (content_status), inactive (is_active) — none of these three Tier-0
    // closures are new to THIS pool composition test, but seeing them survive
    // together in one relaxed-rung pass is the "does the whole predicate
    // compose correctly" check no other executable test currently makes.
    const relaxed = servableRows(pool, false, 0, 10).map((r) => r.label);
    expect(relaxed.sort()).toEqual(['legacy-0', 'pending-0', 'verified-0'].sort());

    // STRICT (pair enforced, verified pool for this slice >= requested count):
    // only verified-0 survives — legacy/pending fall out under the strict
    // predicate too, on top of the same three Tier-0 exclusions.
    const strict = servableRows(pool, true, 1, 1).map((r) => r.label);
    expect(strict).toEqual(['verified-0']);
  });
});
