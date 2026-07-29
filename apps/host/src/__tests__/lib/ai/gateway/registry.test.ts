/**
 * Model Gateway — Registry integrity (Phase 1).
 *
 * The registry is the SINGLE source of truth for every LLM the platform knows
 * about. This suite pins the catalog's structural invariants so a future edit
 * that (a) duplicates an id, (b) drops a routing signal (cost/latency/quality/
 * capabilities), or (c) accidentally flips a dormant provider `configured:true`
 * fails loudly BEFORE it can change which model serves a live path.
 *
 * The provider-routing invariant these tests protect is P12 (AI safety /
 * provider): only the 4 wired models may be selectable; both Gemini seams stay
 * dormant until a deliberate, user-approved flip.
 *
 * Owner: testing. Reviewer: ai-engineer (catalog correctness).
 */

import { describe, it, expect } from 'vitest';
import {
  getModel,
  listModels,
  estimateCostUsd,
  ROUTING_POLICIES,
  ANTHROPIC_HAIKU_ID,
  ANTHROPIC_SONNET_ID,
  OPENAI_MINI_ID,
  OPENAI_FULL_ID,
  GEMINI_FLASH_ID,
  GEMINI_PRO_ID,
} from '@alfanumrik/lib/ai/gateway';
import type { ModelDescriptor } from '@alfanumrik/lib/ai/gateway';

const CONFIGURED_IDS = [ANTHROPIC_HAIKU_ID, ANTHROPIC_SONNET_ID, OPENAI_MINI_ID, OPENAI_FULL_ID];
const DORMANT_IDS = [GEMINI_FLASH_ID, GEMINI_PRO_ID];

describe('Model Gateway registry — integrity', () => {
  it('exposes the full 6-model catalog with configuredOnly:false', () => {
    const all = listModels({ configuredOnly: false });
    expect(all).toHaveLength(6);
    const ids = all.map((m) => m.id).sort();
    expect(ids).toEqual([...CONFIGURED_IDS, ...DORMANT_IDS].sort());
  });

  it('has unique model ids (no duplicate catalog entries)', () => {
    const ids = listModels({ configuredOnly: false }).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every model carries non-null cost / latency / qualityTier routing signals', () => {
    for (const m of listModels({ configuredOnly: false })) {
      expect(Number.isFinite(m.inputCostPer1M), `${m.id} inputCostPer1M`).toBe(true);
      expect(Number.isFinite(m.outputCostPer1M), `${m.id} outputCostPer1M`).toBe(true);
      expect(m.inputCostPer1M, `${m.id} inputCostPer1M >= 0`).toBeGreaterThanOrEqual(0);
      expect(m.outputCostPer1M, `${m.id} outputCostPer1M >= 0`).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(m.p50LatencyMs), `${m.id} p50LatencyMs`).toBe(true);
      expect(m.p50LatencyMs, `${m.id} p50LatencyMs > 0`).toBeGreaterThan(0);
      expect(typeof m.qualityTier, `${m.id} qualityTier`).toBe('number');
      expect(Number.isFinite(m.qualityTier), `${m.id} qualityTier finite`).toBe(true);
    }
  });

  it('every model declares a complete capability set (json/vision/streaming/tools booleans)', () => {
    for (const m of listModels({ configuredOnly: false })) {
      expect(m.capabilities, `${m.id} capabilities present`).toBeTruthy();
      for (const cap of ['json', 'vision', 'streaming', 'tools'] as const) {
        expect(typeof m.capabilities[cap], `${m.id} capability ${cap}`).toBe('boolean');
      }
    }
  });

  it('every model has a non-empty id, provider, family and tier', () => {
    for (const m of listModels({ configuredOnly: false })) {
      expect(m.id).toBeTruthy();
      expect(['anthropic', 'openai', 'gemini']).toContain(m.provider);
      expect(m.family).toBeTruthy();
      expect(['small', 'large']).toContain(m.tier);
    }
  });

  it('the 4 wired models are configured:true', () => {
    for (const id of CONFIGURED_IDS) {
      const m = getModel(id) as ModelDescriptor;
      expect(m, `${id} present in catalog`).toBeTruthy();
      expect(m.configured, `${id} configured`).toBe(true);
    }
  });

  it('both Gemini seams are configured:false (dormant in Phase 1)', () => {
    for (const id of DORMANT_IDS) {
      const m = getModel(id) as ModelDescriptor;
      expect(m, `${id} present in catalog`).toBeTruthy();
      expect(m.provider).toBe('gemini');
      expect(m.configured, `${id} dormant`).toBe(false);
    }
  });

  it('listModels() defaults to configured-only (the selectable set)', () => {
    const selectable = listModels();
    expect(selectable.map((m) => m.id).sort()).toEqual([...CONFIGURED_IDS].sort());
    expect(selectable.every((m) => m.configured)).toBe(true);
  });

  it('getModel returns undefined for an unknown id', () => {
    expect(getModel('no-such-model-xyz')).toBeUndefined();
  });

  it('estimateCostUsd applies per-1M input+output pricing', () => {
    const haiku = getModel(ANTHROPIC_HAIKU_ID) as ModelDescriptor;
    // 1M input + 1M output at Haiku's 1.0 / 5.0 estimate = 6.0 USD.
    expect(estimateCostUsd(haiku, 1_000_000, 1_000_000)).toBeCloseTo(6.0, 9);
    // Zero tokens = zero cost.
    expect(estimateCostUsd(haiku, 0, 0)).toBe(0);
  });

  it('estimateCostUsd is defensive on non-finite / negative token counts', () => {
    const full = getModel(OPENAI_FULL_ID) as ModelDescriptor;
    expect(estimateCostUsd(full, Number.NaN, Number.POSITIVE_INFINITY)).toBe(0);
    expect(estimateCostUsd(full, -100, -100)).toBe(0);
  });

  it('ROUTING_POLICIES enumerates exactly the 5 known policies', () => {
    expect([...ROUTING_POLICIES].sort()).toEqual(
      ['balanced', 'cost', 'default', 'latency', 'quality'].sort(),
    );
  });
});
