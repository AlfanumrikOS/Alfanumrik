/**
 * Model Gateway — Router policy correctness (Phase 1).
 *
 * `selectModelChain(policy, constraints)` is a PURE, deterministic ordering
 * function. These tests pin every policy's ordering contract and the two
 * invariants that keep the flag-OFF world a byte-identical no-op:
 *
 *   1. `default` reproduces the legacy fallback chain EXACTLY — OpenAI-primary
 *      as of the 2026-08-02 CEO-directed cost swap (gpt-4o-mini → gpt-4o →
 *      Haiku → Sonnet; Claude retained as the reliability fallback tier, not
 *      deleted); constraints FILTER but never REORDER it.
 *   2. NO policy or constraint can ever surface a `configured:false` model
 *      (both Gemini seams stay dormant — P12 provider invariant).
 *
 * Owner: testing. Reviewer: ai-engineer (routing correctness on live paths).
 */

import { describe, it, expect } from 'vitest';
import {
  selectModelChain,
  ANTHROPIC_HAIKU_ID,
  ANTHROPIC_SONNET_ID,
  OPENAI_MINI_ID,
  OPENAI_FULL_ID,
  GEMINI_FLASH_ID,
  GEMINI_PRO_ID,
  ROUTING_POLICIES,
} from '@alfanumrik/lib/ai/gateway';

const ids = (chain: { id: string }[]) => chain.map((m) => m.id);

const DORMANT = new Set([GEMINI_FLASH_ID, GEMINI_PRO_ID]);

describe('Model Gateway router — policy ordering', () => {
  it('default reproduces the legacy OpenAI-primary chain byte-for-byte (Claude retained as fallback)', () => {
    expect(ids(selectModelChain('default'))).toEqual([
      OPENAI_MINI_ID,
      OPENAI_FULL_ID,
      ANTHROPIC_HAIKU_ID,
      ANTHROPIC_SONNET_ID,
    ]);
  });

  it('default chain is OpenAI-primary post 2026-08 cost directive, Claude retained as fallback', () => {
    // Regression pin (REG-334, renumbered 2026-08-03 from REG-332 during the
    // origin/main merge — see .claude/regression/00-header.md's collision
    // note): the 2026-08-02 CEO-directed cost swap flipped
    // MODEL_FALLBACK_ORDER / LEGACY_FALLBACK_ORDER from Anthropic-primary to
    // OpenAI-first, Anthropic-second, for every preference key (Anthropic's
    // per-token cost does not scale with per-student revenue at current
    // volume). This test exists so an accidental revert back to
    // Anthropic-primary is caught immediately, the same way the pre-swap
    // literal order used to be pinned in the test directly above.
    const chain = selectModelChain('default');
    expect(ids(chain)).toEqual([OPENAI_MINI_ID, OPENAI_FULL_ID, ANTHROPIC_HAIKU_ID, ANTHROPIC_SONNET_ID]);
    // Assert providers explicitly too, not just ids, so a future id rename
    // alone couldn't silently flip a provider while keeping this test green.
    expect(chain.map((m) => m.provider)).toEqual(['openai', 'openai', 'anthropic', 'anthropic']);
  });

  it('cost orders by ascending blended (input+output) cost', () => {
    // Blended: mini 0.75 < Haiku 6 < gpt-4o 12.5 < Sonnet 18.
    expect(ids(selectModelChain('cost'))).toEqual([
      OPENAI_MINI_ID,
      ANTHROPIC_HAIKU_ID,
      OPENAI_FULL_ID,
      ANTHROPIC_SONNET_ID,
    ]);
  });

  it('latency orders by ascending p50', () => {
    // p50: mini 700 < Haiku 800 < gpt-4o 1200 < Sonnet 1500.
    expect(ids(selectModelChain('latency'))).toEqual([
      OPENAI_MINI_ID,
      ANTHROPIC_HAIKU_ID,
      OPENAI_FULL_ID,
      ANTHROPIC_SONNET_ID,
    ]);
  });

  it('quality orders by descending qualityTier', () => {
    // qualityTier: Sonnet 9 > gpt-4o 8 > Haiku 6 > mini 5.
    expect(ids(selectModelChain('quality'))).toEqual([
      ANTHROPIC_SONNET_ID,
      OPENAI_FULL_ID,
      ANTHROPIC_HAIKU_ID,
      OPENAI_MINI_ID,
    ]);
  });

  it('balanced applies the documented 0.5*quality + 0.3*(1-cost) + 0.2*(1-latency) weighting deterministically', () => {
    // Min-max normalized over the 4 configured candidates (see router.ts):
    //   gpt-4o : 0.5*0.75 + 0.3*0.3188 + 0.2*0.375  = 0.5457  (rank 1)
    //   Haiku  : 0.5*0.25 + 0.3*0.6957 + 0.2*0.875  = 0.5087  (rank 2)
    //   Sonnet : 0.5*1    + 0.3*0      + 0.2*0       = 0.5     (tie → catalog idx 1)
    //   mini   : 0.5*0    + 0.3*1      + 0.2*1       = 0.5     (tie → catalog idx 2)
    // Sonnet (catalog index 1) precedes mini (index 2) on the deterministic
    // catalog-order tie-break.
    expect(ids(selectModelChain('balanced'))).toEqual([
      OPENAI_FULL_ID,
      ANTHROPIC_HAIKU_ID,
      ANTHROPIC_SONNET_ID,
      OPENAI_MINI_ID,
    ]);
  });

  it('balanced is deterministic across repeated calls', () => {
    expect(ids(selectModelChain('balanced'))).toEqual(ids(selectModelChain('balanced')));
  });
});

