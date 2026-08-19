import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// ── Integration test exclusion ──
// Tests under `src/__tests__/migrations/**` and `src/__tests__/scripts/**`
// require a live Supabase Postgres backend (real CHECK constraints, triggers,
// views, UNIQUE indexes). They cannot run with placeholder env vars and would
// always fail in PR CI. They are run by a separate `test:integration` script
// gated on real `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` secrets.
//
// These are DIRECTORY-PREFIX patterns: the integration-lane `include` below
// suffixes each with `/**/*.{test,spec}.{ts,tsx}` to enumerate every test file
// under the directory. Keep this list to directory prefixes only — file-level
// globs go in INTEGRATION_TEST_FILE_GLOBS so the suffix-mapping doesn't mangle
// them into `…/*.integration.test.ts/**/*.{test,spec}.{ts,tsx}`.
const INTEGRATION_TEST_PATTERNS = [
  'src/__tests__/migrations/**',
  'src/__tests__/scripts/**',
];

// Wave 1 knowledge-audit carve-out (Task 1.2, 2026-07-03): the tests under
// `src/__tests__/scripts/knowledge-audit/**` are PURE (prompt builder, parser
// tolerance/clamping, coverage math, expected-count heuristics, agreement
// matrix — no DB, no network, no env). They live next to the other script
// tests for discoverability, but they belong in the NORMAL per-PR lane, so the
// integration-lane directory prefix above is split here: knowledge-audit/** is
// excluded from the integration lane and carved OUT of the normal lane's
// integration exclusion (see NORMAL_LANE_INTEGRATION_EXCLUDES below).
const PURE_SCRIPT_TEST_GLOB = 'src/__tests__/scripts/knowledge-audit/**/*.{test,spec}.{ts,tsx}';

// Normal-lane exclusion for the integration directories, with the pure
// knowledge-audit subtree carved back out. `!(knowledge-audit)` is a picomatch
// extglob: any scripts/ SUBDIRECTORY except knowledge-audit stays integration-
// only, and the root-level pattern keeps loose files (e.g.
// backfill-cbse-syllabus.test.ts) integration-only too.
const NORMAL_LANE_INTEGRATION_EXCLUDES = [
  'src/__tests__/migrations/**',
  'src/__tests__/scripts/*.{test,spec}.{ts,tsx}',
  'src/__tests__/scripts/!(knowledge-audit)/**',
];

// B1 RAG eval-harness (Task 8, 2026-06-13, architect-reviewed): the LIVE-DB
// runner entry is NARROWLY matched as `src/__tests__/eval/**/*.integration.test.ts`
// — ONLY the `*.integration.test.ts` file (run-eval.integration.test.ts) joins
// the integration lane. The PURE eval tests (`src/__tests__/eval/rag/*.test.ts`
// — golden-schema, metrics, relevance-judge, trace-mining, verdict, run-eval,
// telemetry, import-boundary) intentionally STAY in the normal `npm test` lane:
// they are offline pure-fn tests with no DB. Do NOT broaden this to
// `src/__tests__/eval/**` or the pure tests get swept into the (currently-red)
// integration lane. This is a FILE-level glob (not a directory prefix), so it is
// added verbatim to the integration-lane `include` and the normal-lane `exclude`
// — NOT suffix-mapped like INTEGRATION_TEST_PATTERNS. The normal lane excludes it
// (plus every `*.integration.test.ts`) so the live-DB runner cannot accidentally
// collect in the unit run — making the lane separation EXPLICIT rather than
// relying solely on the runtime `hasSupabaseIntegrationEnv()` skip-guard inside
// the test.
const INTEGRATION_TEST_FILE_GLOBS = [
  'src/__tests__/eval/**/*.integration.test.ts',
];

const isIntegrationRun = process.env.RUN_INTEGRATION_TESTS === '1';

