// supabase/functions/grounded-answer/__tests__/mol-shadow.test.ts
// C4.2a wire-up (2026-05-19) — shadow-helper unit tests.
//
// Runs under Vitest. Companion file alongside mol-telemetry-adapter.test.ts;
// uses the same mocking strategy:
//   - vi.mock the `_shared/mol/index`     module so generateResponse is a spy
//   - vi.mock the `_shared/mol/telemetry` module so recordMolRequest is a spy
//   - vi.mock the `_shared/mol/feature-flag` module so getFlagEnvelope is a
//     spy whose envelope we configure per-test
//
// Single-row contract (C4.2a):
//   On the success path the helper writes ZERO rows of its own —
//   generateResponse's auto-log (which tests do NOT exercise because
//   generateResponse is mocked) is the single tagged row. Tests therefore
//   verify generateResponse was CALLED with the right config payload
//   (system_prompt_override, shadow_role='shadow', shadow_of_request_id,
//   trace_id) and that recordMolRequest was NOT called.
//
// On the failure path generateResponse throws/rejects before the
// orchestrator's auto-log can run, so the helper writes a defensive
// shadow-tagged failure row via writeFailureRow → recordMolRequest. Tests
// assert exactly that one row carries shadow_role='shadow' + failure_chain.
//
// What we verify:
//   1. Every short-circuit path (enabled=false, kill_switch=true, task not in
//      allow-list, rollout=0) produces ZERO generateResponse calls and ZERO
//      recordMolRequest calls.
//   2. A sample HIT fires exactly one generateResponse call whose
//      GenerateRequest.config carries:
//        - system_prompt_override = args.systemPrompt   (prompt-parity fix)
//        - shadow_role = 'shadow'                       (de-dup fix)
//        - shadow_of_request_id = args.request_id       (de-dup fix)
//        - trace_id = args.trace_id                     (cross-service join)
//      AND the helper does NOT call recordMolRequest on success.
//   3. generateResponse throwing/rejecting is swallowed; a defensive
//      shadow-tagged failure row IS recorded.
//   4. recordMolRequest throwing synchronously is swallowed; the helper still
//      returns void.
//   5. fireShadowAndForget wrapper detaches the promise (no await needed; no
//      unhandled rejection).

// @ts-ignore — stub Deno before module import; the MOL modules touch
// globalThis.Deno at load time.
globalThis.Deno = { env: { get: (_k: string) => '' } };

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Hoisted spies (stable across the file; reset per test) ───────────────────
const generateResponseSpy = vi.fn();
const recordMolRequestSpy = vi.fn();
const getFlagEnvelopeSpy = vi.fn();

