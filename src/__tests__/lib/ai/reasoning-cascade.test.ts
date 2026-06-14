import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * GUARD — Foxy Reasoning Cascade (Foxy Reasoning v2 — Phase 1).
 *
 * The cascade is the cross-provider AVAILABILITY fallback. Three tiers, tried in
 * order from a configurable start tier:
 *   base     -> gpt-4o-mini  (callOpenAI mini)
 *   escalate -> gpt-4o       (callOpenAI full)
 *   last     -> Claude Haiku (callClaude)
 *
 * We mock ONLY the two boundary clients (callOpenAI + callClaude) and run the
 * real cascade + logger. Asserted contract:
 *   - base success -> returns tier 'base' (no escalation);
 *   - base throws -> advances to escalate; logs foxy.reasoning.tier_fallback;
 *   - base + escalate throw -> advances to last (Claude);
 *   - ALL tiers throw -> the cascade itself throws (exhausted);
 *   - startTier 'escalate' SKIPS base entirely;
 *   - jsonMode is forwarded to the OpenAI tiers but NOT to the Claude (last) tier
 *     (Claude has no response_format json_object mode).
 */

const _callOpenAI = vi.fn();
const _callClaude = vi.fn();
const _loggerWarn = vi.fn();

vi.mock('@/lib/ai/clients/openai', () => ({
  callOpenAI: (...args: unknown[]) => _callOpenAI(...args),
  OPENAI_MINI_MODEL: 'gpt-4o-mini',
  OPENAI_FULL_MODEL: 'gpt-4o',
}));
vi.mock('@/lib/ai/clients/claude', () => ({
  callClaude: (...args: unknown[]) => _callClaude(...args),
}));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: (...a: unknown[]) => _loggerWarn(...a), error: vi.fn(), debug: vi.fn() },
}));

import { callReasoningModel } from '@/lib/ai/clients/reasoning-cascade';

const REQ = {
  systemPrompt: 'You are a math tutor.',
  messages: [{ role: 'user' as const, content: 'add 1/2 + 3/4' }],
  maxTokens: 256,
  temperature: 0.2,
  timeoutMs: 10_000,
};

