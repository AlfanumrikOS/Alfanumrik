/**
 * Model Gateway -- Orchestrator behavior (Phase 1).
 *
 * `callModel(req, opts)` is the single entry point. These tests inject FAKE
 * adapters (per testing rule 2 -- mock the provider boundary, not the routing
 * logic) and mock only the feature-flag read + the telemetry sinks, so the real
 * router + real registry + real fallback loop run.
 *
 * Contracts pinned here:
 *   - FLAG GATE: with ff_model_gateway_v1 OFF, ANY requested policy is forced to
 *     `default` -- the flag-OFF world is byte-identical to today's legacy
 *     Claude-primary chain (OpenAI retained as fallback; this is the
 *     additive-no-op guarantee).
 *   - FALLBACK: a transient (non-fail-fast) failure advances to the next model.
 *   - FAIL-FAST: a 401/403 auth failure aborts the chain immediately -- the
 *     remaining models are NOT tried (a different model, same key, won't help).
 *   - TELEMETRY: every attempt + the per-call summary emit the documented
 *     metadata fields (no PII).
 *   - ALL-FAILED: returns a structured { ok:false } result and never throws.
 *
 * Owner: testing. Enforces: P12 (AI safety / provider). Reviewer: ai-engineer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AdapterMap,
  AdapterOutcome,
  GatewayRequest,
  ModelDescriptor,
  ProviderAdapter,
  ProviderId,
} from '@alfanumrik/lib/ai/gateway';

// -- Feature-flag mock (override isFeatureEnabled; keep MODEL_GATEWAY_FLAGS real) --
const mockIsFeatureEnabled = vi.fn<(...a: unknown[]) => Promise<boolean>>();
vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/feature-flags')>();
  return {
    ...actual,
    isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  };
});

// -- Telemetry mock (assert emitted fields; keep the suite hermetic / no DB) --
const emitAttempt = vi.fn();
const emitSummary = vi.fn();
vi.mock('@alfanumrik/lib/ai/gateway/telemetry', () => ({
  emitGatewayAttempt: (...a: unknown[]) => emitAttempt(...a),
  emitGatewaySummary: (...a: unknown[]) => emitSummary(...a),
}));

// Import AFTER the mocks are registered (vi.mock is hoisted, but keep intent clear).
import {
  callModel,
  GATEWAY_FLAG,
  ANTHROPIC_HAIKU_ID,
  ANTHROPIC_SONNET_ID,
  OPENAI_MINI_ID,
  OPENAI_FULL_ID,
} from '@alfanumrik/lib/ai/gateway';

// -- Fake adapter helpers --

function okOutcome(model: string): AdapterOutcome {
  return { kind: 'ok', content: `answer from ${model}`, model, inputTokens: 10, outputTokens: 20, latencyMs: 42 };
}

/** Build a provider adapter whose invoke() is driven by the supplied fn. */
function fakeAdapter(
  provider: ProviderId,
  invoke: (d: ModelDescriptor, r: GatewayRequest) => Promise<AdapterOutcome>,
): ProviderAdapter {
  return { provider, invoke: vi.fn(invoke) as ProviderAdapter['invoke'] };
}

const REQ: GatewayRequest = {
  systemPrompt: 'sys',
  messages: [{ role: 'user', content: 'hi' }],
  maxTokens: 128,
  temperature: 0.1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('callModel -- flag gate (OFF forces default policy)', () => {
  it('forces default even when the caller requests `cost`, and consults the flag', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    // `default` starts at Haiku (Claude-primary); `cost` starts at mini
    // (cheapest). Heads already differ, so just check the head.
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'cost', adapters });

    expect(res.ok).toBe(true);
    expect(res.policy).toBe('default');
    expect(res.modelId).toBe(ANTHROPIC_HAIKU_ID); // default's head (Claude-primary), not cost's head (mini)
    expect(res.provider).toBe('anthropic');
    expect(res.fallbackCount).toBe(0);
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(GATEWAY_FLAG, expect.anything());
    // openai adapter must NOT have been tried (Haiku answered first).
    expect((adapters.openai!.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('forces default even when the caller requests `quality`', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const adapters: AdapterMap = {
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'quality', adapters });
    expect(res.policy).toBe('default');
    // quality head would be Sonnet; default head is Haiku (Claude-primary).
    expect(res.modelId).toBe(ANTHROPIC_HAIKU_ID);
  });

  it('does NOT consult the flag for an explicit `default` request (default is always available)', async () => {
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'default', adapters });
    expect(res.policy).toBe('default');
    expect(res.modelId).toBe(ANTHROPIC_HAIKU_ID);
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('flag ON honours the requested non-default policy (`cost` -> gpt-4o-mini first)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const adapters: AdapterMap = {
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'cost', adapters });
    expect(res.ok).toBe(true);
    expect(res.policy).toBe('cost');
    expect(res.modelId).toBe(OPENAI_MINI_ID); // cheapest configured model
    expect(res.provider).toBe('openai');
  });
});

