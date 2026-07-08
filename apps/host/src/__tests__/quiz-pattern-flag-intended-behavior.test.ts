import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SLC-6 (engineering-audit Cycle 3, Student Learning Core) — lock the INTENDED
 * anti-cheat asymmetry so it cannot silently change.
 *
 * SLC-6 is NOT a bug. The constitution's P3 table labels the three checks:
 *   1. Speed (avg < 3s/q)            → REJECT
 *   2. Pattern (all-same idx, >3 q)  → FLAG  (heuristic, false-positive-prone)
 *   3. Count (responses != questions)→ REJECT
 *
 * The server treats all three checks as FLAG (xp=0, record-but-zero):
 *   - Server (submit_quiz_results_v2): all three checks set v_flagged := true and
 *     zero the XP, but the quiz_sessions row is STILL written (record-but-zero).
 *   - Client (src/app/quiz/page.tsx): as of SLC-5 (2026-06-30) ALL three checks
 *     are advisory (console.warn + always submit). Historically speed + count
 *     short-circuited (score 0, return before submit); that discard was removed
 *     in SLC-5 because the server is the single authority and the client discard
 *     silently destroyed a legitimately-fast student's work. See
 *     slc5-anticheat-advisory-convergence.test.ts for the full SLC-5 pin.
 *
 * This test PINS the server flag-only behavior + the client advisory convergence
 * so a future edit can't quietly turn a check into a hard reject (client) or a
 * RAISE/abort (server) without a failing test forcing a conscious decision.
 *
 * TEST-ONLY structural pin (greps the source). Companion to the executable
 * client-mirror tests in anti-cheat.test.ts / anti-cheat-server-parity.test.ts.
 */

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
function stripSqlComments(sql: string): string {
  return sql.replace(/--[^\n]*$/gm, '').replace(/\r/g, '');
}

const QUIZ_PAGE = 'src/app/quiz/page.tsx';
const V2_LATEST =
  'supabase/migrations/20260623000500_reapply_submit_quiz_v2_column_fix.sql';

// ════════════════════════════════════════════════════════════════════════════
// 1. CLIENT — pattern check is FLAG-only (warn, then still submit).
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-6 client: pattern check warns but does NOT short-circuit submission', () => {
  const src = read(QUIZ_PAGE);

  it('quiz page source is present', () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it('the pattern (all-same-option, >3 q) branch logs a warning', () => {
    // `if (mcqResponses.length > 3 && maxSameOption === mcqResponses.length)`
    expect(src.replace(/\s+/g, ' ')).toMatch(
      /mcqResponses\.length\s*>\s*3\s*&&\s*maxSameOption\s*===\s*mcqResponses\.length/,
    );
    expect(src).toMatch(/\[AntiCheat\][^\n]*pattern gaming/i);
  });

  it('the pattern branch body contains NO early return / no score-0 reject (flag-only)', () => {
    // Isolate the pattern `if (...) { ... }` block and assert it neither returns
    // nor sets a 0-score results object (which is how speed + count REJECT).
    const flat = src.replace(/\r/g, '');
    const idx = flat.search(/maxSameOption\s*===\s*mcqResponses\.length\s*\)\s*\{/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const open = flat.indexOf('{', idx);
    // Balanced-brace extraction: walk from the opening brace counting `{`/`}`
    // depth so the TRUE matching close brace is found. A naive indexOf('}')
    // stops at the `}` inside the `${optionCounts.indexOf(...)}` template
    // literal in the warn line, truncating the block early — which would let a
    // future `return`/short-circuit added AFTER that template literal inside the
    // pattern branch escape the guard below.
    let depth = 0;
    let close = -1;
    for (let i = open; i < flat.length; i++) {
      if (flat[i] === '{') depth++;
      else if (flat[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    expect(close).toBeGreaterThan(open);
    const block = flat.slice(open, close + 1);
    expect(block).not.toMatch(/\breturn\b/);
    expect(block).not.toMatch(/setScreen\(\s*'results'\s*\)/);
    expect(block).not.toMatch(/score_percent\s*:\s*0/);
  });

  // SLC-5 convergence (2026-06-30): the speed + count branches USED to
  // short-circuit (return + score 0, discarding the attempt). They no longer
  // do — all three client checks are now ADVISORY (warn + always submit); the
  // server RPC is the single authority. The two assertions below now PIN that
  // convergence (no return / no score-0 discard in those branches). The full
  // SLC-5 behavior is locked in slc5-anticheat-advisory-convergence.test.ts.
  it('SLC-5: the speed (avg<3s) branch no longer short-circuits — warn only, no return/score-0', () => {
    const flat = src.replace(/\r/g, '');
    const idx = flat.search(/avgTimePerQ\s*<\s*3\s*\)\s*\{/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const open = flat.indexOf('{', idx);
    const block = balancedBlock(flat, open);
    expect(block).toMatch(/console\.warn/);
    expect(block).not.toMatch(/\breturn\b/);
    expect(block).not.toMatch(/score_percent\s*:\s*0/);
  });

  it('SLC-5: the count-mismatch branch no longer short-circuits — warn only, no return/score-0', () => {
    const flat = src.replace(/\r/g, '');
    const idx = flat.search(/allResponses\.length\s*!==\s*questions\.length\s*\)\s*\{/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const open = flat.indexOf('{', idx);
    const block = balancedBlock(flat, open);
    expect(block).toMatch(/console\.warn/);
    expect(block).not.toMatch(/\breturn\b/);
    expect(block).not.toMatch(/score_percent\s*:\s*0/);
  });
});

/** Balanced-brace block extraction starting at the opening `{` at `open`. */
function balancedBlock(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced block');
}

// ════════════════════════════════════════════════════════════════════════════
// 2. SERVER — all three checks FLAG (xp=0) but the row is still recorded.
//    Pin that the pattern check sets v_flagged (not RAISE) and the XP gate zeroes
//    XP on flag, while the INSERT INTO quiz_sessions runs regardless.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-6 server: pattern check flags (xp=0) and the session row is still written', () => {
  const sql = stripSqlComments(read(V2_LATEST));

  it('the v2 RPC source is present', () => {
    expect(sql.length).toBeGreaterThan(0);
  });

  it('P3 Check 2 (all-same when >3) sets v_flagged := true (flag, not RAISE/abort)', () => {
    expect(sql).toMatch(/v_total\s*>\s*3/i);
    expect(sql).toMatch(/v_max_same_answer\s*=\s*v_total/i);
    // The pattern branch flags; it must not RAISE EXCEPTION to abort the submit.
    const idx = sql.search(/IF\s+v_max_same_answer\s*=\s*v_total\s+THEN/i);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = sql.slice(idx, idx + 120);
    expect(block).toMatch(/v_flagged\s*:=\s*true/i);
    expect(block).not.toMatch(/RAISE\s+EXCEPTION/i);
  });

  it('a flag zeroes XP (IF v_flagged THEN v_xp := 0)', () => {
    expect(sql).toMatch(/IF\s+v_flagged\s+THEN\s+v_xp\s*:=\s*0\s*;/i);
  });

  it('the quiz_sessions row is INSERTed regardless of v_flagged (record-but-zero)', () => {
    // The INSERT is unconditional — it is NOT nested inside `IF NOT v_flagged`.
    expect(sql).toMatch(/INSERT\s+INTO\s+quiz_sessions/i);
    expect(sql).not.toMatch(/IF\s+NOT\s+v_flagged\s+THEN\s+INSERT\s+INTO\s+quiz_sessions/i);
  });
});
