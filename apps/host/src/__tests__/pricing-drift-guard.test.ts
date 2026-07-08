import { describe, it, expect } from 'vitest';
import {
  SCHOOL_SEAT_TIER_INR,
  SCHOOL_SEAT_DEFAULT_INR,
  SCHOOL_PER_SEAT_MARKETING_INR,
  SCHOOL_PER_SEAT_MARKETING_LABEL,
  SCHOOL_PER_SEAT_QUARTERLY_INR,
  SCHOOL_PER_SEAT_QUARTERLY_LABEL,
  schoolSeatPriceForTier,
  schoolSeatPriceQuarterly,
} from '@alfanumrik/lib/pricing';

/**
 * REG-154 — Pricing single-source-of-truth drift guard (P11-adjacent / REG-65 family).
 *
 * Two failure modes this pins:
 *   1. The B2B per-seat tier values in the pricing SoT (src/lib/pricing.ts) silently
 *      drifting away from the numbers `POST /api/super-admin/invoices` actually bills.
 *      The invoice route was repointed at `schoolSeatPriceForTier()` (Phase 4
 *      hardening) — these literals ARE the billed amounts.
 *   2. The /schools marketing headline price (`SCHOOL_PER_SEAT_MARKETING_INR`)
 *      drifting away from a real, billable tier — i.e. quoting a public
 *      "from ₹X/student/month" number that the system never actually charges.
 *      REG-65 (landing-page pricing-verbatim drift) hardening: the marketing
 *      number MUST equal a published billable tier (the lowest tier, `basic`).
 *
 * If any of these assertions fail it is a PRICING change (CEO approval required),
 * NOT a test to relax. Update the SoT + invoice billing together and only then
 * adjust these expectations.
 */
