import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * ── ANTI-ORPHAN GUARD (added 2026-07-28) ──────────────────────────────────
 *
 * Failure mode being fixed: `npm test` was green while 25 test files (429
 * tests, including the P12 AI-admission and P13 PII-redaction suites) ran in
 * NO lane at all. The root `vitest.config.ts` listed most of them with
 * `supabase/functions/...` globs, but vitest resolves relative includes
 * against `test.root` = CWD, and every lane runs with CWD = `apps/host`, so
 * those globs pointed at the non-existent `apps/host/supabase/...`. Nothing
 * failed — the files were simply never collected.
 *
 * This test makes that state impossible to re-enter silently: it enumerates
 * every test file on disk and asserts each one is either (a) collected by the
 * unit lane, or (b) accounted for by an explicit, named reason. A test file
 * that lands somewhere the config does not reach fails THIS test.
 *
 * It re-derives collection from the config's own `include` / `exclude` arrays
 * rather than hardcoding a count, so it cannot drift from reality.
 *
 * Dependency note: this file uses no glob package of its own. Directory
 * walking is hand-rolled, and pattern matching uses `picomatch` — the matcher
 * vite/vitest already depend on. If picomatch is ever absent the guard FAILS
 * loudly rather than silently passing.
 */

const require = createRequire(import.meta.url);

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const LANE_ROOT = path.resolve(REPO_ROOT, 'apps/host'); // vitest `root` in every real lane

const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx)$/;
const VITEST_HARNESS_RE = /\.vitest-harness\.ts$/;

/** Recursive walk that never descends into node_modules. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const full = path.join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walk(full, out);
    else if (TEST_FILE_RE.test(entry) || VITEST_HARNESS_RE.test(entry)) out.push(full);
  }
  return out;
}

/** Every test file on disk in the three trees that can hold vitest tests. */
function testFilesOnDisk(): string[] {
  const roots = [
    path.join(REPO_ROOT, 'apps/host/src'),
    path.join(REPO_ROOT, 'packages'),
    path.join(REPO_ROOT, 'supabase/functions'),
  ];
  const files: string[] = [];
  for (const root of roots) walk(root, files);
  return files.map((p) => p.split(path.sep).join('/')).sort();
}

/**
 * Read include/exclude straight out of the root config module — the SAME
 * object vitest resolves, so the guard cannot disagree with the collector.
 */
async function laneGlobs(): Promise<{ include: string[]; exclude: string[] }> {
  const mod = (await import('../../../../vitest.config')) as {
    default: { test?: { include?: string[]; exclude?: string[] } };
  };
  const cfg = mod.default?.test ?? {};
  return { include: cfg.include ?? [], exclude: cfg.exclude ?? [] };
}

type Matcher = (input: string) => boolean;

function loadPicomatch(): (pattern: string, opts?: object) => Matcher {
  try {
    return require('picomatch');
  } catch {
    throw new Error(
      'picomatch is not resolvable. This guard needs it to re-derive which files ' +
        'the vitest include/exclude globs actually match. Do NOT delete this test to ' +
        'make the error go away — that would restore the silent-orphan failure mode it ' +
        'exists to prevent. Add picomatch as an explicit devDependency instead.',
    );
  }
}

/** True when `absPath` is matched by the lane's include globs and not excluded. */
function isCollected(
  absPath: string,
  include: Matcher[],
  exclude: Matcher[],
): boolean {
  const rel = path.relative(LANE_ROOT, absPath).split(path.sep).join('/');
  const candidates = [absPath, rel];
  const hit = (ms: Matcher[]) => ms.some((m) => candidates.some((c) => m(c)));
  return hit(include) && !hit(exclude);
}

/**
 * Named, reviewed reasons a test file may legitimately not be collected by the
 * unit lane. Anything not covered here is an orphan and fails the guard.
 */
