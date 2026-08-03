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
 *     OpenAI-primary chain (Claude retained as fallback; this is the
 *     additive-no-op guarantee).
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
    // `default` and `cost` now BOTH start at gpt-4o-mini (OpenAI-primary
    // swap), so a same-head success can't distinguish which chain ran. Make
    // mini fail and look at what answers SECOND instead: default's next hop
    // is gpt-4o (openai), cost's next hop is Haiku (anthropic) — divergent
    // enough to prove which chain actually executed.
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => {
        if (d.id === OPENAI_MINI_ID) {
          return { kind: 'error', failFast: false, error: 'openai:5xx', latencyMs: 1 };
        }
        return okOutcome(d.id);
      }),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'cost', adapters });

    expect(res.ok).toBe(true);
    expect(res.policy).toBe('default');
    expect(res.modelId).toBe(OPENAI_FULL_ID); // default's 2nd hop, not cost's 2nd hop (Haiku)
    expect(res.provider).toBe('openai');
    expect(res.fallbackCount).toBe(1);
    // The gate must have evaluated the gateway flag.
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(GATEWAY_FLAG, expect.anything());
    // anthropic adapter must NOT have been tried (gpt-4o answered second).
    expect((adapters.anthropic!.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('forces default even when the caller requests `quality`', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const adapters: AdapterMap = {
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'quality', adapters });
    expect(res.policy).toBe('default');
    // quality head would be Sonnet; default head is gpt-4o-mini (OpenAI-primary).
    expect(res.modelId).toBe(OPENAI_MINI_ID);
  });

  it('does NOT consult the flag for an explicit `default` request (default is always available)', async () => {
    // Both providers mocked explicitly (hermetic). An anthropic-only map
    // would, post-reorder, fall through to the REAL DEFAULT_ADAPTERS.openai
    // (callModel merges caller overrides with the real adapters per-provider)
    // — it happens to fail safely today only because OPENAI_API_KEY is unset
    // in this environment, which is an environment accident, not a guarantee.
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    const res = await callModel(REQ, { policy: 'default', adapters });
    expect(res.policy).toBe('default');
    expect(res.modelId).toBe(OPENAI_MINI_ID);
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
  it('skips a failed mini and succeeds on gpt-4o, recording the failed attempt', async () => {
    // default policy (flag not needed since request is default). anthropic is
    // mocked explicitly too, even though it should never be invoked — mini's
    // provider-internal fallback to gpt-4o resolves the request first, and an
    // anthropic-only map would silently exercise the REAL openai adapter for
    // the first (failing) attempt instead of this fake.
    const openai = fakeAdapter('openai', async (d) => {
      if (d.id === OPENAI_MINI_ID) {
        return { kind: 'error', failFast: false, error: 'openai:5xx', latencyMs: 7 };
      }
      return okOutcome(d.id);
    });
    const anthropic = fakeAdapter('anthropic', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, { policy: 'default', adapters: { openai, anthropic } });

    expect(res.ok).toBe(true);
    expect(res.modelId).toBe(OPENAI_FULL_ID);
    expect(res.fallbackCount).toBe(1);
    expect(res.attempts).toHaveLength(2);
    expect(res.attempts[0]).toMatchObject({ modelId: OPENAI_MINI_ID, success: false, error: 'openai:5xx' });
    expect(res.attempts[1]).toMatchObject({ modelId: OPENAI_FULL_ID, success: true });
    expect((anthropic.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('crosses the provider boundary (openai all-fail → anthropic succeeds)', async () => {
    // Post OpenAI-primary swap, OpenAI is the primary tier and Claude is the
    // reliability fallback — this test now exercises that exact fallback path
    // (mirrors the pre-swap test, providers swapped).
    const openai = fakeAdapter('openai', async () => ({
      kind: 'error' as const, failFast: false, error: 'openai:timeout', latencyMs: 5,
    }));
    const anthropic = fakeAdapter('anthropic', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, { policy: 'default', adapters: { anthropic, openai } });

    expect(res.ok).toBe(true);
    expect(res.provider).toBe('anthropic');
    expect(res.modelId).toBe(ANTHROPIC_HAIKU_ID); // first anthropic model in the default chain
    expect(res.fallbackCount).toBe(2); // mini + gpt-4o failed first
  });

  it('normalizes a thrown adapter error into a non-fail-fast advance', async () => {
    // Both providers mocked explicitly (see the "does NOT consult the flag"
    // test above for why an anthropic-only map is unsafe post-reorder).
    const openai = fakeAdapter('openai', async (d) => {
      if (d.id === OPENAI_MINI_ID) throw new Error('boom-network');
      return okOutcome(d.id);
    });
    const anthropic = fakeAdapter('anthropic', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, { policy: 'default', adapters: { openai, anthropic } });
    expect(res.ok).toBe(true);
    expect(res.modelId).toBe(OPENAI_FULL_ID);
    expect(res.attempts[0].error).toContain('boom-network');
    expect((anthropic.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('callModel — fail-fast on auth (401/403)', () => {
  it('aborts the whole chain on a fail-fast auth error and does not try later models', async () => {
    const openai = fakeAdapter('openai', async (d) => {
      if (d.id === OPENAI_MINI_ID) {
        return { kind: 'error', failFast: true, error: 'openai 401 unauthorized', latencyMs: 3 };
      }
      return okOutcome(d.id);
    });
    const anthropic = fakeAdapter('anthropic', async (d) => okOutcome(d.id));
    const res = await callModel(REQ, { policy: 'default', adapters: { anthropic, openai } });

    expect(res.ok).toBe(false);
    expect(res.attempts).toHaveLength(1); // stopped after the auth failure
    expect(res.error).toContain('401');
    // gpt-4o + both anthropic models must never be invoked.
    expect((openai.invoke as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((anthropic.invoke as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
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
    // anthropic is now the fallback tier (tried last in the OpenAI-primary
    // chain), so its error is the last one surfaced.
    expect(res.error).toBe('anthropic:timeout'); // last failure surfaced
  });
});

describe('callModel — telemetry emission (metadata only, P13)', () => {
  it('emits a per-attempt record with the documented fields on success', async () => {
    // Both providers mocked explicitly (an anthropic-only map would silently
    // fall through to the REAL openai adapter now that OpenAI is primary).
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    await callModel(REQ, { policy: 'default', adapters });

    expect(emitAttempt).toHaveBeenCalled();
    const arg = emitAttempt.mock.calls[0][0];
    expect(arg).toMatchObject({
      modelId: OPENAI_MINI_ID,
      provider: 'openai',
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
    // Both providers mocked explicitly (same rationale as above — this test
    // previously mocked anthropic only and passed "by accident" because the
    // assertion doesn't care about fallbackCount/attempt shape, only the
    // FINAL model; it would have silently exercised the real openai adapter
    // first under the new order).
    const adapters: AdapterMap = {
      openai: fakeAdapter('openai', async (d) => okOutcome(d.id)),
      anthropic: fakeAdapter('anthropic', async (d) => okOutcome(d.id)),
    };
    await callModel(REQ, { policy: 'default', adapters });
    expect(emitSummary).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, modelId: OPENAI_MINI_ID, provider: 'openai', policy: 'default' }),
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

// Documents the default chain's new tail position (Claude Sonnet, retained as
// the reliability fallback after the 2026-08-02 OpenAI-primary swap).
it('default chain tail is Claude Sonnet (documented order sanity, post OpenAI-primary swap)', async () => {
  const openai = fakeAdapter('openai', async () => ({
    kind: 'error' as const, failFast: false, error: 'a', latencyMs: 1,
  }));
  const anthropic = fakeAdapter('anthropic', async (d) => {
    if (d.id === ANTHROPIC_SONNET_ID) return okOutcome(d.id);
    return { kind: 'error', failFast: false, error: 'b', latencyMs: 1 };
  });
  const res = await callModel(REQ, { policy: 'default', adapters: { anthropic, openai } });
  expect(res.ok).toBe(true);
  expect(res.modelId).toBe(ANTHROPIC_SONNET_ID);
  expect(res.attempts).toHaveLength(4); // mini, gpt-4o, Haiku all failed before Sonnet
});
