/**
 * Model Gateway — config.ts model-name byte-identity (Phase 1).
 *
 * config.ts's HAIKU/SONNET model NAMES are now DERIVED from the gateway registry
 * id constants (single source of truth) instead of being inline literals. This
 * refactor MUST be a pure no-op: every legacy caller of getAIConfig() has to see
 * exactly the same model-name strings it saw before, or the "flag-OFF is
 * byte-identical" guarantee breaks at the config layer.
 *
 * This test pins the exact pre-change literals so a future registry edit that
 * changed a model id would fail HERE (loudly) rather than silently repoint every
 * legacy AI caller onto a different model — a P12 provider-change that requires
 * explicit user approval.
 *
 * Owner: testing. Enforces: P12. Reviewer: ai-engineer.
 */

import { describe, it, expect } from 'vitest';
import { getAIConfig } from '@alfanumrik/lib/ai/config';
import { ANTHROPIC_HAIKU_ID, ANTHROPIC_SONNET_ID } from '@alfanumrik/lib/ai/gateway';

// The exact pre-registry literals. These are frozen by contract — changing them
// is an AI-provider/model change (user approval required).
const HAIKU_LITERAL = 'claude-haiku-4-5-20251001';
const SONNET_LITERAL = 'claude-sonnet-4-20250514';

describe('config.ts model-name byte-identity', () => {
  it('primaryModel.name equals the frozen Haiku literal', () => {
    expect(getAIConfig().primaryModel.name).toBe(HAIKU_LITERAL);
  });

  it('fallbackModel.name equals the frozen Sonnet literal', () => {
    expect(getAIConfig().fallbackModel.name).toBe(SONNET_LITERAL);
  });

  it('config names are sourced from the registry id constants (single source of truth)', () => {
    expect(ANTHROPIC_HAIKU_ID).toBe(HAIKU_LITERAL);
    expect(ANTHROPIC_SONNET_ID).toBe(SONNET_LITERAL);
    expect(getAIConfig().primaryModel.name).toBe(ANTHROPIC_HAIKU_ID);
    expect(getAIConfig().fallbackModel.name).toBe(ANTHROPIC_SONNET_ID);
  });

  it('request-shaping params are unchanged (Haiku 1024 tok / Sonnet 2048 tok)', () => {
    const cfg = getAIConfig();
    expect(cfg.primaryModel.maxTokens).toBe(1024);
    expect(cfg.fallbackModel.maxTokens).toBe(2048);
  });
});
