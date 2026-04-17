// supabase/functions/grounded-answer/__tests__/confidence.test.ts
// Deno test runner. Run via:
//   cd supabase/functions/grounded-answer && deno test --allow-all
//
// Verifies the confidence formula from spec §6.5:
//   0.4*topSim + 0.3*top3Avg + 0.2*(chunks/target) + 0.1*groundingPass

import { assertAlmostEquals, assertEquals } from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { computeConfidence } from '../confidence.ts';

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

Deno.test('formula: topSim=0.8, top3=0.7, 5/5, pass=1 → 0.77', () => {
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