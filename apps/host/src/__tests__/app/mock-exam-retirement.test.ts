/**
 * Legacy /mock-exam runtime — RETIREMENT PIN (Phase 5 track A, 2026-08-11).
 *
 * Replaces `mock-exam-section-b-count.test.tsx`, which mounted the deleted page.
 *
 * WHAT WAS DELETED AND WHY
 * ------------------------
 * `/mock-exam` (page 542 L + results 211 L + layout 10 L) ran a 3-hour,
 * 39-question, 80-mark CBSE paper entirely in React state and then passed the
 * result to `/mock-exam/results` AS A URL QUERY STRING. It wrote nothing to the
 * database: no attempt row, no responses, no XP, no mastery. A student could sit
 * a full board-pattern paper and the product would retain none of it.
 *
 * THE THREE THINGS THIS TEST GUARDS
 * ---------------------------------
 *   1. The runtime is really gone (not just unlinked).
 *   2. The URLs still RESOLVE. `/mock-exam` left the nav in Phase 3, but
 *      bookmarks, the old `/practice/exam/mock` alias and pasted links persist.
 *      Deleting a page without a redirect converts a data-loss bug into a 404,
 *      which is not an improvement.
 *   3. The CBSE paper STRUCTURE survived the move. The deleted test's real
 *      subject was the Section B count (6×2, not the 5×2 that made the paper
 *      38q/78m). That structure now lives in the successor's
 *      `start_mock_test_attempt` RPC, so the pin follows it there — otherwise
 *      deleting the page would silently delete the regression guard with it.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function findRepoRoot(): string {
  const candidates = [resolve(process.cwd(), '..', '..'), resolve(process.cwd(), '..'), process.cwd()];
  for (const c of candidates) {
    if (existsSync(resolve(c, 'apps/host/src')) && existsSync(resolve(c, 'packages/ui/src'))) return c;
  }
  throw new Error('mock-exam-retirement: could not locate the monorepo root');
}

const REPO_ROOT = findRepoRoot();
const APP = resolve(REPO_ROOT, 'apps/host/src/app');
const NEXT_CONFIG = readFileSync(resolve(REPO_ROOT, 'apps/host/next.config.js'), 'utf8');

/** `source` → `destination` pairs from the `redirects()` block only. Bounded at
 *  the next `async <name>()` sibling so `rewrites()` cannot be misread. */
