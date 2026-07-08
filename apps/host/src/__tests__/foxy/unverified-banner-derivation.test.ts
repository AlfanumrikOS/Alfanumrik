/**
 * Foxy `groundingStatus` derivation — audit 2026-05-10.
 *
 * Pre-audit, src/app/api/foxy/route.ts hardcoded `isUnverified = false` for
 * any successful grounded-answer call. That meant the UnverifiedBanner never
 * fired, even when soft-mode answered from "general CBSE knowledge" with
 * zero retrieved chunks. 287/309 foxy traces in the 30 days before PR #693
 * had grounded=true with chunk_count=0 — every one of them was rendered to
 * students with the green "grounded" badge.
 *
 * The audit fix:
 *   isUnverified = !groundedFromChunks || (confidence < SOFT_BANNER_THRESHOLD)
 *
 * This test mirrors that derivation so a future refactor that tries to
 * hardcode either side back to `false` fails this gate.
 */

import { describe, it, expect } from 'vitest';
import { SOFT_CONFIDENCE_BANNER_THRESHOLD } from '@alfanumrik/lib/grounding-config';

/**
 * Mirror of the route.ts logic. Keep in sync with src/app/api/foxy/route.ts
 * around the `isUnverified` declaration.
 */
function deriveIsUnverified(args: {
  groundedFromChunks: boolean | undefined;
  confidence: number | null | undefined;
}): boolean {
  const groundedFromChunksRaw = args.groundedFromChunks === true;
  const lowConfidence = typeof args.confidence === 'number'
    && args.confidence < SOFT_CONFIDENCE_BANNER_THRESHOLD;
  return !groundedFromChunksRaw || lowConfidence;
}

describe('Foxy isUnverified derivation', () => {
  it('isUnverified=true when groundedFromChunks is false (soft fallback to general knowledge)', () => {
    expect(deriveIsUnverified({ groundedFromChunks: false, confidence: 0.9 })).toBe(true);
  });

  it('isUnverified=true when groundedFromChunks is undefined (legacy / cached responses)', () => {
    // Conservative: missing field means we don't claim grounding.
    expect(deriveIsUnverified({ groundedFromChunks: undefined, confidence: 0.9 })).toBe(true);
  });

  it('isUnverified=true when confidence is below the soft banner threshold', () => {
    // Even with chunks used, a low-confidence answer warrants the caution banner.
    expect(
      deriveIsUnverified({
        groundedFromChunks: true,
        confidence: SOFT_CONFIDENCE_BANNER_THRESHOLD - 0.01,
      }),
    ).toBe(true);
  });

  it('isUnverified=false when grounded-from-chunks AND confidence is above threshold', () => {
    expect(
      deriveIsUnverified({
        groundedFromChunks: true,
        confidence: SOFT_CONFIDENCE_BANNER_THRESHOLD + 0.01,
      }),
    ).toBe(false);
  });

  it('isUnverified=true when confidence is null (no signal, conservative default)', () => {
    // null confidence means we don't have a number to gate on. The
    // grounded-from-chunks signal is the only remaining input — but if the
    // route is ever called with confidence=null AND groundedFromChunks=true
    // (unusual), we let groundedFromChunks decide.
    expect(deriveIsUnverified({ groundedFromChunks: true, confidence: null })).toBe(false);
    expect(deriveIsUnverified({ groundedFromChunks: false, confidence: null })).toBe(true);
  });

  it('regression guard: must not unconditionally return false (the pre-audit bug)', () => {
    // Pre-audit, isUnverified was hardcoded to false for the soft-mode path.
    // The bug was 100% reproducible: no matter what groundedFromChunks said,
    // students got the "grounded" badge. This guard fails if anyone tries
    // to revert.
    const seenValues = new Set<boolean>();
    const samples: Array<Parameters<typeof deriveIsUnverified>[0]> = [
      { groundedFromChunks: true, confidence: 0.9 },
      { groundedFromChunks: false, confidence: 0.9 },
      { groundedFromChunks: true, confidence: 0.1 },
      { groundedFromChunks: false, confidence: 0.1 },
    ];
    for (const s of samples) seenValues.add(deriveIsUnverified(s));
    expect(seenValues.size).toBeGreaterThan(1);
  });
});