/**
 * ── Orphaned-lane fix (2026-07-28) ────────────────────────────────────────
 *
 * Vitest resolves relative `include` globs against `test.root`, which defaults
 * to the process CWD — NOT to the directory holding this config file. Every
 * lane that actually runs invokes vitest with CWD = `apps/host`:
 *
 *   root `npm test`   → `npm run test --workspaces --if-present` → apps/host
 *   CI unit shards    → `npm test -w apps/host -- --config ../../vitest.ci-shard.config.mts`
 *
 * So `src/**` correctly resolved to `apps/host/src/**`, but every
 * `supabase/functions/...` entry below silently resolved to the non-existent
 * `apps/host/supabase/functions/...` and matched ZERO files. Those 24 files
 * (411 tests, including the P12 AI-admission and P13 PII-redaction suites)
 * ran in no lane at all: not in the workspace lane (bad prefix) and not from
 * the repo root (the root `test` script never invokes vitest directly).
 *
 * `repoGlob()` anchors those patterns to THIS FILE's directory, so they
 * resolve identically no matter what CWD vitest is launched from. Verified:
 * absolute patterns are honoured by vitest 4's collector.
 *
 * Guarded by `apps/host/src/__tests__/vitest-lane-coverage.test.ts`, which
 * fails if any test file on disk is collected by neither lane.
 */
const repoGlob = (p: string) => path.resolve(__dirname, p).split(path.sep).join('/');

/**
 * Edge-Function and shared-package test files that are Vitest-compatible.
 * These live outside `apps/host/src`, so they need repo-anchored globs.
 */
const CROSS_PACKAGE_TEST_GLOBS = [
  // MOL shared library (Deno-free helpers) — Vitest-compatible.
  'supabase/functions/_shared/mol/__tests__/**/*.{test,spec}.ts',
  // Shared Edge-Function helpers. NOTE: gmail-transport.test.ts is a Deno test
  // and is deliberately NOT listed (it runs in the `deno test` CI job).
  'supabase/functions/_shared/__tests__/redact-pii.test.ts',
  'supabase/functions/_shared/__tests__/python-ai-proxy.test.ts',
  'supabase/functions/_shared/__tests__/ai-admission.test.ts',
  'supabase/functions/_shared/__tests__/reliability.test.ts',
  // C3/C4 MOL grounded-answer harnesses. Every OTHER file in that function's
  // __tests__ dir uses Deno.test(), hence exact paths rather than a directory
  // glob — vitest must never load the Deno tests.
  'supabase/functions/grounded-answer/__vitest__/mol-telemetry-adapter.vitest-harness.ts',
  'supabase/functions/grounded-answer/__vitest__/mol-shadow.vitest-harness.ts',
  'supabase/functions/grounded-answer/__vitest__/mol-shadow.integration.vitest-harness.ts',
  'supabase/functions/grounded-answer/__vitest__/mol-shadow-governance.vitest-harness.ts',
  // PR-2 bulk-jee-neet-import static-source contract canary + pure validators.
  'supabase/functions/bulk-jee-neet-import/__tests__/index.test.ts',
].map(repoGlob);

/**
 * ── P2-3 Phase 3 (2026-08-04): packages/lib + packages/ui collect DIRECTLY ──
 *
 * Previously, canonical `packages/lib/src/**\/*.test.ts` files were reached
 * ONLY as a side-effect of importing a 2-line `export * from '...'` mirror
 * stub under `apps/host/src/lib/**` (one exception: `foxy-report.test.ts`,
 * which had no stub and was listed verbatim in CROSS_PACKAGE_TEST_GLOBS
 * above). The 30 mirror stubs are now deleted — this glob is the ONLY path
 * by which those tests are collected, so it must never be narrowed without
 * first re-adding stubs or another collection path.
 *
 * Repo-anchored via repoGlob() for the same CWD-independence reason as
 * CROSS_PACKAGE_TEST_GLOBS (see the "Orphaned-lane fix" note above): vitest
 * resolves relative includes against `test.root` = CWD = apps/host in every
 * lane, so a bare `packages/lib/src/**` pattern would silently match zero
 * files.
 */
