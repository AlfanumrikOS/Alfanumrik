// ── Hermetic test environment ────────────────────────────────────────────────
//
// ⚠️  DO NOT "SIMPLIFY" THIS BACK TO `process.env.X = process.env.X || '...'`.
//
// INCIDENT (2026-08-08). This block previously used the `||` fallback pattern
// for exactly three Supabase variables and neutralised nothing else. The
// fallback only fires when the variable is ABSENT — so on any developer
// machine that exports real credentials into the shell (which is the normal
// state for anyone who also runs `supabase`, `vercel env pull`, or a
// `.env`-sourcing profile), the placeholder never applied and **the entire
// unit suite executed against production infrastructure**.
//
// Measured blast radius on one such shell (real SUPABASE_SERVICE_ROLE_KEY,
// real project ref, `rzp_live_` Razorpay key, real Upstash Redis):
//   • baseline `npm test` → 13 failed files / 62 failed tests / 41 errors /
//     24 "Worker exited unexpectedly" crashes, 63 minutes wall clock
//   • same 13 files with the env scrubbed → 13 passed / 199 tests / 44.1s
//   • genuine product defects found among those 62 failures: ZERO
//
// Three distinct mechanisms produced those artifacts:
//   1. `acquireIdempotencyLock()` (packages/lib/src/redis.ts) wrote real keys
//      into production Upstash Redis. `/api/auth/bootstrap` takes a 30s lock
//      on `bootstrap:<userId>`; the first test claimed it and every later test
//      short-circuited to `{ status: 'deduplicated' }` HTTP 200, yielding
//      "expected 200 to be 400" style failures. The lock OUTLIVED the process,
//      so the failure set changed run to run — non-deterministic red.
//   2. `NEXT_PUBLIC_APP_URL=http://localhost:3000` overrode the
//      `https://alfanumrik.com` default in `appHost()`
//      (packages/lib/src/school-provisioning.ts), breaking claim-URL assertions.
//   3. Real Supabase round-trips produced AbortErrors, a 234.9s hang, and the
//      worker crashes.
//
// THE RULE: the unit lane's environment is DECLARED here, not inherited.
// Anything a test needs, that test sets and restores itself (this is already
// the established convention — see the payments, alfabot, health, env-accessors
// and internal-caller-signing suites, all of which set/delete their own vars).
//
// PARITY TARGET: CI (`.github/workflows/ci.yml` top-level `env:`) sets exactly
// three application variables and nothing else. Reproducing that exact state
// locally is the whole point — it removes the "passes for me" class of bug in
// both directions.
//
// ESCAPE HATCH: the integration lane (`npm run test:integration`, i.e.
// `RUN_INTEGRATION_TESTS=1`) legitimately talks to a real staging project and
// shares this setup file, so the scrub is skipped there. That lane is explicit
// opt-in and is the ONLY supported way to point tests at a live backend.
const IS_INTEGRATION_LANE = process.env.RUN_INTEGRATION_TESTS === '1';

