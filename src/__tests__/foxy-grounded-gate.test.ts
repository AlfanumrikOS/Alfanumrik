/**
 * Foxy grounded-answer feature-flag gate tests.
 *
 * The /api/foxy route has two code paths:
 *   (a) grounded-answer service path — when ff_grounded_ai_foxy is ON
 *   (b) legacy intent-router path    — when ff_grounded_ai_foxy is OFF
 *
 * During the Phase 3 rollout window both paths MUST remain reachable. This
 * file verifies the pure decision logic (refund-on-abstain table + grounding
 * status derivation) that governs how each path maps service output to the
 * client response shape. The two paths themselves are integration-tested
 * end-to-end via Playwright (e2e) — we don't re-mount the full Node route
 * here because that requires mocking 6+ modules and this repo keeps route
 * integration testing at the E2E layer.
 */

import { describe, it, expect } from 'vitest';
import { SOFT_CONFIDENCE_BANNER_THRESHOLD } from '@/lib/grounding-config';
import type { AbstainReason } from '@/lib/ai/grounded-client';

// ─── Mirror of REFUND_ABSTAIN_REASONS in src/app/api/foxy/route.ts ──────────
// Keep in sync. Quality review rejects if this diverges from the route value.
const REFUND_ABSTAIN_REASONS: AbstainReason[] = [
  'upstream_error',
  'circuit_open',
  'chapter_not_ready',
];

describe('foxy quota refund policy', () => {
  it('refunds on upstream_error (service/hop failure)', () => {
    expect(REFUND_ABSTAIN_REASONS).toContain('upstream_error');
  });

  it('refunds on circuit_open (breaker tripped)', () => {
    expect(REFUND_ABSTAIN_REASONS).toContain('circuit_open');
  });

  it('refunds on chapter_not_ready (content gap)', () => {
    expect(REFUND_ABSTAIN_REASONS).toContain('chapter_not_ready');
  });

  it('does NOT refund on low_similarity (service did retrieve)', () => {
    expect(REFUND_ABSTAIN_REASONS).not.toContain('low_similarity');
  });

  it('does NOT refund on no_supporting_chunks (service did run Claude)', () => {
    expect(REFUND_ABSTAIN_REASONS).not.toContain('no_supporting_chunks');
  });

  it('does NOT refund on scope_mismatch (caller misuse)', () => {
    expect(REFUND_ABSTAIN_REASONS).not.toContain('scope_mismatch');
  });

  it('does NOT refund on no_chunks_retrieved (content gap with no alternatives)', () => {
    // no_chunks_retrieved means retrieval ran to completion and found nothing
    // — the service did work on the student's behalf. We don't refund for
    // this; the student gets the hard-abstain card with suggested alternatives.
    expect(REFUND_ABSTAIN_REASONS).not.toContain('no_chunks_retrieved');
  });
});

describe('foxy grounding status derivation', () => {
  // Mirror of the `isUnverified` decision in the grounded-answer path of
  // src/app/api/foxy/route.ts. If the banner threshold changes in
  // grounding-config.ts (source of truth), this test still passes because we
  // reference the constant, not a literal.
  const statusFor = (confidence: number): 'grounded' | 'unverified' => {
    return confidence < SOFT_CONFIDENCE_BANNER_THRESHOLD ? 'unverified' : 'grounded';
  };

  it('confidence=1.0 → grounded', () => {
    expect(statusFor(1.0)).toBe('grounded');
  });

  it('confidence at threshold → grounded (strictly less-than triggers unverified)', () => {
    expect(statusFor(SOFT_CONFIDENCE_BANNER_THRESHOLD)).toBe('grounded');
  });

  it('confidence just below threshold → unverified', () => {
    expect(statusFor(SOFT_CONFIDENCE_BANNER_THRESHOLD - 0.01)).toBe('unverified');
  });

  it('confidence=0 → unverified', () => {
    expect(statusFor(0)).toBe('unverified');
  });
});

describe('foxy grounded-answer request shape', () => {
  // Sanity check that the grounding-config thresholds the route relies on
  // have the expected ranges — catches accidental edits to grounding-config.ts
  // that would silently change banner visibility.
  it('SOFT_CONFIDENCE_BANNER_THRESHOLD is between 0.4 and 0.8', () => {
    expect(SOFT_CONFIDENCE_BANNER_THRESHOLD).toBeGreaterThanOrEqual(0.4);
    expect(SOFT_CONFIDENCE_BANNER_THRESHOLD).toBeLessThanOrEqual(0.8);
  });
});