import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { XP_RULES } from '@alfanumrik/lib/xp-config';

/**
 * P2 — the 6-arg `atomic_quiz_profile_update` overload WRITES the xp_transactions
 * ledger row it reads for the 200 XP/day cap.
 *
 * THE DEFECT THIS PINS (DSA audit, 2026-07-29)
 * ============================================
 * There are two overloads of `public.atomic_quiz_profile_update`. The 6-arg one
 * (RETURNS jsonb) READ today's already-earned quiz XP from `xp_transactions`
 * WHERE `daily_category = 'quiz'` and clamped its award against it — but it
 * NEVER INSERTED into that table. The only ledger INSERT lived in the 7-arg
 * sibling.
 *
 * So on the 6-arg path the cap read could only ever see XP written by OTHER
 * paths; the overload's own prior awards read back as zero, `v_remaining` stayed
 * at (or near) 200 forever, and the cap could NEVER bind — while
 * `students.xp_total` and `student_learning_profiles.xp` were incremented on
 * every call and the RPC's own payload cheerfully reported `xp_capped: false`.
 *
 * REACHABILITY CORRECTION (architect, 2026-07-29): an earlier version of this
 * header claimed the 6-arg form was the "HOT path" with "both live callers" —
 * that claim was RETRACTED. The architect verified the 6-arg overload has NO
 * reachable production caller; the live submission path is
 * `submit_quiz_results_v2` + the 7-arg overload. The migration header was
 * corrected to match: this is a defensive fix on a DORMANT surface. The pin
 * below is unchanged — dormant is not deleted, and if the 6-arg form is ever
 * re-wired it must carry its own ledger write.
 *
 * WHY A STATIC SQL TEST
 * ====================
 * Same rationale as the sibling REG-48 / SLC-2 parity guards
 * (`xp-ledger-parity.test.ts`, `xp-sql-literal-parity.test.ts`): the RPC graph
 * has no live-DB harness in the PR lane, so the enforceable contract is the
 * migration SOURCE. This file follows that established grep-the-migration
 * style — resolve the file, strip comments so annotations cannot satisfy a
 * match, and assert structure + literal parity against the canonical TS
 * constant.
 *
 * WHAT WOULD TURN THIS RED
 * ------------------------
 *   - the ledger INSERT being dropped or moved out of the 6-arg body
 *     (i.e. the exact defect regressing),
 *   - the insert losing `daily_category = 'quiz'`, which is what the cap read
 *     filters on — the write would land but the cap still would not bind,
 *   - the insert losing its `v_effective_xp > 0` guard (a 0-XP or fully-capped
 *     or anti-cheat-flagged submission would start writing ledger noise),
 *   - the cap literal drifting from XP_RULES.quiz_daily_cap in
 *     `packages/lib/src/xp-config.ts`,
 *   - ANY change to the JSONB return keys, which REG-48 pins and both callers
 *     destructure.
 *
 * Invariant: P2 (XP Economy). Owner: assessment.
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
/** Strip `--` comments (full-line and trailing) so prose never satisfies a match. */
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*$/gm, '').replace(/\r/g, '');
}

const MIGRATIONS_DIR = 'supabase/migrations';
/** The fix under test. */
const LEDGER_FIX = `${MIGRATIONS_DIR}/20260729130000_fix_6arg_quiz_xp_ledger_write.sql`;
/** The immediately-prior definition of the same overload — the return-shape baseline. */
const PRIOR_DEF = `${MIGRATIONS_DIR}/20260729120001_fix_quiz_rpc_defects.sql`;

function rootMigrationFiles(): string[] {
  const dir = resolveRepo(MIGRATIONS_DIR);
  if (!dir) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => `${MIGRATIONS_DIR}/${f}`);
}

// ─── 6-arg overload body extraction ───────────────────────────────────────────
// The 6-arg overload is identified by its parameter list ending in
// `p_time_seconds INT` with NO `p_session_id` — that absence is what makes it
// the 6-arg form. Its body runs to the terminating `$$;`.

const SIX_ARG_HEADER =
  /CREATE OR REPLACE FUNCTION public\.atomic_quiz_profile_update\(\s*p_student_id\s+UUID,\s*p_subject\s+TEXT,\s*p_xp\s+INT,\s*p_total\s+INT,\s*p_correct\s+INT,\s*p_time_seconds\s+INT\s*\)/i;

function extractSixArgBody(rel: string): string | null {
  const sql = stripSqlComments(read(rel));
  const header = SIX_ARG_HEADER.exec(sql);
  if (!header) return null;
  const start = header.index;
  const end = sql.indexOf('$$;', start);
  if (end === -1) return null;
  return sql.slice(start, end + 3);
}

/**
 * Ordered list of keys from the body's `RETURN jsonb_build_object(...)`.
 *
 * Anchored on `RETURN` on purpose: the fix added a SECOND jsonb_build_object
 * (the ledger row's `metadata`), so a bare "first jsonb_build_object" match
 * would read the metadata keys and this parity check would compare the wrong
 * object.
 */