if (!IS_INTEGRATION_LANE) {
  // ── Step 1: remove inherited credentials ──────────────────────────────────
  // Prefix sweep. Every consumer of these degrades to an in-memory / no-op /
  // throw-before-network path when the variable is ABSENT (verified in source
  // 2026-08-08):
  //   UPSTASH_*  → getRedis() returns null in packages/lib/src/redis.ts:21,
  //                rbac.ts:59, middleware-helpers.ts:84, api-rate-limit.ts:30
  //                and the ensureUpstash() guard in apps/host/src/proxy.ts:216 —
  //                all fall back to the in-memory limiter/cache, and
  //                acquireIdempotencyLock() returns true (allow) rather than
  //                dedupe.
  //   SUPABASE_* → no application code reads bare SUPABASE_URL /
  //                SUPABASE_ANON_KEY (the one reference,
  //                api/whatsapp/_lib/daily6.ts:220, prefers
  //                NEXT_PUBLIC_SUPABASE_URL which is force-assigned below).
  //                They MUST stay absent: observability-migration-1a/1b.test.ts
  //                gate `describeIfSupabase` on `SUPABASE_URL &&
  //                SUPABASE_SERVICE_ROLE_KEY` and would otherwise wake up and
  //                dial a live Postgres from the unit lane.
  //   RAZORPAY_* / ANTHROPIC_* / OPENAI_* → every test that needs one assigns a
  //                fake itself; absent, callOpenAI/callClaude throw
  //                "…_API_KEY not configured" before touching the network,
  //                which is the safe default REG-168 already assumes.
  const SCRUB_PREFIXES = [
    'UPSTASH_',
    'SUPABASE_',
    'RAZORPAY_',
    'ANTHROPIC_',
    'OPENAI_',
  ];

  // Named credentials with a demonstrated network or signing path that do not
  // share a sweepable prefix. Keep this list additive: a new secret in a dev
  // shell is a new way for the suite to lie.
  const SCRUB_EXACT = [
    // Host derivation — must be absent so appHost() / guardian-invite.ts use
    // their `https://alfanumrik.com` default (mechanism 2 of the incident).
    'NEXT_PUBLIC_APP_URL',
    // Paid / networked AI + messaging providers.
    'VOYAGE_API_KEY',
    'GEMINI_API_KEY',
    'LLAMA_API_KEY',
    'TWILIO_AUTH_TOKEN',
    // Request-signing and privileged access secrets.
    'INTERNAL_CALLER_SIGNING_SECRET',
    'ADMIN_API_KEY',
    'SUPER_ADMIN_SECRET',
    'CRON_SECRET',
    // Telemetry sinks — a real DSN turns test noise into production events.
    'SENTRY_DSN',
    'NEXT_PUBLIC_SENTRY_DSN',
    'SENTRY_AUTH_TOKEN',
  ];

  for (const name of Object.keys(process.env)) {
    if (SCRUB_PREFIXES.some((p) => name.startsWith(p)) || SCRUB_EXACT.includes(name)) {
      delete process.env[name];
    }
  }

  // ── Step 2: declare the test identity (force-assign, never fall back) ─────
  // These three values are byte-identical to `.github/workflows/ci.yml`'s
  // top-level `env:` block. The service-role placeholder MUST differ from the
  // anon placeholder or packages/lib/src/env.ts's anti-leak check throws at
  // boot. Assignment happens AFTER the sweep above, which deletes
  // SUPABASE_SERVICE_ROLE_KEY by prefix.
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://placeholder.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ci-placeholder-service-role';
}

// ─── Hermetic AI test layer (REG-168) ──────────────────────────────────────
// All three LLM client modules have dedicated unit tests that exercise the
// REAL function over a mocked fetch (vi.stubGlobal('fetch', ...)):
//
//   @alfanumrik/lib/ai/clients/claude         → src/__tests__/ai/agents/claude-tools.test.ts
//   @alfanumrik/lib/ai/clients/openai         → src/__tests__/lib/ai/openai-client.test.ts
//   @alfanumrik/lib/ai/clients/reasoning-cascade → src/__tests__/lib/ai/reasoning-cascade.test.ts
//
// Because these files test the REAL module, a setup-level vi.mock for any of
// them would break those suites — vi.mock in setupFiles is not overrideable by
// a test file's own dynamic import (the mock wins at module resolution time).
//
// The hermetic guarantee is therefore enforced PER-CALL-SITE rather than here:
//
//   - Every test file that calls code which USES callClaude / callOpenAI /
//     callReasoningModel (but does NOT test those clients directly) must add
//     its own vi.mock for the client module. This is the established pattern:
//     math-classify.test.ts mocks both claude and reasoning-cascade;
//     reasoning-cascade.test.ts mocks callOpenAI and callClaude as sub-clients.
//
//   - For callOpenAI: the function throws 'OPENAI_API_KEY not configured' before
//     touching the network when the env var is absent — a safe no-network default.
//
//   - For callClaude: the function throws / returns an error response when
//     ANTHROPIC_API_KEY is absent ('ANTHROPIC_API_KEY not configured', status 503).
//
// Rule: any new test file that imports application code which transitively calls
// an LLM client MUST add vi.mock('@alfanumrik/lib/ai/clients/<module>') at the top of
// that file. The CI environment guard below warns when keys are present so the
// risk of accidental real calls is visible in test output.
//
// UPDATE (2026-08-08): the "safe no-network default" the two bullets above rely
// on is now GUARANTEED rather than hoped for — the hermetic-environment block at
// the top of this file deletes ANTHROPIC_* / OPENAI_* (and every other provider
// credential) in the unit lane, so an unmocked call-site fails loudly and
// offline instead of silently billing a real account. The per-call-site vi.mock
// rule still stands: it is what makes those tests deterministic, not merely safe.