describe('Model Gateway router — constraints filter without reordering default', () => {
  it('minQualityTier drops sub-floor models but preserves default order', () => {
    // Floor 7 removes Haiku(6) and mini(5); gpt-4o(8) and Sonnet(9) survive in
    // their legacy (OpenAI-primary) positions — gpt-4o before Sonnet, no reorder.
    expect(ids(selectModelChain('default', { minQualityTier: 7 }))).toEqual([
      OPENAI_FULL_ID,
      ANTHROPIC_SONNET_ID,
    ]);
  });

  it('maxInputCostPer1M drops over-budget models but preserves default order', () => {
    // Ceiling 1.0 keeps mini(0.15) and Haiku(1.0); drops gpt-4o(2.5), Sonnet(3.0).
    // Legacy (OpenAI-primary) order has mini before Haiku — filtering must not
    // reorder them.
    expect(ids(selectModelChain('default', { maxInputCostPer1M: 1.0 }))).toEqual([
      OPENAI_MINI_ID,
      ANTHROPIC_HAIKU_ID,
    ]);
  });

  it('needsVision keeps every configured model (all four support vision)', () => {
    expect(ids(selectModelChain('default', { needsVision: true }))).toEqual([
      OPENAI_MINI_ID,
      OPENAI_FULL_ID,
      ANTHROPIC_HAIKU_ID,
      ANTHROPIC_SONNET_ID,
    ]);
  });

  it('needsJson keeps every configured model (all four support native JSON)', () => {
    expect(ids(selectModelChain('cost', { needsJson: true }))).toHaveLength(4);
  });

  it('an impossible constraint yields an empty chain (no fallback to dormant)', () => {
    const chain = selectModelChain('quality', { minQualityTier: 999 });
    expect(chain).toEqual([]);
  });
});

describe('Model Gateway router — never selects a dormant (configured:false) model', () => {
  it('excludes both Gemini seams under every policy, with and without constraints', () => {
    const constraintSets = [
      {},
      { needsVision: true },
      { needsJson: true },
      { minQualityTier: 1 },
      { maxInputCostPer1M: 1000 },
    ];
    for (const policy of ROUTING_POLICIES) {
      for (const constraints of constraintSets) {
        const chain = selectModelChain(policy, constraints);
        for (const m of chain) {
          expect(m.configured, `${policy} surfaced ${m.id}`).toBe(true);
          expect(DORMANT.has(m.id), `${policy} surfaced dormant ${m.id}`).toBe(false);
        }
      }
    }
  });

  it('cost policy does NOT pick the cheaper-but-dormant Gemini flash', () => {
    // Gemini flash's blended cost (0.375) undercuts gpt-4o-mini (0.75) — if the
    // dormant guard regressed, flash would sort to the front. It must not.
    const first = selectModelChain('cost')[0];
    expect(first.id).toBe(OPENAI_MINI_ID);
    expect(first.id).not.toBe(GEMINI_FLASH_ID);
  });
});