describe('callModel -- fallback advances on transient failure', () => {
  it('skips a failed Haiku and succeeds on Sonnet, recording the failed attempt', async () => {
    // default policy (Claude-primary): [Haiku, Sonnet, mini, full].
    // Make Haiku fail; Sonnet (same provider, next in chain) answers.
    const anthropic = fakeAdapter('anthropic', async (d) => {
      if (d.id === ANTHROPIC_HAIKU_ID) {
        return { kind: 'error', failFast: false, error: 'anthropic:5xx', latencyMs: 7 };
      }
      return okOutcome(d.id);
    });
    const openai = fakeAdapter('openai', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, { policy: 'default', adapters: { openai, anthropic } });

    expect(res.ok).toBe(true);
    expect(res.modelId).toBe(ANTHROPIC_SONNET_ID);
    expect(res.fallbackCount).toBe(1);
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0]).toMatchObject({ modelId: ANTHROPIC_HAIKU_ID, success: false, error: 'anthropic:5xx' });
    expect(res.attempts[1]).toMatchObject({ modelId: ANTHROPIC_SONNET_ID, success: true });
    expect((openai.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('crosses the provider boundary (anthropic all-fail -> openai succeeds)', async () => {
    // Claude-primary: Claude is the primary tier, OpenAI is the reliability
    // fallback. This test exercises the cross-provider fallback path.
    const anthropic = fakeAdapter('anthropic', async () => ({
      kind: 'error' as const, failFast: false, error: 'anthropic:timeout', latencyMs: 5,
    }));
    const openai = fakeAdapter('openai', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, { policy: 'default', adapters: { anthropic, openai } });

    expect(res.ok).toBe(true);
    expect(res.provider).toBe('openai');
    expect(res.modelId).toBe(OPENAI_MINI_ID); // first openai model in the default chain
    expect(res.fallbackCount).toBe(2); // Haiku + Sonnet failed first
  });

  it('normalizes a thrown adapter error into a non-fail-fast advance', async () => {
    const anthropic = fakeAdapter('anthropic', async (d) => {
      if (d.id === ANTHROPIC_HAIKU_ID) throw new Error('boom-network');
      return okOutcome(d.id);
    });
    const openai = fakeAdapter('openai', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, { policy: 'default', adapters: { openai, anthropic } });
    expect(res.ok).toBe(true);
    expect(res.modelId).toBe(ANTHROPIC_SONNET_ID);
    expect(res.attempts[0].error).toContain('boom-network');
    expect((openai.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('callModel -- fail-fast on auth (401/403)', () => {
  it('aborts the whole chain on a fail-fast auth error and does not try later models', async () => {
    const anthropic = fakeAdapter('anthropic', async (d) => {
      if (d.id === ANTHROPIC_HAIKU_ID) {
        return { kind: 'error', failFast: true, error: 'anthropic 401 unauthorized', latencyMs: 3 };
      }
      return okOutcome(d.id);
    });
    const openai = fakeAdapter('openai', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, { policy: 'default', adapters: { anthropic, openai } });

    expect(res.ok).toBe(false);
    expect(res.attempts).toHaveLength(1); // stopped after the auth failure
    expect(res.error).toContain('401');
    // Sonnet + both openai models must never be invoked.
    expect((anthropic.invoke as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((openai.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('callModel -- all candidates fail', () => {
  it('returns a structured failure result and does not throw', async () => {
    const anthropic = fakeAdapter('anthropic', async () => ({
      kind: 'error' as const, failFast: false, error: 'anthropic:timeout', latencyMs: 4,
    }));
    const openai = fakeAdapter('openai', async () => ({
      kind: 'error' as const, failFast: false, error: 'openai:5xx', latencyMs: 6,
    }));
    const res = await callModel(REQ, { policy: 'default', adapters: { anthropic, openai } });

    expect(res.ok).toBe(false);
    expect(res.provider).toBe('none');
    expect(res.modelId).toBe('');
    expect(res.content).toBe('');
    expect(res.attempts).toHaveLength(4); // all four default-chain models tried
    // openai is now the fallback tier (tried last in the Claude-primary
    // chain), so its error is the last one surfaced.
    expect(res.error).toBe('openai:5xx'); // last failure surfaced
  });
});

describe('callModel -- telemetry emission (metadata only, P13)', () => {
  it('emits a per-attempt record with the documented fields on success', async () => {
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    await callModel(REQ, { policy: 'default', adapters });

    expect(emitAttempt).toHaveBeenCalled();
    const arg = emitAttempt.mock.calls[0][0];
    expect(arg).toMatchObject({
      modelId: ANTHROPIC_HAIKU_ID,
      provider: 'anthropic',
      policy: 'default',
      success: true,
      fallbackCount: 0,
    });
    for (const key of ['modelId', 'provider', 'policy', 'inputTokens', 'outputTokens', 'estimatedCostUsd', 'latencyMs', 'fallbackCount', 'success']) {
      expect(arg, `attempt telemetry missing ${key}`).toHaveProperty(key);
    }
    // Metadata only -- telemetry must never carry the prompt/messages (P13).
    expect(JSON.stringify(arg)).not.toContain(REQ.systemPrompt);
  });

  it('emits a success summary naming the answering model', async () => {
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    await callModel(REQ, { policy: 'default', adapters });
    expect(emitSummary).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, modelId: ANTHROPIC_HAIKU_ID, provider: 'anthropic', policy: 'default' }),
    );
  });

  it('emits a failure summary when every model is exhausted', async () => {
    const anthropic = fakeAdapter('anthropic', async () => ({
      kind: 'error' as const, failFast: false, error: 'x', latencyMs: 1,
    }));
    const openai = fakeAdapter('openai', async () => ({
      kind: 'error' as const, failFast: false, error: 'y', latencyMs: 1,
    }));
    await callModel(REQ, { policy: 'default', adapters: { anthropic, openai } });
    expect(emitSummary).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, provider: 'none' }),
    );
  });
});

// Documents the default chain's new tail position (OpenAI gpt-4o, retained as
// the reliability fallback after the 2026-08-26 Claude-primary swap back).
it('default chain tail is OpenAI gpt-4o (documented order sanity, post Claude-primary swap)', async () => {
  const anthropic = fakeAdapter('anthropic', async () => ({
    kind: 'error' as const, failFast: false, error: 'a', latencyMs: 1,
  }));
  const openai = fakeAdapter('openai', async (d) => {
    if (d.id === OPENAI_FULL_ID) return okOutcome(d.id);
    return { kind: 'error', failFast: false, error: 'b', latencyMs: 1 };
  });
  const res = await callModel(REQ, { policy: 'default', adapters: { anthropic, openai } });
  expect(res.ok).toBe(true);
  expect(res.modelId).toBe(OPENAI_FULL_ID);
  expect(res.attempts).toHaveLength(4); // Haiku, Sonnet, mini all failed before gpt-4o
});

// -- Percentage-rollout mechanism (2026-08-03) -- end-to-end via callModel --
// Dedicated resolveDefaultChain unit tests live in rollout.test.ts. These
// prove the FULL callModel integration: a caller id in opts.flagContext
// really does move the `default` policy's resolved chain between
// Claude-primary and the OpenAI-primary rollback order.
describe('callModel -- percentage-rollout mechanism (ff_foxy_openai_primary_rollout_v1)', () => {
  it('explicit default policy + no flagContext.userId -> never consults ANY flag (today\'s callers, unaffected)', async () => {
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'default', adapters });
    expect(res.modelId).toBe(ANTHROPIC_HAIKU_ID);
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('explicit default policy + flagContext.userId, rollout flag OFF -> resolves Claude-primary (unchanged)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, {
      policy: 'default',
      adapters,
      flagContext: { userId: 'student-out-of-bucket' },
    });
    expect(res.modelId).toBe(ANTHROPIC_HAIKU_ID);
    expect(res.provider).toBe('anthropic');
  });

  it('explicit default policy + flagContext.userId, rollout flag ON (in-bucket) -> resolves OpenAI-primary rollback', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, {
      policy: 'default',
      adapters,
      flagContext: { userId: 'student-in-rollback-bucket' },
    });
    // OpenAI-primary rollback auto order is [mini, full, Haiku, Sonnet] -- mini answers first.
    expect(res.modelId).toBe(OPENAI_MINI_ID);
    expect(res.provider).toBe('openai');
    // anthropic must never have been tried.
    expect((adapters.anthropic!.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('rollout flag ON but that specific model fails -> falls through the OpenAI-primary rollback chain, not the Claude-primary one', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const openai = fakeAdapter('openai', async (d) => {
      if (d.id === OPENAI_MINI_ID) {
        return { kind: 'error', failFast: false, error: 'openai:5xx', latencyMs: 1 };
      }
      return okOutcome(d.id); // gpt-4o (2nd in OpenAI-primary rollback order) answers
    });
    const anthropic = fakeAdapter('anthropic', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, {
      policy: 'default',
      adapters: { anthropic, openai },
      flagContext: { userId: 'student-in-rollback-bucket' },
    });
    expect(res.ok).toBe(true);
    expect(res.modelId).toBe(OPENAI_FULL_ID); // 2nd hop in OpenAI-primary rollback, not Haiku
    expect(res.fallbackCount).toBe(1);
    expect((anthropic.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
