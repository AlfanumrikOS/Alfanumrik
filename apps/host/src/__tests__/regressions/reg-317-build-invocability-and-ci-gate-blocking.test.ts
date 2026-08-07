/**
 * REG-317 — Build/tooling invocability + CI gate blocking posture.
 *
 * WHAT THIS PINS AND WHY
 * ----------------------
 * The 2026-07-27 `fix/typecheck-scripts-gap` PR closed a family of bugs that
 * every existing gate was structurally blind to: tooling that COMPILES but
 * cannot be INVOKED, and guards that RUN but INSPECT NOTHING.
 *
 *   1. 22 npm script declarations in `apps/host/package.json` referenced paths
 *      that do not resolve from `apps/host` (npm's cwd for that package). Every
 *      one died with MODULE_NOT_FOUND the first time a human ran it. No
 *      compiler reads package.json, so nothing caught it.
 *   2. Seven repo-root `scripts/**` files imported `../src/lib/…`, a path the
 *      monorepo migration deleted. `npm run type-check` is `--workspaces` and
 *      `scripts/` belongs to no workspace, so nothing type-checked them.
 *   3. `scripts/security/check-edge-logs.mjs` (a P13 privacy guard) globbed
 *      relative to cwd. From `apps/host` it matched 0 of 47 Edge Functions and
 *      printed a green "passed". A guard that inspects nothing is not a pass.
 *   4. The three new blocking CI steps that close 1-3 are only worth anything
 *      while they stay BLOCKING. A `continue-on-error: true` added in a hurry
 *      would silently return the repo to the pre-fix state.
 *   5. The `edge-function-tests` Deno pre-warm list and test list used to be
 *      two hand-maintained lists. They drifted; five test files ran without
 *      being pre-warmed; a first-ever esm.sh fetch inside the no-retry offline
 *      test step took an HTTP 522 and reddened a build. One `env` var is now
 *      the single source of truth — but only while neither step re-inlines a
 *      target path.
 *
 * These are all BEHAVIOURAL assertions: each subprocess/parse test fails if the
 * invariant breaks, and the mutation cases prove the pins are non-vacuous.
 *
 * NO network. NO Supabase. File / YAML / short-lived subprocess only.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// vitest runs with cwd = apps/host, but everything under test lives at the
// repo ROOT (scripts/, .github/, supabase/), OUTSIDE that cwd. Anchor to the
// file's own location so the suite is cwd-independent, exactly like the
// scripts it is pinning.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const HOST_ROOT = join(REPO_ROOT, 'apps/host');

const SCRIPT_PATH_CANARY = join(REPO_ROOT, 'scripts/check-npm-script-paths.mjs');
const EDGE_LOG_GUARD = join(REPO_ROOT, 'scripts/security/check-edge-logs.mjs');
const CI_WORKFLOW = join(REPO_ROOT, '.github/workflows/ci.yml');

/** Run a node script and capture status/stdout/stderr. No shell, no network. */
function runNode(scriptPath: string, cwd: string) {
  const r = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: 'utf8',
    // Keep it snappy; every one of these is a pure filesystem scan.
    timeout: 60_000,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    combined: `${r.stdout ?? ''}${r.stderr ?? ''}`,
  };
}

/**
 * Normalize Windows `\` separators to POSIX `/` for path-CONTENT assertions.
 * The scripts under test emit paths with the host-OS separator — path.relative
 * (check-npm-script-paths.mjs), path.resolve (the vitest.config alias) and
 * fs.globSync (check-edge-logs.mjs) all print `\` on Windows and `/` on the
 * Linux CI runner. That is correct behaviour on each OS; the bug was only that
 * a few assertions checked for a literal `a/b/c` substring, so they passed on
 * CI but spuriously failed on a Windows dev machine. Normalizing the RECEIVED
 * text keeps each assertion's path content fully intact (nothing weakened) and
 * makes the pin OS-independent, exactly as it is already cwd-independent.
 */
const posix = (s: string) => s.replace(/\\/g, '/');

