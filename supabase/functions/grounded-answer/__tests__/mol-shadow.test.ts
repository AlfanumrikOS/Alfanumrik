// supabase/functions/grounded-answer/__tests__/mol-shadow.test.ts
// C4 foundation (2026-05-19) — shadow-helper unit tests.
//
// Runs under Vitest. Companion file alongside mol-telemetry-adapter.test.ts;
// uses the same mocking strategy:
//   - vi.mock the `_shared/mol/index`     module so generateResponse is a spy
//   - vi.mock the `_shared/mol/telemetry` module so recordMolRequest is a spy
//   - vi.mock the `_shared/mol/feature-flag` module so getFlagEnvelope is a
//     spy whose envelope we configure per-test
//
// What we verify:
//   1. Every short-circuit path (enabled=false, kill_switch=true, task not in
//      allow-list, rollout=0) produces ZERO generateResponse calls and ZERO
//      recordMolRequest calls.
//   2. A sample HIT (envelope.enabled=true, task allowed, rollout=100) fires
//      exactly one generateResponse call AND records exactly one shadow-tagged
//      row with shadow_role='shadow' and shadow_of_request_id matching the
//      baseline's request_id.
//   3. generateResponse throwing is swallowed; a failure row is recorded.
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

// ─── Happy path: sample hits, shadow row written ─────────────────────────────

describe('shadowFireOpenAI — sample hit', () => {
  it('rollout_pct=100 + task allowed + enabled → calls generateResponse once and records shadow row', async () => {
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
    // openai, carries the baseline request_id, and the surface label.
    const req = generateResponseSpy.mock.calls[0][0];
    expect(req.config.preferred_provider).toBe('openai');
    expect(req.config.request_id).toBe('baseline-req-id');
    expect(req.config.surface).toBe('foxy');
    expect(req.task_type).toBe('doubt_solving');

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.shadow_role).toBe('shadow');
    expect(payload.shadow_of_request_id).toBe('baseline-req-id');
    expect(payload.request_id).toBe('baseline-req-id');
    expect(payload.trace_id).toBe('trace-uuid-stub');
    expect(payload.provider).toBe('openai');
    expect(payload.model).toBe('gpt-4o-mini');
    expect(payload.tokens).toEqual({ prompt: 200, completion: 350 });
    expect(payload.failure_chain).toBeNull();
    expect(payload.task_type).toBe('doubt_solving');
    expect(payload.surface).toBe('foxy');
    expect(payload.student_id).toBe('student-uuid-stub');
    expect(payload.grade).toBe('8');
    expect(payload.language).toBe('en');
    expect(payload.exam_goal).toBe('cbse');
  });

  it('null student_id propagates as null in the shadow row', async () => {
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

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.student_id).toBeNull();
    expect(payload.grade).toBeNull();
    expect(payload.language).toBeNull();
    expect(payload.exam_goal).toBeNull();

    // generateResponse still received a non-null student_id (synthetic) so
    // its input validation doesn't trip — this is the helper's job.
    const req = generateResponseSpy.mock.calls[0][0];
    expect(req.student_context.student_id).toMatch(/^anon-shadow-/);
  });

  it('null trace_id propagates as null in the shadow row', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());

    await shadowFireOpenAI(makeArgs({ trace_id: null }));

    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.trace_id).toBeNull();
  });
});

// ─── Failure isolation ───────────────────────────────────────────────────────

describe('shadowFireOpenAI — failure isolation', () => {
  it('generateResponse rejects → helper swallows, writes failure row with shadow_role=shadow', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockRejectedValueOnce(new Error('OpenAI 503 — overloaded'));

    await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();

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

    const payload = recordMolRequestSpy.mock.calls[0][0];
    expect(payload.failure_chain).toBe('openai:auth');
  });

  it('recordMolRequest throws synchronously → helper still returns void (no rethrow)', async () => {
    getFlagEnvelopeSpy.mockResolvedValueOnce(
      envelope({
        enabled: true,
        task_types: ['doubt_solving'],
        rollout_pct: 100,
      }),
    );
    generateResponseSpy.mockResolvedValueOnce(okMolResult());
    recordMolRequestSpy.mockImplementation(() => {
      throw new Error('supabase client construct failed');
    });

    await expect(shadowFireOpenAI(makeArgs())).resolves.toBeUndefined();

    // Spy WAS called (proves we reached recordMolRequest before it threw).
    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
  });

  it('recordMolRequest throws synchronously on the failure path too', async () => {
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

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
    expect(recordMolRequestSpy.mock.calls[0][0].shadow_role).toBe('shadow');
  });

  it('returns void synchronously on success path too', async () => {
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

    expect(recordMolRequestSpy).toHaveBeenCalledTimes(1);
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
