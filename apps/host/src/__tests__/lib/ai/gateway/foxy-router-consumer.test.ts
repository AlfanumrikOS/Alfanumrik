/**
 * Model Gateway — classifier consumer equivalence (Phase 1).
 *
 * `classifyWithLLM` (inside foxy-router.ts, reached via the exported
 * `classifyIntent`) is the FIRST real gateway consumer. Its contract:
 *   - flag OFF → legacy direct `callClaude` path (today's behavior, untouched);
 *   - flag ON  → route through `callModel({ policy: 'default' })` (the gateway),
 *                which reproduces the legacy chain byte-for-byte;
 *   - EITHER WAY the return SHAPE is identical, and the throw-on-failure contract
 *     is preserved (classifyIntent catches and falls back to the mode default).
 *
 * This is a non-student-facing, non-grading path (P12-safe): it does not touch
 * grounded Foxy generation, quiz, XP, or P1–P6. We mock the gateway + the Claude
 * client (the provider boundary) and drive the flag per-test.
 *
 * Owner: testing. Enforces: P12. Reviewer: ai-engineer, assessment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Gateway mock: callModel + the flag constant classifyWithLLM reads ────────
const mockCallModel = vi.fn();
vi.mock('@alfanumrik/lib/ai/gateway', () => ({
  callModel: (...a: unknown[]) => mockCallModel(...a),
  GATEWAY_FLAG: 'ff_model_gateway_v1',
}));

// ─── Claude client mock (legacy path) ─────────────────────────────────────────
const mockCallClaude = vi.fn();
vi.mock('@alfanumrik/lib/ai/clients/claude', () => ({
  callClaude: (...a: unknown[]) => mockCallClaude(...a),
}));

// ─── Reasoning cascade mock (ambiguous math branch — unused here, hermetic) ───
vi.mock('@alfanumrik/lib/ai/clients/reasoning-cascade', () => ({
  callReasoningModel: vi.fn(),
}));

// ─── Feature-flag mock: override isFeatureEnabled, keep the rest real ─────────
const mockIsFeatureEnabled = vi.fn<(...a: unknown[]) => Promise<boolean>>();
vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/feature-flags')>();
  return {
    ...actual,
    isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  };
});

import { classifyIntent } from '@alfanumrik/lib/ai/workflows/foxy-router';

// A message with NO strong keyword signal → keyword confidence 0.4 → the
// classifier proceeds to the LLM branch (the unit under test). "learn" mode's
// default intent is 'explain'.
const LOW_SIGNAL = 'tell me about this topic please';
const CLASSIFIER_JSON =
  '{"intent":"explain","confidence":0.7,"reasoning":"conceptual","topic":"Topic","concept":"C"}';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('classifyIntent — flag OFF uses the legacy callClaude path', () => {
  it('calls callClaude, not the gateway, and returns the parsed classification', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    mockCallClaude.mockResolvedValue({ content: CLASSIFIER_JSON });

    const res = await classifyIntent(LOW_SIGNAL, 'Science', '8', 'learn');

    expect(mockCallClaude).toHaveBeenCalledTimes(1);
    expect(mockCallModel).not.toHaveBeenCalled();
    expect(res.intent).toBe('explain');
    expect(res.confidence).toBe(0.7);
    expect(res.extractedTopic).toBe('Topic');
    expect(res.extractedConcept).toBe('C');
  });
});

describe('classifyIntent — flag ON routes through the gateway (default policy)', () => {
  it('calls callModel with policy=default and the same message, not callClaude', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCallModel.mockResolvedValue({ ok: true, content: CLASSIFIER_JSON });

    const res = await classifyIntent(LOW_SIGNAL, 'Science', '8', 'learn');

    expect(mockCallModel).toHaveBeenCalledTimes(1);
    expect(mockCallClaude).not.toHaveBeenCalled();

    const [req, opts] = mockCallModel.mock.calls[0];
    expect(opts).toEqual({ policy: 'default' });
    expect(req.messages[0]).toEqual({ role: 'user', content: LOW_SIGNAL });
    expect(req.maxTokens).toBe(128);
    expect(req.temperature).toBe(0.1);

    // Same return shape as the legacy path.
    expect(res.intent).toBe('explain');
    expect(res.confidence).toBe(0.7);
    expect(res.extractedTopic).toBe('Topic');
  });
});

describe('classifyIntent — return shape is identical across both paths', () => {
  it('flag-OFF and flag-ON produce the same IntentClassification for the same content', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    mockCallClaude.mockResolvedValue({ content: CLASSIFIER_JSON });
    const off = await classifyIntent(LOW_SIGNAL, 'Science', '8', 'learn');

    vi.clearAllMocks();
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCallModel.mockResolvedValue({ ok: true, content: CLASSIFIER_JSON });
    const on = await classifyIntent(LOW_SIGNAL, 'Science', '8', 'learn');

    expect(on).toEqual(off);
  });
});

describe('classifyIntent — gateway failure preserves the throw-on-failure fallback', () => {
  it('a gateway { ok:false } falls back to the mode default (never throws)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    mockCallModel.mockResolvedValue({ ok: false, error: 'all models exhausted' });

    const res = await classifyIntent(LOW_SIGNAL, 'Science', '8', 'learn');

    // classifyWithLLM throws on !ok → classifyIntent catches → mode-default fallback.
    expect(res.confidence).toBe(0.3);
    expect(res.reasoning).toContain('Fallback to mode default');
    expect(res.intent).toBe('explain'); // learn → explain default
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it('a legacy callClaude throw also falls back to the mode default (parity)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    mockCallClaude.mockRejectedValue(new Error('claude down'));

    const res = await classifyIntent(LOW_SIGNAL, 'Science', '8', 'learn');
    expect(res.confidence).toBe(0.3);
    expect(res.reasoning).toContain('Fallback to mode default');
    expect(res.intent).toBe('explain');
  });
});
