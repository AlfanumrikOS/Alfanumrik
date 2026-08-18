/**
 * XC-4a [P10] — bundle-cap regression PIN (stops silent cap-creep).
 *
 * THEME: constants synced by COMMENT, not contract. `scripts/check-bundle-size.mjs`
 * defines the P10 budget caps. CAP_SHARED_KB has been raised SEVEN times via
 * reviewed edits (270 → 275 → 280 → 282 → 284 → 288 → 289 → 297), each absorbing measured
 * baseline drift instead of reducing the bundle. P10 protects Indian-4G users; cap creep
 * quietly erodes that guardrail.
 *
 * Bumped 289 → 297 on 2026-08-16 (CEO-approved). CI measured 294.6 kB on
 * chore/prod-readiness-dependencies after `@supabase/ssr` 0.12.0 → 0.12.4 forced a
 * peer-dependency floor bump of `@supabase/supabase-js`/`auth-js`/`realtime-js`
 * 2.108.2 → 2.112.3, plus Next.js 16.2.6 → 16.3.1 drift — landed incidentally via a
 * lockfile-only commit (f649cffa5) rather than a deliberate version bump. See the
 * `CAP_SHARED_KB` history paragraph in .claude/CLAUDE.md's P10 section for the full
 * rationale (identified/avoidable contributor, CEO chose to raise the cap over
 * pinning the dependency back).
 *
 * WHAT THIS TEST DOES: pins the CURRENT cap values. It does NOT claim these
 * values are "correct" — it makes any FUTURE raise a CONSCIOUS, REVIEWED event:
 * a cap bump now also fails this pin, so the bump and the pin update land in the
 * SAME PR, with the P10 approval rationale recorded in both places.
 *
 *   >>> WHEN A CAP IS INTENTIONALLY CHANGED (with P10 approval per
 *   >>> .claude/CLAUDE.md), UPDATE THE EXPECTED VALUE BELOW IN THE SAME PR. <<<
 *
 * Values + variable NAMES were read directly from the script (not guessed).
 * Note: the script does NOT define a separate `SHARED_JS_LIMIT_KB` constant —
 * the authoritative first-load total is `CAP_SHARED_KB` (the 160 kB
 * single-largest-chunk metric referenced in CLAUDE.md is doc-only, not a
 * variable in this script). This pin covers every numeric cap the script
 * actually declares.
 *
 * TEST-ONLY: never edits check-bundle-size.mjs.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT_PATH = resolve(process.cwd(), 'scripts/check-bundle-size.mjs');

// ── PINNED current values (update in the same PR as any approved cap change) ──
const EXPECTED = {
  CAP_SHARED_KB: 297,
  CAP_PAGE_KB: 260,
  CAP_MIDDLEWARE_KB: 120,
  SHARED_THRESHOLD_PCT: 95,
} as const;

function parseConst(src: string, name: string): number {
  const m = new RegExp(`const\\s+${name}\\s*=\\s*(\\d+)\\s*;`).exec(src);
  if (!m) throw new Error(`could not find \`const ${name} = <number>;\` in check-bundle-size.mjs`);
  return Number(m[1]);
}

describe('XC-4a: P10 bundle-cap pin (cap-creep guard)', () => {
  const src = readFileSync(SCRIPT_PATH, 'utf8');

  for (const [name, expected] of Object.entries(EXPECTED)) {
    it(`${name} is pinned at ${expected} (raising it requires updating this pin)`, () => {
      expect(
        parseConst(src, name),
        `${name} changed in check-bundle-size.mjs. If this is an intentional, ` +
          `P10-approved change, update EXPECTED.${name} in this test in the same PR.`
      ).toBe(expected);
    });
  }
});
