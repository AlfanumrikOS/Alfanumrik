import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SLC-1 (engineering-audit remediation) — single-XP-writer / de-dup guard (P2).
 *
 * THE CHANGE UNDER TEST
 * =====================
 * Migration `20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql` does a
 * `CREATE OR REPLACE FUNCTION public.fn_quiz_session_sync_profile()` that REMOVES
 * the legacy quiz-completion trigger's DUPLICATE, UNCAPPED XP work
 * (`v_xp` compute, `student_learning_profiles.xp`/`level`/`total_*` counters, and
 * the `UPDATE students SET xp_total`) so that the capped RPC
 * `atomic_quiz_profile_update` becomes the SOLE XP writer for quiz submissions.
 * It KEEPS the streak maintenance (`streak_days` / `longest_streak`) — the two
 * profile columns the RPC does NOT write — so no progress stat freezes.
 * XP literals 10/20/50 and the 200/day cap are UNTOUCHED (pure de-dup, NOT an
 * economy change). The trigger BINDING `trg_quiz_session_sync_profile` is left
 * unchanged (no DROP, no re-CREATE).
 *
 * ─── Lane note (why this is a migration-SHAPE test, not a live-DB test) ──────
 * This repo has NO local live-Postgres lane. The RLS/trigger regression
 * convention (see `src/__tests__/rls-teacher-assigned-students.test.ts` and
 * `src/__tests__/xp-sql-literal-parity.test.ts`) is SOURCE-LEVEL: assert the
 * exact SHAPE of the migration text, because the shape IS the guarantee. A
 * behavioral "XP increments 1× not 2×" test would need a live DB to INSERT a
 * `quiz_sessions` row, fire the AFTER trigger, run the RPC, and read back
 * `students.xp_total` — infeasible here without standing up Postgres.
 *
 * We therefore pin, at the source level, the invariants that ENCODE
 * "1× not 2×":
 *   (1) the neutered trigger body no longer contains ANY XP / xp_total / level /
 *       counter write  ⇒ the second (uncapped) writer is gone;
 *   (2) the authoritative RPC `atomic_quiz_profile_update` is untouched and still
 *       does the capped award (baseline 821);
 *   (3) v1 `submit_quiz_results` and v2 `submit_quiz_results_v2` both still
 *       `PERFORM atomic_quiz_profile_update` (baseline 7549 / 7850) ⇒ every active
 *       completion path retains EXACTLY ONE award (the RPC), so removing the
 *       trigger's award cannot leave any path with zero writers (no under-award).
 *
 * FOLLOW-UP (not faked here): a live-DB behavioral assertion of "8/10 → +100
 * once, not +200" and "perfect quiz after the 200 cap adds 0" (assessment
 * checklist (a)(b)(d)) belongs in an integration lane if/when one is stood up.
 * Those rows are explicitly deferred-to-live-DB in the testing report.
 */

// ─── Filesystem helpers (same pattern as xp-sql-literal-parity.test.ts) ───────