// ─── CI environment guard ──────────────────────────────────────────────────
// Warn if real AI API keys are present so developers know to check their mocks.
// The three client modules are NOT globally mocked here — see note above.
// In the unit lane these branches are now unreachable (the keys were deleted
// above); they remain live for the RUN_INTEGRATION_TESTS=1 lane, which skips
// the scrub and therefore CAN inherit real keys from the environment.
if (process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[TEST SETUP] ANTHROPIC_API_KEY is set. ' +
    'Any test that imports code which calls callClaude without mocking ' +
    '@alfanumrik/lib/ai/clients/claude will make real API calls. ' +
    'Add vi.mock(\'@alfanumrik/lib/ai/clients/claude\') to the test file (REG-168).',
  );
}
if (process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY.startsWith('sk-test')) {
  console.warn(
    '[TEST SETUP] OPENAI_API_KEY is set to a real key. ' +
    'callReasoningModel and callOpenAI are not globally mocked. ' +
    'Tests that use those clients must mock them at the file level (REG-168). ' +
    'Consider unsetting OPENAI_API_KEY in test environments for clarity.',
  );
}

import '@testing-library/jest-dom/vitest';
import { configure as configureTestingLibrary } from '@testing-library/react';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

// ── testing-library async polling budget ─────────────────────────────────────
//
// ⚠️  DO NOT "TIDY" THIS BACK TO THE DEFAULT. The default is 1000 ms and it is
// demonstrably too tight for this suite. Read the measurements before touching.
//
// WHAT THIS DOES — AND WHAT IT DOES NOT DO.
// `asyncUtilTimeout` is the wall-clock budget `waitFor`,
// `waitForElementToBeRemoved`, and every `findBy*` / `findAllBy*` query get to
// POLL before they give up. It is a deadline, not an assertion. Nothing here
// weakens, relaxes, or skips a single expectation: every `expect()` inside a
// `waitFor` callback still has to become literally true, and every synchronous
// `getBy*` assertion that follows a `waitFor` is completely unaffected (those
// never poll — they pass or throw on the first tick). Raising this number can
// only change WHEN a test fails, never WHETHER a true assertion is required.
//
// WHY 5000 ms — the measurement, not a vibe.
// A component-render timing study on `/parent/reports` (the page behind
// `src/__tests__/parent/parent-reports-design-system-refactor.test.tsx`) was run
// on one machine, alternating that page's source between commit 819a5e71a
// (pre-Wave-B) and the then-current HEAD (post-Wave-B), three samples each —
// time from `render()` to the asserted value appearing in the DOM:
//
//     pre-Wave-B  (819a5e71a) : 544 / 979 / 549 ms
//     post-Wave-B (HEAD)      : 573 / 609 / 625 ms
//
// The 979 ms reading is the whole argument. Against a 1000 ms default that is a
// 21 ms margin — a 2% margin on a JSDOM render, which is noise, not headroom.
// This test was ALREADY inside the failure band before the refactor that got
// blamed for it; the newer code is in fact marginally faster. The failure mode
// was never a product regression, it was a harness deadline calibrated with no
// margin at all.
//
// The render is genuinely two sequential round trips and cannot be collapsed
// into one. Milestone trace at HEAD: `get_children` fires @205 ms → the child's
// name paints @359 ms → `get_child_dashboard` fires @382 ms → the asserted
// value paints @595 ms. The second request exists to enforce the cross-child
// data boundary (`resolveLinkedChild` re-checks the requested child against the
// server-filtered list); short-circuiting it to make the test faster would
// create a real authorization hole. So the latency is load-bearing.
//
// Under 4 concurrent vitest shards on one box the same CPU starvation also took
// out `src/__tests__/app/parent-reports-data-load-error.test.tsx` (6 of its 11
// tests), `src/__tests__/school-admin/escalations-safeguarding-tab.test.tsx`
// (2), and `src/__tests__/components/offline/OfflineBoundary.test.tsx` (1) —
// all clustered in the same sub-second band. This is a suite-wide
// calibration problem, which is why the fix is global here rather than a
// per-call-site `{ timeout }` sprinkle.
//
// 5000 ms is ~5x the worst measured render (979 ms), which puts the deadline
// far outside the observed scheduling-jitter distribution instead of at its
// edge. It is also the value several suites had already reached for
// independently (e.g. `src/__tests__/foxy/learning-action-chained.test.tsx`),
// so it standardises an existing local convention rather than inventing one.
//
// WHY NOT HIGHER. This is a real cost, paid only on failure: a component that
// genuinely hangs now burns 5 s per waiting assertion instead of 1 s. 5000 ms
// keeps that bounded and — critically — keeps it well under vitest's
// `testTimeout` (120000 ms in vitest.config.ts), so a hung component still
// fails through `waitFor`'s own error, which prints the "Unable to find an
// element with the text: …" message plus a DOM dump. Push this past
// `testTimeout` and you lose that diagnostic entirely: the test dies as an
// anonymous vitest timeout with no DOM. Diagnostics are the reason for the
// ceiling, not just speed.
//
// The correct fix if this ever proves insufficient is to make the render
// faster or the test's waiting explicit — NOT `test.retry`, which converts a
// deterministic red into an intermittent green and hides real flakes.
configureTestingLibrary({ asyncUtilTimeout: 5000 });