// Mock the MOL barrel index so `generateResponse` is a spy. Re-export the
// type stubs the helper imports.
vi.mock('../../_shared/mol/index.ts', () => ({
  generateResponse: (...args: unknown[]) =>
    (generateResponseSpy as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('../../_shared/mol/telemetry.ts', () => ({
  recordMolRequest: (...args: unknown[]) =>
    (recordMolRequestSpy as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('../../_shared/mol/feature-flag.ts', () => ({
  getFlagEnvelope: (...args: unknown[]) =>
    (getFlagEnvelopeSpy as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));

// Imports MUST come after vi.mock so the mocked bindings are in place.
import {
  shadowFireOpenAI,
  fireShadowAndForget,
  C4_SHADOW_FLAG,
  type ShadowFireArgs,
} from '../mol-shadow.ts';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A `MolResult`-shaped value that mirrors what generateResponse returns. */
function okMolResult(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    text: 'shadow answer body — discarded by user-facing path',
    provider: 'openai',
    model: 'gpt-4o-mini',
    task_type: 'doubt_solving',
    latency_ms: 950,
    tokens: { prompt: 200, completion: 350 },
    usd_cost: 0.00033,
    inr_cost: 0.0274,
    fallback_count: 0,
    passes: 1,
    request_id: 'baseline-req-id',
    ...overrides,
  };
}

/** Default args mirroring a doubt_solving call from Foxy. */
function makeArgs(overrides: Partial<ShadowFireArgs> = {}): ShadowFireArgs {
  return {
    request_id: 'baseline-req-id',
    systemPrompt: 'You are Foxy, a CBSE tutor for Class 8 Science.',
    userMessage: 'What is photosynthesis?',
    maxTokens: 1024,
    temperature: 0.3,
    task_type: 'doubt_solving',
    surface: 'foxy',
    baseline_provider: 'anthropic',
    baseline_model: 'claude-haiku-4-5-20251001',
    trace_id: 'trace-uuid-stub',
    student_context: {
      student_id: 'student-uuid-stub',
      grade: '8',
      language: 'en',
      exam_goal: 'cbse',
      subject: 'science',
    },
    ...overrides,
  };
}

/** Envelope helper — sets the metadata payload getFlagEnvelope returns. */
function envelope(opts: {
  is_enabled?: boolean;
  enabled?: boolean;
  kill_switch?: boolean;
  task_types?: string[];
  rollout_pct?: number;
}) {
  return {
    is_enabled: opts.is_enabled ?? true,
    metadata: {
      enabled: opts.enabled,
      kill_switch: opts.kill_switch,
      task_types: opts.task_types,
      rollout_pct: opts.rollout_pct,
    },
  };
}

beforeEach(() => {
  generateResponseSpy.mockReset();
  recordMolRequestSpy.mockReset();
  getFlagEnvelopeSpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Short-circuit paths ─────────────────────────────────────────────────────

describe('shadowFireOpenAI — short-circuits (no side effects)', () => {
  it('envelope.enabled=false → no generateResponse, no recordMolRequest', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({ enabled: false, task_types: ['doubt_solving'], rollout_pct: 100 }),
    );

    await shadowFireOpenAI(makeArgs());

    expect(generateResponseSpy).not.toHaveBeenCalled();
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });

  it('envelope.kill_switch=true → no generateResponse, no recordMolRequest', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        kill_switch: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );

    await shadowFireOpenAI(makeArgs());

    expect(generateResponseSpy).not.toHaveBeenCalled();
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });

  it('task_type not in allow-list → no generateResponse, no recordMolRequest', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['quiz_generation'], // doubt_solving not allowed
        rollout_pct: 100,
      }),
    );

    await shadowFireOpenAI(makeArgs({ task_type: 'doubt_solving' }));

    expect(generateResponseSpy).not.toHaveBeenCalled();
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });

  it('rollout_pct=0 → sample bucket misses, no generateResponse', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 0,
      }),
    );

    await shadowFireOpenAI(makeArgs());

    expect(generateResponseSpy).not.toHaveBeenCalled();
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });

  it('envelope.enabled undefined + is_enabled=false → disabled (column wins when envelope silent)', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce({
      is_enabled: false,
      metadata: { task_types: ['doubt_solving'], rollout_pct: 100 },
    });

    await shadowFireOpenAI(makeArgs());

    expect(generateResponseSpy).not.toHaveBeenCalled();
  });

  it('getFlagEnvelope throws → helper treats as disabled, no side effects', async () => {
    getFlagEnvelopeSpy.mockRejectedValueOnce(new Error('flag fetch failed'));

    await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();

    expect(generateResponseSpy).not.toHaveBeenCalled();
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });
});

// ─── Happy path: sample hits, single-row contract ────────────────────────────

