import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * REG-421 — `hermetic_supabase_client_seam_per_call_site` (2026-08-23).
 *
 * ── The incident this pins ─────────────────────────────────────────────────
 * `apps/host/src/__tests__/school-admin/parents-page-load-states.test.tsx` was
 * a merge-time flake. Root cause, measured 2026-08-23:
 *
 *   `vi.mock` is keyed by SPECIFIER STRING, not by resolved module identity.
 *   The test mocked `@alfanumrik/lib/supabase`. The component's fetcher reached
 *   `packages/lib/src/authed-fetch.ts:25`, which imports the client from a
 *   DIFFERENT specifier — `@alfanumrik/lib/supabase-client`. That specifier was
 *   never mocked, so `authedFetch()` got the REAL lazy client Proxy and awaited
 *   a REAL `supabase.auth.getSession()` (localStorage read + a possible token
 *   refresh) inside the render window.
 *
 *   Diagnostic that settled it: `mockedGetSessionCallCount: 0` while
 *   `realClientCtor: "bound SupabaseClient"`. The mock was live and simply
 *   never consulted.
 *
 * Under `Unit Tests (shard N/4)` — four vitest processes on one box, and a
 * REQUIRED check at merge time — that unmocked round trip is a coin flip. This
 * is the same failure family as REG-168 (hermetic LLM mock layer), and the same
 * remedy applies: the guarantee cannot live in `setup.ts` (a global `vi.mock`
 * for `supabase-client` would break the files that test the real client), so it
 * is enforced PER CALL SITE and pinned by a static gate.
 *
 * ── What this file asserts ────────────────────────────────────────────────
 *   1. ANCHOR — the seam still has the shape the gate assumes: `authed-fetch.ts`
 *      exists, calls `auth.getSession()`, and imports the client from
 *      `@alfanumrik/lib/supabase-client` (NOT `@alfanumrik/lib/supabase`).
 *      If that ever changes, this gate must be re-derived rather than trusted.
 *   2. NON-VACUITY — the analyzer actually resolves the monorepo's aliases and
 *      classifies a known-guarded file as guarded. A scanner that silently
 *      matches nothing is indistinguishable from a clean repo; this is what
 *      tells them apart.
 *   3. RATCHET — no component-render test may NEWLY reach `authed-fetch`
 *      without mocking `…/supabase-client` or `…/authed-fetch`. The 25
 *      pre-existing call sites are frozen in KNOWN_UNGUARDED and may only
 *      shrink.
 *
 * ── Reading the analyzer ──────────────────────────────────────────────────
 * A test is a VIOLATION when, after deleting every module it `vi.mock`s from
 * the import graph, `packages/lib/src/authed-fetch.ts` is still reachable from
 * something it imports — and it has not mocked the client seam itself. Cutting
 * the mocked modules is the load-bearing part: a test that stubs the hook or
 * page-level fetcher in front of `authedFetch` is genuinely hermetic and must
 * not be flagged.
 *
 * `import type` / `export type` specifiers are erased before graph building —
 * they carry no runtime edge.
 *
 * ── How to clear an entry ─────────────────────────────────────────────────
 * Add, alongside the existing supabase mock:
 *
 *     vi.mock('@alfanumrik/lib/supabase-client', () => ({
 *       supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },
 *     }));
 *
 * ...then DELETE the file from KNOWN_UNGUARDED. The last test in this file
 * fails if a fixed entry is left behind, so the baseline cannot rot upward.
 */

/* ────────────────────────────── repo layout ────────────────────────────── */

function findRepoRoot(): string {
  // Marker must be `packages/` — the setup.ts monorepo shim remaps missing
  // `supabase/...` reads under apps/host to the repo root, so a supabase-based
  // probe would falsely resolve the HOST root (same reasoning as REG-353).
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'packages', 'lib', 'src'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('repo root (packages/lib/src) not found');
}

const REPO = findRepoRoot().split(path.sep).join('/');
const abs = (...parts: string[]) => path.resolve(REPO, ...parts).split(path.sep).join('/');
const rel = (f: string) => f.replace(`${REPO}/`, '');

const SOURCE_ROOTS = [abs('apps/host/src'), abs('packages/lib/src'), abs('packages/ui/src')];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];

/** The module whose mere presence on a render path means a real client call. */
const SEAM_FILES = [
  abs('packages/lib/src/authed-fetch.ts'),
  // Historical path kept as a thin re-export for the ~16 school-admin importers.
  abs('packages/lib/src/school-admin/authed-fetch.ts'),
].filter((f) => fs.existsSync(f));

/** A `vi.mock` of either of these cuts the seam. Matched against the SPECIFIER. */
const GUARD_SPECIFIER = /(^|\/)(supabase-client|authed-fetch)$/;