function openAIOk(content: string, model: string, tokens = 10) {
  return { content, model, tokensUsed: tokens };
}
function claudeOk(content: string, model = 'claude-haiku-4-5', tokens = 20) {
  return { content, model, tokensUsed: tokens, contentBlocks: [], inputTokens: 0, outputTokens: 0, stopReason: 'end_turn', latencyMs: 1 };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('callReasoningModel — base success', () => {
  it('returns tier "base" with the gpt-4o-mini result and never escalates', async () => {
    _callOpenAI.mockResolvedValueOnce(openAIOk('base answer', 'gpt-4o-mini', 11));

    const result = await callReasoningModel(REQ);

    expect(result.tier).toBe('base');
    expect(result.content).toBe('base answer');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.tokensUsed).toBe(11);
    // base only — no escalation, no Claude.
    expect(_callOpenAI).toHaveBeenCalledTimes(1);
    expect(_callClaude).not.toHaveBeenCalled();
    expect(_loggerWarn).not.toHaveBeenCalled();
    // The first OpenAI call used the mini model.
    expect(_callOpenAI.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o-mini' });
  });
});

describe('callReasoningModel — base throws → escalate', () => {
  it('advances to gpt-4o on a base failure and returns tier "escalate"; logs the fallback', async () => {
    _callOpenAI
      .mockRejectedValueOnce(new Error('OpenAI API error 429')) // base fails
      .mockResolvedValueOnce(openAIOk('escalate answer', 'gpt-4o', 30)); // escalate succeeds

    const result = await callReasoningModel(REQ);

    expect(result.tier).toBe('escalate');
    expect(result.model).toBe('gpt-4o');
    expect(_callOpenAI).toHaveBeenCalledTimes(2);
    expect(_callClaude).not.toHaveBeenCalled();
    // The second OpenAI call used the full model.
    expect(_callOpenAI.mock.calls[1][0]).toMatchObject({ model: 'gpt-4o' });
    // Tier-transition logged base -> escalate (P13: names only).
    expect(_loggerWarn).toHaveBeenCalledWith('foxy.reasoning.tier_fallback', { fromTier: 'base', toTier: 'escalate' });
  });

  it('an empty base result (the OpenAI client throws on empty) also escalates', async () => {
    _callOpenAI
      .mockRejectedValueOnce(new Error('OpenAI API returned empty content'))
      .mockResolvedValueOnce(openAIOk('escalate', 'gpt-4o'));

    const result = await callReasoningModel(REQ);
    expect(result.tier).toBe('escalate');
  });
});

describe('callReasoningModel — base + escalate throw → last (Claude)', () => {
  it('advances to Claude Haiku and returns tier "last"', async () => {
    _callOpenAI
      .mockRejectedValueOnce(new Error('OpenAI API error 500')) // base
      .mockRejectedValueOnce(new Error('OpenAI API error 500')); // escalate
    _callClaude.mockResolvedValueOnce(claudeOk('claude answer'));

    const result = await callReasoningModel(REQ);

    expect(result.tier).toBe('last');
    expect(result.content).toBe('claude answer');
    expect(_callOpenAI).toHaveBeenCalledTimes(2);
    expect(_callClaude).toHaveBeenCalledTimes(1);
    // Two transitions logged: base->escalate, escalate->last.
    expect(_loggerWarn).toHaveBeenCalledWith('foxy.reasoning.tier_fallback', { fromTier: 'base', toTier: 'escalate' });
    expect(_loggerWarn).toHaveBeenCalledWith('foxy.reasoning.tier_fallback', { fromTier: 'escalate', toTier: 'last' });
  });

  it('an empty Claude completion on the last tier is a tier failure → the cascade throws', async () => {
    _callOpenAI
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'));
    _callClaude.mockResolvedValueOnce(claudeOk('   ')); // whitespace-only → treated as empty

    await expect(callReasoningModel(REQ)).rejects.toThrow(/Reasoning cascade exhausted/);
  });
});

describe('callReasoningModel — all tiers throw → cascade throws', () => {
  it('throws "Reasoning cascade exhausted" carrying the last error when every tier fails', async () => {
    _callOpenAI
      .mockRejectedValueOnce(new Error('base down'))
      .mockRejectedValueOnce(new Error('escalate down'));
    _callClaude.mockRejectedValueOnce(new Error('claude down'));

    await expect(callReasoningModel(REQ)).rejects.toThrow(/Reasoning cascade exhausted: claude down/);
    expect(_callOpenAI).toHaveBeenCalledTimes(2);
    expect(_callClaude).toHaveBeenCalledTimes(1);
  });
});

describe('callReasoningModel — startTier skips earlier tiers', () => {
  it('startTier "escalate" calls gpt-4o FIRST and never touches base (gpt-4o-mini)', async () => {
    _callOpenAI.mockResolvedValueOnce(openAIOk('escalate first', 'gpt-4o'));

    const result = await callReasoningModel(REQ, { startTier: 'escalate' });

    expect(result.tier).toBe('escalate');
    expect(_callOpenAI).toHaveBeenCalledTimes(1);
    // The single OpenAI call used the FULL model — base was skipped.
    expect(_callOpenAI.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o' });
  });

  it('startTier "escalate" still falls through to Claude on an escalate failure', async () => {
    _callOpenAI.mockRejectedValueOnce(new Error('escalate down'));
    _callClaude.mockResolvedValueOnce(claudeOk('claude'));

    const result = await callReasoningModel(REQ, { startTier: 'escalate' });

    expect(result.tier).toBe('last');
    // base was never attempted.
    expect(_callOpenAI).toHaveBeenCalledTimes(1);
    expect(_callClaude).toHaveBeenCalledTimes(1);
  });

  it('startTier "last" calls ONLY Claude (both OpenAI tiers skipped)', async () => {
    _callClaude.mockResolvedValueOnce(claudeOk('claude only'));

    const result = await callReasoningModel(REQ, { startTier: 'last' });

    expect(result.tier).toBe('last');
    expect(_callOpenAI).not.toHaveBeenCalled();
    expect(_callClaude).toHaveBeenCalledTimes(1);
  });
});

describe('callReasoningModel — jsonMode forwarding', () => {
  it('forwards jsonMode:true to the OpenAI tiers', async () => {
    _callOpenAI.mockResolvedValueOnce(openAIOk('{"x":1}', 'gpt-4o-mini'));

    await callReasoningModel({ ...REQ, jsonMode: true });

    expect(_callOpenAI.mock.calls[0][0]).toMatchObject({ jsonMode: true });
  });

  it('does NOT forward jsonMode to the Claude (last) tier — Claude has no response_format', async () => {
    _callOpenAI
      .mockRejectedValueOnce(new Error('base down'))
      .mockRejectedValueOnce(new Error('escalate down'));
    _callClaude.mockResolvedValueOnce(claudeOk('claude'));

    await callReasoningModel({ ...REQ, jsonMode: true });

    expect(_callClaude).toHaveBeenCalledTimes(1);
    const claudeArg = _callClaude.mock.calls[0][0] as Record<string, unknown>;
    expect('jsonMode' in claudeArg).toBe(false);
    // Claude still receives the system prompt + messages (the JSON instruction
    // is carried in the prompt itself, not response_format).
    expect(claudeArg.systemPrompt).toBe(REQ.systemPrompt);
  });

  it('forwards jsonMode:true to gpt-4o when starting at the escalate tier', async () => {
    _callOpenAI.mockResolvedValueOnce(openAIOk('{"y":2}', 'gpt-4o'));

    await callReasoningModel({ ...REQ, jsonMode: true }, { startTier: 'escalate' });

    expect(_callOpenAI.mock.calls[0][0]).toMatchObject({ model: 'gpt-4o', jsonMode: true });
  });
});
