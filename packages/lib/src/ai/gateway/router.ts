/**
 * Model Gateway — Router (Phase 1)
 *
 * Pure, deterministic model selection. Given a policy + constraints, returns an
 * ORDERED list of candidate descriptors (index 0 tried first). No I/O, no flag
 * reads, no provider calls — trivially unit-testable.
 *
 * The gateway (gateway.ts) owns the flag gate and adapter invocation; the router
 * only decides ordering.
 *
 * Policy semantics (see docs/superpowers/specs/2026-07-24-model-gateway-design.md):
 *   default  → the legacy Anthropic-primary chain, byte-for-byte (Haiku → Sonnet
 *              → gpt-4o-mini → gpt-4o). Constraints FILTER but never REORDER, so
 *              with no constraints the order is identical to the legacy path.
 *   cost     → ascending blended cost (inputCostPer1M + outputCostPer1M).
 *   latency  → ascending p50LatencyMs.
 *   quality  → descending qualityTier.
 *   balanced → descending weighted score (quality up, cost down, latency down).
 *
 * INVARIANT: never returns a `configured:false` model (Gemini stays dormant).
 *
 * Owner: ai-engineer. Assessment reviews routing that could change which model
 * serves a live/student path.
 */

import type { ModelDescriptor, RoutingConstraints, RoutingPolicy } from './types';
import { listModels, legacyChain, blendedCostPer1M } from './registry';

// ─── Constraint filter ──────────────────────────────────────────────────────

function passesConstraints(m: ModelDescriptor, c: RoutingConstraints): boolean {
  if (c.needsJson && !m.capabilities.json) return false;
  if (c.needsVision && !m.capabilities.vision) return false;
  if (typeof c.minQualityTier === 'number' && m.qualityTier < c.minQualityTier) return false;
  if (typeof c.maxInputCostPer1M === 'number' && m.inputCostPer1M > c.maxInputCostPer1M) return false;
  return true;
}

// ─── Balanced score ─────────────────────────────────────────────────────────
//
// A single weighted, min-max-normalized score over the CANDIDATE set (higher =
// better). Each term is normalized to [0,1] against the current candidates so
// the weights are comparable regardless of absolute units:
//   quality term  = (q - qMin) / (qMax - qMin)                 (higher better)
//   cost term     = 1 - (cost - costMin) / (costMax - costMin) (lower better)
//   latency term  = 1 - (lat - latMin)  / (latMax - latMin)    (lower better)
// A zero-width range (all candidates equal on that axis) contributes a neutral
// 1 for that term. Weights are documented + intentionally quality-leaning.
const BALANCED_WEIGHTS = { quality: 0.5, cost: 0.3, latency: 0.2 } as const;

function balancedScores(candidates: ModelDescriptor[]): Map<string, number> {
  const quals = candidates.map((m) => m.qualityTier);
  const costs = candidates.map((m) => blendedCostPer1M(m));
  const lats = candidates.map((m) => m.p50LatencyMs);

  const qMin = Math.min(...quals);
  const qMax = Math.max(...quals);
  const cMin = Math.min(...costs);
  const cMax = Math.max(...costs);
  const lMin = Math.min(...lats);
  const lMax = Math.max(...lats);

  const norm = (v: number, min: number, max: number): number => (max > min ? (v - min) / (max - min) : 1);

  const scores = new Map<string, number>();
  for (const m of candidates) {
    const qTerm = norm(m.qualityTier, qMin, qMax);
    const cTerm = 1 - norm(blendedCostPer1M(m), cMin, cMax);
    const lTerm = 1 - norm(m.p50LatencyMs, lMin, lMax);
    scores.set(
      m.id,
      BALANCED_WEIGHTS.quality * qTerm + BALANCED_WEIGHTS.cost * cTerm + BALANCED_WEIGHTS.latency * lTerm,
    );
  }
  return scores;
}

// ─── Public: selectModelChain ───────────────────────────────────────────────

/**
 * Build the ordered candidate chain for a policy + constraints.
 *
 * `default` preserves the legacy order and only drops constraint-failing models
 * (so an unconstrained `default` call is byte-for-byte the legacy chain). Every
 * other policy sorts the configured, constraint-passing catalog. Ties break by
 * catalog (declaration) order for determinism.
 */
export function selectModelChain(
  policy: RoutingPolicy,
  constraints: RoutingConstraints = {},
): ModelDescriptor[] {
  if (policy === 'default') {
    // Legacy Anthropic-primary 'auto' chain, filtered (never reordered).
    return legacyChain('auto').filter((m) => passesConstraints(m, constraints));
  }

  const candidates = listModels({ configuredOnly: true }).filter((m) => passesConstraints(m, constraints));
  // Preserve catalog order as the stable tie-break baseline.
  const indexOf = new Map<string, number>(candidates.map((m, i) => [m.id, i]));

  switch (policy) {
    case 'cost':
      return [...candidates].sort(
        (a, b) => blendedCostPer1M(a) - blendedCostPer1M(b) || indexOf.get(a.id)! - indexOf.get(b.id)!,
      );
    case 'latency':
      return [...candidates].sort(
        (a, b) => a.p50LatencyMs - b.p50LatencyMs || indexOf.get(a.id)! - indexOf.get(b.id)!,
      );
    case 'quality':
      return [...candidates].sort(
        (a, b) => b.qualityTier - a.qualityTier || indexOf.get(a.id)! - indexOf.get(b.id)!,
      );
    case 'balanced': {
      const scores = balancedScores(candidates);
      return [...candidates].sort(
        (a, b) => (scores.get(b.id)! - scores.get(a.id)!) || indexOf.get(a.id)! - indexOf.get(b.id)!,
      );
    }
    default:
      // Exhaustive — but stay safe if a new policy is added without a case.
      return [...candidates];
  }
}