// ── Monorepo static-test path shim ───────────────────────────────────────────
// `npm test --workspaces` runs the host Vitest process with cwd=apps/host.
// Most app tests intentionally read `src/...` from that cwd, while the static
// contract tests read repo-root assets such as `supabase/...` and
// `eslint-rules/...`. Redirect only missing repo-root asset reads, leaving app
// source paths untouched.
(() => {
  const require = createRequire(import.meta.url);
  const fs = require('node:fs') as typeof import('node:fs');
  const hostRoot = path.resolve(process.cwd());
  const repoRoot = path.resolve(hostRoot, '..', '..');
  const repoRootDirs = new Set([
    '.github',
    'docs',
    'eslint-rules',
    'eslint-plugin-alfanumrik',
    'eval',
    'mobile',
    'scripts',
    'supabase',
  ]);
  // NOTE (2026-08-03, P0-1): the three `sentry.*.config.ts` entries were
  // removed from this set — the Sentry init files now live at the apps/host
  // project root (instrumentation.ts / instrumentation-client.ts /
  // sentry.server.config.ts / sentry.edge.config.ts), so host-relative reads
  // resolve directly and the repo-root copies no longer exist.
  const repoRootFiles = new Set([
    'vercel.json',
  ]);

  const originalExistsSync = fs.existsSync.bind(fs);
  const originalReadFileSync = fs.readFileSync.bind(fs);
  const originalReaddirSync = fs.readdirSync.bind(fs);
  const originalStatSync = fs.statSync.bind(fs);
  const originalLstatSync = fs.lstatSync.bind(fs);
  const originalPromisesReadFile = fs.promises.readFile.bind(fs.promises);
  const originalPromisesStat = fs.promises.stat.bind(fs.promises);

  function remapRepoAssetPath(input: unknown): unknown {
    if (typeof input !== 'string') return input;
    const absolute = path.resolve(input);
    if (!absolute.startsWith(hostRoot + path.sep)) return input;

    const relative = path.relative(hostRoot, absolute);
    if (!originalExistsSync(absolute)) {
      const studentRouteCandidate = relative.startsWith(`src${path.sep}app${path.sep}`)
        ? path.resolve(hostRoot, 'src/app/(student)', relative.slice(`src${path.sep}app${path.sep}`.length))
        : null;
      if (studentRouteCandidate && originalExistsSync(studentRouteCandidate)) {
        return studentRouteCandidate;
      }

      const packageUiCandidate = relative.startsWith(`src${path.sep}components${path.sep}`)
        ? path.resolve(repoRoot, 'packages/ui/src', relative.slice(`src${path.sep}components${path.sep}`.length))
        : null;
      if (packageUiCandidate && originalExistsSync(packageUiCandidate)) {
        return packageUiCandidate;
      }
    }

    const [firstSegment] = relative.split(path.sep);
    if (repoRootFiles.has(relative) && !originalExistsSync(absolute)) {
      const candidate = path.resolve(repoRoot, relative);
      return originalExistsSync(candidate) ? candidate : input;
    }
    if (!repoRootDirs.has(firstSegment)) return input;
    if (originalExistsSync(absolute)) return input;

    const candidate = path.resolve(repoRoot, relative);
    return originalExistsSync(candidate) ? candidate : input;
  }

  fs.existsSync = ((file: Parameters<typeof fs.existsSync>[0]) =>
    originalExistsSync(remapRepoAssetPath(file))) as typeof fs.existsSync;
  fs.readFileSync = ((file: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) =>
    originalReadFileSync(remapRepoAssetPath(file), ...(args as []))) as typeof fs.readFileSync;
  fs.readdirSync = ((file: Parameters<typeof fs.readdirSync>[0], ...args: unknown[]) =>
    originalReaddirSync(remapRepoAssetPath(file), ...(args as []))) as typeof fs.readdirSync;
  fs.statSync = ((file: Parameters<typeof fs.statSync>[0], ...args: unknown[]) =>
    originalStatSync(remapRepoAssetPath(file), ...(args as []))) as typeof fs.statSync;
  fs.lstatSync = ((file: Parameters<typeof fs.lstatSync>[0], ...args: unknown[]) =>
    originalLstatSync(remapRepoAssetPath(file), ...(args as []))) as typeof fs.lstatSync;
  fs.promises.readFile = ((file: Parameters<typeof fs.promises.readFile>[0], ...args: unknown[]) =>
    originalPromisesReadFile(remapRepoAssetPath(file), ...(args as []))) as typeof fs.promises.readFile;
  fs.promises.stat = ((file: Parameters<typeof fs.promises.stat>[0], ...args: unknown[]) =>
    originalPromisesStat(remapRepoAssetPath(file), ...(args as []))) as typeof fs.promises.stat;
  syncBuiltinESMExports();
})();

