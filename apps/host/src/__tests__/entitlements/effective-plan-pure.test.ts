import { describe, it, expect } from 'vitest';

/**
 * Track A.5 — B2C ↔ B2B entitlement-conflict resolver: PURE logic.
 *
 * Under test (no DB, no mocks needed — these are the pure exports of
 * src/lib/entitlements/effective-plan.ts plus planTier from src/lib/plans.ts):
 *   - assembleEffective(coverage, personalPlan)        — highest-tier-wins + tie→school
 *   - isRedundantPurchase(entitlement, requestedPlan)  — redundant iff requested ≤ school tier
 *   - normalizeSchoolPlanToConsumerCode(raw)           — B2B plan text → consumer tier
 *   - planTier(code)                                   — the ONE tier ranking
 *
 * These functions carry the whole no-double-charge / upgrade-still-allowed
 * decision, so they are pinned exhaustively here; the DB-backed seat resolution
 * and the route wiring live in the sibling suites.
 */

import {
  assembleEffective,
  isRedundantPurchase,
  normalizeSchoolPlanToConsumerCode,
  type SchoolCoverage,
  type EffectiveEntitlement,
} from '@alfanumrik/lib/entitlements/effective-plan';
import { planTier } from '@alfanumrik/lib/plans';

function coverage(plan: SchoolCoverage['plan'], schoolId = 'school-1'): SchoolCoverage {
  return { plan, schoolId };
}