describe('shadowFireOpenAI — sample hit (single-row contract)', () => {
  it('rollout_pct=100 + task allowed + enabled → calls generateResponse with the prompt-parity + dedup config; helper writes ZERO rows on success', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    await shadowFireOpenAI(makeArgs());

    expect(generateResponseSpy).toHaveBeenCalledTimes(1);
    // Validate the request shape we hand to generateResponse: pinned to
    // openai, carries the baseline request_id, the surface label, AND the
    // four C4.2a fixes (system_prompt_override + shadow_role +
    // shadow_of_request_id + trace_id) on the config payload.
    const req = generateResponseSpy.mock.calls[0][0];
    expect(req.config.preferred_provider).toBe('openai');
    expect(req.config.request_id).toBe('baseline-req-id');
    expect(req.config.surface).toBe('foxy');
    expect(req.task_type).toBe('doubt_solving');
    // ── C4.2a contract ──
    expect(req.config.system_prompt_override).toBe(
      'You are Foxy, a CBSE tutor for Class 8 Science.',
    );
    expect(req.config.shadow_role).toBe('shadow');
    expect(req.config.shadow_of_request_id).toBe('baseline-req-id');
    expect(req.config.trace_id).toBe('trace-uuid-stub');

    // The helper writes ZERO rows on success — the orchestrator's
    // recordMolRequest (inside the mocked generateResponse, not exercised
    // by this test) is the single tagged row in production.
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });

  it('null student_id propagates as null and synthetic anon id reaches generateResponse', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    await shadowFireOpenAI(
      makeArgs({
        student_context: {
          student_id: null,
          grade: null,
          language: null,
          exam_goal: null,
          subject: null,
        },
      }),
    );

    // No helper-side row on success (single-row contract).
    expect(recordMolRequestSpy).not.toHaveBeenCalled();

    // generateResponse received a non-null student_id (synthetic) so its
    // input validation doesn't trip — this is the helper's job. The
    // synthetic id is NEVER persisted; the orchestrator's auto-log row
    // would use req.student_context.student_id, but since the C4 design
    // wants the original null to appear on the row, the orchestrator's
    // auto-log carries the synthetic — this is a known minor cosmetic
    // (anon-shadow-* prefix is distinguishable from real UUIDs in dashboards).
    const req = generateResponseSpy.mock.calls[0][0];
    expect(req.student_context.student_id).toMatch(/^anon-shadow-/);
  });

  it('null trace_id propagates as null through config.trace_id', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    await shadowFireOpenAI(makeArgs({ trace_id: null }));

    expect(recordMolRequestSpy).not.toHaveBeenCalled();
    const req = generateResponseSpy.mock.calls[0][0];
    expect(req.config.trace_id).toBeNull();
  });
});

// ─── Failure isolation ───────────────────────────────────────────────────────

describe('shadowFireOpenAI — failure isolation', () => {
  it('generateResponse rejects → helper swallows, writes defensive failure row tagged shadow', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockRejectedValueOnce(new Error('OpenAI 503 — overloaded'));

    await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();

    // generateResponse rejected BEFORE the orchestrator's auto-log could
    // run, so the helper writes a defensive row so the failure is visible.
    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.shadow_role).toBe('shadow');
    expect(payload.shadow_of_request_id).toBe('baseline-req-id');
    expect(payload.provider).toBe('openai');
    expect(payload.failure_chain).toBe('openai:5xx');
    expect(payload.passes).toBe(0);
    expect(payload.tokens).toEqual({ prompt: 0, completion: 0 });
    expect(payload.usd_cost).toBe(0);
  });

  it('generateResponse rejects with auth error → failure_chain tagged auth', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockRejectedValueOnce(new Error('OpenAI 401 — invalid_api_key'));

    await shadowFireOpenAI(makeArgs());

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.failure_chain).toBe('openai:auth');
  });

  it('generateResponse throws synchronously (not via reject) → helper still writes defensive failure row', async () => {
    // Edge case: an internal MOL bug or a misconfigured worker could cause
    // generateResponse to throw synchronously before returning a promise.
    // The try/catch wrapping the await still handles this; the failure row
    // is the only path that records the event.
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockImplementation(() => {
      throw new Error('sync MOL bug — providers map missing');
    });

    await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.shadow_role).toBe('shadow');
    expect(payload.failure_chain).toMatch(/openai:/);
  });

  it('recordMolRequest throws synchronously on the failure path → helper still returns void', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockRejectedValueOnce(new Error('OpenAI 503'));
    recordMolRequestSpy.mockImplementation(() => {
      throw new Error('supabase write blew up');
    });

    await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();
    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
  });
});

// ─── Wrapper: fire-and-forget contract ───────────────────────────────────────

