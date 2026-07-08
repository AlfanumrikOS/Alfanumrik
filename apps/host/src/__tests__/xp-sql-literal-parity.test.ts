import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { XP_RULES } from '@alfanumrik/lib/xp-config';

/**
 * SLC-2 (engineering-audit Cycle 3, Student Learning Core) — P2 XP literal
 * SQL↔TS parity guard.  TEST-ONLY: the audit verified the values are CORRECT
 * everywhere today; this guard makes future DRIFT fail CI.
 *
 * THE GAP THIS PINS
 * =================
 * The P2 XP earning formula
 *     xp = correct * quiz_per_correct
 *        + (score >= 80  ? quiz_high_score_bonus : 0)
 *        + (score == 100 ? quiz_perfect_bonus    : 0)
 * is centralised in TypeScript (XP_RULES in src/lib/xp-config.ts, read by
 * src/lib/scoring.ts), but is RE-TYPED as raw `10 / 20 / 50` literals inside
 * ~9 PL/pgSQL function bodies (v1 submit_quiz_results + v2 submit_quiz_results_v2
 * + the legacy quiz_sessions completion trigger, plus every CREATE OR REPLACE
 * redefinition of v2 — SLC-10 documents 6 post-baseline redefinitions).
 *
 * The existing REG-48 parity test (xp-ledger-parity.test.ts) only mirrors the
 * daily-CAP arithmetic (200) — it does NOT assert the per-correct / high-score /
 * perfect EARNING literals against the SQL bodies.  A future XP-economy change
 * applied in TS but missed in one SQL body would silently mis-award XP for
 * whichever RPC path that body serves (v1 mobile vs v2 web).
 *
 * WHAT A REGRESSION HERE WOULD CATCH
 * ==================================
 *   - any migration's quiz-XP SQL body whose per-correct multiplier drifts from
 *     XP_RULES.quiz_per_correct (10),
 *   - high-score bonus drifting from XP_RULES.quiz_high_score_bonus (20),
 *   - perfect bonus drifting from XP_RULES.quiz_perfect_bonus (50),
 *   - the TS canonical constants themselves changing without a paired P2 review.
 *
 * SLC-10: the guard targets the CURRENT authoritative SQL (the baseline pg_dump
 * + all root migrations), NOT the archived _legacy chain.  The drift SWEEP below
 * scans every root-level migration, so a future RPC redefinition that lands a
 * wrong literal fails immediately, wherever it lands.
 *
 * Mirrors the repo's grep-the-migration conformance style
 * (atomic-quiz-conflict-42p10-structure.test.ts, anti-cheat-server-parity.test.ts).
 *
 * REGRESSION CATALOG (proposed): see file footer.
 */

// ─── Filesystem helpers (same pattern as atomic-quiz-conflict-42p10-structure) ─

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
/** Strip full-line AND trailing `--` comments so the `-- P2: ...=10` annotation
 *  comments never satisfy a match; collapse whitespace for layout-tolerance. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*$/gm, '').replace(/\r/g, '');
}

const MIGRATIONS_DIR = 'supabase/migrations';

/** All top-level (non-_legacy) migration .sql files — the CURRENT authoritative
 *  SQL surface (SLC-10). readdirSync lists the dir's immediate entries only, so
 *  the archived `_legacy/` subdirectory is naturally excluded. */
function rootMigrationFiles(): string[] {
  const dir = resolveRepo(MIGRATIONS_DIR);
  if (!dir) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => `${MIGRATIONS_DIR}/${f}`);
}

// ─── Canonical XP-earning literal extractors ──────────────────────────────────
// These match the THREE earning literals as they appear in the PL/pgSQL bodies.
// They are intentionally tolerant of the RHS variable (v_correct in the RPCs,
// COALESCE(NEW.correct_answers, 0) in the trigger) and of trailing annotations,
// but they TIE each bonus literal to its gating condition so we never confuse a
// +20 with a +50.

// base: `v_xp := <expr> * 10;`   (per-correct multiplier)
const RE_PER_CORRECT = /v_xp\s*:=\s*[^;]*?\*\s*(\d+)/gi;
// high-score: `... >= 80 ... THEN v_xp := v_xp + 20`
const RE_HIGH_BONUS = />=\s*80\s+THEN\s+v_xp\s*:=\s*v_xp\s*\+\s*(\d+)/gi;
// perfect: `... = 100 ... THEN v_xp := v_xp + 50`
const RE_PERFECT_BONUS = /=\s*100\s+THEN\s+v_xp\s*:=\s*v_xp\s*\+\s*(\d+)/gi;

interface XpLiterals {
  perCorrect: number[];
  highBonus: number[];
  perfectBonus: number[];
}

function extractXpLiterals(rel: string): XpLiterals {
  const sql = stripComments(read(rel));
  const grab = (re: RegExp) => [...sql.matchAll(re)].map((m) => Number(m[1]));
  return {
    perCorrect: grab(RE_PER_CORRECT),
    highBonus: grab(RE_HIGH_BONUS),
    perfectBonus: grab(RE_PERFECT_BONUS),
  };
}

// ─── Authoritative target files (SLC-10: latest, non-legacy) ──────────────────
// v2 latest redefinition (the live web submit path).
const V2_LATEST = `${MIGRATIONS_DIR}/20260623000500_reapply_submit_quiz_v2_column_fix.sql`;
// Baseline pg_dump = the live prod snapshot; holds v1 submit_quiz_results, the
// v2 snapshot, AND the legacy quiz_sessions completion trigger.
const BASELINE = `${MIGRATIONS_DIR}/00000000000000_baseline_from_prod.sql`;

