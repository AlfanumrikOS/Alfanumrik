/**
 * `checkQuizPushSites()` — shape + coupling pin (P1 / REG-51).
 *
 * WHAT THIS GUARDS, AND WHY IT IS NOT `pre-rollout-checklist.test.ts`:
 *
 *   `pre-rollout-checklist.test.ts` runs `checkQuizPushSites()` against the
 *   real quiz page and asserts it passes. That proves the PAGE is clean today.
 *   It proves nothing about the CHECK — a count-only implementation would also
 *   report pass on today's page, because today's page has enough sites. The
 *   guard could be hollowed out and that suite would stay green.
 *
 *   This file pins the check itself. The client is not the shuffle authority:
 *   every `Response` the quiz page constructs must stamp `shuffle_map: null`,
 *   and a non-null value is the client asserting a mapping only the server's
 *   per-session snapshot can know. That is the defect the server-side shuffle
 *   fix removed, and the check exists to stop it coming back.
 *
 * WHY NOTHING HERE MENTIONS A SITE COUNT:
 *
 *   `MIN_SHUFFLE_MAP_PUSH_SITES` is a FLOOR that is legitimately re-baselined
 *   whenever a response construction is added — b008c20c7 (Phase 4 session
 *   resume) added a sixth site, which is what broke the previous `=== 5` pin,
 *   and it will happen again. Every assertion below is written so that raising
 *   or lowering the floor does not touch this file, while reverting to a
 *   count-only check, or dropping the `null` assertion, fails it.
 *
 * WHY THIS IS SHAPE-AND-COUPLING RATHER THAN MUTATION:
 *
 *   The honest version of this test would feed `checkQuizPushSites()` a
 *   synthetic page carrying one fabricated `shuffle_map` and assert it fails.
 *   That is not reachable: `scripts/pre-rollout-checklist.ts` resolves outside
 *   this vitest project's root and is evaluated outside the module runner's
 *   mock registry, so `vi.mock('fs')` registered here applies to THIS file's
 *   `fs` import but NOT to the script's (verified empirically — the script
 *   kept reading the real quiz page through an active mock). `vi.spyOn` on the
 *   `fs` namespace throws (ESM namespaces are not configurable), and patching
 *   the CJS `node:fs` object the way `src/__tests__/setup.ts` does is invisible
 *   to it for the same reason. The remaining honest route — writing a decoy
 *   page at the repo-root path the check probes first — would leave a
 *   real-page-shadowing file behind on any crash, which is a worse failure
 *   mode than the gap it closes.
 *
 *   So: §1 pins the check's decision shape against the specific revert, and §2
 *   pins the check's own reported result to an independently-derived reading of
 *   the real page, so a check that stopped looking at values could not keep
 *   reporting them. If `scripts/pre-rollout-checklist.ts` ever grows an
 *   injectable source parameter, replace §1 with real mutation cases.
 */

import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { checkQuizPushSites } from '../../../scripts/pre-rollout-checklist';

const repoRoot = path.resolve(__dirname, '../../../../..');
const scriptPath = path.join(repoRoot, 'scripts', 'pre-rollout-checklist.ts');
const quizPagePath = path.join(
  repoRoot,
  'apps',
  'host',
  'src',
  'app',
  '(student)',
  'quiz',
  'page.tsx',
);

const script = readFileSync(scriptPath, 'utf8');

/** The `checkQuizPushSites` function body, isolated from the rest of the file. */
const checkBody = (() => {
  const start = script.indexOf('export function checkQuizPushSites');
  expect(start, 'checkQuizPushSites no longer exists in the pre-rollout checklist').toBeGreaterThan(
    -1,
  );
  const end = script.indexOf('\n}', start);
  return script.slice(start, end + 2);
})();

describe('§1 checkQuizPushSites decision shape — floor, not count (P1/REG-51)', () => {
  it('compares each captured value against the literal `null`', () => {
    // The load-bearing assertion. Without a value comparison the check is
    // silent about the P1 defect: six sites writing `shuffle_map:
    // buildLocalMap()` would satisfy a count-only check completely.
    expect(
      checkBody,
      'checkQuizPushSites no longer inspects the captured shuffle_map VALUES — ' +
        'a count-only check passes on a client-fabricated map, which is the P1/REG-51 defect',
    ).toContain("!== 'null'");
  });

  it('uses the site count only as a lower bound, never as an equality', () => {
    expect(checkBody).toMatch(/\.length\s*<\s*MIN_SHUFFLE_MAP_PUSH_SITES/);
    // The specific revert this file exists to catch: turning the floor back
    // into an exact count. Deliberately name-agnostic — the superseded
    // implementation spelled it `matches.length !== EXPECTED_SHUFFLE_MAP_PUSH_SITES`,
    // so an assertion keyed on today's identifiers would have let it back in.
    expect(
      checkBody,
      'the site count is being compared for equality again — it must stay a floor, ' +
        'so an honest new response construction does not break the gate',
    ).not.toMatch(/\.length\s*[!=]==/);
  });

  it('keeps the two failure modes distinguishable', () => {
    // "a construction lost its stamp" and "the client fabricated a map" are
    // different defects with different owners. Collapsing them into one
    // message makes a CI failure unactionable.
    expect(checkBody).toContain('lost its stamp');
    expect(checkBody).toContain('client fabricated a shuffle_map (P1)');
  });

  it('declares a floor of at least 1, so the count branch is not vacuous', () => {
    const declared = /const MIN_SHUFFLE_MAP_PUSH_SITES = (\d+);/.exec(script);
    expect(declared, 'MIN_SHUFFLE_MAP_PUSH_SITES is no longer a numeric literal').not.toBeNull();
    // Deliberately no upper assertion and no expected value: the floor is
    // re-baselined by design. A floor of 0 would make the branch unreachable.
    expect(Number(declared![1])).toBeGreaterThanOrEqual(1);
  });
});

describe('§2 checkQuizPushSites result is coupled to the real page values', () => {
  /**
   * An independent reading of the quiz page, derived here rather than imported,
   * so §2 is an oracle for the check rather than a restatement of it.
   */
  const observed = [...readFileSync(quizPagePath, 'utf8').matchAll(/shuffle_map:\s*([^,\n]+)/g)]
    .map((m) =>
      m[1]
        .replace(/\/\/.*$/, '')
        .replace(/;\s*$/, '')
        .trim(),
    );

  it('the quiz page has response constructions, and every one stamps null', () => {
    expect(observed.length).toBeGreaterThan(0);
    expect(
      observed.filter((v) => v !== 'null'),
      'the quiz page fabricates a shuffle_map — the client is not the shuffle authority (P1)',
    ).toEqual([]);
  });

  it('the enforced floor is at or below the real site count', () => {
    // A floor above reality makes the gate permanently red; a floor far below
    // it lets a construction silently drop its stamp. Asserted as a relation,
    // so re-baselining the floor alongside a new site keeps this green.
    const floor = Number(/const MIN_SHUFFLE_MAP_PUSH_SITES = (\d+);/.exec(script)![1]);
    expect(floor).toBeLessThanOrEqual(observed.length);
  });

  it('reports back the values it read, not just how many it found', () => {
    const r = checkQuizPushSites();

    expect(r.pass, r.detail).toBe(true);
    // Exact-equality against the independent reading: a check that stopped
    // examining values could not keep producing this string, and the site
    // number comes from the page rather than from a literal here, so adding a
    // response construction does not break this test.
    expect(r.detail).toBe(`${observed.length} sites, all null`);
  });
});
