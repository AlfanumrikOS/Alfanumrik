import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * SLC-5 — Anti-Cheat Advisory Convergence (P3, P7, P1)
 *
 * THE CHANGE (src/app/quiz/page.tsx): the two client HARD-REJECT anti-cheat
 * branches — Check 1 (avg time < 3s) and Check 3 (response count != question
 * count) — no longer early-`return` a discarded `score_percent:0 / xp_earned:0
 * / session_id:''` result. They now keep only a `console.warn` and ALWAYS fall
 * through to `submitQuizResults(...)`. Check 2 (all-same-index pattern) was
 * already flag-only and is unchanged. The server RPC is the single authority:
 * it re-applies the SAME 3 checks → `flagged=true`, XP=0, and STILL records the
 * session with the REAL score. A gentle bilingual (EN/HI via `isHi`) flagged
 * note renders on the results screen; `flagged?: boolean` is added to the
 * results state.
 *
 * Convergence: all 3 client checks are now ADVISORY-only (warn + always submit).
 * This file PINS that so a future edit cannot silently re-introduce a discard /
 * hard-reject, weaken the thresholds, drop the bilingual note, or recompute the
 * score client-side in the always-submit path.
 *
 * Style: source pin (comment-stripped read of the quiz page). The anti-cheat
 * logic in quiz/page.tsx is inline (not exported), so behavioral assertion of
 * the submit-flow wiring is done structurally. The detection CONDITIONS are
 * exercised behaviorally in anti-cheat.test.ts (unchanged thresholds).
 *
 * Regression catalog: REG-206 (slc5_client_anticheat_advisory_always_submits).
 */

// ─── helpers ─────────────────────────────────────────────────────────────────

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
 * Strip JS/TS comments so the comment prose (which intentionally talks about
 * "discard"/"score to 0"/"reject") cannot satisfy a structural assertion. The
 * `[^:]` guard before `//` avoids clipping `https://` inside string literals.
 */
