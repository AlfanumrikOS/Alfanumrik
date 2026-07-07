// ── Default test environment variables ────────────────────────────────────────
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.placeholder';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ci-placeholder-service-role';

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

// ─── CI environment guard ──────────────────────────────────────────────────
// Warn if real AI API keys are present so developers know to check their mocks.
// The three client modules are NOT globally mocked here — see note above.
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
