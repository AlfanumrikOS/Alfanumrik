import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { computeElapsedSeconds } from '@alfanumrik/lib/quiz/session-contract';

/**
 * P0 — "anti-cheat is INVERTED in exam mode".
 *
 * Defect (pre-existing, found in the Phase 4 review):
 *   `quiz/page.tsx` passed the raw `timer` state as `p_time` to
 *   `submit_quiz_results_v2`. In exam mode that timer counts DOWN from the
 *   limit, so `p_time` was the time REMAINING, not elapsed.
 *
 *   P3 Check 1 (`p_time / v_total < 3` -> flag -> XP 0) therefore ran
 *   backwards in exam mode:
 *     * a student who used nearly the full window submitted p_time ~ 0
 *       -> FLAGGED, XP 0;
 *     * every exam that auto-submitted at `timer === 0` was flagged BY
 *       CONSTRUCTION -> guaranteed 0 XP;
 *     * a rusher who left 25 minutes on the clock submitted p_time = 1500
 *       -> passed comfortably.
 *   The check punished thoroughness and rewarded rushing.
 *
 *   The same file already knew the correction — the `exam_simulations` write
 *   used `examTimeLimit * 60 - timer` — but the submit call did not. Two call
 *   sites, one of them wrong.
 *
 * Fix: elapsed seconds are derived ONCE, by `computeElapsedSeconds`, and every
 * consumer (submit RPC, client-side advisory anti-cheat, exam_simulations,
 * analytics) reads that one value. The duplicate inline conversion is deleted,
 * so there is no second site left to forget.
 *
 * Invariants: the P3 3s/question threshold is NOT changed. Only the value fed
 * into it is corrected to the elapsed time it was always documented to be.
 */

const PAGE = 'apps/host/src/app/(student)/quiz/page.tsx';

