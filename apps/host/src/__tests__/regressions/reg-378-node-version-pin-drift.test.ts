/**
 * REG-378 — Node.js toolchain version-pin drift guard.
 *
 * WHAT THIS PINS AND WHY
 * ----------------------
 * On 2026-08-09 the repo's Node version was pinned to 22.x on every surface
 * that can choose a Node at all, because those surfaces had silently drifted
 * apart: `.nvmrc` said 22 while `apps/host/package.json` engines said
 * `>=20 <23`, the `Dockerfile` built and RAN production on `node:20-alpine`,
 * and four GitHub Actions workflows still provisioned Node 20 (one used the
 * floating alias `lts/*`, which resolves to whatever the runner image ships
 * that week). Nothing in the repo related those files to each other, so each
 * one could move independently and NOTHING failed — the divergence was only
 * ever found by a hand audit, and a hand audit rots the moment it is written.
 *
 * This suite is that audit, mechanised. It re-derives every pin from the files
 * themselves on each run and fails if any of them stops saying 22:
 *
 *   (a) every `.github/workflows/*.yml` Node pin resolves to major 22;
 *   (b) no floating alias (`lts/*`, `latest`, `node`, `*`, `current`) is used;
 *   (c) every tracked `package.json` declares a 22-ONLY `engines.node` range;
 *   (d) every `FROM node:` line in every tracked Dockerfile is a node:22 base;
 *   (e) `.nvmrc` reads 22 (and any sibling `.node-version`/`.tool-versions`
 *       that ever appears must agree).
 *
 * Two things this suite deliberately does BEYOND a literal re-read:
 *
 *   1. WORKFLOW `env:` DOES NOT CROSS FILES. `node-version: ${{ env.NODE_VERSION }}`
 *      is only meaningful if NODE_VERSION is defined in THAT workflow file
 *      (workflow-level `env:` or the referencing job's `env:`). GitHub Actions
 *      does not inherit `env:` from ci.yml into a sibling workflow, and
 *      `e2e-suite.yml` carries a comment about exactly this trap because it was
 *      hit. An unresolvable expression silently becomes the EMPTY STRING, which
 *      setup-node then resolves to "whatever the runner image ships" — the same
 *      failure mode as `lts/*`, just invisible. So every expression is resolved
 *      against same-file scope only, and an unresolvable one is a FAILURE, not
 *      a skip.
 *
 *   2. THE EFFECTIVE FLOOR IS NOT 22.0.0. `.npmrc` sets `engine-strict=true`,
 *      which applies to the WHOLE dependency tree, not just our own packages.
 *      The tightest transitive constraint in the current lockfile is
 *      `posthog-node` -> `^20.20.0 || >=22.22.0`, so `npm ci` actually requires
 *      Node >= 22.22.0 even though our own `engines` say `>=22.0.0`. That gap is
 *      documented in `.npmrc`, and this suite RE-DERIVES the floor from
 *      `package-lock.json` and fails if the documented number stops matching —
 *      so a dependency bump that raises the floor cannot rot the comment (or
 *      quietly break `npm ci` on a runner that resolves "22" to an older minor).
 *
 * Non-vacuity: every rule is also exercised against a synthetic MUTATED input
 * and asserted to FAIL. A guard that inspects nothing is not a pass (REG-317).
 *
 * NO network. NO Supabase. NO npm install (the `engine-strict=true` pin above
 * makes `npm ci` fail by design on an off-range local Node). File reads only.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

// vitest runs with cwd = apps/host; everything pinned here lives at the repo
// ROOT (.github/, Dockerfile, .nvmrc, .npmrc, package-lock.json). Anchor to the
// file's own location so the suite is cwd-independent.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');

/** The one number this whole suite exists to defend. */
const PINNED_MAJOR = 22;

// ── Pure helpers (exported shape kept local; exercised directly by the
//    mutation tests below so each rule is provably non-vacuous) ──────────────

const FLOATING_ALIASES = new Set(['lts/*', 'latest', 'node', '*', 'current', 'stable']);

function isFloatingAlias(raw: string): boolean {
  const v = raw.trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  return FLOATING_ALIASES.has(v) || v.startsWith('lts/');
}