function stripComments(src: string): string {
  return src
    .replace(/\r/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
}

const QUIZ_PAGE = 'src/app/quiz/page.tsx';
const RAW = read(QUIZ_PAGE);
const SRC = stripComments(RAW);

/**
 * Region from the first anti-cheat statement up to (and including the call
 * token of) the authoritative `submitQuizResults(` in the happy-path submit.
 * Everything an attempt-discarding branch could short-circuit lives here.
 */
function antiCheatRegion(): string {
  const start = SRC.indexOf('const mcqResponses = allResponses.filter');
  expect(start).toBeGreaterThanOrEqual(0);
  // The FIRST submitQuizResults after the anti-cheat block is the happy-path
  // submit (the retry path is much further down).
  const submit = SRC.indexOf('submitQuizResults(', start);
  expect(submit).toBeGreaterThan(start);
  return SRC.slice(start, submit + 'submitQuizResults('.length);
}

// ════════════════════════════════════════════════════════════════════════════
// 0. Source present
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-5: quiz page source present', () => {
  it('quiz/page.tsx is readable and non-trivial', () => {
    expect(RAW.length).toBeGreaterThan(1000);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 1. SOURCE PIN — Check 1 (avg<3s) and Check 3 (count mismatch) no longer
//    discard the attempt. Neither branch early-returns nor sets the discard
//    result `score_percent:0 / xp_earned:0 / session_id:''` before submit.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-5: speed (avg<3s) + count-mismatch branches no longer hard-reject', () => {
  const region = antiCheatRegion();

  it('the whole anti-cheat region contains NO early return before submit', () => {
    // If any of the 3 advisory branches short-circuited, a `return` would sit
    // between the first check and the submitQuizResults call.
    expect(region).not.toMatch(/\breturn\b/);
  });

  it('the anti-cheat region never builds the discard result (score_percent: 0)', () => {
    // The legacy discard set `score_percent: 0, xp_earned: 0, session_id: ''`.
    // None of those tokens may appear in the advisory anti-cheat region.
    expect(region).not.toMatch(/score_percent\s*:\s*0/);
    expect(region).not.toMatch(/xp_earned\s*:\s*0/);
    expect(region).not.toMatch(/session_id\s*:\s*''/);
  });

  it('SCOPE GUARD: the discard shape still legitimately exists in the network-error catch', () => {
    // The catch block keeps `score_percent: <computed>, xp_earned: 0,
    // session_id: ''` for the OFFLINE display-only path — that is NOT an
    // anti-cheat discard and must remain. Pin it so we know our scoping above
    // is meaningful (the token exists in the file, just not in the AC region).
    expect(SRC).toMatch(/xp_earned\s*:\s*0/);
    expect(SRC).toMatch(/session_id\s*:\s*''/);
  });

  it('the speed (avg<3s) branch body is advisory: warn only, no return/discard', () => {
    const idx = SRC.search(/avgTimePerQ\s*<\s*3\s*\)\s*\{/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const open = SRC.indexOf('{', idx);
    const block = balancedBlock(SRC, open);
    expect(block).toMatch(/console\.warn/);
    expect(block).toMatch(/\[AntiCheat\]/);
    expect(block).not.toMatch(/\breturn\b/);
    expect(block).not.toMatch(/score_percent\s*:\s*0/);
    expect(block).not.toMatch(/setScreen\(\s*'results'\s*\)/);
  });

  it('the count-mismatch branch body is advisory: warn only, no return/discard', () => {
    const idx = SRC.search(/allResponses\.length\s*!==\s*questions\.length\s*\)\s*\{/);
    expect(idx).toBeGreaterThanOrEqual(0);
    const open = SRC.indexOf('{', idx);
    const block = balancedBlock(SRC, open);
    expect(block).toMatch(/console\.warn/);
    expect(block).toMatch(/\[AntiCheat\]/);
    expect(block).not.toMatch(/\breturn\b/);
    expect(block).not.toMatch(/score_percent\s*:\s*0/);
    expect(block).not.toMatch(/setScreen\(\s*'results'\s*\)/);
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
// 2. THRESHOLDS UNCHANGED — the 3 conditions still exist verbatim.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-5: anti-cheat thresholds are byte-unchanged', () => {
  const flat = SRC.replace(/\s+/g, ' ');

  it('Check 1: avg time < 3s condition is intact', () => {
    expect(flat).toMatch(/totalResponses\s*>\s*0\s*&&\s*avgTimePerQ\s*<\s*3/);
  });

  it('Check 2: all-same-index pattern (>3 MCQ) condition is intact', () => {
    expect(flat).toMatch(/mcqResponses\.length\s*>\s*3\s*&&\s*maxSameOption\s*===\s*mcqResponses\.length/);
  });

  it('Check 3: response count != question count condition is intact', () => {
    expect(flat).toMatch(/allResponses\.length\s*!==\s*questions\.length/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. ALWAYS-SUBMIT — all 3 advisory paths fall through to submitQuizResults.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-5: all 3 anti-cheat checks ALWAYS submit (none short-circuits)', () => {
  const region = antiCheatRegion();

  it('the region opens with the speed check and closes at submitQuizResults', () => {
    expect(region).toMatch(/avgTimePerQ\s*<\s*3/);
    expect(region.endsWith('submitQuizResults(')).toBe(true);
  });

  it('all 3 checks appear BEFORE the submit, with no return between them', () => {
    const iSpeed = region.search(/avgTimePerQ\s*<\s*3/);
    const iPattern = region.search(/maxSameOption\s*===\s*mcqResponses\.length/);
    const iCount = region.search(/allResponses\.length\s*!==\s*questions\.length/);
    const iSubmit = region.lastIndexOf('submitQuizResults(');
    expect(iSpeed).toBeGreaterThanOrEqual(0);
    expect(iPattern).toBeGreaterThan(iSpeed);
    expect(iCount).toBeGreaterThan(iPattern);
    expect(iSubmit).toBeGreaterThan(iCount);
    expect(region).not.toMatch(/\breturn\b/);
  });

  it('each check console.warns (advisory telemetry) rather than throwing', () => {
    const warns = region.match(/console\.warn/g) || [];
    // Check 1 + Check 2 + Check 3 each warn.
    expect(warns.length).toBeGreaterThanOrEqual(3);
    expect(region).not.toMatch(/throw\s+new\s+Error/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. FLAGGED RENDER + P7 — `flagged` in results state; bilingual non-accusatory
//    note gated by isHi.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-5: flagged result renders a gentle bilingual (P7) note', () => {
  it('the results state type carries `flagged?: boolean`', () => {
    expect(SRC).toMatch(/flagged\?\s*:\s*boolean/);
  });

  it('the flagged note is conditionally rendered on results.flagged', () => {
    expect(SRC.replace(/\s+/g, ' ')).toMatch(/results\.flagged\s*&&/);
  });

  it('the flagged note has BOTH an English and a Hindi (Devanagari) string gated by isHi (P7)', () => {
    // Isolate the `results.flagged && ( ... )` JSX block.
    const idx = SRC.indexOf('results.flagged');
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = SRC.slice(idx, idx + 900);
    // Bilingual gate.
    expect(block).toMatch(/isHi/);
    // English copy.
    expect(block).toMatch(/flagged for review/i);
    expect(block).toMatch(/no XP was awarded/i);
    // Hindi copy — must contain Devanagari characters.
    expect(block).toMatch(/[ऀ-ॿ]/);
    // Mentions XP in the Hindi string too (technical term not translated, P7).
    expect(block).toMatch(/XP/);
  });

  it('the flagged note is NON-accusatory (no cheater/cheating accusation language)', () => {
    const idx = SRC.indexOf('results.flagged');
    const block = SRC.slice(idx, idx + 900);
    expect(block).not.toMatch(/cheat/i);
    expect(block).not.toMatch(/धोखा/); // "cheating" in Hindi
    // It frames the outcome gently ("try again to earn XP").
    expect(block).toMatch(/try again/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. P1 — the displayed score in the always-submit path comes from the SERVER
//    response, not a client recompute.
// ════════════════════════════════════════════════════════════════════════════
describe('SLC-5: results score is server-authoritative in the always-submit path (P1)', () => {
  it('the submit result is assigned straight from the server response: setResults(res)', () => {
    const submit = SRC.indexOf('submitQuizResults(');
    expect(submit).toBeGreaterThanOrEqual(0);
    const after = SRC.slice(submit, submit + 600);
    expect(after).toMatch(/setResults\(\s*res\s*\)/);
  });

  it('the always-submit path does NOT recompute score before setResults (no calculateScorePercent / Math.round((correct))', () => {
    // Region between the submit call and the first setResults(res).
    const submit = SRC.indexOf('submitQuizResults(');
    const setRes = SRC.indexOf('setResults(res)', submit);
    expect(setRes).toBeGreaterThan(submit);
    const region = SRC.slice(submit, setRes);
    expect(region).not.toMatch(/calculateScorePercent/);
    expect(region).not.toMatch(/Math\.round\s*\(\s*\(\s*correct/);
    expect(region).not.toMatch(/score_percent\s*:/);
  });

  it('SCOPE GUARD: the client recompute (calculateScorePercent) lives ONLY in the offline catch', () => {
    // calculateScorePercent appears in the file (offline display path) but NOT
    // in the always-submit happy path (asserted above). This pins that the only
    // client-side score math is the offline-only branch.
    expect(SRC).toMatch(/calculateScorePercent\(/);
  });
});