function resolveRepo(rel: string): string | null {
  for (const c of [
    path.resolve(process.cwd(), rel),
    path.resolve(process.cwd(), '..', rel),
    path.resolve(process.cwd(), '..', '..', rel),
  ]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}
function read(rel: string): string {
  const p = resolveRepo(rel);
  return p ? fs.readFileSync(p, 'utf-8') : '';
}
function codeOnly(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Server-side P3 Check 1, mirrored exactly from
 * submit_quiz_results_v2 (`v_avg_time := p_time / v_total; IF v_avg_time < 3.0`).
 * Threshold copied, not changed.
 */
function serverFlagsAsTooFast(pTime: number, totalQuestions: number): boolean {
  if (totalQuestions <= 0) return false;
  return pTime / totalQuestions < 3.0;
}

/** What the page USED to send: the raw timer state. */
const legacyPTime = (timer: number) => timer;

describe('P0-2: computeElapsedSeconds returns TRUE elapsed seconds in every mode', () => {
  it('practice mode counts up — elapsed is the timer itself', () => {
    expect(computeElapsedSeconds({ quizMode: 'practice', timer: 437, examTimeLimitMinutes: 180 })).toBe(437);
  });

  it('cognitive mode counts up — elapsed is the timer itself', () => {
    expect(computeElapsedSeconds({ quizMode: 'cognitive', timer: 90, examTimeLimitMinutes: 180 })).toBe(90);
  });

  it('exam mode counts DOWN — elapsed is limit minus remaining', () => {
    // 60-minute exam, 5 minutes left on the clock => 55 minutes elapsed.
    expect(computeElapsedSeconds({ quizMode: 'exam', timer: 300, examTimeLimitMinutes: 60 })).toBe(3300);
  });

  it('exam auto-submit at timer 0 means the FULL window elapsed, not zero', () => {
    expect(computeElapsedSeconds({ quizMode: 'exam', timer: 0, examTimeLimitMinutes: 60 })).toBe(3600);
  });

  it('exam start (timer === full limit) means zero elapsed', () => {
    expect(computeElapsedSeconds({ quizMode: 'exam', timer: 3600, examTimeLimitMinutes: 60 })).toBe(0);
  });

  it('clamps to [0, limit] so a clock glitch cannot mint a negative or oversized p_time', () => {
    expect(computeElapsedSeconds({ quizMode: 'exam', timer: 9999, examTimeLimitMinutes: 60 })).toBe(0);
    expect(computeElapsedSeconds({ quizMode: 'exam', timer: -5, examTimeLimitMinutes: 60 })).toBe(3600);
    expect(computeElapsedSeconds({ quizMode: 'practice', timer: -5, examTimeLimitMinutes: 60 })).toBe(0);
    expect(computeElapsedSeconds({ quizMode: 'exam', timer: Number.NaN, examTimeLimitMinutes: 60 })).toBe(3600);
  });
});

describe('P0-2: the P3 verdict is no longer inverted in exam mode', () => {
  it('a thorough student who uses nearly the whole window is NOT flagged (was flagged)', () => {
    // 20-question, 60-minute exam. Student finishes with 12 seconds left.
    const timer = 12;
    const fixed = computeElapsedSeconds({ quizMode: 'exam', timer, examTimeLimitMinutes: 60 });

    expect(serverFlagsAsTooFast(legacyPTime(timer), 20)).toBe(true);   // pre-fix: 12/20 = 0.6s/q -> FLAG, XP 0
    expect(serverFlagsAsTooFast(fixed, 20)).toBe(false);               // post-fix: 3588/20 = 179s/q -> clean
  });

  it('an exam that AUTO-SUBMITS at timer 0 is not flagged by construction (was a guaranteed flag)', () => {
    const timer = 0;
    const fixed = computeElapsedSeconds({ quizMode: 'exam', timer, examTimeLimitMinutes: 180 });

    expect(serverFlagsAsTooFast(legacyPTime(timer), 20)).toBe(true);   // pre-fix: 0/20 = 0s/q -> ALWAYS flagged
    expect(serverFlagsAsTooFast(fixed, 20)).toBe(false);               // post-fix: 10800/20 = 540s/q -> clean
  });

  it('a genuine rusher IS still caught — the 3s/question threshold is unchanged', () => {
    // 20-question, 60-minute exam blasted through in 40 seconds:
    // 3560 seconds still on the clock.
    const timer = 3560;
    const fixed = computeElapsedSeconds({ quizMode: 'exam', timer, examTimeLimitMinutes: 60 });

    expect(fixed).toBe(40);
    expect(serverFlagsAsTooFast(legacyPTime(timer), 20)).toBe(false);  // pre-fix: rushing PASSED (3560/20 = 178s/q)
    expect(serverFlagsAsTooFast(fixed, 20)).toBe(true);                // post-fix: 40/20 = 2s/q -> flagged
  });

  it('exactly 3s/question is the boundary and is not flagged, in exam mode too', () => {
    // 10 questions, 30-minute exam, 30s elapsed => exactly 3.0s/question.
    const fixed = computeElapsedSeconds({ quizMode: 'exam', timer: 1770, examTimeLimitMinutes: 30 });
    expect(fixed).toBe(30);
    expect(serverFlagsAsTooFast(fixed, 10)).toBe(false);
    expect(serverFlagsAsTooFast(29, 10)).toBe(true);
  });

  it('practice mode is completely unaffected by the fix', () => {
    for (const timer of [0, 1, 29, 30, 600]) {
      expect(computeElapsedSeconds({ quizMode: 'practice', timer, examTimeLimitMinutes: 180 })).toBe(legacyPTime(timer));
    }
  });
});

describe('P0-2: the quiz page derives elapsed ONCE and every call site reads it', () => {
  const src = codeOnly(PAGE);

  it('the page imports computeElapsedSeconds', () => {
    expect(src).toMatch(/computeElapsedSeconds/);
    expect(read(PAGE)).toMatch(/@alfanumrik\/lib\/quiz\/session-contract/);
  });

  it('elapsed is derived in exactly ONE place', () => {
    const derivations = src.match(/computeElapsedSeconds\(\{/g) ?? [];
    expect(derivations.length).toBe(1);
    expect(src).toMatch(/const\s+elapsedSeconds\s*=\s*computeElapsedSeconds\(\{/);
  });

  it('the submit RPC receives elapsedSeconds, not the raw timer', () => {
    // Both submit call sites (happy path + retry) pass the derived value.
    const submits = src.match(/submitQuizResults\([\s\S]*?\);/g) ?? [];
    expect(submits.length).toBe(2);
    for (const call of submits) {
      expect(call).toMatch(/\belapsedSeconds\b/);
      expect(call).not.toMatch(/^\s*timer,\s*$/m);
    }
  });

  it('the duplicate inline conversion `examTimeLimit * 60 - timer` is DELETED', () => {
    expect(src).not.toMatch(/examTimeLimit\s*\*\s*60\s*-\s*timer/);
  });

  it('exam_simulations.time_taken_seconds reads the same derived value', () => {
    expect(src).toMatch(/time_taken_seconds:\s*elapsedSeconds/);
    // The limit itself is still the limit.
    expect(src).toMatch(/time_limit_seconds:\s*examTimeLimit\s*\*\s*60/);
  });

  it('the client-side advisory P3 speed check uses elapsed too, so it agrees with the server', () => {
    expect(src).toMatch(/avgTimePerQ\s*=\s*totalResponses\s*>\s*0\s*\?\s*elapsedSeconds\s*\/\s*totalResponses/);
  });

  it('quiz_completed analytics reports elapsed time, not remaining', () => {
    // Lookbehind excludes `response_time_seconds:` / `avg_response_time_seconds:`,
    // which are per-question fields and have nothing to do with the wall clock.
    const timeSeconds = src.match(/(?<![_a-zA-Z])time_seconds:\s*\w+/g) ?? [];
    expect(timeSeconds.length).toBeGreaterThanOrEqual(2);
    for (const t of timeSeconds) expect(t).toMatch(/time_seconds:\s*elapsedSeconds/);
  });
});