const ACCOUNTED_FOR: Array<{ reason: string; matches: (abs: string, src: string) => boolean }> = [
  {
    reason: 'integration lane (RUN_INTEGRATION_TESTS=1) — needs a live Supabase',
    matches: (abs) =>
      abs.includes('/apps/host/src/__tests__/migrations/') ||
      (abs.includes('/apps/host/src/__tests__/scripts/') && !abs.includes('/knowledge-audit/')) ||
      abs.endsWith('.integration.test.ts'),
  },
  {
    reason: 'Deno test — runs in the `deno test` CI job (DENO_TEST_TARGETS), not vitest',
    matches: (_abs, src) => /\bDeno\.test\s*\(/.test(src),
  },
  {
    reason: 'explicitly excluded in vitest.config.ts with a documented TODO (shebang transform bug)',
    matches: (abs) => abs.endsWith('/apps/host/src/__tests__/reorder-baseline.test.ts'),
  },
];

/**
 * ── P2-3 Phase 3 (2026-08-04) ──────────────────────────────────────────────
 * Until this phase, `packages/lib/src/**\/*.test.ts` files were reached ONLY
 * as a side effect of importing a 2-line `export * from '...'` mirror stub
 * under `apps/host/src/lib/**` (`src/__tests__/setup.ts` patched fs reads so
 * this guard could compare stub-vs-canonical bytes and treat that as
 * "collected"). The 30 mirror stubs are now DELETED and
 * `PACKAGE_SOURCE_TEST_GLOBS` in `vitest.config.ts` globs
 * `packages/lib/src/**` and `packages/ui/src/**` test files directly (the
 * same repo-anchored `repoGlob()` mechanism as `CROSS_PACKAGE_TEST_GLOBS`).
 * That means `isCollected()` now returns true for those files on its own —
 * there is no more "reached via stub" special case to account for, and none
 * is added back here. If a packages/lib or packages/ui test file is ever
 * orphaned again (e.g. someone narrows `PACKAGE_SOURCE_TEST_GLOBS`), this
 * guard must fail loudly rather than silently re-exempting it — do not
 * re-add a stub-equivalence exemption without an actual stub mechanism to
 * justify it.
 */

describe('vitest lane coverage (anti-orphan guard)', () => {
  const files = testFilesOnDisk();

  it('sees a plausible number of test files on disk (guards against a broken walk)', async () => {
    const { include } = await laneGlobs();
    expect(files.length).toBeGreaterThan(1000);
    expect(include.length).toBeGreaterThan(0);
  });

  it('vitest.config test.exclude contains no negated ("!") globs', async () => {
    const { exclude } = await laneGlobs();
    const negated = exclude.filter((p) => typeof p === 'string' && p.startsWith('!'));

    expect(
      negated,
      'A leading "!" does NOT carve a path back into the lane here. Every entry in ' +
        'test.exclude is compiled as its OWN picomatch matcher and a file counts as ' +
        'excluded when ANY matcher hits, so "!x" yields a matcher that matches ' +
        'EVERYTHING EXCEPT x -- it excludes the whole repo. On 2026-08-18 four such ' +
        'entries orphaned all 1436 test files at once. To keep a file in the lane, ' +
        'NARROW the exclude glob that swallows it (see the ' +
        'scripts/!(knowledge-audit)/** extglob in vitest.config.ts for the idiom) ' +
        'instead of negating it here:\n' +
        negated.join('\n'),
    ).toEqual([]);
  });

  it('every test file on disk either runs in the unit lane or has a named reason', async () => {
    const pm = loadPicomatch();
    const { include, exclude } = await laneGlobs();
    const inc = include.map((p) => pm(p, { dot: true }));
    const exc = exclude.map((p) => pm(p, { dot: true }));
    const orphans: string[] = [];

    for (const abs of files) {
      if (isCollected(abs, inc, exc)) continue;
      const src = readFileSync(abs, 'utf8');
      if (ACCOUNTED_FOR.some((entry) => entry.matches(abs, src))) continue;
      orphans.push(path.relative(REPO_ROOT, abs));
    }
    // ── Config-sanity short-circuit ───────────────────────────────
    // A malformed include/exclude makes EVERY file look orphaned. Reporting
    // that as 1400+ individual orphans buries the actual fault, which is
    // exactly what happened on 2026-08-18. Past a sane threshold, say THE
    // CONFIG IS BROKEN instead and stop.
    const orphanRatio = files.length === 0 ? 0 : orphans.length / files.length;
    expect(
      orphanRatio,
      orphans.length +
        ' of ' +
        files.length +
        ' test files resolve to NO lane. That is a broken vitest.config.ts, not ' +
        'that many orphaned files: check test.exclude for negated ("!") globs, and ' +
        'check that test.include is non-empty and repo-anchored. Fix the config ' +
        'first -- the orphan list below is meaningless until you do.',
    ).toBeLessThan(0.5);

    expect(
      orphans,
      'These test files run in NO lane. Either add them to vitest.config.ts ' +
        '(CROSS_PACKAGE_TEST_GLOBS for anything outside apps/host/src), or add a named ' +
        'entry to ACCOUNTED_FOR in this file explaining why they must not run:\n' +
        orphans.join('\n'),
    ).toEqual([]);
  });

  it('cross-package include globs are repo-anchored, not cwd-relative', async () => {
    const { include } = await laneGlobs();
    // The original bug verbatim: `supabase/functions/...` resolved against
    // apps/host and matched nothing. Anchoring is what makes the lane
    // cwd-independent, so pin both the mechanism and the property.
    const src = readFileSync(path.join(REPO_ROOT, 'vitest.config.ts'), 'utf8');
    expect(src).toContain('CROSS_PACKAGE_TEST_GLOBS');
    expect(src).toMatch(/\]\.map\(repoGlob\)/);
    for (const pattern of include) {
      if (pattern.includes('supabase/functions') || pattern.includes('packages/')) {
        expect(
          path.isAbsolute(pattern),
          `include pattern "${pattern}" is cwd-relative; it will silently match zero ` +
            'files whenever vitest runs from a directory other than the repo root. ' +
            'Wrap it in repoGlob().',
        ).toBe(true);
      }
    }
  });
});
