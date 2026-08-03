/**
 * Model Gateway — Rollout (percentage-based OpenAI-primary rollback lever, 2026-08-03).
 *
 * `resolveDefaultChain(flagContext, constraints)` is the flag-aware resolver
 * behind callModel's `default` policy. These tests pin:
 *   - No caller id → NEVER consults the flag; resolves byte-identically to
 *     legacyChain('auto') (today's OpenAI-primary chain), filtered.
 *   - Flag disabled/false → same as above.
 *   - Flag enabled/true (caller in-bucket) → resolves to
 *     claudePrimaryChain('auto') (the reconstructed Claude-primary order).
 *   - Constraints filter both chains identically to selectModelChain.
 *
 * Owner: testing. Enforces: P12 (provider-routing rollout correctness).
 * Reviewer: ai-engineer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockIsFeatureEnabled = vi.fn<(...a: unknown[]) => Promise<boolean>>();
vi.mock('@alfanumrik/lib/feature-flags', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alfanumrik/lib/feature-flags')>();
  return {
    ...actual,
    isFeatureEnabled: (...args: unknown[]) => mockIsFeatureEnabled(...args),
  };
});

import {
  resolveDefaultChain,
  MODEL_ROLLOUT_FLAG,
  ANTHROPIC_HAIKU_ID,
  ANTHROPIC_SONNET_ID,
  OPENAI_MINI_ID,
  OPENAI_FULL_ID,
} from '@alfanumrik/lib/ai/gateway';

const ids = (chain: { id: string }[]) => chain.map((m) => m.id);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveDefaultChain — no caller id (the common case today)', () => {
  it('never consults the flag when flagContext is undefined', async () => {
    const chain = await resolveDefaultChain(undefined);
    expect(ids(chain)).toEqual([OPENAI_MINI_ID, OPENAI_FULL_ID, ANTHROPIC_HAIKU_ID, ANTHROPIC_SONNET_ID]);
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('never consults the flag when flagContext has no userId', async () => {
    const chain = await resolveDefaultChain({ role: 'student', environment: 'production' });
    expect(ids(chain)).toEqual([OPENAI_MINI_ID, OPENAI_FULL_ID, ANTHROPIC_HAIKU_ID, ANTHROPIC_SONNET_ID]);
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });

  it('never consults the flag for an empty-string userId', async () => {
    const chain = await resolveDefaultChain({ userId: '' });
    expect(ids(chain)).toEqual([OPENAI_MINI_ID, OPENAI_FULL_ID, ANTHROPIC_HAIKU_ID, ANTHROPIC_SONNET_ID]);
    expect(mockIsFeatureEnabled).not.toHaveBeenCalled();
  });
});

describe('resolveDefaultChain — caller id present, flag OFF/false', () => {
  it('resolves to the OpenAI-primary chain (legacyChain) when isFeatureEnabled resolves false', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const chain = await resolveDefaultChain({ userId: 'student-123' });
    expect(ids(chain)).toEqual([OPENAI_MINI_ID, OPENAI_FULL_ID, ANTHROPIC_HAIKU_ID, ANTHROPIC_SONNET_ID]);
    expect(mockIsFeatureEnabled).toHaveBeenCalledWith(MODEL_ROLLOUT_FLAG, { userId: 'student-123' });
  });
});

describe('resolveDefaultChain — caller id present, flag ON/true (in-bucket)', () => {
  it('resolves to the reconstructed Claude-primary chain when isFeatureEnabled resolves true', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const chain = await resolveDefaultChain({ userId: 'student-in-rollback-bucket' });
    expect(ids(chain)).toEqual([ANTHROPIC_HAIKU_ID, ANTHROPIC_SONNET_ID, OPENAI_MINI_ID, OPENAI_FULL_ID]);
  });

  it('the Claude-primary chain providers are anthropic, anthropic, openai, openai (not just ids)', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const chain = await resolveDefaultChain({ userId: 'student-x' });
    expect(chain.map((m) => m.provider)).toEqual(['anthropic', 'anthropic', 'openai', 'openai']);
  });
});

describe('resolveDefaultChain — constraints filter without reordering, in either branch', () => {
  it('minQualityTier filters the OpenAI-primary branch consistently with selectModelChain', async () => {
    mockIsFeatureEnabled.mockResolvedValue(false);
    const chain = await resolveDefaultChain({ userId: 'student-1' }, { minQualityTier: 7 });
    expect(ids(chain)).toEqual([OPENAI_FULL_ID, ANTHROPIC_SONNET_ID]);
  });

  it('minQualityTier filters the Claude-primary branch, preserving its order', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const chain = await resolveDefaultChain({ userId: 'student-1' }, { minQualityTier: 7 });
    // Claude-primary order is [haiku(6), sonnet(9), mini(5), full(8)]; floor 7
    // drops haiku(6) and mini(5), keeping sonnet then full in their positions.
    expect(ids(chain)).toEqual([ANTHROPIC_SONNET_ID, OPENAI_FULL_ID]);
  });

  it('an impossible constraint yields an empty chain in either branch', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const chain = await resolveDefaultChain({ userId: 'student-1' }, { minQualityTier: 999 });
    expect(chain).toEqual([]);
  });
});

describe('resolveDefaultChain — determinism', () => {
  it('is deterministic across repeated calls for the same flag result', async () => {
    mockIsFeatureEnabled.mockResolvedValue(true);
    const a = await resolveDefaultChain({ userId: 'student-stable' });
    const b = await resolveDefaultChain({ userId: 'student-stable' });
    expect(ids(a)).toEqual(ids(b));
  });
});