// ── Blob.prototype.stream polyfill (jsdom + Node-22 CI gap) ───────────────────
// jsdom's Blob implementation (jsdom 29.x, lib/jsdom/living/file-api/Blob-impl.js)
// ships `arrayBuffer()`, `bytes()`, `text()`, and `slice()` but NOT `stream()`.
//
// When test code constructs `new Response(blob)` and then reads the body with
// `res.blob()` / `res.arrayBuffer()`, the platform's "extract a body" algorithm
// (WHATWG Fetch §body) takes the Blob branch: "set stream to object.stream()".
// On the Node-22 undici that backs the CI runner this branch is hit, and because
// jsdom's Blob has no `.stream`, it throws `TypeError: object.stream is not a
// function`. On newer Node (the local dev runtime) the same path resolves the
// body from the Blob's internal bytes without calling `.stream()`, which is why
// the voice-python-client synthesize tests pass locally but fail in CI.
//
// Fix: define a minimal, spec-shaped `Blob.prototype.stream` that returns a real
// web `ReadableStream` over the blob's bytes — ONLY when the method is missing.
// We never override a working native/jsdom implementation (the guard below bails
// the moment `stream` exists), so this is inert on any environment that already
// provides it. This is test-environment-only and fixes every test that reads a
// Blob-bodied Response under jsdom, not just the voice client.
(() => {
  const BlobCtor: typeof Blob | undefined = typeof Blob !== 'undefined' ? Blob : undefined;
  if (!BlobCtor || typeof BlobCtor.prototype === 'undefined') return;
  // Guard: only polyfill when absent. Never clobber a working impl.
  if (typeof (BlobCtor.prototype as { stream?: unknown }).stream === 'function') return;
  if (typeof ReadableStream === 'undefined') return; // can't build a stream — leave as-is.

  Object.defineProperty(BlobCtor.prototype, 'stream', {
    configurable: true,
    writable: true,
    value: function stream(this: Blob): ReadableStream<Uint8Array> {
      // Pull the bytes lazily via the already-present arrayBuffer() so we don't
      // depend on internal jsdom fields. The stream emits a single chunk, which
      // is sufficient for body-consumption code paths (blob()/arrayBuffer()).
      const blob = this;
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            const buf = await blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            if (bytes.byteLength > 0) controller.enqueue(bytes);
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });
    },
  });
})();

// ── localStorage / sessionStorage mock ────────────────────────────────────────
// Vitest 4 + JSDOM 29 can emit a `--localstorage-file` warning that leaves the
// Storage API in a non-functional state (clear/setItem become undefined).
// Providing a reliable in-memory implementation here fixes the issue globally
// without breaking any test that relies on actual storage behaviour.

const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => key in store ? store[key] : null,
    setItem: (key: string, value: string): void => { store[key] = String(value); },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { store = {}; },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
    get length(): number { return Object.keys(store).length; },
  };
};

Object.defineProperty(global, 'localStorage', {
  value: createStorageMock(),
  writable: true,
});

Object.defineProperty(global, 'sessionStorage', {
  value: createStorageMock(),
  writable: true,
});
