// supabase/functions/grounded-answer/__tests__/confidence.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies the confidence formula from spec §6.5:
//   0.4*topSim + 0.3*top3Avg + 0.2*(chunks/target) + 0.1*groundingPass

import { assertAlmostEquals, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { computeConfidence } from '../confidence.ts';
import { RRF_THEORETICAL_MAX } from '../config.ts';

Deno.test('formula: all 1s → 1.0', () => {
  const score = computeConfidence({
    topSimilarity: 1,
    top3AverageSimilarity: 1,
    chunksReturned: 5,
    matchCountTarget: 5,
    groundingCheckPassRatio: 1,
  });
  assertAlmostEquals(score, 1.0, 1e-9);
});

Deno.test('formula: all 0s → 0', () => {
  const score = computeConfidence({
    topSimilarity: 0,
    top3AverageSimilarity: 0,
    chunksReturned: 0,
    matchCountTarget: 5,
    groundingCheckPassRatio: 0,
  });
  assertEquals(score, 0);
});

Deno.test('formula: topSim=0.8, top3=0.7, 5/5, pass=1 → 0.83', () => {
  // 0.4*0.8 + 0.3*0.7 + 0.2*1.0 + 0.1*1.0
  // = 0.32 + 0.21 + 0.2 + 0.1
  // = 0.83
  const score = computeConfidence({
    topSimilarity: 0.8,
    top3AverageSimilarity: 0.7,
    chunksReturned: 5,
    matchCountTarget: 5,
    groundingCheckPassRatio: 1,
  });
  assertAlmostEquals(score, 0.83, 1e-9);
});

Deno.test('formula: soft mode with pass ratio 1 contributes 0.1', () => {
  const withPass = computeConfidence({
    topSimilarity: 0.5,
    top3AverageSimilarity: 0.5,
    chunksReturned: 3,
    matchCountTarget: 5,
    groundingCheckPassRatio: 1,
  });
  const withoutPass = computeConfidence({
    topSimilarity: 0.5,
    top3AverageSimilarity: 0.5,
    chunksReturned: 3,
    matchCountTarget: 5,
    groundingCheckPassRatio: 0,
  });
  assertAlmostEquals(withPass - withoutPass, 0.1, 1e-9);
});

Deno.test('clamps topSimilarity > 1.0 to 1.0', () => {
  // A buggy retrieval could hypothetically produce similarity > 1 with
  // normalisation drift. We cap it so the output stays in [0,1].
  const score = computeConfidence({
    topSimilarity: 1.5,
    top3AverageSimilarity: 1.5,
    chunksReturned: 100,
    matchCountTarget: 5,
    groundingCheckPassRatio: 2,
  });
  assertAlmostEquals(score, 1.0, 1e-9);
});

Deno.test('clamps negative inputs to 0', () => {
  const score = computeConfidence({
    topSimilarity: -0.3,
    top3AverageSimilarity: -0.5,
    chunksReturned: -1,
    matchCountTarget: 5,
    groundingCheckPassRatio: -0.2,
  });
  assertEquals(score, 0);
});

Deno.test('handles matchCountTarget=0 without NaN', () => {
  const score = computeConfidence({
    topSimilarity: 0.8,
    top3AverageSimilarity: 0.7,
    chunksReturned: 0,
    matchCountTarget: 0,
    groundingCheckPassRatio: 1,
  });
  // 0.4*0.8 + 0.3*0.7 + 0.2*0 + 0.1*1 = 0.32 + 0.21 + 0 + 0.1 = 0.63
  assertAlmostEquals(score, 0.63, 1e-9);
});

Deno.test('chunks exceeding target: coverage capped at 1.0', () => {
  // e.g. legacy retriever returns 10 chunks when target was 5; coverage
  // contribution saturates at 0.2, not 0.4.
  const score = computeConfidence({
    topSimilarity: 0.0,
    top3AverageSimilarity: 0.0,
    chunksReturned: 10,
    matchCountTarget: 5,
    groundingCheckPassRatio: 0,
  });
  assertAlmostEquals(score, 0.2, 1e-9);
});

Deno.test('NaN inputs → 0 (never produce NaN output)', () => {
  const score = computeConfidence({
    topSimilarity: Number.NaN,
    top3AverageSimilarity: 0.5,
    chunksReturned: 3,
    matchCountTarget: 5,
    groundingCheckPassRatio: 1,
  });
  // topSim=0 due to NaN guard; 0.3*0.5 + 0.2*0.6 + 0.1*1 = 0.15 + 0.12 + 0.1 = 0.37
  assertAlmostEquals(score, 0.37, 1e-9);
});

// ─── RRF caller-contract regression guards (audit 2026-05-10) ───────────────
// computeConfidence's contract is "topSim/top3Avg are normalized to [0,1]".
// pipeline.ts does the RRF→[0,1] normalization by dividing by
// RRF_THEORETICAL_MAX. These tests lock in the values that real production
// traces hit so a future change to either the constant or the formula will
// fail loudly instead of silently re-breaking strict-mode confidence gating.

Deno.test('RRF_THEORETICAL_MAX equals 2/61 (rank-1 in vec + fts ceiling)', () => {
  assertAlmostEquals(RRF_THEORETICAL_MAX, 2 / 61, 1e-12);
});

Deno.test('RRF caller contract: vector-only match (rank 1, ~0.0164 RRF) reaches meaningful confidence', () => {
  // Reproduces the production trace b61aa097-1043-41b3-91bf-b714d1fa2352
  // observed 2026-05-10 immediately after PR #692: topSim=0.0164,
  // top3Avg≈0.0164 (vector-only, similar across chunks), 5/5 retrieved,
  // soft-mode pass-ratio=1. Pre-audit-fix this returned 0.3114, structurally
  // below STRICT_CONFIDENCE_ABSTAIN_THRESHOLD (0.75) and SOFT banner (0.6).
  // Post-fix the caller normalizes by RRF_THEORETICAL_MAX so the formula's
  // topSim+top3 weights actually matter.
  const RRF_RAW_VECTOR_ONLY_RANK_1 = 1 / 61;
  const topSimNormalized = Math.min(RRF_RAW_VECTOR_ONLY_RANK_1 / RRF_THEORETICAL_MAX, 1);
  const top3AvgNormalized = topSimNormalized;
  const score = computeConfidence({
    topSimilarity: topSimNormalized,
    top3AverageSimilarity: top3AvgNormalized,
    chunksReturned: 5,
    matchCountTarget: 5,
    groundingCheckPassRatio: 1,
  });
  // 0.4*0.5 + 0.3*0.5 + 0.2*1 + 0.1*1 = 0.65
  assertAlmostEquals(score, 0.65, 1e-9);
});

Deno.test('RRF caller contract: best-case rank-1 in both lists hits 1.0', () => {
  const topSimNormalized = Math.min(RRF_THEORETICAL_MAX / RRF_THEORETICAL_MAX, 1);
  const score = computeConfidence({
    topSimilarity: topSimNormalized,
    top3AverageSimilarity: topSimNormalized,
    chunksReturned: 5,
    matchCountTarget: 5,
    groundingCheckPassRatio: 1,
  });
  assertAlmostEquals(score, 1.0, 1e-9);
});

Deno.test('RRF caller contract: weak match at floor (0.005) stays below soft banner', () => {
  // STRICT floor 0.012, SOFT floor 0.005. Even a chunk that just barely
  // squeaks past the soft floor should NOT register as confident.
  const topSimNormalized = Math.min(0.005 / RRF_THEORETICAL_MAX, 1);
  const score = computeConfidence({
    topSimilarity: topSimNormalized,
    top3AverageSimilarity: topSimNormalized,
    chunksReturned: 5,
    matchCountTarget: 5,
    groundingCheckPassRatio: 1,
  });
  // 0.4*0.152 + 0.3*0.152 + 0.2*1 + 0.1*1 ≈ 0.41 — below SOFT 0.6 banner
  // threshold, well below STRICT 0.75 abstain threshold. Honest signal.
  assertAlmostEquals(score, 0.4066, 1e-3);
});