/** Strip surrounding quotes from a raw YAML scalar. */
function unquote(raw: string): string {
  return raw.trim().replace(/^['"]|['"]$/g, '');
}

/**
 * Resolve a `node-version` value to a major, using SAME-FILE scope only.
 * Returns a discriminated result rather than throwing so the caller can report
 * every offender in one go instead of dying on the first.
 */
type PinResolution =
  | { ok: true; major: number; resolved: string }
  | {
      ok: false;
      reason: 'floating' | 'unresolved-env' | 'unresolved-input' | 'unparseable';
      resolved: string;
    };

/**
 * The `inputs:` a single .github YAML file declares FOR ITSELF — a composite
 * action's top-level `inputs:`, or a reusable workflow's
 * `on.workflow_call.inputs` / `on.workflow_dispatch.inputs`.
 *
 * `default` is `undefined` when the input declares none. That distinction is
 * the whole point: an input WITH a default has a knowable value when no caller
 * overrides it; an input WITHOUT one is whatever an arbitrary caller passes,
 * which is not a pin at all.
 */
type InputScope = Record<string, { default?: string }>;

function resolveNodePin(
  raw: string,
  envScope: Record<string, unknown>,
  inputScope: InputScope = {},
): PinResolution {
  let value = unquote(String(raw));

  const expr = value.match(/^\$\{\{\s*(?:env|vars)\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/);
  if (expr) {
    const key = expr[1];
    if (!(key in envScope)) {
      // GitHub Actions substitutes an UNDEFINED expression with the empty
      // string. setup-node then behaves like an unpinned `node-version`.
      return { ok: false, reason: 'unresolved-env', resolved: value };
    }
    value = unquote(String(envScope[key]));
  }

  // `${{ inputs.<name> }}` — a composite action's (or reusable workflow's) OWN
  // input. Resolvable ONLY through that same file's declared `default:`, which
  // is the value every caller that does not override it actually gets. This is
  // a real pin and must be checked like one; before this branch existed the
  // repo's first composite action read as `unparseable`.
  //
  // Two shapes stay UNRESOLVED on purpose, because in both of them the
  // effective Node is chosen by an arbitrary caller rather than by this file:
  //   - an input that is not declared here at all;
  //   - a declared input with NO `default:`.
  // Same failure mode as the cross-file `env:` trap — silently "whatever the
  // caller/runner supplies" — so it gets the same verdict: offender, not skip.
  const inputExpr = value.match(/^\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/);
  if (inputExpr) {
    const key = inputExpr[1];
    const declared = inputScope[key];
    if (!declared || declared.default === undefined) {
      return { ok: false, reason: 'unresolved-input', resolved: value };
    }
    value = unquote(String(declared.default));
  }

  if (isFloatingAlias(value)) return { ok: false, reason: 'floating', resolved: value };

  const major = value.match(/^(\d+)(?:[.x].*)?$/);
  if (!major) return { ok: false, reason: 'unparseable', resolved: value };
  return { ok: true, major: Number(major[1]), resolved: value };
}

/**
 * Extract every `node-version` PIN from raw YAML text — a `node-version:` key
 * whose value sits ON THE SAME LINE.
 *
 * A bare `node-version:` with nothing after the colon is an input DECLARATION
 * (`inputs: { node-version: { description: ..., default: ... } }`), not a pin,
 * and contributes nothing. The previous matcher used `\s*` after the colon;
 * `\s` matches `\n`, so it happily ran on to the NEXT line and reported a
 * composite action's `description:` line as an unparseable Node pin. Hence
 * `[^\S\n]*` (horizontal whitespace only) plus a required leading non-space,
 * which cannot cross a line boundary.
 */
function nodeVersionPins(raw: string): string[] {
  return [...raw.matchAll(/^[^\S\n]*node-version:[^\S\n]*(\S.*?)[^\S\n]*$/gm)].map((m) => m[1]);
}

/** Same same-line discipline, for a workflow's own `NODE_VERSION:` env key. */
function nodeVersionEnvValues(raw: string): string[] {
  return [...raw.matchAll(/^[^\S\n]*NODE_VERSION:[^\S\n]*(\S.*?)[^\S\n]*$/gm)].map((m) => m[1]);
}

/**
 * SCREAMING_CASE scalars a file defines for itself, harvested from raw text so
 * the belt-and-braces scan does not depend on the structural walk. Same-line
 * only, for the same reason as `nodeVersionPins`: `KEY:` followed by a nested
 * block is not a scalar assignment and must not be read as one.
 */
function rawEnvScope(raw: string): Record<string, unknown> {
  return Object.fromEntries(
    [...raw.matchAll(/^[^\S\n]*([A-Z_][A-Z0-9_]*):[^\S\n]*(['"]?[\w./*-]+['"]?)[^\S\n]*$/gm)].map(
      (m) => [m[1], m[2]],
    ),
  );
}

/**
 * The `inputs:` scope a .github YAML file declares for itself. Covers both
 * shapes that can pin Node for their callers: a composite action's top-level
 * `inputs:` and a reusable/dispatchable workflow's `on.workflow_call.inputs`
 * (and `on.workflow_dispatch.inputs`). Unparseable YAML yields an EMPTY scope,
 * so an expression against it stays `unresolved-input` — fail closed.
 */
function declaredInputScope(raw: string): InputScope {
  let doc: any;
  try {
    doc = parseYaml(raw);
  } catch {
    return {};
  }
  if (!doc || typeof doc !== 'object') return {};

  // YAML 1.1 folds a bare `on:` key to boolean true; the `yaml` package's
  // default 1.2 core schema keeps it a string. Accept either.
  const on = doc.on ?? doc[true as unknown as string] ?? {};
  const maps = [doc.inputs, on?.workflow_call?.inputs, on?.workflow_dispatch?.inputs];

  const scope: InputScope = {};
  for (const map of maps) {
    if (!map || typeof map !== 'object') continue;
    for (const [name, decl] of Object.entries<any>(map)) {
      const hasDefault = decl && typeof decl === 'object' && 'default' in decl;
      scope[name] = hasDefault ? { default: String(decl.default) } : {};
    }
  }
  return scope;
}

/**
 * Parse an `engines.node` semver range and answer the two questions that
 * matter: what major does it FLOOR at, and can any major other than 22 satisfy
 * it. Deliberately narrow — it understands the shapes this repo actually uses
 * (`>=22.0.0 <23.0.0`, `22.x`, `^22.0.0`) and REJECTS anything else rather than
 * guessing, so a novel range shape trips the guard instead of slipping through.
 */
type EngineRange =
  | { ok: true; floor: [number, number, number]; only22: boolean }
  | { ok: false; reason: string };

function parseEngineNodeRange(range: string): EngineRange {
  const r = range.trim();

  const bounded = r.match(/^>=\s*(\d+)\.(\d+)\.(\d+)\s+<\s*(\d+)\.(\d+)\.(\d+)$/);
  if (bounded) {
    const floorMajor = Number(bounded[1]);
    const ceilMajor = Number(bounded[4]);
    const ceilMinor = Number(bounded[5]);
    const ceilPatch = Number(bounded[6]);
    const only22 =
      floorMajor === PINNED_MAJOR &&
      (ceilMajor === PINNED_MAJOR + 1 && ceilMinor === 0 && ceilPatch === 0);
    return {
      ok: true,
      floor: [floorMajor, Number(bounded[2]), Number(bounded[3])],
      only22,
    };
  }

  const dotX = r.match(/^(\d+)\.x$/);
  if (dotX) {
    const major = Number(dotX[1]);
    return { ok: true, floor: [major, 0, 0], only22: major === PINNED_MAJOR };
  }

  const caret = r.match(/^\^(\d+)\.(\d+)\.(\d+)$/);
  if (caret) {
    const major = Number(caret[1]);
    return {
      ok: true,
      floor: [major, Number(caret[2]), Number(caret[3])],
      only22: major === PINNED_MAJOR,
    };
  }

  return { ok: false, reason: `unrecognised engines.node range: ${JSON.stringify(range)}` };
}

/**
 * Derive the tightest `>=22.MINOR.PATCH` floor across every package in the
 * lockfile. With `engine-strict=true`, THIS — not our own engines block — is
 * the version below which `npm ci` hard-fails.
 */
function deriveTransitiveFloor(lockJson: string): { floor: string; source: string } | null {
  const lock = JSON.parse(lockJson) as {
    packages?: Record<string, { engines?: { node?: string } }>;
  };
  let best: { minor: number; patch: number; source: string } | null = null;
  for (const [name, meta] of Object.entries(lock.packages ?? {})) {
    const range = meta?.engines?.node;
    if (typeof range !== 'string') continue;
    for (const m of range.matchAll(new RegExp(`>=\\s*${PINNED_MAJOR}\\.(\\d+)\\.(\\d+)`, 'g'))) {
      const minor = Number(m[1]);
      const patch = Number(m[2]);
      if (!best || minor > best.minor || (minor === best.minor && patch > best.patch)) {
        best = { minor, patch, source: name.replace(/^node_modules\//, '') };
      }
    }
  }
  if (!best) return null;
  return { floor: `${PINNED_MAJOR}.${best.minor}.${best.patch}`, source: best.source };
}

// ── File collection ─────────────────────────────────────────────────────────

const WORKFLOW_DIR = join(REPO_ROOT, '.github/workflows');
const GITHUB_DIR = join(REPO_ROOT, '.github');

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort();
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.claude',
  '.vercel',
  'coverage',
  'dist',
  'build',
  'out',
  'playwright-report',
  'test-results',
  'venv',
  '.venv',
  '__pycache__',
]);

/** Bounded recursive walk — deep enough for apps/*, packages/*, python/. */
function walk(dir: string, depth: number, hit: (abs: string, name: string) => void): void {
  if (depth < 0) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(abs, depth - 1, hit);
    else hit(abs, name);
  }
}

/**
 * Directories the walk must never descend into. These name locations INSIDE
 * the repo — so they may only ever be matched against a repo-RELATIVE path
 * (see `repoRelative`), never an absolute one.
 */
const FORBIDDEN_SCAN_FRAGMENTS = [
  '/node_modules/',
  '/.next/',
  '/.claude/',
  '/dist/',
  '/build/',
  '/coverage/',
] as const;

/**
 * `abs` expressed relative to `repoRoot`, forward-slashed and '/'-prefixed so
 * the fragments above anchor on a directory boundary at any depth (including
 * immediately under the root: `/node_modules/x` still matches).
 */
function repoRelative(repoRoot: string, abs: string): string {
  return `/${relative(repoRoot, abs).replace(/\\/g, '/')}`;
}

/**
 * Why a scanned path is illegitimate, or null if it is fine.
 *
 * Pure and root-parameterised on purpose: it is exercised below against
 * synthetic roots so the exclusions are provably enforced even on a machine
 * whose real layout happens to contain none of them.
 */
function scanLeak(repoRoot: string, abs: string): string | null {
  const rel = repoRelative(repoRoot, abs);
  if (rel === '/..' || rel.startsWith('/../')) return 'escaped repo root';
  return FORBIDDEN_SCAN_FRAGMENTS.find((frag) => rel.includes(frag)) ?? null;
}

function dockerfiles(): string[] {
  const found: string[] = [];
  walk(REPO_ROOT, 3, (abs, name) => {
    if (name === 'Dockerfile' || /^Dockerfile\./.test(name) || /\.Dockerfile$/.test(name)) {
      found.push(abs);
    }
  });
  return found.sort();
}

/** Every workspace package.json this repo owns (never node_modules). */
const TRACKED_PACKAGE_JSONS = [
  'package.json',
  'apps/host/package.json',
  'packages/lib/package.json',
  'packages/ui/package.json',
  'eslint-plugin-alfanumrik/package.json',
];

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

/**
 * Re-derive the workspace set from the root package.json's own `workspaces`
 * globs instead of trusting the hardcoded list above. A hardcoded list is a
 * hand audit wearing a test's clothes: add `apps/admin` or `packages/foo`
 * tomorrow and its engines block is unpinned with NOTHING failing — the exact
 * shape of drift this whole suite exists to kill. Supports only the `dir/*`
 * and literal-dir forms this repo actually uses; a novel glob shape throws
 * rather than silently returning a short list.
 */
function discoverWorkspacePackageJsons(): string[] {
  const root = JSON.parse(read('package.json')) as { workspaces?: string[] };
  const globs = root.workspaces ?? [];
  if (globs.length === 0) throw new Error('root package.json declares no workspaces');

  const found = new Set<string>(['package.json']);
  for (const glob of globs) {
    if (glob.includes('**') || (glob.lastIndexOf('*') > 0 && !glob.endsWith('/*'))) {
      throw new Error(`unsupported workspace glob shape: ${JSON.stringify(glob)}`);
    }
    if (glob.endsWith('/*')) {
      const parent = glob.slice(0, -2);
      const abs = join(REPO_ROOT, parent);
      if (!existsSync(abs)) continue;
      for (const name of readdirSync(abs)) {
        if (SKIP_DIRS.has(name)) continue;
        if (!statSync(join(abs, name)).isDirectory()) continue;
        if (existsSync(join(abs, name, 'package.json'))) found.add(`${parent}/${name}/package.json`);
      }
    } else if (existsSync(join(REPO_ROOT, glob, 'package.json'))) {
      found.add(`${glob}/package.json`);
    }
  }
  return [...found].sort();
}

/**
 * Every YAML file anywhere under `.github/`, not just `.github/workflows/`.
 * Composite actions (`.github/actions/<name>/action.yml`) and reusable
 * workflows in subdirs carry `node-version:` keys a workflows-only scan cannot
 * see — and a composite action's pin is just as load-bearing as a workflow's,
 * because every job that `uses:` it inherits that Node.
 */
function githubYamlFiles(): string[] {
  const found: string[] = [];
  walk(GITHUB_DIR, 4, (abs, name) => {
    if (/\.ya?ml$/.test(name)) found.push(abs);
  });
  return found.sort();
}

// ── (a) + (b) Workflow pins ─────────────────────────────────────────────────

describe('REG-378 (a/b) GitHub Actions Node pins', () => {
  it('collects a non-trivial number of workflow Node pins (non-vacuity floor)', () => {
    const files = workflowFiles();
    expect(files.length).toBeGreaterThanOrEqual(20);

    let pins = 0;
    for (const f of files) {
      pins += nodeVersionPins(read(`.github/workflows/${f}`)).length;
    }
    // 25 setup-node pins existed at the 2026-08-09 pin-down. A scan that
    // suddenly sees almost none is broken, not clean.
    expect(pins).toBeGreaterThanOrEqual(20);
  });

  it('gives every actions/setup-node step an explicit node-version', () => {
    const offenders: string[] = [];
    for (const f of workflowFiles()) {
      const doc = parseYaml(read(`.github/workflows/${f}`)) as any;
      for (const [jobName, job] of Object.entries<any>(doc?.jobs ?? {})) {
        for (const [i, step] of (job?.steps ?? []).entries()) {
          if (!/actions\/setup-node/.test(String(step?.uses ?? ''))) continue;
          const nv = step?.with?.['node-version'];
          const nvf = step?.with?.['node-version-file'];
          if (nv === undefined && nvf === undefined) {
            offenders.push(`${f} :: job ${jobName} :: step #${i}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('resolves every workflow Node pin to major 22, using SAME-FILE env scope only', () => {
    // GitHub Actions does NOT inherit workflow-level `env:` across files
    // (see e2e-suite.yml's own comment). An `${{ env.NODE_VERSION }}` whose
    // NODE_VERSION lives only in ci.yml expands to "" and silently unpins.
    const offenders: string[] = [];
    for (const f of workflowFiles()) {
      const raw = read(`.github/workflows/${f}`);
      const doc = parseYaml(raw) as any;
      const topEnv: Record<string, unknown> = doc?.env ?? {};
      const inputScope = declaredInputScope(raw);

      for (const [jobName, job] of Object.entries<any>(doc?.jobs ?? {})) {
        const scope = { ...topEnv, ...(job?.env ?? {}) };
        for (const [i, step] of (job?.steps ?? []).entries()) {
          if (!/actions\/setup-node/.test(String(step?.uses ?? ''))) continue;

          const nvf = step?.with?.['node-version-file'];
          if (nvf !== undefined) {
            // A version FILE is acceptable only if it points at the pinned
            // .nvmrc, which rule (e) independently asserts reads 22.
            if (unquote(String(nvf)) !== '.nvmrc') {
              offenders.push(`${f}::${jobName}#${i} node-version-file=${nvf}`);
            }
            continue;
          }

          const res = resolveNodePin(String(step?.with?.['node-version']), scope, inputScope);
          if (!res.ok) {
            offenders.push(`${f}::${jobName}#${i} ${res.reason} (${res.resolved})`);
          } else if (res.major !== PINNED_MAJOR) {
            offenders.push(`${f}::${jobName}#${i} major ${res.major} (${res.resolved})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds no non-22 Node pin anywhere in the raw workflow text (catches pins the step walk misses)', () => {
    // Belt-and-braces over the structural walk above: matrix entries, reusable
    // workflow inputs, and hand-written `node-version:` keys under a non
    // setup-node step would all be invisible to the walk but are still real
    // pins someone reads and copies.
    const offenders: string[] = [];
    for (const f of workflowFiles()) {
      const raw = read(`.github/workflows/${f}`);
      const scope = rawEnvScope(raw);
      const inputScope = declaredInputScope(raw);
      for (const value of nodeVersionPins(raw)) {
        const res = resolveNodePin(value, scope, inputScope);
        if (!res.ok) offenders.push(`${f}: ${res.reason} (${res.resolved})`);
        else if (res.major !== PINNED_MAJOR) offenders.push(`${f}: major ${res.major}`);
      }
      for (const value of nodeVersionEnvValues(raw)) {
        const res = resolveNodePin(value, {});
        if (!res.ok) offenders.push(`${f}: NODE_VERSION ${res.reason} (${res.resolved})`);
        else if (res.major !== PINNED_MAJOR) offenders.push(`${f}: NODE_VERSION major ${res.major}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('scans EVERY yaml under .github/, not just .github/workflows/ (composite actions count too)', () => {
    // A composite action (`.github/actions/*/action.yml`) or a reusable
    // workflow parked in a subdirectory can pin Node for every job that
    // `uses:` it, and a workflows-only scan is blind to all of it. As of
    // 2026-08-12 this is no longer hypothetical: `.github/actions/
    // setup-node-workspace/action.yml` (the repo's first composite action)
    // provisions Node for six ci.yml jobs, so its `node-version` IS the pin
    // for all of them and a workflows-only scan would see none of it.
    const files = githubYamlFiles();
    // Must at least cover every workflow file the narrower scan sees.
    expect(files.length).toBeGreaterThanOrEqual(workflowFiles().length);

    const offenders: string[] = [];
    for (const abs of files) {
      const raw = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
      const scope = rawEnvScope(raw);
      const inputScope = declaredInputScope(raw);
      for (const value of nodeVersionPins(raw)) {
        const res = resolveNodePin(value, scope, inputScope);
        if (!res.ok) offenders.push(`${abs}: ${res.reason} (${res.resolved})`);
        else if (res.major !== PINNED_MAJOR) offenders.push(`${abs}: major ${res.major}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('governs composite actions through their OWN declared inputs default, and fails them on drift', () => {
    // Non-vacuity for the branch above: prove the composite action really is
    // reached, that its `${{ inputs.node-version }}` really does resolve (not
    // merely "no pins found, therefore clean"), and — the load-bearing half —
    // that flipping its default to a non-22 value or dropping the default
    // makes it an offender. Without these three, the `inputs.` resolution
    // added on 2026-08-12 could be a hole rather than a guard.
    const actions = githubYamlFiles().filter((p) =>
      /[\\/]\.github[\\/]actions[\\/]/.test(p),
    );
    expect(actions.length, 'expected at least one composite action to govern').toBeGreaterThan(0);

    let inputPins = 0;
    for (const abs of actions) {
      const raw = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
      const scope = rawEnvScope(raw);
      const inputScope = declaredInputScope(raw);

      for (const value of nodeVersionPins(raw)) {
        const res = resolveNodePin(value, scope, inputScope);
        expect(res, `${abs} pin ${value}`).toMatchObject({ ok: true });
        expect((res as { major: number }).major, `${abs} pin ${value}`).toBe(PINNED_MAJOR);

        const key = value.match(/^\$\{\{\s*inputs\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/)?.[1];
        if (!key) continue;
        inputPins += 1;

        // MUTATION 1 — the default reverts to the pre-pin-down major.
        expect(resolveNodePin(value, scope, { [key]: { default: '20' } })).toMatchObject({
          ok: true,
          major: 20,
        });
        // MUTATION 2 — the default goes floating.
        expect(resolveNodePin(value, scope, { [key]: { default: 'lts/*' } })).toMatchObject({
          ok: false,
          reason: 'floating',
        });
        // MUTATION 3 — the `default:` line is deleted, so the effective Node
        // becomes whatever an arbitrary caller passes. Not a pin.
        expect(resolveNodePin(value, scope, { [key]: {} })).toMatchObject({
          ok: false,
          reason: 'unresolved-input',
        });
        // MUTATION 4 — the input is renamed/removed out from under the pin.
        expect(resolveNodePin(value, scope, {})).toMatchObject({
          ok: false,
          reason: 'unresolved-input',
        });
      }
    }
    // The whole point of this test is the `${{ inputs.* }}` path; if the repo
    // ever stops exercising it here, say so rather than passing on zero work.
    expect(inputPins, 'no composite-action ${{ inputs.* }} Node pin was exercised').toBeGreaterThan(
      0,
    );
  });

  it('fails end-to-end on a reverted composite-action default (whole chain, in-memory mutation)', () => {
    // The mutations above inject a synthetic scope. This one mutates the REAL
    // file's TEXT and re-runs the entire chain — read -> parseYaml ->
    // declaredInputScope -> nodeVersionPins -> resolveNodePin — so the proof
    // covers the YAML plumbing too, not just the resolver. Purely in memory:
    // nothing is written back to `.github/`.
    const abs = githubYamlFiles().find((p) =>
      /[\\/]\.github[\\/]actions[\\/]setup-node-workspace[\\/]action\.ya?ml$/.test(p),
    );
    expect(abs, 'setup-node-workspace composite action not found by the scan').toBeDefined();
    const raw = readFileSync(abs!, 'utf8').replace(/\r\n/g, '\n');

    const scanFor = (text: string) =>
      nodeVersionPins(text).map((v) => resolveNodePin(v, rawEnvScope(text), declaredInputScope(text)));

    // Shipped state: exactly one pin, resolving to 22 via the declared default.
    expect(scanFor(raw)).toEqual([{ ok: true, major: PINNED_MAJOR, resolved: '22' }]);

    for (const [bad, expected] of [
      ["default: '20'", { ok: true, major: 20, resolved: '20' }],
      ["default: 'lts/*'", { ok: false, reason: 'floating', resolved: 'lts/*' }],
      ["default: 'latest'", { ok: false, reason: 'floating', resolved: 'latest' }],
      ["default: 'node'", { ok: false, reason: 'floating', resolved: 'node' }],
      ["default: '*'", { ok: false, reason: 'floating', resolved: '*' }],
      ['required: false', { ok: false, reason: 'unresolved-input', resolved: '${{ inputs.node-version }}' }],
    ] as const) {
      // Replace ONLY the node-version input's default (it is the first
      // `default:` in the file); `install`'s default must stay untouched.
      const mutated = raw.replace("default: '22'", bad);
      expect(mutated, `mutation ${bad} was a silent no-op`).not.toBe(raw);
      expect(scanFor(mutated), `mutation ${bad}`).toEqual([expected]);
      // ...and the suite's own verdict on that mutated file is OFFENDER.
      const [res] = scanFor(mutated);
      expect(res.ok && res.major === PINNED_MAJOR, `mutation ${bad} must NOT pass`).toBe(false);
    }
  });

  it('reads a bare `node-version:` key as an input DECLARATION, never as a pin', () => {
    // The exact regression: `\s` matches `\n`, so a matcher using `\s*` after
    // the colon ran past the end of the line and reported the NEXT line — an
    // input's `description:` — as an unparseable Node pin. A declaration has
    // no value on its own line and must contribute NO pin at all.
    const declaration = [
      'inputs:',
      '  node-version:',
      "    description: 'Node.js version to install. Callers should pass ${{ env.NODE_VERSION }}.'",
      '    required: false',
      "    default: '22'",
    ].join('\n');
    expect(nodeVersionPins(declaration)).toEqual([]);
    expect(declaredInputScope(declaration)).toEqual({ 'node-version': { default: '22' } });

    // A trailing-whitespace-only value is still a declaration, not a pin.
    expect(nodeVersionPins('  node-version:   \n    default: 22\n')).toEqual([]);

    // ...while a real same-line pin IS still collected, in every shape the
    // repo uses. (If this half broke, the fix above would be a blind spot.)
    expect(nodeVersionPins('        node-version: 22\n')).toEqual(['22']);
    expect(nodeVersionPins("        node-version: '22'\n")).toEqual(["'22'"]);
    expect(nodeVersionPins('        node-version: ${{ env.NODE_VERSION }}\n')).toEqual([
      '${{ env.NODE_VERSION }}',
    ]);
    expect(nodeVersionPins('        node-version: ${{ inputs.node-version }}\n')).toEqual([
      '${{ inputs.node-version }}',
    ]);
    // And a drifted pin on a declaration-shaped block is still caught.
    expect(nodeVersionPins('inputs:\n  node-version:\n    default: 20\nwith:\n  node-version: 20\n')).toEqual(
      ['20'],
    );
  });

  it('rejects the exact drift shapes this pin-down removed (mutation proof)', () => {
    const env = { NODE_VERSION: '22' };
    // The four real pre-2026-08-09 states.
    expect(resolveNodePin('20', env)).toMatchObject({ ok: true, major: 20 });
    expect(resolveNodePin("'20'", env)).toMatchObject({ ok: true, major: 20 });
    expect(resolveNodePin('lts/*', env)).toEqual({ ok: false, reason: 'floating', resolved: 'lts/*' });
    expect(resolveNodePin('latest', env)).toMatchObject({ ok: false, reason: 'floating' });
    expect(resolveNodePin('node', env)).toMatchObject({ ok: false, reason: 'floating' });
    expect(resolveNodePin('*', env)).toMatchObject({ ok: false, reason: 'floating' });
    expect(resolveNodePin('lts/jod', env)).toMatchObject({ ok: false, reason: 'floating' });

    // The cross-file env trap: same expression, no same-file definition.
    expect(resolveNodePin('${{ env.NODE_VERSION }}', {})).toMatchObject({
      ok: false,
      reason: 'unresolved-env',
    });
    expect(resolveNodePin('${{ env.NODE_VERSION }}', env)).toMatchObject({ ok: true, major: 22 });

    // The composite-action trap (added 2026-08-12 with the repo's first
    // composite action): `${{ inputs.<name> }}` resolves ONLY through that
    // action's own declared `default:`. A pin is a pin whichever context it
    // reads from, so every drift shape must still be caught through it.
    const pin = '${{ inputs.node-version }}';
    expect(resolveNodePin(pin, env, { 'node-version': { default: '22' } })).toMatchObject({
      ok: true,
      major: 22,
    });
    expect(resolveNodePin(pin, env, { 'node-version': { default: "'22'" } })).toMatchObject({
      ok: true,
      major: 22,
    });
    // Drift in the default is drift in the pin — six ci.yml jobs would silently
    // move to Node 20.
    expect(resolveNodePin(pin, env, { 'node-version': { default: '20' } })).toMatchObject({
      ok: true,
      major: 20,
    });
    expect(resolveNodePin(pin, env, { 'node-version': { default: 'lts/*' } })).toEqual({
      ok: false,
      reason: 'floating',
      resolved: 'lts/*',
    });
    expect(resolveNodePin(pin, env, { 'node-version': { default: 'latest' } })).toMatchObject({
      ok: false,
      reason: 'floating',
    });
    // Declared but with NO default: the effective version is whatever an
    // arbitrary caller passes, which is not a pin. Must stay an offender.
    expect(resolveNodePin(pin, env, { 'node-version': {} })).toMatchObject({
      ok: false,
      reason: 'unresolved-input',
    });
    // Not declared in this file at all — same verdict, and notably NOT
    // satisfiable by a same-named env var (contexts do not cross).
    expect(resolveNodePin(pin, env, {})).toMatchObject({ ok: false, reason: 'unresolved-input' });
    expect(resolveNodePin(pin, { 'node-version': '22' }, {})).toMatchObject({
      ok: false,
      reason: 'unresolved-input',
    });
    // And the env path is unchanged by any of this: an inputs scope must not
    // rescue an unresolved `env.` expression.
    expect(resolveNodePin('${{ env.NODE_VERSION }}', {}, { NODE_VERSION: { default: '22' } })).toMatchObject(
      { ok: false, reason: 'unresolved-env' },
    );

    // And the good shapes still pass.
    expect(resolveNodePin("'22'", env)).toMatchObject({ ok: true, major: 22 });
    expect(resolveNodePin('22', env)).toMatchObject({ ok: true, major: 22 });
    expect(resolveNodePin('22.x', env)).toMatchObject({ ok: true, major: 22 });
  });
});

// ── (c) package.json engines ────────────────────────────────────────────────

describe('REG-378 (c) package.json engines.node is 22-only', () => {
  it('declares a 22-only engines.node in every tracked package.json', () => {
    const offenders: string[] = [];
    for (const rel of TRACKED_PACKAGE_JSONS) {
      expect(existsSync(join(REPO_ROOT, rel)), `${rel} must exist`).toBe(true);
      const pkg = JSON.parse(read(rel)) as { engines?: { node?: string } };
      const range = pkg.engines?.node;
      if (typeof range !== 'string') {
        offenders.push(`${rel}: no engines.node`);
        continue;
      }
      const parsed = parseEngineNodeRange(range);
      if (!parsed.ok) offenders.push(`${rel}: ${parsed.reason}`);
      else if (!parsed.only22) offenders.push(`${rel}: not 22-only -> ${range}`);
    }
    expect(offenders).toEqual([]);
  });

  it('pins EVERY workspace the root package.json declares, not a hand-copied list', () => {
    // Re-derived from the `workspaces` globs on each run. If someone adds
    // `apps/admin` or `packages/analytics`, the hardcoded TRACKED_PACKAGE_JSONS
    // above would silently stop being the full set and the new workspace would
    // ship with no engines pin and nothing failing. This is the only test that
    // can notice that.
    const discovered = discoverWorkspacePackageJsons();
    expect(discovered.length).toBeGreaterThanOrEqual(2); // non-vacuity
    expect(discovered).toEqual([...TRACKED_PACKAGE_JSONS].sort());
  });

  it('rejects the pre-pin `>=20.0.0 <23.0.0` range and other non-22 shapes (mutation proof)', () => {
    // apps/host's literal pre-2026-08-09 value.
    expect(parseEngineNodeRange('>=20.0.0 <23.0.0')).toMatchObject({ ok: true, only22: false });
    expect(parseEngineNodeRange('>=22.0.0 <24.0.0')).toMatchObject({ ok: true, only22: false });
    expect(parseEngineNodeRange('20.x')).toMatchObject({ ok: true, only22: false });
    expect(parseEngineNodeRange('^20.0.0')).toMatchObject({ ok: true, only22: false });
    // A range shape the parser does not understand must FAIL, never pass by
    // default — an unknown shape is exactly how a wide range sneaks back in.
    expect(parseEngineNodeRange('>=22')).toMatchObject({ ok: false });
    expect(parseEngineNodeRange('*')).toMatchObject({ ok: false });
    // And the shipped shape passes.
    expect(parseEngineNodeRange('>=22.0.0 <23.0.0')).toMatchObject({ ok: true, only22: true });
    expect(parseEngineNodeRange('22.x')).toMatchObject({ ok: true, only22: true });
  });
});

// ── (d) Dockerfile base images ──────────────────────────────────────────────

describe('REG-378 (d) Dockerfile node base images', () => {
  it('uses a node:22 base for every Node stage of every tracked Dockerfile', () => {
    const files = dockerfiles();
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    let nodeStages = 0;
    for (const abs of files) {
      const raw = readFileSync(abs, 'utf8').replace(/\r\n/g, '\n');
      for (const m of raw.matchAll(/^\s*FROM\s+(?:--platform=\S+\s+)?node:([^\s]+)/gim)) {
        nodeStages += 1;
        const tag = m[1];
        const major = tag.match(/^(\d+)/);
        if (!major) offenders.push(`${abs}: floating/undecipherable node tag "${tag}"`);
        else if (Number(major[1]) !== PINNED_MAJOR) {
          offenders.push(`${abs}: node:${tag} (major ${major[1]})`);
        }
      }
    }
    expect(offenders).toEqual([]);
    // The root Dockerfile is a 3-stage build (deps / builder / runner). If this
    // ever reads 0, the scan stopped finding the Dockerfile and is vacuous.
    expect(nodeStages).toBeGreaterThanOrEqual(3);
  });

  it('flags a reverted node:20 stage (mutation proof)', () => {
    const raw = read('Dockerfile');
    const reverted = raw.replace(/node:22-alpine/g, 'node:20-alpine');
    expect(reverted).not.toBe(raw); // guard against a silent no-op replace
    const majors = [...reverted.matchAll(/^\s*FROM\s+node:(\d+)/gim)].map((m) => Number(m[1]));
    expect(majors.length).toBeGreaterThanOrEqual(3);
    expect(majors.every((m) => m === PINNED_MAJOR)).toBe(false);
  });
});

// ── Scan hygiene: the exclusions are load-bearing, not decorative ───────────

describe('REG-378 scan exclusions', () => {
  it('never walks build artefacts, dependencies, or agent worktrees', () => {
    // A guard that scans `node_modules/`, `.next/` or `.claude/worktrees/` is
    // not a stricter guard — it is a FLAKY one, failing on files this repo does
    // not author and cannot fix. Assert the walk's output, not just the
    // constant, so a future edit to SKIP_DIRS is caught by behaviour.
    const scanned = dockerfiles();
    expect(scanned.length).toBeGreaterThan(0);
    for (const abs of scanned) {
      expect(scanLeak(REPO_ROOT, abs), `scan leaked (${abs})`).toBeNull();
    }
  });

  it('judges leakage on the repo-RELATIVE path, so a checkout that LIVES in .claude/worktrees is not its own violation', () => {
    // The regression this shape fixes (2026-08-11). The fragments above name
    // directories *inside* the repo, but they used to be matched against the
    // ABSOLUTE path. Every agent worktree is a full checkout whose own root is
    // `<repo>/.claude/worktrees/<name>/`, so REPO_ROOT itself contains
    // `/.claude/worktrees/` — and `<REPO_ROOT>/Dockerfile`, the single most
    // load-bearing file rule (d) exists to read, was reported as a leak into
    // `/.claude/`. The suite failed for every run executed from a worktree,
    // with no defect behind it, while touching nothing in any change set.
    //
    // The guard's INTENT — never descend into a sibling/nested worktree — is
    // preserved exactly and asserted below. What changed is only the frame of
    // reference: "where inside the repo did the walk go", not "what string
    // does this machine's home directory happen to contain".
    const wtRoot = '/home/u/proj/.claude/worktrees/phase4';

    // Its OWN root files are legitimate scan targets, worktree or not.
    expect(scanLeak(wtRoot, `${wtRoot}/Dockerfile`)).toBeNull();
    expect(scanLeak(wtRoot, `${wtRoot}/python/Dockerfile`)).toBeNull();

    // …and every real exclusion still bites, from that same root.
    expect(scanLeak(wtRoot, `${wtRoot}/.claude/worktrees/nested/Dockerfile`)).toBe('/.claude/');
    expect(scanLeak(wtRoot, `${wtRoot}/node_modules/foo/Dockerfile`)).toBe('/node_modules/');
    expect(scanLeak(wtRoot, `${wtRoot}/apps/host/.next/Dockerfile`)).toBe('/.next/');
    expect(scanLeak(wtRoot, `${wtRoot}/packages/ui/dist/Dockerfile`)).toBe('/dist/');
    expect(scanLeak(wtRoot, `${wtRoot}/build/Dockerfile`)).toBe('/build/');
    expect(scanLeak(wtRoot, `${wtRoot}/coverage/Dockerfile`)).toBe('/coverage/');

    // A path that is not under the root at all is a leak of its own kind —
    // a sibling worktree reached by escaping upward would otherwise read as
    // "clean" because it contains no forbidden fragment relative to itself.
    expect(scanLeak(wtRoot, '/home/u/proj/.claude/worktrees/other/Dockerfile')).toBe(
      'escaped repo root',
    );
    expect(scanLeak(wtRoot, '/home/u/elsewhere/Dockerfile')).toBe('escaped repo root');
  });

  it('excludes .claude/worktrees even though real node:20 Dockerfiles live there', () => {
    // This exclusion is not hypothetical. Agent worktrees under
    // `.claude/worktrees/*` are stale full checkouts of this repo and (at the
    // time of the 2026-08-09 pin-down) still carried `FROM node:20-alpine`.
    // Without the `.claude` skip, rule (d) would fail on every machine that has
    // ever run a worktree — a false failure with no defect behind it.
    //
    // NOTE the deliberate asymmetry with the test above: what must be excluded
    // is a worktree *reached from* REPO_ROOT, i.e. `REPO_ROOT/.claude/worktrees/*`.
    // REPO_ROOT itself is always in scope even when it IS a worktree.
    const wt = join(REPO_ROOT, '.claude/worktrees');
    const scanned = dockerfiles();
    for (const abs of scanned) {
      expect(
        repoRelative(REPO_ROOT, abs).startsWith('/.claude/worktrees/'),
        `scan descended into a nested worktree: ${abs}`,
      ).toBe(false);
    }

    if (!existsSync(wt)) return; // worktrees are a local artefact; absent on CI
    for (const name of readdirSync(wt)) {
      const df = join(wt, name, 'Dockerfile');
      if (!existsSync(df)) continue;
      // Non-vacuity: prove there IS something in there the scan would have
      // tripped on, so the exclusion is demonstrably doing work. (When this
      // suite runs FROM a worktree there are usually no nested worktrees to
      // find — which is why the mutation proof above is unconditional.)
      const raw = readFileSync(df, 'utf8');
      if (/^\s*FROM\s+node:/im.test(raw)) {
        expect(scanned.map((p) => p.replace(/\\/g, '/'))).not.toContain(
          df.replace(/\\/g, '/'),
        );
        return;
      }
    }
  });

  it('reaches python/Dockerfile but finds no node stage there (scanned, not excluded)', () => {
    // python/Dockerfile is INSIDE the scan's reach on purpose. It is a
    // python:3.12-slim image with zero `FROM node:` lines, so it contributes
    // nothing to rule (d) and can never false-fail it — while remaining
    // governed by the 22 pin the day anyone adds a Node build stage to it.
    // Excluding it by path would have created exactly that blind spot.
    const rel = join(REPO_ROOT, 'python/Dockerfile');
    if (!existsSync(rel)) return; // python service is optional in some checkouts
    expect(dockerfiles().map((p) => p.replace(/\\/g, '/'))).toContain(
      rel.replace(/\\/g, '/'),
    );
    const raw = readFileSync(rel, 'utf8');
    expect([...raw.matchAll(/^\s*FROM\s+node:/gim)]).toHaveLength(0);
    expect(raw).toMatch(/^\s*FROM\s+python:/im); // it really is the python image
  });
});

// ── (e) .nvmrc and friends ──────────────────────────────────────────────────

describe('REG-378 (e) .nvmrc', () => {
  it('reads 22 with no floating alias and no stray carriage return', () => {
    const rawBytes = readFileSync(join(REPO_ROOT, '.nvmrc'), 'utf8');
    // .gitattributes pins .nvmrc to eol=lf precisely because nvm/fnm read the
    // file as a bare token: "22\r" is not "22".
    expect(rawBytes).not.toContain('\r');

    const value = rawBytes.trim();
    expect(isFloatingAlias(value)).toBe(false);

    // Accepts the bare major (`22`, today's value) OR a fully-qualified 22.x
    // pin (`22.23.2`). Deliberately NOT `toBe('22')`: the recommended fix for
    // the engine-strict floor problem documented below is to pin .nvmrc to an
    // exact minor at/above the transitive floor and point setup-node at it via
    // `node-version-file: .nvmrc` — an equality assertion here would BLOCK the
    // remediation while pinning nothing extra. Every non-22 value and every
    // floating alias is still rejected.
    const res = resolveNodePin(value, {});
    expect(res, `.nvmrc = ${JSON.stringify(value)}`).toMatchObject({ ok: true });
    expect((res as { major: number }).major).toBe(PINNED_MAJOR);
    expect(value).toMatch(/^22(\.\d+\.\d+)?$/);
  });

  it('would still reject a reverted or floating .nvmrc under the relaxed shape (mutation proof)', () => {
    for (const bad of ['20', '20.19.0', 'lts/*', 'lts/jod', 'node', 'latest', '*', '23.1.0']) {
      const res = resolveNodePin(bad, {});
      const accepted = res.ok && res.major === PINNED_MAJOR && /^22(\.\d+\.\d+)?$/.test(bad);
      expect(accepted, `.nvmrc value ${bad} must NOT be accepted`).toBe(false);
    }
    for (const good of ['22', '22.23.2']) {
      const res = resolveNodePin(good, {});
      expect(res.ok && res.major === PINNED_MAJOR, `${good} must be accepted`).toBe(true);
    }
  });

  it('keeps any sibling version file in agreement (no second source of truth)', () => {
    for (const rel of ['.node-version', '.tool-versions']) {
      const abs = join(REPO_ROOT, rel);
      if (!existsSync(abs)) continue;
      const raw = readFileSync(abs, 'utf8');
      const nodeLine =
        rel === '.tool-versions'
          ? (raw.match(/^\s*nodejs\s+(\S+)/m)?.[1] ?? '')
          : raw.trim();
      expect(isFloatingAlias(nodeLine), `${rel} uses a floating alias`).toBe(false);
      expect(nodeLine.startsWith(String(PINNED_MAJOR)), `${rel} = ${nodeLine}`).toBe(true);
    }
  });
});

// ── engine-strict + the effective (transitive) floor ────────────────────────

describe('REG-378 engine-strict floor', () => {
  it('keeps engine-strict=true so a wrong Node cannot silently produce a build', () => {
    const npmrc = read('.npmrc');
    expect(npmrc).toMatch(/^\s*engine-strict\s*=\s*true\s*$/m);
  });

  it('keeps the documented effective floor in sync with the lockfile (re-derived, not restated)', () => {
    // engine-strict applies to the WHOLE tree: the tightest transitive
    // >=22.x constraint is the real `npm ci` floor, NOT our own >=22.0.0.
    const derived = deriveTransitiveFloor(read('package-lock.json'));
    expect(derived, 'no >=22.x engines constraint found in lockfile').not.toBeNull();

    const npmrc = read('.npmrc');
    expect(
      npmrc.includes(derived!.floor),
      `.npmrc documents a stale effective Node floor. Lockfile now requires >= ${derived!.floor} ` +
        `(tightest: ${derived!.source}). Update the .npmrc comment (and re-check that every ` +
        `runner/base image resolving "22" lands at or above it).`,
    ).toBe(true);
    expect(npmrc).toContain(derived!.source);

    // The gap this documents is real: our declared floor is BELOW the tree's.
    const declared = parseEngineNodeRange(
      (JSON.parse(read('package.json')) as { engines: { node: string } }).engines.node,
    );
    expect(declared.ok).toBe(true);
  });

  it('keeps the transitive floor SATISFIABLE inside the 22-only window we declare', () => {
    // The pin is only coherent while some 22.x version satisfies BOTH our own
    // `>=22.0.0 <23.0.0` and the whole tree's tightest constraint. The day a
    // dependency raises its floor past 22.x, `npm ci` becomes unsatisfiable on
    // EVERY environment simultaneously and the correct response is to revisit
    // the pin — not to discover it from a red CI run with an EBADENGINE dump.
    const derived = deriveTransitiveFloor(read('package-lock.json'))!;
    const [fMaj, fMin, fPatch] = derived.floor.split('.').map(Number);
    expect(fMaj).toBe(PINNED_MAJOR);

    const declared = parseEngineNodeRange(
      (JSON.parse(read('package.json')) as { engines: { node: string } }).engines.node,
    );
    expect(declared.ok).toBe(true);
    const [dMaj, dMin, dPatch] = (declared as { floor: [number, number, number] }).floor;

    // Our declared floor must not be ABOVE the tree's (that would be fine but
    // would make the .npmrc note wrong), and the tree's floor must sit inside
    // our 22-only ceiling. Both directions asserted so either drift is loud.
    const declaredNum = dMaj * 1e6 + dMin * 1e3 + dPatch;
    const derivedNum = fMaj * 1e6 + fMin * 1e3 + fPatch;
    expect(derivedNum).toBeGreaterThanOrEqual(declaredNum);
    expect(fMaj).toBeLessThan(PINNED_MAJOR + 1);

    // And the honest headroom statement: this floor is what makes a runner
    // resolving `22` to an OLD minor a pipeline-wide `npm ci` failure. If it
    // ever climbs to 22.90+, "latest 22.x" stops being comfortably above it.
    expect(fMin).toBeLessThan(90);
  });

  it('re-derives the tightest floor rather than taking the first match (mutation proof)', () => {
    const synthetic = JSON.stringify({
      packages: {
        'node_modules/a': { engines: { node: '>=22.5.0' } },
        'node_modules/b': { engines: { node: '^20.20.0 || >=22.22.0' } },
        'node_modules/c': { engines: { node: '>=22.12.0' } },
        'node_modules/d': { engines: { node: '>=18.0.0' } },
      },
    });
    expect(deriveTransitiveFloor(synthetic)).toEqual({ floor: '22.22.0', source: 'b' });
    expect(deriveTransitiveFloor(JSON.stringify({ packages: {} }))).toBeNull();
  });
});
