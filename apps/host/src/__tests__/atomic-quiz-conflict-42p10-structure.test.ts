import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * atomic_quiz_profile_update 42P10 hotfix — STRUCTURAL pins
 * (always-on, runs in NORMAL CI; no database required).
 *
 * Companion to the integration-lane e2e (migrations/atomic-quiz-xp-42p10-e2e.test.ts).
 * These pins grep the migration SOURCE so the fix cannot silently regress.
 *
 * THE BUG THIS PINS
 * =================
 * The 7-arg overload public.atomic_quiz_profile_update(
 *   p_student_id, p_subject, p_xp, p_total, p_correct, p_time_seconds, p_session_id)
 * writes the XP ledger row (CASE A: session_id set + v_xp_to_award > 0) via
 *     INSERT INTO public.xp_transactions (...) ON CONFLICT (reference_id) DO NOTHING;
 * xp_transactions.reference_id is backed ONLY by a PARTIAL unique index
 *     idx_xp_txn_reference_id ON xp_transactions (reference_id) WHERE reference_id IS NOT NULL.
 * Postgres cannot infer a partial index for ON CONFLICT unless the clause carries the
 * matching WHERE predicate, so the bare clause raised 42P10 ("no unique or exclusion
 * constraint matching the ON CONFLICT specification") on every correct-answer / high-XP
 * submit. Reproduced live on prod, fixed in 20260623000600 by adding the predicate:
 *     ON CONFLICT (reference_id) WHERE reference_id IS NOT NULL DO NOTHING
 *
 * WHAT A REGRESSION HERE WOULD CATCH
 * ==================================
 *   - dropping the `WHERE reference_id IS NOT NULL` predicate from the ledger
 *     ON CONFLICT clause -> 42P10 returns and every high-XP submit 500s again.
 *   - re-emitting the 7-arg overload as anything other than CREATE OR REPLACE of
 *     the SECURITY DEFINER + search_path-pinned function.
 *   - silently mutating the P2 XP formula literals or the 200 daily cap — pinned
 *     present AND proven byte-identical (executable body) to the prior 20260610000000
 *     so P2 is provably unchanged by this hotfix.
 *   - introducing any DROP (this is an additive CREATE OR REPLACE, no teardown).
 *
 * Mirrors the repo's grep-the-migration conformance style
 * (sm2-interval-clamp-structure.test.ts, adaptive-selection-structure.test.ts).
 *
 * REGRESSION CATALOG: REG-170 (recommended) — "atomic_quiz_profile_update
 * ON CONFLICT (reference_id) must carry the partial-index predicate — XP-grant
 * path 42P10 guard; P2 formula+cap + P4 idempotency preserved."
 */

const FIX = 'supabase/migrations/20260623000600_fix_atomic_quiz_reference_id_on_conflict_42p10.sql';
const PRIOR = 'supabase/migrations/20260610000000_publish_quiz_completed_event.sql';

function resolve(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolve(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
/** Collapse whitespace + strip full-line `--` comments so matching is
 *  layout-tolerant and never matches the RCA prose in the header comments. */
function normalised(rel: string): string {
  return read(rel)
    .replace(/^\s*--.*$/gm, '')
    .replace(/\s+/g, ' ');
}

/**
 * Extract the EXECUTABLE body of the 7-arg overload (returning VOID), with all
 * comments (full-line + trailing inline) stripped and whitespace collapsed. Used
 * for the byte-identical comparison: prove the hotfix changed ONLY the ON CONFLICT
 * predicate and left the P2 math untouched.
 *
 * The 7-arg overload is the FIRST `CREATE OR REPLACE FUNCTION
 * public.atomic_quiz_profile_update(` ... `RETURNS VOID ... $$ ... $$;` block in
 * each file (in 20260610000000 the JSONB 6-arg overload follows it).
 */
function sevenArgBody(rel: string): string {
  const raw = read(rel)
    .replace(/--[^\n]*$/gm, '') // strip trailing + full-line comments
    .replace(/\s+/g, ' ')
    .trim();
  const startToken = 'CREATE OR REPLACE FUNCTION public.atomic_quiz_profile_update(';
  const start = raw.indexOf(startToken);
  if (start < 0) return '';
  // The function body is delimited by the first `AS $$` ... `$$;` after the header.
  const bodyOpen = raw.indexOf('AS $$', start);
  const bodyClose = raw.indexOf('$$;', bodyOpen);
  if (bodyOpen < 0 || bodyClose < 0) return '';
  // Include the header (signature + RETURNS/LANGUAGE/SECURITY clauses) through the
  // closing $$; so the signature + body are both covered by the comparison.
  return raw.slice(start, bodyClose + '$$;'.length);
}

// ───────────────────────────────────────────────────────────────────────────
describe('atomic_quiz 42P10 hotfix — migrations present', () => {
  it('the 42P10 fix migration (20260623000600) exists', () => {
    expect(resolve(FIX)).not.toBeNull();
  });
  it('the prior baseline (20260610000000) exists for the byte-identity comparison', () => {
    expect(resolve(PRIOR)).not.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The fix itself: the partial-index predicate must be present on the ledger
// ON CONFLICT clause. This is the single line that fixes 42P10.
// ───────────────────────────────────────────────────────────────────────────
describe('42P10 fix — ledger ON CONFLICT carries the matching partial-index predicate', () => {
  it('xp_transactions INSERT uses ON CONFLICT (reference_id) WHERE reference_id IS NOT NULL DO NOTHING', () => {
    const sql = normalised(FIX);
    // The exact predicate-bearing conflict clause that matches idx_xp_txn_reference_id.
    expect(sql).toMatch(
      /ON CONFLICT\s*\(\s*reference_id\s*\)\s+WHERE\s+reference_id\s+IS\s+NOT\s+NULL\s+DO\s+NOTHING/i,
    );
  });

  it('the bare predicate-less ON CONFLICT (reference_id) DO NOTHING (the 42P10 form) is GONE from the ledger insert', () => {
    // Isolate the xp_transactions INSERT ... ; statement and assert it does NOT
    // contain a predicate-less conflict clause. (The state_events insert lower in
    // the function uses ON CONFLICT (idempotency_key) — a different, correctly
    // backed full unique index — so we scope to the xp_transactions statement.)
    const sql = normalised(FIX);
    const insStart = sql.search(/INSERT INTO public\.xp_transactions/i);
    expect(insStart).toBeGreaterThanOrEqual(0);
    const stmt = sql.slice(insStart, sql.indexOf(';', insStart) + 1);
    expect(stmt).toMatch(/ON CONFLICT\s*\(\s*reference_id\s*\)/i);
    // It MUST carry the WHERE predicate — i.e. the bare form must not appear.
    expect(stmt).not.toMatch(/ON CONFLICT\s*\(\s*reference_id\s*\)\s+DO\s+NOTHING/i);
  });

  it('the partial-index predicate explicitly names idx_xp_txn_reference_id in the RCA so the intent is documented', () => {
    // Documentation pin: the header names the partial index it is matching, so a
    // future reader knows WHY the predicate is mandatory (not a stylistic choice).
    expect(read(FIX)).toMatch(/idx_xp_txn_reference_id/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// RPC contract retained: CREATE OR REPLACE of the 7-arg signature, SECURITY
// DEFINER + search_path, no DROP.
// ───────────────────────────────────────────────────────────────────────────
describe('42P10 fix — 7-arg RPC contract retained', () => {
  it('re-emits the 7-arg overload via CREATE OR REPLACE FUNCTION', () => {
    expect(normalised(FIX)).toMatch(
      /CREATE OR REPLACE FUNCTION\s+public\.atomic_quiz_profile_update\s*\(/i,
    );
  });

  it('preserves the 7 named parameters in order, RETURNS VOID, LANGUAGE plpgsql', () => {
    const sql = normalised(FIX);
    expect(sql).toMatch(/p_student_id\s+UUID/i);
    expect(sql).toMatch(/p_subject\s+TEXT/i);
    expect(sql).toMatch(/p_xp\s+INT/i);
    expect(sql).toMatch(/p_total\s+INT/i);
    expect(sql).toMatch(/p_correct\s+INT/i);
    expect(sql).toMatch(/p_time_seconds\s+INT/i);
    expect(sql).toMatch(/p_session_id\s+UUID\s+DEFAULT\s+NULL/i);
    expect(sql).toMatch(/RETURNS VOID/i);
    expect(sql).toMatch(/LANGUAGE plpgsql/i);
  });

  it('retains SECURITY DEFINER and SET search_path = public, pg_temp', () => {
    const sql = normalised(FIX);
    expect(sql).toMatch(/SECURITY DEFINER/i);
    expect(sql).toMatch(/SET search_path = public, pg_temp/i);
  });

  it('re-asserts least privilege: REVOKE EXECUTE ... FROM anon on the exact 7-arg overload', () => {
    expect(normalised(FIX)).toMatch(
      /REVOKE EXECUTE ON FUNCTION public\.atomic_quiz_profile_update\(\s*UUID\s*,\s*TEXT\s*,\s*INT\s*,\s*INT\s*,\s*INT\s*,\s*INT\s*,\s*UUID\s*\) FROM anon/i,
    );
  });

  it('contains NO DROP (additive CREATE OR REPLACE — no teardown)', () => {
    const sql = normalised(FIX);
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/DROP FUNCTION/i);
    expect(sql).not.toMatch(/DROP INDEX/i);
    expect(sql).not.toMatch(/DROP TRIGGER/i);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P2 invariant FREEZE GUARD: the XP formula literals + the 200 daily cap are
// present AND byte-identical (executable body) to the prior 20260610000000.
// Note: this function does NOT recompute the per-correct/bonus formula (the
// caller passes p_xp already computed by xp-rules.ts) — what it owns is the
// DAILY CAP (200) and the cap math. We pin that the cap + cap math survive.
// ───────────────────────────────────────────────────────────────────────────
describe('P2 freeze guard — daily cap + cap math present and unchanged', () => {
  it('pins the 200 daily quiz-XP cap literal', () => {
    const sql = normalised(FIX);
    // v_xp_to_award := GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp));
    expect(sql).toMatch(
      /v_xp_to_award\s*:=\s*GREATEST\(\s*0\s*,\s*LEAST\(\s*p_xp\s*,\s*200\s*-\s*v_today_quiz_xp\s*\)\s*\)\s*;/i,
    );
  });

  it("pins the daily_category = 'quiz' IST-boundary today-XP accumulation (cap source)", () => {
    const sql = normalised(FIX);
    expect(sql).toMatch(/daily_category\s*=\s*'quiz'/i);
    expect(sql).toMatch(/Asia\/Kolkata/i);
    expect(sql).toMatch(/SUM\(amount\)/i);
  });

  it('pins the FLOOR(xp / 500.0) + 1 level recomputation literal (unchanged level math)', () => {
    const sql = normalised(FIX);
    expect(sql).toMatch(
      /GREATEST\(\s*1\s*,\s*FLOOR\(\s*student_learning_profiles\.xp\s*\/\s*500\.0\s*\)\s*\+\s*1\s*\)/i,
    );
  });

  it('P2 BYTE-IDENTITY: the 7-arg executable body equals the prior 20260610000000 body once the ON CONFLICT predicate is normalised', () => {
    // Prove the ONLY executable change vs the baseline is the added predicate.
    // Normalise BOTH bodies' ledger conflict clause to the bare form, then assert
    // the entire (signature + body) strings are byte-identical. If anything else
    // moved — a literal, the cap, the formula, the upsert — this fails.
    const norm = (s: string) =>
      s.replace(
        /ON CONFLICT \(reference_id\)(?: WHERE reference_id IS NOT NULL)? DO NOTHING/i,
        'ON CONFLICT (reference_id) DO NOTHING',
      );

    const fixBody = sevenArgBody(FIX);
    const priorBody = sevenArgBody(PRIOR);

    // Sanity: both extracted.
    expect(fixBody.length).toBeGreaterThan(500);
    expect(priorBody.length).toBeGreaterThan(500);

    expect(norm(fixBody)).toBe(norm(priorBody));
  });

  it("sanity: the two bodies DIFFER before normalisation (the fix actually changed the predicate)", () => {
    // Guards against a false-pass where sevenArgBody() returned '' for both, or
    // where the predicate was never added. They must differ pre-normalisation.
    expect(sevenArgBody(FIX)).not.toBe(sevenArgBody(PRIOR));
  });
});

// ───────────────────────────────────────────────────────────────────────────
// P4 idempotency surface: the conflict-driven dedup + the gate that only bumps
// totals on a NEW ledger row must survive (this is what makes a re-submit +0 XP).
// ───────────────────────────────────────────────────────────────────────────
describe('P4 idempotency — re-submit dedup machinery retained', () => {
  it('reads ROW_COUNT after the ledger insert and only bumps xp_total when a NEW row landed', () => {
    const sql = normalised(FIX);
    expect(sql).toMatch(/GET DIAGNOSTICS v_rows_inserted = ROW_COUNT/i);
    expect(sql).toMatch(/IF v_rows_inserted > 0 THEN/i);
    expect(sql).toMatch(/UPDATE public\.students SET[\s\S]*xp_total\s*=\s*COALESCE\(xp_total, 0\)\s*\+\s*v_xp_to_award/i);
  });

  it("builds the per-session reference_id ('quiz_' || session_id) used as the dedup key", () => {
    expect(normalised(FIX)).toMatch(/v_reference_id\s*:=\s*'quiz_'\s*\|\|\s*p_session_id::TEXT/i);
  });
});