function extractReturnKeys(body: string): string[] {
  const idx = body.search(/RETURN\s+jsonb_build_object/i);
  if (idx === -1) return [];
  const segment = body.slice(idx);
  // Keys are the quoted literals in the odd positions of the key/value pairs;
  // matching `'key',` (a quoted string immediately followed by a comma) picks
  // them out without also grabbing string VALUES, which here are none.
  return [...segment.matchAll(/'([a-z_]+)'\s*,/g)].map((m) => m[1]);
}

// ════════════════════════════════════════════════════════════════════════════
// 0. Preconditions — never let this suite pass vacuously.
// ════════════════════════════════════════════════════════════════════════════

describe('P2 6-arg ledger write: preconditions', () => {
  it('the fix migration exists on disk', () => {
    expect(resolveRepo(LEDGER_FIX)).not.toBeNull();
  });

  it('the prior definition of the same overload exists (return-shape baseline)', () => {
    expect(resolveRepo(PRIOR_DEF)).not.toBeNull();
  });

  it('the 6-arg overload body is extractable from both migrations', () => {
    expect(extractSixArgBody(LEDGER_FIX)).not.toBeNull();
    expect(extractSixArgBody(PRIOR_DEF)).not.toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. The ledger INSERT exists, in the right table, with the right category.
// ════════════════════════════════════════════════════════════════════════════

describe('P2 6-arg ledger write: the INSERT the cap read depends on', () => {
  const body = extractSixArgBody(LEDGER_FIX) ?? '';

  it('INSERTs into public.xp_transactions inside the 6-arg body', () => {
    expect(body).toMatch(/INSERT INTO public\.xp_transactions/i);
  });

  it('writes the column list the cap read and the 7-arg sibling both assume', () => {
    for (const column of [
      'student_id',
      'amount',
      'source',
      'subject',
      'daily_category',
      'reference_id',
      'metadata',
      'created_at',
    ]) {
      expect(body, `xp_transactions insert must name ${column}`).toContain(column);
    }
  });

  it("stamps daily_category = 'quiz' — the exact value the cap read filters on", () => {
    // The cap read is `WHERE ... daily_category = 'quiz'`. A row written under
    // any other category is invisible to it and the cap still never binds, so
    // this is the load-bearing half of the fix.
    const insertIdx = body.search(/INSERT INTO public\.xp_transactions/i);
    expect(insertIdx).toBeGreaterThan(-1);
    const insertStmt = body.slice(insertIdx, body.indexOf(');', insertIdx) + 2);
    expect(insertStmt).toContain('daily_category');
    // Both `source` and `daily_category` are the literal 'quiz'.
    expect((insertStmt.match(/'quiz'/g) ?? []).length).toBeGreaterThanOrEqual(2);

    const capRead = body.slice(0, insertIdx);
    expect(capRead).toMatch(/FROM public\.xp_transactions/i);
    expect(capRead).toMatch(/daily_category\s*=\s*'quiz'/i);
  });

  it('writes the CAPPED amount (v_effective_xp), not the raw requested p_xp', () => {
    const insertIdx = body.search(/INSERT INTO public\.xp_transactions/i);
    const insertStmt = body.slice(insertIdx, body.indexOf(');', insertIdx) + 2);
    expect(insertStmt).toContain('v_effective_xp');
    // The uncapped value is only allowed inside the metadata audit trail
    // (`original_xp`), never as the ledger `amount`.
    expect(insertStmt).toMatch(/VALUES[\s\S]*v_effective_xp/i);
    expect(insertStmt).toContain('original_xp');
  });

  it('is guarded by `IF v_effective_xp > 0` (0-XP and flagged submissions write nothing)', () => {
    expect(body).toMatch(/IF\s+v_effective_xp\s*>\s*0\s+THEN[\s\S]{0,400}?INSERT INTO public\.xp_transactions/i);
  });

  it('the INSERT lands AFTER the cap clamp and BEFORE the profile/student writes (one transaction, correct order)', () => {
    const clampIdx = body.search(/v_effective_xp\s*:=\s*LEAST/i);
    const insertIdx = body.search(/INSERT INTO public\.xp_transactions/i);
    const profileIdx = body.search(/INSERT INTO public\.student_learning_profiles/i);
    const studentIdx = body.search(/UPDATE public\.students/i);

    expect(clampIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(clampIdx);
    expect(profileIdx).toBeGreaterThan(insertIdx);
    expect(studentIdx).toBeGreaterThan(insertIdx);
  });

  it('is an additive CREATE OR REPLACE — no table/column DDL, no RLS change', () => {
    const sql = stripSqlComments(read(LEDGER_FIX));
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|FUNCTION)\b/i);
    expect(sql).not.toMatch(/\bCREATE\s+TABLE\b/i);
    expect(sql).not.toMatch(/\bALTER\s+TABLE\b/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Cap literal parity — the SQL literal equals XP_RULES.quiz_daily_cap.
// ════════════════════════════════════════════════════════════════════════════

describe('P2 6-arg ledger write: daily-cap literal parity with xp-config.ts', () => {
  it('quiz_daily_cap is 200 (P2 anchor — changing it needs user approval)', () => {
    expect(XP_RULES.quiz_daily_cap).toBe(200);
  });

  it("the fix migration's v_daily_cap literal equals XP_RULES.quiz_daily_cap", () => {
    const body = extractSixArgBody(LEDGER_FIX) ?? '';
    const match = /v_daily_cap\s+INT\s*:=\s*(\d+)/i.exec(body);
    expect(match, 'expected a v_daily_cap declaration in the 6-arg body').not.toBeNull();
    expect(Number(match![1])).toBe(XP_RULES.quiz_daily_cap);
  });

  it('drift sweep: EVERY v_daily_cap literal across all root migrations equals quiz_daily_cap', () => {
    // Forward-looking guard, mirroring the SLC-2 sweep: a future redefinition
    // of either overload that mis-types the cap fails here wherever it lands.
    const offenders: Array<{ file: string; value: number }> = [];
    let found = 0;
    for (const f of rootMigrationFiles()) {
      const sql = stripSqlComments(read(f));
      for (const m of sql.matchAll(/v_daily_cap\s+INT\s*:=\s*(\d+)/gi)) {
        found += 1;
        if (Number(m[1]) !== XP_RULES.quiz_daily_cap) {
          offenders.push({ file: f, value: Number(m[1]) });
        }
      }
    }
    expect(offenders).toEqual([]);
    // Non-vacuity: the sweep must have actually inspected cap declarations.
    expect(found).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Return shape UNCHANGED (REG-48 pins this; both callers destructure it).
// ════════════════════════════════════════════════════════════════════════════

describe('P2 6-arg ledger write: JSONB return keys are unchanged', () => {
  const EXPECTED_KEYS = [
    'success',
    'requested_xp',
    'effective_xp',
    'xp_capped',
    'xp_cap_excess',
    'today_earned',
    'daily_cap',
    'remaining_today',
    'profile_xp',
  ];

  it('the fix returns exactly the nine documented keys, in order', () => {
    const keys = extractReturnKeys(extractSixArgBody(LEDGER_FIX) ?? '');
    expect(keys).toEqual(EXPECTED_KEYS);
  });

  it('the keys are byte-for-byte identical to the prior definition (no key added or removed)', () => {
    const before = extractReturnKeys(extractSixArgBody(PRIOR_DEF) ?? '');
    const after = extractReturnKeys(extractSixArgBody(LEDGER_FIX) ?? '');
    expect(before.length).toBe(EXPECTED_KEYS.length); // non-vacuity
    expect(after).toEqual(before);
  });

  it('the ledger metadata keys mirror the 7-arg sibling (separate object from the RETURN)', () => {
    // Guards the anchoring above: the body must contain BOTH objects, and the
    // metadata one must carry the four audit keys the 7-arg path writes.
    const body = extractSixArgBody(LEDGER_FIX) ?? '';
    expect((body.match(/jsonb_build_object/g) ?? []).length).toBe(2);
    const metadataSegment = body.slice(
      body.indexOf('jsonb_build_object'),
      body.search(/RETURN\s+jsonb_build_object/i),
    );
    for (const key of ['total_q', 'correct_q', 'time_seconds', 'original_xp']) {
      expect(metadataSegment).toContain(`'${key}'`);
    }
  });

  it('the cap-status keys are still derived from the clamp variables, not re-hardcoded', () => {
    const body = extractSixArgBody(LEDGER_FIX) ?? '';
    const returnSegment = body.slice(body.search(/RETURN\s+jsonb_build_object/i));
    expect(returnSegment).toContain('v_effective_xp');
    expect(returnSegment).toContain('v_xp_capped');
    expect(returnSegment).toContain('v_today_earned');
    expect(returnSegment).toContain('v_daily_cap');
    expect(returnSegment).toMatch(/GREATEST\(0,\s*v_remaining\s*-\s*v_effective_xp\)/i);
  });
});

/**
 * PROPOSED REGRESSION CATALOG ROW (orchestrator assigns the REG id):
 *   REG-xxx: quiz_6arg_xp_ledger_write
 *     asserts  | the 6-arg atomic_quiz_profile_update overload INSERTs into
 *              | xp_transactions with daily_category='quiz', guarded by
 *              | v_effective_xp > 0, positioned after the cap clamp and before
 *              | the profile/student writes (same transaction); its v_daily_cap
 *              | literal equals XP_RULES.quiz_daily_cap in every root migration;
 *              | and its nine JSONB return keys are unchanged from the prior
 *              | definition (REG-48 return-shape pin).
 *     location | apps/host/src/__tests__/xp-6arg-ledger-write-parity.test.ts
 *     invariant| P2 (XP Economy)
 */