describe('Pricing SoT drift guard (REG-154)', () => {
  // The exact per-seat amounts the invoice route bills. These are the
  // system-of-record literals; the test asserts the SoT never diverges from them.
  const BILLED_TIER_INR = {
    basic: 99,
    standard: 199,
    premium: 399,
    enterprise: 599,
  } as const;

  const BILLED_DEFAULT_INR = 199; // unknown/unset tier -> standard

  describe('SCHOOL_SEAT_TIER_INR matches the billed per-seat amounts', () => {
    it('pins the basic tier at ₹99/seat', () => {
      expect(SCHOOL_SEAT_TIER_INR.basic).toBe(BILLED_TIER_INR.basic);
    });

    it('pins the standard tier at ₹199/seat', () => {
      expect(SCHOOL_SEAT_TIER_INR.standard).toBe(BILLED_TIER_INR.standard);
    });

    it('pins the premium tier at ₹399/seat', () => {
      expect(SCHOOL_SEAT_TIER_INR.premium).toBe(BILLED_TIER_INR.premium);
    });

    it('pins the enterprise tier at ₹599/seat', () => {
      expect(SCHOOL_SEAT_TIER_INR.enterprise).toBe(BILLED_TIER_INR.enterprise);
    });

    it('exposes exactly the four published tiers (no silent tier add/remove)', () => {
      expect(Object.keys(SCHOOL_SEAT_TIER_INR).sort()).toEqual([
        'basic',
        'enterprise',
        'premium',
        'standard',
      ]);
    });
  });

  describe('schoolSeatPriceForTier() resolves to the billed amount', () => {
    it.each(Object.entries(BILLED_TIER_INR))(
      'tier "%s" resolves to ₹%i',
      (tier, expected) => {
        expect(schoolSeatPriceForTier(tier)).toBe(expected);
      },
    );

    it('is case-insensitive (matches invoice-route normalisation)', () => {
      expect(schoolSeatPriceForTier('BASIC')).toBe(BILLED_TIER_INR.basic);
      expect(schoolSeatPriceForTier('Premium')).toBe(BILLED_TIER_INR.premium);
    });

    it('falls back to the standard tier (₹199) for unknown plan', () => {
      expect(schoolSeatPriceForTier('gold')).toBe(BILLED_DEFAULT_INR);
    });

    it('falls back to the standard tier (₹199) for null/undefined/empty', () => {
      expect(schoolSeatPriceForTier(null)).toBe(BILLED_DEFAULT_INR);
      expect(schoolSeatPriceForTier(undefined)).toBe(BILLED_DEFAULT_INR);
      expect(schoolSeatPriceForTier('')).toBe(BILLED_DEFAULT_INR);
    });

    it('default export constant matches the standard tier and the billed default', () => {
      expect(SCHOOL_SEAT_DEFAULT_INR).toBe(SCHOOL_SEAT_TIER_INR.standard);
      expect(SCHOOL_SEAT_DEFAULT_INR).toBe(BILLED_DEFAULT_INR);
    });
  });

  describe('marketing per-seat price maps to a real billable tier (REG-65 hardening)', () => {
    it('SCHOOL_PER_SEAT_MARKETING_INR equals the basic (lowest published) tier', () => {
      expect(SCHOOL_PER_SEAT_MARKETING_INR).toBe(SCHOOL_SEAT_TIER_INR.basic);
      expect(SCHOOL_PER_SEAT_MARKETING_INR).toBe(99);
    });

    it('the marketing number is a value the system actually bills', () => {
      const billableTiers = Object.values(SCHOOL_SEAT_TIER_INR);
      expect(billableTiers).toContain(SCHOOL_PER_SEAT_MARKETING_INR);
    });

    it('the marketing label is the formatted basic tier ("₹99")', () => {
      expect(SCHOOL_PER_SEAT_MARKETING_LABEL).toBe('₹99');
    });

    it('does NOT quote the legacy hardcoded ₹75 that maps to no billed tier', () => {
      const billableTiers = Object.values(SCHOOL_SEAT_TIER_INR) as number[];
      expect(billableTiers).not.toContain(75);
      expect(SCHOOL_PER_SEAT_MARKETING_INR).not.toBe(75);
    });
  });

  describe('quarterly per-seat display figure is DERIVED (basic tier × 3), never an independent literal', () => {
    it('SCHOOL_PER_SEAT_QUARTERLY_INR equals the basic tier × 3 (₹297)', () => {
      expect(SCHOOL_PER_SEAT_QUARTERLY_INR).toBe(SCHOOL_SEAT_TIER_INR.basic * 3);
      expect(SCHOOL_PER_SEAT_QUARTERLY_INR).toBe(297);
    });

    it('the quarterly label is the formatted ₹297', () => {
      expect(SCHOOL_PER_SEAT_QUARTERLY_LABEL).toBe('₹297');
    });

    it('schoolSeatPriceQuarterly() = tier monthly × 3 for every published tier', () => {
      expect(schoolSeatPriceQuarterly('basic')).toBe(99 * 3);
      expect(schoolSeatPriceQuarterly('standard')).toBe(199 * 3);
      expect(schoolSeatPriceQuarterly('premium')).toBe(399 * 3);
      expect(schoolSeatPriceQuarterly('enterprise')).toBe(599 * 3);
    });

    it('schoolSeatPriceQuarterly() falls back to the standard tier × 3 for unknown/null', () => {
      expect(schoolSeatPriceQuarterly('gold')).toBe(199 * 3);
      expect(schoolSeatPriceQuarterly(null)).toBe(199 * 3);
      expect(schoolSeatPriceQuarterly(undefined)).toBe(199 * 3);
    });

    it('quarterly display = exactly 3× the monthly billed amount (one number drives both)', () => {
      // The quarterly figure is purely derived — there is no second literal to
      // drift. Changing the basic tier moves both with one CEO-approved number.
      expect(SCHOOL_PER_SEAT_QUARTERLY_INR).toBe(schoolSeatPriceForTier('basic') * 3);
    });
  });
});
