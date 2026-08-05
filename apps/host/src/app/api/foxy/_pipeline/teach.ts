/**
 * SCAFFOLDING — R3 decomposition will move handleFoxyPost sections here. See
 * docs/superpowers/specs/2026-08-05-foxy-north-star-alignment-design.md §7
 * R3 mapping table for the section-to-stage assignments. DO NOT wire this
 * into route.ts yet — the runPipeline invocation lands in the R3 wave
 * alongside the section extractions (byte-identical to today's inline flow,
 * pinned by the 16 foxy-golden-turns fixtures).
 *
 * Stage: teach — Claude call (streaming or non-streaming), structured extraction.
 */

import type { StageFn } from './types';

export const teachStage: StageFn = async (_ctx) => {
  return { kind: 'continue' };
};
