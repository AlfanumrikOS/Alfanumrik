/**
 * Model Gateway — Orchestrator behavior (Phase 1).
 *
 * `callModel(req, opts)` is the single entry point. These tests inject FAKE
 * adapters (per testing rule 2 — mock the provider boundary, not the routing
 * logic) and mock only the feature-flag read + the telemetry sinks, so the real
 * router + real registry + real fallback loop run.
 *
 * Contracts pinned here:
 *   - FLAG GATE: with ff_model_gateway_v1 OFF, ANY requested policy is forced to
 *     `default` — the flag-OFF world is byte-identical to today's legacy
 *     Anthropic-primary chain (this is the additive-no-op guarantee).
 *   - FALLBACK: a transient (non-fail-fast) failure advances to the next model.
 *   - FAIL-FAST: a 401/403 auth failure aborts the chain immediately — the
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

// ─── Feature-flag mock (override isFeatureEnabled; keep MODEL_GATEWAY_FLAGS real) ─
const mockIsFeatureEnabled = vi.fn<(...a: unknown[]) => Promise<boolean>>();
vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/feature-flags')>();
  return {
    ...actual,
    isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  };
});

// ─── Telemetry mock (assert emitted fields; keep the suite hermetic / no DB) ──
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

// ─── Fake adapter helpers ─────────────────────────────────────────────────────

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

describe('callModel — flag gate (OFF forces default policy)', () => {
  it('forces default even when the caller requests `cost`, and consults the flag', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    // anthropic succeeds first — proving the DEFAULT chain (Haiku first) ran,
    // not `cost` (which would put gpt-4o-mini first).
    const adapters: AdapterMap = {
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'cost', adapters });

    expect(res.ok).toBe(true);
    expect(res.policy).toBe('default');
    expect(res.modelId).toBe(ANTHROPIC_HAIKU_ID); // default chain head, not cost head
    expect(res.provider).toBe('anthropic');
    expect(res.fallbackCount).toBe(0);
    // The gate must have evaluated the gateway flag.
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
    // quality head would be Sonnet; default head is Haiku.
    expect(res.modelId).toBe(ANTHROPIC_HAIKU_ID);
  });

  it('does NOT consult the flag for an explicit `default` request (default is always available)', async () => {
    const adapters: AdapterMap = { anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)) };
    const res = await callModel(REQ, { policy: 'default', adapters });
    expect(res.policy).toBe('default');
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('flag ON honours the requested non-default policy (`cost` → gpt-4o-mini first)', async () => {
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

describe('callModel — fallback advances on transient failure', () => {
  it('skips a failed Haiku and succeeds on Sonnet, recording the failed attempt', async () => {
    // default policy (flag not needed since request is default)
    const anthropic = fakeAdapter('anthropic', async (d) => {
      if (d.id === ANTHROPIC_HAIKU_ID) {
        return { kind: 'error', failFast: false, error: 'anthropic:5xx', latencyMs: 7 };
      }
      return okOutcome(d.id);
    });
    const res = await callModel(REQ, { policy: 'default', adapters: { anthropic } });

    expect(res.ok).toBe(true);
    expect(res.modelId).toBe(ANTHROPIC_SONNET_ID);
    expect(res.fallbackCount).toBe(1);
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0]).toMatchObject({ modelId: ANTHROPIC_HAIKU_ID, success: false, error: 'anthropic:5xx' });
    expect(res.attempts[1]).toMatchObject({ modelId: ANTHROPIC_SONNET_ID, success: true });
  });

  it('crosses the provider boundary (anthropic all-fail → openai succeeds)', async () => {
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
    const res = await callModel(REQ, { policy: 'default', adapters: { anthropic } });
    expect(res.ok).toBe(true);
    expect(res.modelId).toBe(ANTHROPIC_SONNET_ID);
    expect(res.attempts[0].error).toContain('boom-network');
  });
});

describe('callModel — fail-fast on auth (401/403)', () => {
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

describe('callModel — all candidates fail', () => {
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
    expect(res.error).toBe('openai:5xx'); // last failure surfaced
  });
});

describe('callModel — telemetry emission (metadata only, P13)', () => {
  it('emits a per-attempt record with the documented fields on success', async () => {
    const adapters: AdapterMap = { anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)) };
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
    // Metadata only — telemetry must never carry the prompt/messages (P13).
    expect(JSON.stringify(arg)).not.toContain(REQ.systemPrompt);
  });

  it('emits a success summary naming the answering model', async () => {
    const adapters: AdapterMap = { anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)) };
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

// Reference the full-model id so an unused-import lint never masks a future
// assertion that needs it; also documents the default chain's tail.
it('default chain tail is gpt-4o (documented order sanity)', async () => {
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
});
