/**
 * AI config — RRF similarity floor calibration regression guard.
 *
 * Audit 2026-05-10: the cold-path Foxy retriever (ncert-retriever.ts) reads
 * its default similarity floor from getAIConfig().ragMinQuality. Pre-audit
 * this was 0.4 (cosine-scale), which on the RRF scale used by
 * match_rag_chunks_ncert (max ~0.0328) would filter every chunk. The
 * grounded-answer primary path was fixed in PR #692 and PR #693; this test
 * pins the analogous floor on the legacy cold path so flipping
 * ff_grounded_ai_foxy=false during an incident actually returns chunks.
 *
 * If a future change tries to revert ragMinQuality to a cosine-scale
 * value (>= 0.1) this test fails loudly. The legacy retriever's contract
 * is "RRF scores in [0, 0.0328]"; floors above that scale are bugs.
 */

import { describe, it, expect } from 'vitest';
import { getAIConfig } from '@/lib/ai/config';
import { SOFT_MIN_SIMILARITY, RRF_THEORETICAL_MAX } from '@/lib/grounding-config';

describe('AI config — RRF floor calibration', () => {
  it('ragMinQuality is calibrated for the RRF scale (≤ RRF theoretical max)', () => {
    const config = getAIConfig();
    expect(config.ragMinQuality).toBeLessThan(RRF_THEORETICAL_MAX);
  });

  it('ragMinQuality matches SOFT_MIN_SIMILARITY (single source of truth across paths)', () => {
    // The cold path is operationally the kill-switch fallback for Foxy soft
    // mode. Aligning the floors keeps the two paths' retrieval shape
    // comparable when ops swap between them during incidents.
    const config = getAIConfig();
    expect(config.ragMinQuality).toBe(SOFT_MIN_SIMILARITY);
  });

  it('regression guard: must not be a cosine-scale value (would filter every chunk)', () => {
    // 0.1 is the canonical "anything in this range or above is cosine"
    // line — RRF max is 0.0328, so any threshold ≥ 0.1 means the floor
    // is stale and the kill switch is broken.
    const config = getAIConfig();
    expect(config.ragMinQuality).toBeLessThan(0.1);
  });
});