/** Create a throwaway directory tree and always clean it up. */
function withTempDir<T>(prefix: string, fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Invariant 1 — every npm script path token resolves.
// ───────────────────────────────────────────────────────────────────────────

describe('REG-317 (1) npm script declarations are invocable', () => {
  it('the real canary exits 0 against the real workspace', () => {
    const r = runNode(SCRIPT_PATH_CANARY, REPO_ROOT);
    expect(r.combined).toMatch(/check:script-paths OK/);
    expect(r.status).toBe(0);
  });

  it('the canary is cwd-independent (same verdict from apps/host)', () => {
    // The whole bug class is "cwd is not what you think". A gate that only
    // works from one cwd would reintroduce it.
    const fromRoot = runNode(SCRIPT_PATH_CANARY, REPO_ROOT);
    const fromHost = runNode(SCRIPT_PATH_CANARY, HOST_ROOT);
    expect(fromHost.status).toBe(0);
    expect(fromHost.status).toBe(fromRoot.status);
    // Same script/package counts from both cwds — not merely "both exit 0".
    const counts = (out: string) => out.match(/(\d+) script\(s\) across (\d+) package/);
    expect(counts(fromHost.combined)).not.toBeNull();
    expect(counts(fromHost.combined)?.slice(1)).toEqual(counts(fromRoot.combined)?.slice(1));
  });

  it('the canary inspects a non-trivial number of declarations (no silent no-op)', () => {
    // Same failure mode as the edge-log guard: a scan that matched nothing
    // would also "pass". Pin a floor, and independently prove the count is
    // real by counting the package.json files the canary walks.
    const r = runNode(SCRIPT_PATH_CANARY, REPO_ROOT);
    const m = r.combined.match(/(\d+) script\(s\) across (\d+) package\.json file\(s\)/);
    expect(m).not.toBeNull();
    const scriptCount = Number(m![1]);
    const pkgCount = Number(m![2]);
    expect(scriptCount).toBeGreaterThan(30);

    // Independently enumerate the workspace package.json set: the root, plus
    // every `dir/*` glob member, plus every literal workspace path.
    const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
    const expectedPkgs = new Set([join(REPO_ROOT, 'package.json')]);
    for (const pattern of rootPkg.workspaces ?? []) {
      if (pattern.endsWith('/*')) {
        const parent = join(REPO_ROOT, pattern.slice(0, -2));
        if (!existsSync(parent)) continue;
        for (const entry of readdirSync(parent, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const candidate = join(parent, entry.name, 'package.json');
          if (existsSync(candidate)) expectedPkgs.add(candidate);
        }
      } else {
        const candidate = join(REPO_ROOT, pattern, 'package.json');
        if (existsSync(candidate)) expectedPkgs.add(candidate);
      }
    }
    expect(expectedPkgs.size).toBeGreaterThan(1);
    expect(pkgCount).toBe(expectedPkgs.size);
  });

  it('MUTATION: a stripped `../../` prefix makes the canary exit non-zero', () => {
    withTempDir('reg317-canary-', (root) => {
      // Reproduce the EXACT defect shape: a workspace package declaring a
      // script whose target lives at the repo root.
      mkdirSync(join(root, 'scripts'), { recursive: true });
      mkdirSync(join(root, 'apps/host'), { recursive: true });
      writeFileSync(join(root, 'scripts', 'target.mjs'), '// fixture\n');
      writeFileSync(
        join(root, 'package.json'),
        JSON.stringify({ name: 'fixture-root', workspaces: ['apps/*'], scripts: {} }, null, 2)
      );

      // The canary derives its repo root from import.meta.url (`../` from the
      // script's own dir), so a verbatim copy at <tmp>/scripts/ treats <tmp>
      // as the repo root. Copy, never rewrite — the mutation must exercise the
      // REAL logic, which the byte-identity assertion below proves.
      const copiedCanary = join(root, 'scripts', 'check-npm-script-paths.mjs');
      cpSync(SCRIPT_PATH_CANARY, copiedCanary);
      expect(readFileSync(copiedCanary, 'utf8')).toBe(readFileSync(SCRIPT_PATH_CANARY, 'utf8'));

      const writeHostPkg = (body: string) =>
        writeFileSync(
          join(root, 'apps/host', 'package.json'),
          JSON.stringify({ name: 'fixture-host', scripts: { 'my:task': body } }, null, 2)
        );

      // CONTROL: correct declaration -> exit 0.
      writeHostPkg('node ../../scripts/target.mjs');
      const ok = runNode(copiedCanary, root);
      expect(ok.status).toBe(0);
      expect(ok.combined).toMatch(/check:script-paths OK/);

      // MUTATION: strip the `../../` -> exit 1, naming the package, the script,
      // the token, and the repo-root hint that makes the fix obvious.
      writeHostPkg('node scripts/target.mjs');
      const broken = runNode(copiedCanary, root);
      expect(broken.status).not.toBe(0);
      expect(broken.combined).toMatch(/check:script-paths FAILED/);
      expect(posix(broken.combined)).toContain('apps/host/package.json');
      expect(broken.combined).toContain('my:task');
      expect(broken.combined).toContain('scripts/target.mjs');
      expect(posix(broken.combined)).toMatch(/exists at repo root — prefix with \.\.\/\.\.\//);

      // Restoring the prefix restores green — the failure was the mutation,
      // not fixture drift.
      writeHostPkg('node ../../scripts/target.mjs');
      expect(runNode(copiedCanary, root).status).toBe(0);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariant 2 — no file under scripts/ imports the dead pre-monorepo
// `../src/lib/` path.
// ───────────────────────────────────────────────────────────────────────────

/**
 * WHY THIS IS A SOURCE-TEXT SCAN AND NOT A RUNTIME IMPORT TEST
 * -----------------------------------------------------------
 * The obvious test — import each script and see whether it throws
 * MODULE_NOT_FOUND — DOES NOT WORK IN THIS REPO, and the reason is precisely
 * why ~14,000 existing Vitest tests never caught the original defect.
 *
 * The root `vitest.config.ts` declares:
 *
 *     { find: /^(\.\.\/)+src\/lib\//, replacement: '<root>/packages/lib/src/' }
 *
 * Under Vitest, ANY import of `../src/lib/x` is silently rewritten to the live
 * `packages/lib/src/x` and resolves cleanly. A runtime probe would therefore
 * pass on code that is stone dead under plain `node`/`tsx`, which is how the
 * seven rotted scripts shipped green. The alias is real and load-bearing for
 * other suites, so it must not be removed to make testing easier — the
 * detection has to happen on the SOURCE TEXT, before any resolver runs.
 *
 * The alias's continued existence is asserted below, behaviourally (the regex
 * is executed against a dead specifier), so that if it is ever removed this
 * test tells the next maintainer that the runtime approach has become viable.
 */
const DEAD_IMPORT_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'static import / re-export `from` specifier', re: /\bfrom\s*['"](?:\.\.\/)+src\/lib\// },
  { label: 'dynamic `import()` specifier', re: /\bimport\s*\(\s*['"](?:\.\.\/)+src\/lib\// },
  { label: 'CommonJS `require()` specifier', re: /\brequire\s*\(\s*['"](?:\.\.\/)+src\/lib\// },
];

const CODE_EXTENSIONS = ['.ts', '.mts', '.cts', '.tsx', '.js', '.mjs', '.cjs'];

function walkCodeFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkCodeFiles(full, out);
    else if (CODE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

describe('REG-317 (2) scripts/ never imports the deleted pre-monorepo src/lib path', () => {
  const scriptFiles = walkCodeFiles(join(REPO_ROOT, 'scripts'));

  it('scans a non-trivial number of files (guards against a vacuous pass)', () => {
    // If the walk silently returned [], every assertion below would "pass".
    expect(scriptFiles.length).toBeGreaterThan(50);
  });

  it('no script source contains a `../src/lib/` module specifier in any form', () => {
    const offenders: string[] = [];
    for (const file of scriptFiles) {
      const text = readFileSync(file, 'utf8');
      for (const { label, re } of DEAD_IMPORT_PATTERNS) {
        if (re.test(text)) {
          offenders.push(`${file.slice(REPO_ROOT.length + 1)} :: ${label}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the detector actually fires on all three real defect shapes (non-vacuous)', () => {
    // These five lines are verbatim shapes taken from the seven scripts the
    // 2026-07-27 fix repaired.
    const positives = [
      "import { supabaseAdmin } from '../src/lib/supabase-admin';",
      "} from '../src/lib/rag/pack-manifest';",
      "export { logger } from '../../src/lib/logger';",
      "  const { run } = await import('../src/lib/state/runtime/event-listener');",
      "const { logger } = require('../src/lib/logger');",
    ];
    for (const line of positives) {
      const caught = DEAD_IMPORT_PATTERNS.some(({ re }) => re.test(line));
      expect(caught, `should flag: ${line}`).toBe(true);
    }
  });

  it('the detector does not fire on the live monorepo paths (no false positives)', () => {
    const negatives = [
      "import { logger } from '../../packages/lib/src/logger';",
      "import { logger } from '@alfanumrik/lib/logger';",
      "import { helper } from './lib/helper';",
      "const mod = await import('../../packages/lib/src/rag/csv');",
    ];
    for (const line of negatives) {
      const caught = DEAD_IMPORT_PATTERNS.some(({ re }) => re.test(line));
      expect(caught, `should NOT flag: ${line}`).toBe(false);
    }
  });

  it('the Vitest alias that defeats a runtime probe is still in effect', async () => {
    // Behavioural, not string-matching: load the real config and EXECUTE the
    // alias regex against a dead specifier. If this ever stops matching, the
    // rationale in the block comment above is stale and a runtime import test
    // becomes possible.
    const mod: any = await import('../../../../../vitest.config');
    const aliases: any[] = mod.default?.resolve?.alias ?? [];
    expect(Array.isArray(aliases)).toBe(true);
    const rewriter = aliases.find(
      (a) => a?.find instanceof RegExp && a.find.test('../src/lib/logger')
    );
    expect(rewriter, 'vitest.config.ts no longer rewrites ../src/lib/* ').toBeTruthy();
    expect(posix(String(rewriter.replacement))).toContain('packages/lib/src');
    // It rewrites every depth of `../`, which is why no script could ever
    // fail a runtime probe regardless of how deeply nested it is.
    expect(rewriter.find.test('../../../src/lib/logger')).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariant 3 — the edge-log PII guard has a zero-match floor.
// ───────────────────────────────────────────────────────────────────────────

describe('REG-317 (3) edge-log PII guard fails loudly when it scans nothing', () => {
  it('scans every supabase/functions/*/index.ts, from any cwd', () => {
    // Independently enumerate what the guard is SUPPOSED to cover, so this
    // assertion self-updates when Edge Functions are added/removed but still
    // fails hard if path resolution breaks (the original false-green).
    const functionsDir = join(REPO_ROOT, 'supabase/functions');
    const expected = readdirSync(functionsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(functionsDir, e.name, 'index.ts')))
      .length;
    expect(expected).toBeGreaterThan(0);

    for (const cwd of [REPO_ROOT, HOST_ROOT]) {
      const r = runNode(EDGE_LOG_GUARD, cwd);
      expect(r.status, `guard failed from cwd=${cwd}: ${r.combined}`).toBe(0);
      const m = r.combined.match(/passed \((\d+) index\.ts files scanned\)/);
      expect(m, `no scan count reported from cwd=${cwd}`).not.toBeNull();
      expect(Number(m![1])).toBe(expected);
      expect(Number(m![1])).toBeGreaterThan(0);
    }
  });

  it('MUTATION: zero matches exits non-zero instead of printing a green pass', () => {
    withTempDir('reg317-edgelog-', (root) => {
      // Isolated fixture root. The guard anchors its glob to `<its own dir>/../..`,
      // so a verbatim copy at <tmp>/scripts/security/ scans <tmp>. The REAL
      // script is never touched.
      const copied = join(root, 'scripts/security/check-edge-logs.mjs');
      mkdirSync(dirname(copied), { recursive: true });
      cpSync(EDGE_LOG_GUARD, copied);
      expect(readFileSync(copied, 'utf8')).toBe(readFileSync(EDGE_LOG_GUARD, 'utf8'));

      // (a) No supabase/functions at all -> 0 matches -> MUST exit non-zero.
      const empty = runNode(copied, root);
      expect(empty.status).not.toBe(0);
      expect(empty.combined).toMatch(/FAILED TO RUN: matched 0 files/);
      // ...and it must say so on stderr, not quietly on stdout.
      expect(empty.stderr).toMatch(/FAILED TO RUN/);
      expect(empty.combined).not.toMatch(/guard passed/);

      // (b) Add one clean Edge Function -> the very same copy now exits 0.
      // This proves (a) failed because of the zero-match floor and not because
      // the temp harness is broken.
      const cleanFn = join(root, 'supabase/functions/alpha');
      mkdirSync(cleanFn, { recursive: true });
      writeFileSync(join(cleanFn, 'index.ts'), "console.log('started', { count: 1 })\n");
      const clean = runNode(copied, root);
      expect(clean.status).toBe(0);
      expect(clean.combined).toMatch(/passed \(1 index\.ts files scanned\)/);

      // (c) The floor did not replace the guard's real job: a PII log still
      // fails. Without this, "exit 1 on empty" could be satisfied by a script
      // that exits 1 always.
      const dirtyFn = join(root, 'supabase/functions/beta');
      mkdirSync(dirtyFn, { recursive: true });
      writeFileSync(join(dirtyFn, 'index.ts'), "console.log('sending to', email)\n");
      const dirty = runNode(copied, root);
      expect(dirty.status).not.toBe(0);
      expect(dirty.combined).toMatch(/Unsafe Edge Function logging detected/);
      expect(posix(dirty.combined)).toContain('supabase/functions/beta/index.ts');
      expect(dirty.combined).not.toMatch(/FAILED TO RUN/);
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Invariants 4 & 5 — CI workflow structure, parsed as YAML.
//
// NOTE ON METHOD: this parses ci.yml with a real YAML parser rather than
// slicing strings. `v3-school-rpc-predeploy.test.ts` uses string slicing over a
// workflow and that is a known hazard — indentation-sensitive slicing silently
// reads the wrong job when steps are reordered or a comment block grows.
// ───────────────────────────────────────────────────────────────────────────

type Step = { name?: string; run?: string; uses?: string; env?: Record<string, unknown> } & Record<
  string,
  unknown
>;

const workflow = parseYaml(readFileSync(CI_WORKFLOW, 'utf8')) as {
  jobs: Record<string, { env?: Record<string, unknown>; steps?: Step[] }>;
};

/** Drop whole-line `#` comments; executable body only. */
function stripShellComments(body: string): string {
  return body
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

describe('REG-317 (4) the three quality-job gates exist and are BLOCKING', () => {
  const quality = workflow.jobs?.quality;
  const steps = quality?.steps ?? [];
  const byName = (n: string) => steps.find((s) => s.name === n);

  it('the workflow parses and the quality job has a real step list', () => {
    expect(quality).toBeDefined();
    expect(Array.isArray(steps)).toBe(true);
    expect(steps.length).toBeGreaterThanOrEqual(10);
    // A sanity anchor: if the parse silently returned the wrong job, this
    // long-standing step would be missing.
    expect(byName('Lint')).toBeDefined();
  });

  it('the continue-on-error detector is non-vacuous', () => {
    // META-PIN. Every "is blocking" assertion below is an absence check, and
    // an absence check passes for free if the parser cannot see the key at
    // all. The former advisory type-sync step ("Verify Supabase types are up to
    // date") was commented out entirely on 2026-08-07 (see #1472), so we pin
    // against the workflow's remaining deliberately-advisory step, which still
    // carries `continue-on-error: true`. Seeing `true` here proves the detector
    // reads the key correctly in the job it is called with.
    const advisory = workflow.jobs?.['edge-function-tests']?.steps?.find(
      (s) => s.name === 'Measure Deno type-check debt (advisory)'
    );
    expect(advisory, 'edge-function-tests advisory step missing').toBeDefined();
    expect(advisory!['continue-on-error']).toBe(true);
  });

  for (const [stepName, mustInvoke] of [
    ['Type check (scripts/)', 'type-check:scripts'],
    ['Check npm script paths', 'check:script-paths'],
    ['Edge Function log PII guard (P13)', 'scripts/security/check-edge-logs.mjs'],
  ] as const) {
    it(`"${stepName}" is present, blocking, and actually invokes its gate`, () => {
      const step = byName(stepName);
      expect(step, `missing quality step: ${stepName}`).toBeDefined();
      // Blocking: the key is either absent or explicitly false.
      const coe = step!['continue-on-error'];
      expect(
        coe === undefined || coe === false,
        `${stepName} must not be continue-on-error (found: ${String(coe)})`
      ).toBe(true);
      // And it must run the real thing, not a placeholder.
      expect(typeof step!.run).toBe('string');
      expect(step!.run).toContain(mustInvoke);
    });
  }

  it('the two npm-script gates map to declarations that exist', () => {
    // Closes the loop: a blocking step is worthless if it invokes an npm
    // script name that no package.json declares.
    const rootScripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts;
    expect(rootScripts['type-check:scripts']).toBeTruthy();
    expect(rootScripts['check:script-paths']).toContain('scripts/check-npm-script-paths.mjs');
    expect(existsSync(SCRIPT_PATH_CANARY)).toBe(true);
    expect(existsSync(EDGE_LOG_GUARD)).toBe(true);
  });

  it('the dev-tooling gates stay ordered AFTER the P15 auth gate', () => {
    // ci.yml documents this as DELIBERATE: steps are serial and fail-stop, so
    // a trivial maintenance-script error must never abort the job before the
    // onboarding-protecting auth gate has emitted a signal.
    const idx = (n: string) => steps.findIndex((s) => s.name === n);
    const auth = idx('Auth & Identity test gate');
    const typeCheckScripts = idx('Type check (scripts/)');
    const scriptPaths = idx('Check npm script paths');
    const piiGuard = idx('Edge Function log PII guard (P13)');
    expect(auth).toBeGreaterThanOrEqual(0);
    expect(typeCheckScripts).toBeGreaterThan(auth);
    expect(scriptPaths).toBeGreaterThan(typeCheckScripts);
    expect(piiGuard).toBeGreaterThan(scriptPaths);
  });
});

describe('REG-317 (5) the Deno pre-warm set cannot drift from the test set', () => {
  const job = workflow.jobs?.['edge-function-tests'];
  const steps = job?.steps ?? [];
  const targetsRaw = job?.env?.DENO_TEST_TARGETS;

  it('DENO_TEST_TARGETS is defined once, at JOB level', () => {
    expect(job, 'edge-function-tests job missing').toBeDefined();
    expect(typeof targetsRaw).toBe('string');
    const targets = String(targetsRaw).trim().split(/\s+/).filter(Boolean);
    expect(targets.length).toBeGreaterThanOrEqual(5);
    // No step may shadow it — a step-level override would recreate two lists.
    for (const step of steps) {
      expect(
        step.env?.DENO_TEST_TARGETS,
        `step "${step.name}" shadows DENO_TEST_TARGETS`
      ).toBeUndefined();
    }
  });

  it('every declared target exists on disk', () => {
    const missing = String(targetsRaw)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .filter((t) => !existsSync(join(REPO_ROOT, t)));
    expect(missing).toEqual([]);
  });

  it('exactly two steps consume the variable — the pre-warm and the test run', () => {
    const consumers = steps.filter((s) => typeof s.run === 'string' && s.run.includes('$DENO_TEST_TARGETS'));
    expect(consumers.map((s) => s.name)).toEqual([
      'Cache Deno module dependencies',
      'Run Edge Function Deno tests (deterministic, offline)',
    ]);
  });

  it('NEITHER consumer hardcodes a supabase/functions target path', () => {
    // THIS is what makes drift structurally impossible. If either step
    // re-inlines a path, the two sets can diverge again and a never-pre-warmed
    // remote import can be fetched inside the offline, no-retry test step.
    // Whole-line comments are stripped first: documenting a path is fine,
    // EXECUTING a hardcoded one is not.
    const consumers = steps.filter(
      (s) => typeof s.run === 'string' && s.run.includes('$DENO_TEST_TARGETS')
    );
    expect(consumers.length).toBe(2);
    for (const step of consumers) {
      const body = stripShellComments(step.run as string);
      expect(body, `step "${step.name}" hardcodes an Edge Function target path`).not.toContain(
        'supabase/functions/'
      );
    }
  });

  it('the offline test step never re-opens the network', () => {
    // The 522 incident was a first-ever fetch inside this step. It must stay
    // offline so a miss fails as a resolution error, not as a flaky download.
    const testStep = steps.find(
      (s) => s.name === 'Run Edge Function Deno tests (deterministic, offline)'
    );
    expect(testStep).toBeDefined();
    // Comments are stripped: ci.yml's comment says "Deliberately no
    // --allow-net", and documenting the rule must not violate it.
    const body = stripShellComments(testStep!.run as string);
    expect(body).toContain('deno test');
    expect(body).toContain('--allow-read');
    expect(body).not.toContain('--allow-net');
  });
});