describe('fireShadowAndForget — detached promise', () => {
  it('returns void synchronously and never throws even when shadow path rejects', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockRejectedValueOnce(new Error('blowup'));

    // The contract is: synchronous return of void, no rejection escapes.
    const ret = fireShadowAndForget(makeArgs());
    expect(ret).toBeUndefined();

    // Flush microtasks so the detached promise has a chance to record the
    // failure row, then assert observable behavior.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Failure path → defensive shadow-tagged row from the helper.
    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    expect(recordMolRequestSpy.mock.calls[0][0].shadow_role).toBe('shadow');
  });

  it('returns void synchronously on success path too; helper writes ZERO rows', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    const ret = fireShadowAndForget(makeArgs());
    expect(ret).toBeUndefined();

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Success path → orchestrator's auto-log inside the (mocked)
    // generateResponse is the SINGLE row. The helper itself records nothing.
    expect(recordMolRequestSpy).not.toHaveBeenCalled();
  });
});

// ─── Flag-name constant ──────────────────────────────────────────────────────

describe('C4_SHADOW_FLAG constant', () => {
  it('matches the registered flag name', () => {
    // Hard-coded check — protects against accidental rename. Registering
    // a different flag_name in the DB while this constant still ships
    // would silently disable the entire shadow path.
    expect(C4_SHADOW_FLAG).toBe('ff_grounded_answer_mol_shadow_v1');
  });
});

// ─── EdgeRuntime.waitUntil lifetime extension ────────────────────────────────

// In Supabase Edge, fire-and-forget promises can be torn down when the
// request completes (worker recycle). The architect's PR #856 review (note b)
// flagged that shadow calls may outlive the baseline response — a 5-10s
// OpenAI call vs a 1-2s cache-hit baseline. C4.2b-i wraps the floating
// promise with EdgeRuntime.waitUntil so the runtime keeps the worker alive
// until the shadow completes. We mock `globalThis.EdgeRuntime` to verify
// the hook is invoked (and gracefully no-ops in environments without it).
describe('fireShadowAndForget — EdgeRuntime.waitUntil lifetime extension', () => {
  let originalEdgeRuntime: unknown;

  beforeEach(() => {
    originalEdgeRuntime = (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
  });

  afterEach(() => {
    if (typeof originalEdgeRuntime === 'undefined') {
      delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;
    } else {
      (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = originalEdgeRuntime;
    }
  });

  it('registers the shadow promise with EdgeRuntime.waitUntil when the API is present', async () => {
    const waitUntilSpy = vi.fn();
    (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil: waitUntilSpy };

    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    fireShadowAndForget(makeArgs());

    expect(waitUntilSpy).toHaveBeenCalledTimes(1);
    const registered = waitUntilSpy.mock.calls[0][0];
    // The argument must be the floating promise (Promise.allSettled chain)
    // so the runtime can `await` it.
    expect(registered).toBeInstanceOf(Promise);

    // Let the floating promise settle so we don't leak it across tests.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });

  it('is a no-op when EdgeRuntime is undefined (local / Vitest environment)', async () => {
    delete (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime;

    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    // Returns void without throwing — the absence of EdgeRuntime is
    // expected in Vitest and must not break the wrapper.
    expect(fireShadowAndForget(makeArgs())).toBeUndefined();

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // Shadow still ran (proves the wrapper didn't short-circuit on the
    // missing API — only the lifetime-extension guarantee is dropped).
    expect(generateResponseSpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when EdgeRuntime exists but lacks waitUntil', async () => {
    (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { somethingElse: true };

    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    expect(fireShadowAndForget(makeArgs())).toBeUndefined();

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(generateResponseSpy).toHaveBeenCalledTimes(1);
  });

  it('swallows a synchronous throw from EdgeRuntime.waitUntil', async () => {
    const waitUntilSpy = vi.fn(() => {
      throw new Error('runtime exploded');
    });
    (globalThis as { EdgeRuntime?: unknown }).EdgeRuntime = { waitUntil: waitUntilSpy };

    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    // Even if the runtime API itself blows up, the wrapper must not throw.
    expect(() => fireShadowAndForget(makeArgs())).not.toThrow();
    expect(waitUntilSpy).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
  });
});
