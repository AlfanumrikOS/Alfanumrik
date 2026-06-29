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
 * So the pattern check is deliberately FLAG-ONLY on BOTH client and server:
 *   - Client (src/app/quiz/page.tsx): speed + count SHORT-CIRCUIT (set score 0,
 *     return BEFORE submit); the pattern check only console.warns and STILL
 *     submits.
 *   - Server (submit_quiz_results_v2): all three checks set v_flagged := true and
 *     zero the XP, but the quiz_sessions row is STILL written (record-but-zero).
 *
 * This test PINS that intended behavior so a future edit can't quietly turn the
 * pattern check into a hard reject, or turn speed/count into flag-only, without a
 * failing test forcing a conscious decision.
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

  it('CONTRAST: the speed branch DOES short-circuit (reject) — return + score 0', () => {
    const flat = src.replace(/\r/g, '');
    const idx = flat.search(/avgTimePerQ\s*<\s*3\s*\)\s*\{/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = flat.slice(idx, idx + 600);
    expect(block).toMatch(/score_percent\s*:\s*0/);
    expect(block).toMatch(/\breturn\b/);
  });

  it('CONTRAST: the count-mismatch branch DOES short-circuit (reject) — return + score 0', () => {
    const flat = src.replace(/\r/g, '');
    const idx = flat.search(/allResponses\.length\s*!==\s*questions\.length\s*\)\s*\{/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = flat.slice(idx, idx + 600);
    expect(block).toMatch(/score_percent\s*:\s*0/);
    expect(block).toMatch(/\breturn\b/);
  });
});

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