function resolveRepo(rel: string): string | null {
  for (const c of [path.resolve(process.cwd(), rel), path.resolve(process.cwd(), '..', rel)]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function read(rel: string): string {
  const p = resolveRepo(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}

/**
 * Strip every `-- … (end of line)` comment. CRITICAL for this migration: its
 * header prose mentions the 10/20/50/200 literals AND its ROLLBACK REFERENCE
 * block reproduces the ENTIRE original (XP-awarding) body as `-- …` comments.
 * Only the single ACTIVE `CREATE OR REPLACE FUNCTION` survives the strip, so all
 * assertions below run against the neutered body alone — never the commented-out
 * original.
 */
function executableSql(rel: string): string {
  return read(rel)
    .replace(/--[^\n]*$/gm, '')
    .replace(/\r/g, '');
}

const MIGRATION = 'supabase/migrations/20260702020000_slc1_dedupe_quiz_session_xp_trigger.sql';
const BASELINE = 'supabase/migrations/00000000000000_baseline_from_prod.sql';

const MIGRATION_PRESENT = resolveRepo(MIGRATION) !== null;

// ════════════════════════════════════════════════════════════════════════════
// 0. Presence + non-vacuity. An empty parse must NOT pass green.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-1: migration presence + parse non-vacuity', () => {
  it(`${MIGRATION} exists`, () => {
    expect(MIGRATION_PRESENT).toBe(true);
  });

  it('the ACTIVE (comment-stripped) body was actually found and parsed', () => {
    const exec = executableSql(MIGRATION);
    // The lone active statement must be present and substantial — guards against
    // a regex/strip break that would otherwise make every absence-assertion below
    // pass vacuously against an empty string.
    expect(exec).toContain(
      'CREATE OR REPLACE FUNCTION "public"."fn_quiz_session_sync_profile"()',
    );
    expect(exec.length).toBeGreaterThan(300);
    // Exactly ONE active function definition — proves the ROLLBACK REFERENCE
    // copy of the old XP-awarding body is genuinely commented out, not live.
    const activeDefs = (exec.match(/CREATE\s+OR\s+REPLACE\s+FUNCTION/gi) || []).length;
    expect(activeDefs).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. CORE de-dup pin — the neutered body NO LONGER awards XP/counters,
//    but STILL maintains the streak.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-1: fn_quiz_session_sync_profile is neutered to streak-only', () => {
  const exec = executableSql(MIGRATION);

  it('removes the XP computation variable (v_xp is gone)', () => {
    expect(exec).not.toMatch(/v_xp/i);
  });

  it('writes NO XP anywhere (no "xp" token survives in the active body)', () => {
    // The active body references streak_days / longest_streak / last_session_at
    // only — none of which contain the substring "xp". A single strong guard:
    // any reappearance of xp / xp_total / EXCLUDED.xp would fail here.
    expect(exec).not.toMatch(/xp/i);
  });

  it('does NOT write xp_total on students (the uncapped duplicate is removed)', () => {
    expect(exec).not.toMatch(/xp_total/i);
    // No UPDATE of students at all in the neutered body.
    expect(exec).not.toMatch(/UPDATE\s+(public\.)?students/i);
  });

  it('does NOT write level or any total_* counter (RPC owns these)', () => {
    expect(exec).not.toMatch(/\blevel\b/i);
    expect(exec).not.toMatch(/total_sessions/i);
    expect(exec).not.toMatch(/total_questions_asked/i);
    expect(exec).not.toMatch(/total_questions_answered_correctly/i);
    expect(exec).not.toMatch(/total_time_minutes/i);
  });

  it('STILL maintains streak_days and longest_streak (no under-maintenance)', () => {
    // Option B: the two profile columns the RPC never writes are kept.
    expect(exec).toMatch(/streak_days/i);
    expect(exec).toMatch(/longest_streak/i);
    // The longest_streak GREATEST(...) maintenance survives.
    expect(exec).toMatch(/longest_streak\s*=\s*GREATEST\s*\(/i);
    // And it still upserts the profile on the (student_id, subject) key.
    expect(exec).toMatch(/INSERT\s+INTO\s+student_learning_profiles/i);
    expect(exec).toMatch(/ON\s+CONFLICT\s*\(\s*student_id\s*,\s*subject\s*\)/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Safety posture preserved — SECURITY DEFINER + search_path, idempotent,
//    no DROP / no trigger re-bind.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-1: safety posture (no posture change, idempotent, non-destructive)', () => {
  const exec = executableSql(MIGRATION);

  it('preserves SECURITY DEFINER + SET search_path = public, pg_temp', () => {
    expect(exec).toMatch(/SECURITY DEFINER/i);
    expect(exec).toMatch(/SET\s+"?search_path"?\s+TO\s+'public',\s*'pg_temp'/i);
  });

  it('is CREATE OR REPLACE (re-runnable / idempotent)', () => {
    expect(exec).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
  });

  it('does NOT DROP or re-CREATE the trigger binding (trg unchanged)', () => {
    expect(exec).not.toMatch(/DROP\s+TRIGGER/i);
    expect(exec).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(exec).not.toMatch(/DROP\s+FUNCTION/i);
  });

  it('performs no destructive schema change (no DROP TABLE/COLUMN, no RLS disable)', () => {
    expect(exec).not.toMatch(/DROP\s+TABLE/i);
    expect(exec).not.toMatch(/DROP\s+COLUMN/i);
    expect(exec).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. P2 VALUES-UNCHANGED pin — this is a de-dup, NOT an economy change.
//    (Complements the REG-181 sweep in xp-sql-literal-parity.test.ts, which pins
//    the literals that DO exist; here we pin that this migration redefines NONE.)
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-1: migration redefines NO XP literal and NOT the capped RPC', () => {
  const exec = executableSql(MIGRATION);

  it('contains none of the XP earning literals 10 / 20 / 50 (no economy redefinition)', () => {
    // The neutered body's only numeric literals are the 5-second window and the
    // streak day-deltas (1). The earning literals must not appear in executable SQL.
    expect(exec).not.toMatch(/\b10\b/);
    expect(exec).not.toMatch(/\b20\b/);
    expect(exec).not.toMatch(/\b50\b/);
  });

  it('does NOT redefine the 200/day cap', () => {
    expect(exec).not.toMatch(/\b200\b/);
  });

  it('does NOT touch the authoritative writer atomic_quiz_profile_update or the submit RPCs', () => {
    // Only fn_quiz_session_sync_profile is (re)defined. The XP-award authority is
    // left entirely alone, so the cap + ledger remain the sole, unchanged award.
    expect(exec).not.toMatch(/atomic_quiz_profile_update/i);
    expect(exec).not.toMatch(/submit_quiz_results/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. NO-UNDER-AWARD structural argument — the RPC is still the award authority
//    and every active completion path still PERFORMs it. Removing the trigger's
//    award therefore leaves EXACTLY ONE writer per path (never zero).
//    Citations: 04-implementation.md §2/§3 and the baseline pg_dump.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-1: RPC remains the single award authority on every path (baseline pin)', () => {
  const baseline = read(BASELINE);

  it('baseline exists and was read', () => {
    expect(resolveRepo(BASELINE)).not.toBeNull();
    expect(baseline.length).toBeGreaterThan(1000);
  });

  it('atomic_quiz_profile_update still performs the capped XP award (baseline ~821, unchanged)', () => {
    // The 7-param void overload (baseline 794) caps the award via the ledger.
    expect(baseline).toContain(
      'v_xp_to_award := GREATEST(0, LEAST(p_xp, 200 - v_today_quiz_xp));',
    );
  });

  it('v1 submit_quiz_results AND v2 submit_quiz_results_v2 both PERFORM the RPC', () => {
    // Both submit functions are defined …
    expect(baseline).toMatch(/CREATE OR REPLACE FUNCTION "public"\."submit_quiz_results"\(/);
    expect(baseline).toMatch(/CREATE OR REPLACE FUNCTION "public"\."submit_quiz_results_v2"\(/);
    // … and each calls atomic_quiz_profile_update (baseline 7549 v1, 7850 v2).
    // The completion trigger also fires on the same INSERT, so before SLC-1 there
    // were TWO writers; after SLC-1 the trigger writes no XP and the RPC is the
    // ONE remaining writer — so removing the trigger's award cannot zero a path.
    const performCount = (baseline.match(/PERFORM atomic_quiz_profile_update/g) || []).length;
    expect(performCount).toBeGreaterThanOrEqual(2);
  });
});

/**
 * PROPOSED REGRESSION CATALOG ROWS (orchestrator assigns the REG id; next free
 * is REG-194). DO NOT edit .claude/regression-catalog.md from here.
 *
 *   REG-194: slc1_single_xp_writer_dedupe
 *     asserts  | the SLC-1 migration's CREATE OR REPLACE of
 *              | fn_quiz_session_sync_profile removes ALL duplicate XP / xp_total /
 *              | level / total_* counter writes (the uncapped second writer is
 *              | gone) while KEEPING streak_days + longest_streak maintenance, and
 *              | preserves SECURITY DEFINER + search_path, stays CREATE OR REPLACE
 *              | (idempotent), and never DROPs/re-binds the trigger. The
 *              | authoritative atomic_quiz_profile_update stays the SOLE capped XP
 *              | writer and is left untouched.
 *     location | src/__tests__/slc1-quiz-session-trigger-dedupe.test.ts
 *     status   | exists (source-level; live-DB "1× not 2×" behavioral pin deferred)
 *     invariant| P2 (XP Economy) — cross-ref REG-48 (daily cap) and REG-181 (xp-sql-literal-parity)
 *
 *   REG-195 (optional / could fold into REG-194): slc1_no_under_award_structural
 *     asserts  | v1 submit_quiz_results + v2 submit_quiz_results_v2 each still
 *              | PERFORM atomic_quiz_profile_update (baseline 7549 / 7850) and the
 *              | RPC still caps the award (baseline 821), so removing the trigger's
 *              | award leaves EXACTLY ONE writer per path — no path loses its only
 *              | XP writer.
 *     location | src/__tests__/slc1-quiz-session-trigger-dedupe.test.ts
 *     status   | exists (source-level)
 *     invariant| P2 (XP Economy)
 */