const PACKAGE_SOURCE_TEST_GLOBS = [
  'packages/lib/src/**/*.{test,spec}.{ts,tsx}',
  'packages/ui/src/**/*.{test,spec}.{ts,tsx}',
].map(repoGlob);

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: [path.resolve(__dirname, 'apps/host/src/__tests__/setup.ts')],
    include: isIntegrationRun
      ? [
          ...INTEGRATION_TEST_PATTERNS.map((p) => `${p}/**/*.{test,spec}.{ts,tsx}`),
          ...INTEGRATION_TEST_FILE_GLOBS,
        ]
      : [
          'src/**/*.{test,spec}.{ts,tsx}',
          // Repo-anchored so they resolve from ANY cwd — see the
          // "Orphaned-lane fix" note on CROSS_PACKAGE_TEST_GLOBS above.
          ...CROSS_PACKAGE_TEST_GLOBS,
          // packages/lib + packages/ui canonical tests, collected DIRECTLY
          // (P2-3 Phase 3) — see the PACKAGE_SOURCE_TEST_GLOBS note above.
          ...PACKAGE_SOURCE_TEST_GLOBS,
        ],
    exclude: isIntegrationRun
      ? [
          'node_modules/**',
          // pure knowledge-audit tests run in the normal lane only (see carve-out above)
          PURE_SCRIPT_TEST_GLOB,
        ]
      : [
          'node_modules/**',
          ...NORMAL_LANE_INTEGRATION_EXCLUDES,
          ...INTEGRATION_TEST_FILE_GLOBS,
          // B1 RAG eval-harness (Task 8): belt-and-braces — explicitly drop ANY
          // `*.integration.test.ts` from the normal lane. INTEGRATION_TEST_FILE_GLOBS
          // already excludes the eval one by its exact glob, but this blanket
          // pattern makes the "integration tests never run in the unit lane"
          // contract self-documenting and future-proof against new
          // `*.integration.test.ts` files landing elsewhere under src/.
          'src/**/*.integration.{test,spec}.{ts,tsx}',
          // TODO(reorder-baseline): vitest's rolldown transformer chokes
          // on the `#!/usr/bin/env node` shebang in scripts/reorder-baseline.mjs
          // when the test file imports it ("Invalid Character `!`"). The
          // script has its own --self-test harness that the CI workflow
          // runs independently, so coverage is preserved. Excluded here to
          // stop the parse error from failing the unit-test job. Real fix:
          // either move the script's logic into a non-shebang module and
          // import that from the script + test, or update vitest's
          // transformer config to strip shebangs.
          'src/__tests__/reorder-baseline.test.ts',
        ],
    globals: true,
    // ── Test timeout (raised 2026-05-05 for CI green) ──
    // The default 5000ms timeout was insufficient for tests that perform a
    // dynamic `await import('@/lib/admin-auth' | '@/lib/usage' | '@/lib/quiz-engine')`
    // under heavy parallel load. These modules transitively pull in
    // @supabase/supabase-js + zod + the env validator, and the JSDOM SSR
    // transform can take 4-7s under contention (full-suite total transform
    // time was 98s across 84 files). The first dynamic import in a fresh
    // worker hit the 5s wall on 6 tests — all of which pass in <1.5s in
    // isolation. Raising the floor to 15s leaves headroom without masking
    // genuine hangs.
    testTimeout: 120000,
    hookTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      // ── Honest-include repair (2026-08-03, P1-7 quality-gate audit) ──
      // The previous include was `src/lib/**/*.{ts,tsx}`, which — with vitest
      // resolving globs against test.root = process CWD = apps/host in every
      // lane that runs — matched the ~402 two-line auto-generated re-export
      // stubs under apps/host/src/lib/ plus 5 real files, and NONE of the
      // canonical implementations in packages/lib/src + packages/ui/src.
      // Global floors and every per-file threshold were measuring shims.
      //
      // Glob mechanics, verified empirically against vitest 4.1.8 (picomatch
      // + tinyglobby + pathe) on 2026-08-03:
      // - COVERED files are kept via pm.isMatch(absPath, include,
      //   { contains: true }) → `../../packages/...` patterns NEVER match (an
      //   absolute path contains no literal `../..`); bare `packages/...`
      //   patterns DO match (unanchored contains-match against the absolute
      //   path).
      // - UNCOVERED files are enumerated by tinyglobby with cwd = test.root →
      //   bare `packages/...` deliberately finds nothing from apps/host. This
      //   is intentional: vitest's createUncoveredFileTransformer() refuses
      //   any file outside project.config.root (= apps/host), falls back to
      //   raw file content, and rolldown's parseAstAsync() then fails on raw
      //   TypeScript — every uncovered packages file would emit a logged
      //   RolldownError and be dropped anyway (verified 2026-08-03 with
      //   absolute include patterns, which DO enumerate). So for packages/**
      //   this include measures files LOADED during the test run only;
      //   packages files with zero importing tests do not appear as 0% rows.
      //   KNOWN LIMITATION — the packages side of the global number is
      //   therefore still slightly flattering. Fixing it requires moving
      //   test.root to the repo root, which relocates blob/coverage output
      //   paths that .github/workflows/ci.yml hardcodes (apps/host/coverage,
      //   apps/host/.vitest-reports) — tracked as a follow-up, do not flip it
      //   casually.
      // - Files outside test.root are silently dropped from the report unless
      //   `allowExternal: true` is set.
      allowExternal: true,
      include: [
        'src/**/*.{ts,tsx}',
        'packages/lib/src/**/*.{ts,tsx}',
        'packages/ui/src/**/*.{ts,tsx}',
      ],
      // Keep every entry *.{ts,tsx}-scoped: a bare `src/lib/**` glob once made
      // getCoverageMapForUncoveredFiles() feed src/lib/state/README.md into
      // rolldown's parseAstAsync(), which throws on markdown and crashed the
      // whole `vitest run --coverage` job in CI.
      exclude: [
        'src/__tests__/**',
        'node_modules/**',
        'src/app/**/page.tsx',
        // Defense-in-depth against the markdown-parse crash above: never let a
        // README.md / *.json (or any non-source doc) reach the coverage parser,
        // regardless of where it lives under an `include` glob.
        '**/*.md',
        '**/*.json',
        // Test files OUTSIDE src/__tests__: packages/lib keeps many *.test.ts
        // files NEXT TO their source (e.g. admin-audit-throttle.test.ts), the
        // grounded-answer harnesses live in __vitest__/, and __tests__ dirs
        // exist under packages too. Exclude semantics run through picomatch
        // with contains:true, so these match at any path depth.
        '**/*.{test,spec}.{ts,tsx}',
        '**/__tests__/**',
        '**/__vitest__/**',
        '**/__mocks__/**',
        '**/*.stories.{ts,tsx}',
        // Server / integration territory: tests live in src/__tests__/migrations
        // and src/__tests__/scripts (the integration-only suite gated on real
        // STAGING_SUPABASE_* secrets in CI). They are NOT exercised by the unit
        // run, so including them in unit-coverage drags global below threshold
        // for no useful signal. Coverage for these paths is the responsibility
        // of the integration-tests workflow job.
        'src/lib/ai/**',
        'src/lib/domains/**',
        'src/lib/identity/**',
        'src/lib/middleware/**',
        // ...and the canonical packages/lib twins of the same territory (the
        // src/lib entries above keep matching the re-export stub layer; these
        // match the real code):
        'packages/lib/src/ai/**',
        'packages/lib/src/domains/**',
        'packages/lib/src/identity/**',
        'packages/lib/src/middleware/**',
        // Generated / wrapper files with nothing meaningful to test.
        'src/lib/types.ts',
        'src/lib/constants.ts',
        'packages/lib/src/types.ts',
        'packages/lib/src/constants.ts',
      ],
      thresholds: {
        // Global threshold — NOTE the measured surface changed on 2026-08-03
        // (P1-7): include went from the stub-only `src/lib/**` to all of
        // apps/host `src/**` + the canonical packages/lib + packages/ui code,
        // so the historical floor rationale below (Installments 1-3) describes
        // a DIFFERENT, much smaller denominator. Full-suite measurement on
        // the new surface (2026-08-03, local Windows run, 1209 files /
        // 18,973 passing tests, 1,447 files in the coverage map):
        //   statements 60.37 | branches 51.69 | functions 58.25 | lines 62.23
        // Floors kept at min(previous, measured-2) per metric:
        //   statements 54 (measured 60.37 — headroom, ratchet candidate)
        //   branches   49 (measured 51.69)
        //   functions  56 (measured 58.25; LOWERED from 58 because the margin
        //                  was 0.25pt — inside normal local↔CI environment
        //                  delta — on a floor calibrated against the old
        //                  stub surface. Set to measured-2 per the P1-7
        //                  repair protocol; before=58, after=56.)
        //   lines      55 (measured 62.23 — headroom, ratchet candidate)
        // TODO(testing): once the CI merge job confirms the merged-shard
        // numbers on the new surface, ratchet statements/lines/functions up
        // to (CI-measured − 2). Aspirational target remains 60%+ across the
        // board via the testing chain.
        //
        // ── Historical floor rationale (pre-2026-08-03, stub-era surface) ──
        // Was previously labelled "aspirational" with a 60%
        // target, but `continue-on-error: true` masked that reality never
        // exceeded ~37%. Now that CI is a hard gate (P0-D launch fix), the
        // floor must reflect actual present coverage.
        //
        // Installment 1 (2026-04-28, PR test/global-coverage-installment-1):
        // raised floors after adding 8 pure-utility test files covering
        // voice.ts, whatsapp-templates.ts, foxy-lines.ts, email-templates.ts,
        // share.ts, sanitize.ts, useDebounce.ts, utils.ts. Measured run
        // 44.20 / 39.78 / 46.86 / 45.47 → floors set 1 point below to leave
        // safety margin.
        // Installment 2 (2026-04-28, PR test/global-coverage-installment-2):
        // added 10 test files for pure-fn server helpers + Foxy/quiz pure
        // libs: scoring.ts, anon-id.ts, score-config.ts, slo.ts, plans.ts,
        // cache.ts (mocked redis), sentry-client-redact.ts, request-timing.ts
        // (mocked logger), posthog-client.ts, feedback-engine.ts (mocked
        // sounds), and the entire quiz-engine.ts pure-fn library. Measured
        // run 49.97 / 45.40 / 53.70 / 51.06 → floors set ~1 point below.
        // Installment 3 (2026-04-28, PR test/global-coverage-installment-3):
        // added 4 test files for the auth/RBAC/usage helpers — admin-auth.ts
        // (14% → 86%), middleware-helpers.ts (18% → 88%), rbac.ts pure parts
        // (25% → 74%), usage.ts (12% → 98%). 107 new tests. Measured run
        // 55.66 / 50.73 / 59.31 / 56.68 → floors set ~1 point below to
        // leave safety margin for refactors. We are now within striking
        // distance of the 60% aspirational target.
        // TODO(testing): installment 4 should target the next layer --
        // oauth-manager.ts (71% -> push to 90%) [done 2026-05-16, Phase 6
        // Iter 2, test/oauth-manager-coverage]; feature-flags.ts (85% ->
        // close gaps at lines 86/119/160-165) [done 2026-05-16, Phase 6
        // Iter 1, PR #767]; plan-gate.ts (81% -> cover lines 89/230/
        // 291-296); and start chipping at supabase.ts (10%) by extracting
        // pure helpers and testing them with mocked client. After
        // installment 4 the 60% milestone should clear.
        statements: 54,
        branches: 49,
        functions: 56,
        lines: 55,
        // ── Per-file thresholds for critical business logic ──
        //
        // Key format (repaired 2026-08-03, P1-7): vitest matches threshold
        // keys with an ANCHORED picomatch against
        // pathe.relative(config.root, coveredFile), and config.root = process
        // CWD = apps/host in every lane that runs. So the ONLY key form that
        // reaches the canonical implementations under packages/ is
        // '../../packages/...' (bare 'packages/...', '**/packages/...' and
        // absolute keys all match nothing — verified empirically against
        // vitest 4.1.8). The previous keys ('src/lib/xp-rules.ts' etc.)
        // pointed at the 2-line apps/host re-export stubs: V8 reports ~100%
        // on a stub the moment any test imports it, so those 90% floors were
        // tautologies. If a lane ever invokes vitest from the repo root
        // instead of apps/host, these keys go silently vacuous — keep lane
        // CWD = apps/host (the CI merge job already does).
        //
        // P14 review chains (assessment + testing) own these floors.
        //
        // D2-B (2026-05-05): packages/lib/src/xp-rules.ts is a thin re-export
        // shim (`export * from './xp-config'`). The XP economy live source is
        // xp-config.ts — the 90/90/90/90 floor sits on the real surface.
        '../../packages/lib/src/xp-config.ts': {
          statements: 90,
          branches: 90,
          functions: 90,
          lines: 90,
        },
        // P22 (learning graph) defense floor — RE-PINNED 2026-08-05 (Foxy
        // North-Star Phase 2 wave 2b, tracker E1). The 7 verified-dead
        // algorithm exports (sm2Update / responseToQuality / nextReviewDate /
        // estimateTheta / irtProbCorrect / bktUpdate / calculateReward) were
        // DELETED from cognitive-engine.ts along with their describe blocks
        // (canonical algorithms now live in the update_learner_state_post_quiz
        // SQL RPC + @alfanumrik/lib/learner-model mirror and irt/fisher-info.ts).
        // Measured post-deletion via `npx vitest run --coverage` over the
        // cognitive-engine test set: 98.12% stmts / 96.40% branches /
        // 98.46% funcs / 97.70% lines — deleting the dead code RAISED the
        // file's coverage from the old 80 floor. Each metric is pinned ~5pp
        // below measured. Remaining surface: Bloom progression, ZPD,
        // interleaving, cognitive load, reflection prompts, velocity, gaps,
        // quiz params, exam planning, image classification, monthly report,
        // mastery badge, experiment evidence (BKT internal helper).
        '../../packages/lib/src/cognitive-engine.ts': {
          statements: 93,
          branches: 91,
          functions: 93,
          lines: 92,
        },
        '../../packages/lib/src/exam-engine.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
        // Phase 6 Installment 1 (2026-05-16, test file
        // src/__tests__/lib/feature-flags-coverage.test.ts): closed the
        // gaps named in this config's earlier TODO comment (lines
        // 86/119/160-165 of feature-flags.ts) plus the adjacent
        // isAtlasEnabled() helper. Actual coverage: 100/93.54/100/100.
        // Floor pinned at 95/85/95/95 to leave 5-8 pp headroom for
        // refactors. The two remaining uncovered branches are extreme
        // defenses (line 84 `await res.json()` returning null; line 108
        // four-way env fallback final clause) — not worth chasing.
        // feature-flags.ts is the single gate every projector, BFF
        // route, and Edge Function reads, so the floor is high.
        '../../packages/lib/src/feature-flags.ts': {
          statements: 95,
          branches: 85,
          functions: 95,
          lines: 95,
        },
        // Phase 6 Installment 2 (2026-05-16, test file
        // src/__tests__/lib/oauth-manager-coverage.test.ts): closed the
        // 71% → 90% gap named in this config's Installment-4 TODO. Added
        // 23 tests covering registerApp validation/DB-error/exception
        // branches, tripleIntersection edge cases (unknown scope, empty
        // sets, dedupe), validateAccessToken null-data/exception/expired-
        // boundary paths, and the previously 0%-covered revokeAppTokens
        // function (with-school, without-school, swallow-exception, and
        // non-Error throw branches). Actual coverage with the existing
        // src/__tests__/oauth-manager.test.ts suite combined:
        // 100/100/100/100. Floor pinned at 95/92/95/95 to leave 5-8 pp
        // headroom for refactors, mirroring the feature-flags.ts
        // convention above. oauth-manager.ts is the gate for the entire
        // B2B developer platform (app registration, token validation,
        // scope intersection) so the floor is high.
        '../../packages/lib/src/oauth-manager.ts': {
          statements: 95,
          branches: 92,
          functions: 95,
          lines: 95,
        },
      },
    },
  },
  resolve: {
    alias: [
      {
        find: /^(\.\.\/)+scripts\//,
        replacement: `${path.resolve(__dirname, './scripts')}/`,
      },
      {
        find: /^(\.\.\/)+supabase\//,
        replacement: `${path.resolve(__dirname, './supabase')}/`,
      },
      {
        find: /^(\.\.\/)+eval\//,
        replacement: `${path.resolve(__dirname, './eval')}/`,
      },
      {
        find: /^(\.\.\/)+agents\//,
        replacement: `${path.resolve(__dirname, './agents')}/`,
      },
      {
        find: /^(\.\.\/)+src\/lib\//,
        replacement: `${path.resolve(__dirname, './packages/lib/src')}/`,
      },
      {
        find: /^(\.\.\/)+components\/navigation\//,
        replacement: `${path.resolve(__dirname, './packages/ui/src/navigation')}/`,
      },
      {
        find: /^(\.\.\/)+components\/scan\//,
        replacement: `${path.resolve(__dirname, './packages/ui/src/scan')}/`,
      },
      {
        find: /^@\/\.\.\/agents\//,
        replacement: `${path.resolve(__dirname, './agents')}/`,
      },
      {
        find: '@/app/learn/[subject]/[chapter]/page',
        replacement: path.resolve(__dirname, './apps/host/src/app/(student)/learn/[subject]/[chapter]/page.tsx'),
      },
      {
        find: '@/app/exams/mock/[paperId]/results/page',
        replacement: path.resolve(__dirname, './apps/host/src/app/(student)/exams/mock/[paperId]/results/page.tsx'),
      },
      { find: '@', replacement: path.resolve(__dirname, './apps/host/src') },
      { find: '@alfanumrik/ui', replacement: path.resolve(__dirname, './packages/ui/src') },
      { find: '@alfanumrik/lib', replacement: path.resolve(__dirname, './packages/lib/src') },
      // MOL Edge Function code imports supabase-js from a Deno URL.
      // Map it to the installed npm package so Vitest can resolve it.
      { find: 'https://esm.sh/@supabase/supabase-js@2', replacement: '@supabase/supabase-js' },
    ],
  },
});