// ─────────────────────────────────────────────────────────────────────────────
// planTier — the single source of truth for tier ordering
// ─────────────────────────────────────────────────────────────────────────────
describe('planTier — single tier ranking', () => {
  it('ranks free=0, starter=1, pro=2, unlimited=3', () => {
    expect(planTier('free')).toBe(0);
    expect(planTier('starter')).toBe(1);
    expect(planTier('pro')).toBe(2);
    expect(planTier('unlimited')).toBe(3);
  });

  it('is strictly monotonic across the four consumer tiers', () => {
    expect(planTier('free')).toBeLessThan(planTier('starter'));
    expect(planTier('starter')).toBeLessThan(planTier('pro'));
    expect(planTier('pro')).toBeLessThan(planTier('unlimited'));
  });

  it('folds legacy aliases / billing-cycle suffixes into their canonical tier', () => {
    expect(planTier('basic')).toBe(planTier('starter'));
    expect(planTier('premium')).toBe(planTier('pro'));
    expect(planTier('ultimate')).toBe(planTier('unlimited'));
    expect(planTier('pro_monthly')).toBe(planTier('pro'));
    expect(planTier('unlimited_yearly')).toBe(planTier('unlimited'));
  });

  it('falls back to free (0) for unknown / null codes', () => {
    expect(planTier('gibberish')).toBe(0);
    expect(planTier(null)).toBe(0);
    expect(planTier(undefined)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizeSchoolPlanToConsumerCode — B2B plan text → consumer tier
// ─────────────────────────────────────────────────────────────────────────────
describe('normalizeSchoolPlanToConsumerCode — B2B alias map', () => {
  it.each([
    ['trial', 'pro'],
    ['basic', 'starter'],
    ['standard', 'pro'],
    ['premium', 'pro'],
    ['enterprise', 'unlimited'],
    ['school_premium', 'unlimited'],
  ] as const)('maps B2B "%s" → consumer "%s"', (raw, expected) => {
    expect(normalizeSchoolPlanToConsumerCode(raw)).toBe(expected);
  });

  it('passes through canonical consumer codes unchanged', () => {
    expect(normalizeSchoolPlanToConsumerCode('starter')).toBe('starter');
    expect(normalizeSchoolPlanToConsumerCode('pro')).toBe('pro');
    expect(normalizeSchoolPlanToConsumerCode('unlimited')).toBe('unlimited');
    expect(normalizeSchoolPlanToConsumerCode('free')).toBe('free');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeSchoolPlanToConsumerCode('  ENTERPRISE ')).toBe('unlimited');
    expect(normalizeSchoolPlanToConsumerCode('Standard')).toBe('pro');
  });

  it('fails closed to "free" for unknown / null / empty B2B plan text', () => {
    expect(normalizeSchoolPlanToConsumerCode('mystery_tier')).toBe('free');
    expect(normalizeSchoolPlanToConsumerCode(null)).toBe('free');
    expect(normalizeSchoolPlanToConsumerCode(undefined)).toBe('free');
    expect(normalizeSchoolPlanToConsumerCode('')).toBe('free');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// assembleEffective — highest-tier-wins, tie → school, can_upgrade, source label
// ─────────────────────────────────────────────────────────────────────────────
describe('assembleEffective — highest tier wins', () => {
  it('school strictly higher than personal → source school, effective = school plan', () => {
    const e = assembleEffective(coverage('pro'), 'starter');
    expect(e.effectivePlan).toBe('pro');
    expect(e.source).toBe('school');
    expect(e.schoolCoverage?.plan).toBe('pro');
    expect(e.personalPlan).toBe('starter'); // personal still surfaced for the UI
  });

  it('personal strictly higher than school → source personal (the paid upgrade wins)', () => {
    const e = assembleEffective(coverage('starter'), 'unlimited');
    expect(e.effectivePlan).toBe('unlimited');
    expect(e.source).toBe('personal');
    // School coverage is still surfaced so the UI can say "also covered by school".
    expect(e.schoolCoverage?.plan).toBe('starter');
    expect(e.personalPlan).toBe('unlimited');
  });

  it('TIE (school tier == personal tier) resolves to SCHOOL (nothing to buy)', () => {
    const e = assembleEffective(coverage('pro'), 'pro');
    expect(e.effectivePlan).toBe('pro');
    expect(e.source).toBe('school');
  });

  it('no school coverage + personal plan → source personal', () => {
    const e = assembleEffective(null, 'starter');
    expect(e.effectivePlan).toBe('starter');
    expect(e.source).toBe('personal');
    expect(e.schoolCoverage).toBeUndefined();
    expect(e.personalPlan).toBe('starter');
  });

  it('no school + no personal (free) → source free, no schoolCoverage, no personalPlan', () => {
    const e = assembleEffective(null, 'free');
    expect(e.effectivePlan).toBe('free');
    expect(e.source).toBe('free');
    expect(e.schoolCoverage).toBeUndefined();
    expect(e.personalPlan).toBeUndefined();
  });

  it('school coverage at free tier + free personal → source school (coverage still attached)', () => {
    const e = assembleEffective(coverage('free'), 'free');
    expect(e.effectivePlan).toBe('free');
    expect(e.source).toBe('school'); // school tier (0) >= personal tier (0) → tie → school
    expect(e.schoolCoverage?.plan).toBe('free');
  });

  describe('can_upgrade — true only when a strictly higher purchasable tier exists', () => {
    it('is TRUE below the ceiling (free / starter / pro effective)', () => {
      expect(assembleEffective(null, 'free').canUpgrade).toBe(true);
      expect(assembleEffective(null, 'starter').canUpgrade).toBe(true);
      expect(assembleEffective(coverage('pro'), 'free').canUpgrade).toBe(true);
    });

    it('is FALSE at the ceiling (unlimited effective), from either source', () => {
      expect(assembleEffective(null, 'unlimited').canUpgrade).toBe(false);
      expect(assembleEffective(coverage('unlimited'), 'free').canUpgrade).toBe(false);
      expect(assembleEffective(coverage('starter'), 'unlimited').canUpgrade).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isRedundantPurchase — the no-double-charge decision
// ─────────────────────────────────────────────────────────────────────────────
describe('isRedundantPurchase — redundant iff requested ≤ school tier', () => {
  function withSchool(plan: SchoolCoverage['plan']): EffectiveEntitlement {
    return assembleEffective(coverage(plan), 'free');
  }

  it('requested tier BELOW school tier → redundant (school already covers it)', () => {
    const v = isRedundantPurchase(withSchool('pro'), 'starter');
    expect(v.redundant).toBe(true);
    expect(v.schoolPlan).toBe('pro');
  });

  it('requested tier EQUAL to school tier → redundant (adds no entitlement)', () => {
    const v = isRedundantPurchase(withSchool('pro'), 'pro');
    expect(v.redundant).toBe(true);
    expect(v.schoolPlan).toBe('pro');
  });

  it('requested tier ABOVE school tier → NOT redundant (genuine upgrade, allowed)', () => {
    const v = isRedundantPurchase(withSchool('starter'), 'pro');
    expect(v.redundant).toBe(false);
    expect(v.schoolPlan).toBeUndefined();
  });

  it('requested tier ABOVE a pro school → NOT redundant (unlimited upgrade allowed)', () => {
    expect(isRedundantPurchase(withSchool('pro'), 'unlimited').redundant).toBe(false);
  });

  it('NO school coverage → NEVER redundant (B2C-only behavior unchanged)', () => {
    const noSchool = assembleEffective(null, 'starter');
    expect(isRedundantPurchase(noSchool, 'starter').redundant).toBe(false);
    expect(isRedundantPurchase(noSchool, 'pro').redundant).toBe(false);
    expect(isRedundantPurchase(noSchool, 'unlimited').redundant).toBe(false);
  });

  it('compares ONLY against school coverage, not the student’s own personal plan', () => {
    // Student has a personal pro plan (source personal) AND a starter school.
    // Re-requesting pro must NOT be flagged redundant here — that duplicate-
    // personal-plan case is owned by the subscribe route's separate 409 check.
    const e = assembleEffective(coverage('starter'), 'pro');
    expect(e.source).toBe('personal');
    expect(isRedundantPurchase(e, 'pro').redundant).toBe(false); // above starter school tier
  });

  it('uses canonical tier comparison (alias-insensitive)', () => {
    // requested 'premium' == pro tier; school 'pro' → redundant.
    expect(isRedundantPurchase(withSchool('pro'), 'premium').redundant).toBe(true);
    // requested 'ultimate' == unlimited; school 'pro' → upgrade, not redundant.
    expect(isRedundantPurchase(withSchool('pro'), 'ultimate').redundant).toBe(false);
  });
});