/* ─────────────────────────── module-graph builder ──────────────────────── */

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, acc);
    } else if (EXTENSIONS.includes(path.extname(entry.name))) {
      acc.push(full);
    }
  }
  return acc;
}

const ALL_FILES = SOURCE_ROOTS.flatMap((r) => walk(r));

/**
 * ⚠️ Resolution is answered from THIS SET, never from `fs.existsSync`.
 *
 * `src/__tests__/setup.ts` monkey-patches `fs.existsSync` with a monorepo shim
 * that, for any missing `apps/host/src/app/<x>` path, silently retries
 * `apps/host/src/app/(student)/<x>` and reports the ORIGINAL path as existing.
 * An `existsSync`-based resolver therefore returns a phantom node for every
 * route-group page (`@/app/learn/[subject]/[chapter]/page` and friends) — a
 * node with no edges, so the whole subgraph behind it goes invisible and the
 * gate under-reports. That is exactly how a static gate rots into a no-op:
 * measured 2026-08-23, it dropped one real offender relative to the same
 * analyzer run outside vitest. Membership in a directory walk cannot be
 * spoofed by the shim, so that is what this uses.
 */
const FILE_SET = new Set(ALL_FILES);

// Mirrors the `resolve.alias` block in the repo-root vitest.config.ts.
const ALIASES: Array<[string, string]> = [
  ['@alfanumrik/lib/', `${abs('packages/lib/src')}/`],
  ['@alfanumrik/ui/', `${abs('packages/ui/src')}/`],
  ['@/', `${abs('apps/host/src')}/`],
];

// Next.js route groups: `@/app/quiz/page` lives at `app/(student)/quiz/page.tsx`.
const APP_ROUTE_GROUPS = fs
  .readdirSync(abs('apps/host/src/app'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name.startsWith('('))
  .map((d) => d.name);

function resolveToFile(base: string): string | null {
  if (FILE_SET.has(base)) return base;
  for (const e of EXTENSIONS) if (FILE_SET.has(base + e)) return base + e;
  for (const e of EXTENSIONS) if (FILE_SET.has(`${base}/index${e}`)) return `${base}/index${e}`;
  return null;
}

function resolveSpecifier(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) {
    return resolveToFile(path.resolve(path.dirname(fromFile), spec).split(path.sep).join('/'));
  }
  for (const [prefix, target] of ALIASES) {
    if (!spec.startsWith(prefix)) continue;
    const base = target + spec.slice(prefix.length);
    const direct = resolveToFile(base);
    if (direct) return direct;
    if (base.includes('/apps/host/src/app/')) {
      const tail = base.split('/apps/host/src/app/')[1];
      for (const group of APP_ROUTE_GROUPS) {
        const hit = resolveToFile(abs('apps/host/src/app', group, tail));
        if (hit) return hit;
      }
    }
    return null;
  }
  return null; // bare npm package — not part of the first-party graph
}

/** Specifiers that survive the TS→JS transform (type-only imports are erased). */
function runtimeImportSpecifiers(file: string): string[] {
  const source = fs
    .readFileSync(file, 'utf8')
    .replace(/^\s*(?:import|export)\s+type\s[\s\S]*?from\s*['"][^'"]+['"]/gm, '');
  const found = new Set<string>();
  for (const m of source.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
    found.add(m[1]);
  }
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) found.add(m[1]);
  return [...found];
}

const isTestFile = (f: string) => /[\\/]__tests__[\\/]|\.(test|spec)\.[tj]sx?$/.test(f);

const FORWARD_EDGES = new Map<string, Set<string>>();
for (const file of ALL_FILES.filter((f) => !isTestFile(f))) {
  const deps = new Set<string>();
  for (const spec of runtimeImportSpecifiers(file)) {
    const resolved = resolveSpecifier(spec, file);
    if (resolved) deps.add(resolved);
  }
  FORWARD_EDGES.set(file, deps);
}

/** BFS from `roots` to any seam file, treating `cut` modules as absent. */
function reachesSeam(roots: string[], cut: Set<string>): string | null {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur) || cut.has(cur)) continue;
    seen.add(cur);
    if (SEAM_FILES.includes(cur)) return cur;
    for (const dep of FORWARD_EDGES.get(cur) ?? []) {
      if (!seen.has(dep) && !cut.has(dep)) queue.push(dep);
    }
  }
  return null;
}

interface Classified {
  test: string;
  guarded: boolean;
}