function redirectPairs(src: string): Array<{ source: string; destination: string }> {
  const start = src.indexOf('async redirects()');
  if (start === -1) return [];
  const rest = src.slice(start + 'async redirects()'.length);
  const nextFn = /\n\s{0,4}async\s+\w+\s*\(/.exec(rest);
  const body = nextFn ? rest.slice(0, nextFn.index) : rest;
  return [
    ...body.matchAll(/source\s*:\s*['"]([^'"]+)['"]\s*,\s*destination\s*:\s*['"]([^'"]+)['"]/g),
  ].map(m => ({ source: m[1], destination: m[2] }));
}

const REDIRECTS = redirectPairs(NEXT_CONFIG);

describe('legacy /mock-exam runtime is deleted', () => {
  it.each([
    ['runner', 'mock-exam/page.tsx'],
    ['results', 'mock-exam/results/page.tsx'],
    ['layout', 'mock-exam/layout.tsx'],
    ['practice alias shell', 'practice/exam/mock/page.tsx'],
  ])('the %s page file no longer exists', (_label, rel) => {
    // NOTE: asserted against the REAL app dir, not a cwd-relative path — the
    // test-setup `(student)` route-group shim would otherwise resolve a deleted
    // `src/app/x` to a live `src/app/(student)/x` and this could never go red.
    expect(existsSync(resolve(APP, '(student)', rel))).toBe(false);
    expect(existsSync(resolve(APP, rel))).toBe(false);
  });

  it('parsed a non-vacuous redirect table (guards the regex, not just the data)', () => {
    // If this parser silently stopped matching, every assertion below would
    // pass trivially against an empty list.
    expect(REDIRECTS.length).toBeGreaterThan(3);
    expect(REDIRECTS.some(r => r.source === '/review')).toBe(true);
  });
});

describe('every retired mock-exam URL still resolves', () => {
  it.each([
    ['/mock-exam', '/mock-exam'],
    ['/mock-exam/results (wildcard)', '/mock-exam/:path*'],
    ['/practice/exam/mock', '/practice/exam/mock'],
  ])('%s redirects to the successor catalogue', (_label, source) => {
    const hit = REDIRECTS.find(r => r.source === source);
    expect(hit, `no redirect declared for ${source} — the URL 404s`).toBeDefined();
    expect(hit!.destination).toBe('/exams/mock');
  });

  it('the redirects are permanent (bookmarks are rewritten, not re-resolved forever)', () => {
    const block = NEXT_CONFIG.slice(NEXT_CONFIG.indexOf("source: '/mock-exam'"));
    expect(block.slice(0, 400)).toMatch(/permanent:\s*true/);
  });

  it('the redirect destination is a real page', () => {
    expect(existsSync(resolve(APP, '(student)/exams/mock/page.tsx'))).toBe(true);
    expect(existsSync(resolve(APP, '(student)/exams/mock/[paperId]/page.tsx'))).toBe(true);
  });
});

describe('no source file routes to the retired runtime any more', () => {
  it('nothing links or pushes to /mock-exam', async () => {
    const { readdirSync } = await import('node:fs');
    const hits: string[] = [];
    let scanned = 0;
    const SKIP = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '__tests__']);
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = resolve(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP.has(e.name)) walk(full);
          continue;
        }
        if (!/\.[cm]?[jt]sx?$/.test(e.name)) continue;
        scanned++;
        const lines = readFileSync(full, 'utf8').split(/\r?\n/);
        lines.forEach((line, i) => {
          // A comment recording the deletion is fine and expected; a live
          // navigation is not. Match only quoted route usages.
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          if (/['"`]\/mock-exam/.test(line)) hits.push(`${full}:${i + 1}`);
        });
      }
    };
    for (const root of ['apps/host/src', 'packages/ui/src', 'packages/lib/src']) {
      walk(resolve(REPO_ROOT, root));
    }
    // Non-vacuous: if the walker broke, `hits` would be empty for the wrong
    // reason and this canary would pass while covering nothing.
    expect(scanned).toBeGreaterThan(500);
    expect(hits, `live references to the deleted /mock-exam route:\n${hits.join('\n')}`).toEqual([]);
  });
});

describe('the CBSE paper structure survived the move to the successor', () => {
  // Carried over from the deleted mock-exam-section-b-count test. The counts
  // now live in the RPC that assembles the dynamic cbse_board paper.
  const RPC = readFileSync(
    resolve(REPO_ROOT, 'supabase/migrations/20260722097000_start_mock_test_attempt_rpc.sql'),
    'utf8',
  );

  it('declares 5 sections with counts 20/6/7/3/3 (Section B is 6, not 5)', () => {
    expect(RPC).toMatch(/v_sections\s+text\[\]\s*:=\s*ARRAY\['A','B','C','D','E'\]/);
    expect(RPC).toMatch(/v_counts\s+int\[\]\s*:=\s*ARRAY\[20,6,7,3,3\]/);
  });

  it('declares marks-per-question 1/2/3/5/4, i.e. 39 questions and 80 marks', () => {
    expect(RPC).toMatch(/v_marks_per_q\s+int\[\]\s*:=\s*ARRAY\[1,2,3,5,4\]/);

    const counts = [20, 6, 7, 3, 3];
    const marks = [1, 2, 3, 5, 4];
    expect(counts.reduce((a, b) => a + b, 0)).toBe(39);
    expect(counts.reduce((sum, c, i) => sum + c * marks[i], 0)).toBe(80);
    // The old buggy shape (Section B = 5) produced 38 questions / 78 marks.
    expect(counts.reduce((sum, c, i) => sum + c * marks[i], 0)).not.toBe(78);
  });
});