// ════════════════════════════════════════════════════════════════════════════
// 0. Canonical TS anchor — XP_RULES is the single source of truth.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-2 / P2 anchor: XP_RULES earning constants are the single source', () => {
  it('quiz_per_correct === 10, quiz_high_score_bonus === 20, quiz_perfect_bonus === 50', () => {
    // Anchor the canonical values. Changing any of these is a P2 invariant change
    // (user approval required) AND must be mirrored into every SQL body below —
    // the parity sweep enforces the mirroring.
    expect(XP_RULES.quiz_per_correct).toBe(10);
    expect(XP_RULES.quiz_high_score_bonus).toBe(20);
    expect(XP_RULES.quiz_perfect_bonus).toBe(50);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Targeted parity — the latest authoritative v2 body matches TS.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-2: latest submit_quiz_results_v2 SQL literals match XP_RULES', () => {
  it('the target migration exists', () => {
    expect(resolveRepo(V2_LATEST)).not.toBeNull();
  });

  it('per-correct multiplier, high-score bonus, perfect bonus all equal XP_RULES', () => {
    const lits = extractXpLiterals(V2_LATEST);

    // Must actually find one of each — guards against a regex/format break that
    // would otherwise make this test pass vacuously.
    expect(lits.perCorrect.length).toBeGreaterThanOrEqual(1);
    expect(lits.highBonus.length).toBeGreaterThanOrEqual(1);
    expect(lits.perfectBonus.length).toBeGreaterThanOrEqual(1);

    for (const n of lits.perCorrect) expect(n).toBe(XP_RULES.quiz_per_correct);
    for (const n of lits.highBonus) expect(n).toBe(XP_RULES.quiz_high_score_bonus);
    for (const n of lits.perfectBonus) expect(n).toBe(XP_RULES.quiz_perfect_bonus);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Targeted parity — the baseline (v1 + v2 snapshot + completion trigger).
//    The baseline contains MULTIPLE copies of the earning block (v1, v2, and the
//    AFTER-completion trigger documented in SLC-1). Every copy must match TS.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-2: baseline pg_dump XP literals (v1 + v2 + trigger) all match XP_RULES', () => {
  it('the baseline exists', () => {
    expect(resolveRepo(BASELINE)).not.toBeNull();
  });

  it('every per-correct / high-score / perfect literal in the baseline equals XP_RULES', () => {
    const lits = extractXpLiterals(BASELINE);

    // Baseline holds v1 + v2 + the trigger → expect at least 2 earning blocks.
    // (Conservative lower bound; exact count is not pinned to survive benign
    // future re-dumps, but drift in ANY copy still fails the per-value asserts.)
    expect(lits.perCorrect.length).toBeGreaterThanOrEqual(2);
    expect(lits.highBonus.length).toBeGreaterThanOrEqual(2);
    expect(lits.perfectBonus.length).toBeGreaterThanOrEqual(2);

    for (const n of lits.perCorrect) expect(n).toBe(XP_RULES.quiz_per_correct);
    for (const n of lits.highBonus) expect(n).toBe(XP_RULES.quiz_high_score_bonus);
    for (const n of lits.perfectBonus) expect(n).toBe(XP_RULES.quiz_perfect_bonus);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. DRIFT SWEEP — every root migration's quiz-XP literals must equal XP_RULES.
//    This is the forward-looking guard: ANY future migration that re-emits the
//    XP block with a drifted literal fails here, no matter which file it lands in.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-2: drift sweep — no root migration mis-types the XP earning literals', () => {
  const files = rootMigrationFiles();

  it('there is at least one root migration to scan (sanity)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('every per-correct multiplier across all root migrations === quiz_per_correct (10)', () => {
    const offenders: Array<{ file: string; value: number }> = [];
    for (const f of files) {
      for (const n of extractXpLiterals(f).perCorrect) {
        if (n !== XP_RULES.quiz_per_correct) offenders.push({ file: f, value: n });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every high-score bonus across all root migrations === quiz_high_score_bonus (20)', () => {
    const offenders: Array<{ file: string; value: number }> = [];
    for (const f of files) {
      for (const n of extractXpLiterals(f).highBonus) {
        if (n !== XP_RULES.quiz_high_score_bonus) offenders.push({ file: f, value: n });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every perfect bonus across all root migrations === quiz_perfect_bonus (50)', () => {
    const offenders: Array<{ file: string; value: number }> = [];
    for (const f of files) {
      for (const n of extractXpLiterals(f).perfectBonus) {
        if (n !== XP_RULES.quiz_perfect_bonus) offenders.push({ file: f, value: n });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the sweep actually inspected quiz-XP SQL (at least one earning block found)', () => {
    // Defends against the whole sweep silently matching nothing (e.g. the RPC
    // files moved out of the scanned dir) and passing vacuously.
    const totalPerCorrect = files.reduce(
      (acc, f) => acc + extractXpLiterals(f).perCorrect.length,
      0,
    );
    expect(totalPerCorrect).toBeGreaterThanOrEqual(2);
  });
});

/**
 * PROPOSED REGRESSION CATALOG ROW (orchestrator assigns the REG id):
 *   REG-xxx: xp_sql_literal_parity
 *     asserts  | the P2 XP earning literals (per-correct=10, high-score-bonus=20,
 *              | perfect-bonus=50) extracted from every root migration's quiz-XP
 *              | PL/pgSQL body equal XP_RULES in src/lib/xp-config.ts; drift in any
 *              | SQL body (v1/v2/trigger or a future RPC redefinition) fails CI.
 *     location | src/__tests__/xp-sql-literal-parity.test.ts
 *     status   | exists (added engineering-audit Cycle 3, SLC-2)
 *     invariant| P2 (XP Economy)
 */