function classifyRenderTests(): Classified[] {
  const renderTests = ALL_FILES
    .filter((f) => isTestFile(f) && /\.(test|spec)\.tsx?$/.test(f))
    .filter((f) => /\brender\s*\(/.test(fs.readFileSync(f, 'utf8')));

  const out: Classified[] = [];
  for (const testFile of renderTests) {
    const source = fs.readFileSync(testFile, 'utf8');
    const mockSpecs = [...source.matchAll(/vi\.mock\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);

    const cut = new Set<string>();
    for (const spec of mockSpecs) {
      const resolved = resolveSpecifier(spec, testFile);
      if (resolved) cut.add(resolved);
    }

    const roots: string[] = [];
    for (const spec of runtimeImportSpecifiers(testFile)) {
      const resolved = resolveSpecifier(spec, testFile);
      if (resolved && !cut.has(resolved)) roots.push(resolved);
    }

    if (!reachesSeam(roots, cut)) continue;
    out.push({ test: rel(testFile), guarded: mockSpecs.some((s) => GUARD_SPECIFIER.test(s)) });
  }
  return out;
}

const CLASSIFIED = classifyRenderTests();
const UNGUARDED = CLASSIFIED.filter((c) => !c.guarded).map((c) => c.test).sort();
const GUARDED = CLASSIFIED.filter((c) => c.guarded).map((c) => c.test).sort();

/**
 * Frozen baseline, measured 2026-08-23. Component-render tests that reach
 * `authed-fetch` without mocking the client seam. RATCHET: entries may be
 * REMOVED (by adding the mock) but never added.
 */
const KNOWN_UNGUARDED: readonly string[] = [
  'apps/host/src/__tests__/app/alfa-momentum-wave4a-learn-exams.test.tsx',
  'apps/host/src/__tests__/app/leaderboard-band-envelope-seam.test.tsx',
  'apps/host/src/__tests__/app/leaderboard-data-load-error.test.tsx',
  'apps/host/src/__tests__/app/learn-chapter-load-error.test.tsx',
  'apps/host/src/__tests__/chatbubble_perf.test.tsx',
  'apps/host/src/__tests__/components/chapter-readiness-card.test.tsx',
  'apps/host/src/__tests__/components/dashboard/ReviewsDueCard.test.tsx',
  'apps/host/src/__tests__/components/dashboard/RevisionRail.test.tsx',
  'apps/host/src/__tests__/components/dashboard/momentum-wave2-visuals.test.tsx',
  'apps/host/src/__tests__/components/navigation/GlobalAppLayout.test.tsx',
  'apps/host/src/__tests__/components/practice/PracticeCenter.test.tsx',
  'apps/host/src/__tests__/components/quiz/QuizResults.flashcard-grade.test.tsx',
  'apps/host/src/__tests__/components/quiz/QuizResults.goal-flag.test.tsx',
  'apps/host/src/__tests__/components/quiz/QuizResults.reread-cta.test.tsx',
  'apps/host/src/__tests__/components/teacher/grading-queue.test.tsx',
  'apps/host/src/__tests__/foxy-chat-bubble-grounding.test.tsx',
  'apps/host/src/__tests__/foxy/foxy-page-snapshot.test.tsx',
  'apps/host/src/__tests__/foxy/foxy-panel.test.tsx',
  'apps/host/src/__tests__/foxy/study-artifact-sheet.test.tsx',
  'apps/host/src/__tests__/parent-shell.test.tsx',
  'apps/host/src/__tests__/school-admin/command-center-flag-gate.test.tsx',
  'apps/host/src/__tests__/school-admin/command-center-setup-checklist.test.tsx',
  'apps/host/src/__tests__/school-admin/command-center-subtitle.test.tsx',
  'apps/host/src/__tests__/school-admin/pulse-flag-gate.test.tsx',
  'apps/host/src/__tests__/school-admin/reports-page-class-options.test.tsx',
];

/* ──────────────────────────────── 1. ANCHOR ────────────────────────────── */

describe('REG-421 (1) — the seam still has the shape this gate assumes', () => {
  it('authed-fetch.ts exists and is the only client-calling fetch helper the gate tracks', () => {
    expect(SEAM_FILES.length).toBeGreaterThan(0);
    expect(SEAM_FILES).toContain(abs('packages/lib/src/authed-fetch.ts'));
  });

  it('authed-fetch imports the client from `@alfanumrik/lib/supabase-client`, NOT `@alfanumrik/lib/supabase`', () => {
    // This single line is the whole reason the flake existed: mocking
    // `@alfanumrik/lib/supabase` does not intercept it.
    const src = fs.readFileSync(abs('packages/lib/src/authed-fetch.ts'), 'utf8');
    expect(src).toMatch(/from\s+['"]@alfanumrik\/lib\/supabase-client['"]/);
    expect(src).not.toMatch(/from\s+['"]@alfanumrik\/lib\/supabase['"]/);
  });

  it('authed-fetch really does perform a live session read (so reaching it is a real hazard)', () => {
    const src = fs.readFileSync(abs('packages/lib/src/authed-fetch.ts'), 'utf8');
    expect(src).toContain('supabase.auth.getSession()');
  });

  it('supabase.ts re-exports the client rather than owning it — the specifier trap', () => {
    // If supabase.ts ever owned its own createClient, mocking it WOULD be
    // sufficient and this gate would be over-strict. It does not.
    const src = fs.readFileSync(abs('packages/lib/src/supabase.ts'), 'utf8');
    expect(src).toMatch(/from\s+['"]\.\/supabase-client['"]/);
  });
});

/* ────────────────────────────── 2. NON-VACUITY ─────────────────────────── */

describe('REG-421 (2) — the analyzer is live, not silently matching nothing', () => {
  it('resolves the monorepo aliases and builds a non-trivial first-party graph', () => {
    expect(ALL_FILES.length).toBeGreaterThan(1000);
    // A graph with no edges means alias resolution broke and every later
    // assertion would pass vacuously.
    const edgeCount = [...FORWARD_EDGES.values()].reduce((n, s) => n + s.size, 0);
    expect(edgeCount).toBeGreaterThan(1000);
  });

  it('finds component-render tests that reach the seam at all', () => {
    expect(CLASSIFIED.length).toBeGreaterThan(0);
  });

  it('classifies a known-FIXED call site as guarded', () => {
    // parents-page-load-states.test.tsx is the file the incident was found on;
    // its fix added the `@alfanumrik/lib/supabase-client` mock. If the analyzer
    // stops seeing it as guarded, the guard detection is broken.
    expect(GUARDED).toContain('apps/host/src/__tests__/school-admin/parents-page-load-states.test.tsx');
  });

  it('resolves route-group pages, which the setup.ts fs shim would otherwise hide', () => {
    // `@/app/learn/[subject]/[chapter]/page` lives at app/(student)/... . If this
    // regresses to an existsSync-based resolver, it resolves to a phantom
    // non-existent path with no edges and the gate silently under-reports.
    const resolved = resolveSpecifier('@/app/learn/[subject]/[chapter]/page', abs('apps/host/src/x.ts'));
    expect(resolved).not.toBeNull();
    expect(resolved).toContain('/app/(student)/learn/');
    expect(FILE_SET.has(resolved!)).toBe(true);
  });

  it('detects a MISSING guard — synthetic control', () => {
    // Same classification logic, run over a hand-built graph where the seam is
    // reachable and nothing is cut. Proves the violation branch can fire.
    const seam = SEAM_FILES[0];
    expect(reachesSeam([seam], new Set())).toBe(seam);
    expect(reachesSeam([seam], new Set([seam]))).toBeNull();
  });
});

/* ─────────────────────────────── 3. RATCHET ────────────────────────────── */

describe('REG-421 (3) — per-call-site hermetic client seam (ratchet)', () => {
  it('no component-render test NEWLY reaches authed-fetch without mocking the client seam', () => {
    const added = UNGUARDED.filter((t) => !KNOWN_UNGUARDED.includes(t));
    expect(
      added,
      added.length === 0
        ? ''
        : `REG-421: ${added.length} component-render test(s) reach ` +
          `packages/lib/src/authed-fetch.ts without mocking '@alfanumrik/lib/supabase-client' ` +
          `or '…/authed-fetch'. That means authedFetch() will build the REAL Supabase client ` +
          `and await a REAL auth.getSession() during render — the parents-page flake ` +
          `(2026-08-23). Add:\n\n` +
          `  vi.mock('@alfanumrik/lib/supabase-client', () => ({\n` +
          `    supabase: { auth: { getSession: async () => ({ data: { session: null }, error: null }) } },\n` +
          `  }));\n\nOffenders:\n  ${added.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the baseline only shrinks — fixed entries must be deleted from KNOWN_UNGUARDED', () => {
    const stale = KNOWN_UNGUARDED.filter((t) => !UNGUARDED.includes(t));
    expect(
      stale,
      stale.length === 0
        ? ''
        : `REG-421: ${stale.length} baseline entr(y|ies) no longer violate — either the ` +
          `client-seam mock was added or the file was renamed/deleted. Remove them from ` +
          `KNOWN_UNGUARDED so the ratchet cannot rot upward:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });

  it('the frozen baseline is exactly the measured set (25 as of 2026-08-23)', () => {
    expect(UNGUARDED).toEqual([...KNOWN_UNGUARDED].sort());
  });
});
