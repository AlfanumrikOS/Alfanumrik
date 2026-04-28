/**
 * plans.ts — unit tests.
 *
 * src/lib/plans.ts is the SSoT for plan identity (display name, icon,
 * tier, upgrade target) and pricing. Tests cover:
 *   - PLANS table integrity (4 plans, ascending tiers, upgrade chain)
 *   - PRICING table integrity (3 paid tiers, monthly < yearly)
 *   - normalizePlanCode strips _monthly/_yearly suffixes and resolves
 *     legacy aliases (basic→starter, premium→pro, ultimate→unlimited)
 *   - getPlanConfig falls back to free for unknown / null inputs
 *   - isPremium recognises only paid tiers (>0)
 *   - formatINR + yearlyPerMonth helpers
 */

import { describe, it, expect } from 'vitest';
import {
  PLANS,
  PRICING,
  formatINR,
  yearlyPerMonth,
  normalizePlanCode,
  getPlanConfig,
  isPremium,
} from '@/lib/plans';

describe('PLANS table', () => {
  it('has exactly the four canonical plan codes', () => {
    expect(Object.keys(PLANS).sort()).toEqual(['free', 'pro', 'starter', 'unlimited']);
  });

  it('has ascending tier numbers 0-3', () => {
    expect(PLANS.free.tier).toBe(0);
    expect(PLANS.starter.tier).toBe(1);
    expect(PLANS.pro.tier).toBe(2);
    expect(PLANS.unlimited.tier).toBe(3);
  });

  it('every plan exposes bilingual name and tagline', () => {
    for (const code of Object.keys(PLANS)) {
      const p = PLANS[code];
      expect(p.name).toBeTruthy();
      expect(p.nameHi).toBeTruthy();
      expect(p.tagline).toBeTruthy();
      expect(p.taglineHi).toBeTruthy();
      expect(p.benefits.length).toBeGreaterThan(0);
      expect(p.benefitsHi.length).toBe(p.benefits.length);
    }
  });

  it('upgrade chain free → starter → pro → unlimited → null', () => {
    expect(PLANS.free.nextPlan).toBe('starter');
    expect(PLANS.starter.nextPlan).toBe('pro');
    expect(PLANS.pro.nextPlan).toBe('unlimited');
    expect(PLANS.unlimited.nextPlan).toBeNull();
    expect(PLANS.unlimited.nextPlanLabel).toBeNull();
  });
});

describe('PRICING table', () => {
  it('has the three paid tiers', () => {
    expect(Object.keys(PRICING).sort()).toEqual(['pro', 'starter', 'unlimited']);
  });

  it('monthly is always cheaper than yearly (yearly bills upfront)', () => {
    for (const tier of ['starter', 'pro', 'unlimited'] as const) {
      expect(PRICING[tier].yearly).toBeGreaterThan(PRICING[tier].monthly);
    }
  });

  it('higher tiers cost more than lower tiers (monthly)', () => {
    expect(PRICING.pro.monthly).toBeGreaterThan(PRICING.starter.monthly);
    expect(PRICING.unlimited.monthly).toBeGreaterThan(PRICING.pro.monthly);
  });
});

describe('formatINR', () => {
  it('prefixes with the rupee symbol', () => {
    expect(formatINR(100)).toBe('₹100');
  });

  it('formats large numbers with the Indian comma separator', () => {
    // 1,00,000 in Indian numeric grouping
    expect(formatINR(100000)).toBe('₹1,00,000');
  });

  it('handles zero', () => {
    expect(formatINR(0)).toBe('₹0');
  });
});

describe('yearlyPerMonth', () => {
  it('rounds yearly / 12', () => {
    expect(yearlyPerMonth(2399)).toBe(Math.round(2399 / 12));
    expect(yearlyPerMonth(12)).toBe(1);
  });

  it('handles zero gracefully', () => {
    expect(yearlyPerMonth(0)).toBe(0);
  });
});

describe('normalizePlanCode', () => {
  it('returns "free" for null / undefined / empty', () => {
    expect(normalizePlanCode(null)).toBe('free');
    expect(normalizePlanCode(undefined)).toBe('free');
    expect(normalizePlanCode('')).toBe('free');
  });

  it('strips _monthly suffix', () => {
    expect(normalizePlanCode('starter_monthly')).toBe('starter');
    expect(normalizePlanCode('pro_monthly')).toBe('pro');
  });

  it('strips _yearly suffix', () => {
    expect(normalizePlanCode('unlimited_yearly')).toBe('unlimited');
    expect(normalizePlanCode('pro_yearly')).toBe('pro');
  });

  it('aliases legacy plan codes (basic → starter, premium → pro, ultimate → unlimited)', () => {
    expect(normalizePlanCode('basic')).toBe('starter');
    expect(normalizePlanCode('premium')).toBe('pro');
    expect(normalizePlanCode('ultimate')).toBe('unlimited');
  });

  it('passes through canonical codes unchanged', () => {
    expect(normalizePlanCode('free')).toBe('free');
    expect(normalizePlanCode('starter')).toBe('starter');
    expect(normalizePlanCode('pro')).toBe('pro');
    expect(normalizePlanCode('unlimited')).toBe('unlimited');
  });

  it('handles legacy code with billing-cycle suffix', () => {
    expect(normalizePlanCode('basic_yearly')).toBe('starter');
    expect(normalizePlanCode('premium_monthly')).toBe('pro');
  });
});

describe('getPlanConfig', () => {
  it('returns free plan for null / undefined / empty', () => {
    expect(getPlanConfig(null).code).toBe('free');
    expect(getPlanConfig(undefined).code).toBe('free');
    expect(getPlanConfig('').code).toBe('free');
  });

  it('returns the correct config for each canonical plan', () => {
    expect(getPlanConfig('free').tier).toBe(0);
    expect(getPlanConfig('starter').tier).toBe(1);
    expect(getPlanConfig('pro').tier).toBe(2);
    expect(getPlanConfig('unlimited').tier).toBe(3);
  });

  it('falls back to free for unknown codes', () => {
    expect(getPlanConfig('mystery_tier').code).toBe('free');
  });

  it('resolves billing-cycle suffix and legacy aliases', () => {
    expect(getPlanConfig('starter_monthly').code).toBe('starter');
    expect(getPlanConfig('basic').code).toBe('starter');
    expect(getPlanConfig('premium_yearly').code).toBe('pro');
  });
});

describe('isPremium', () => {
  it('returns false for free / null / undefined / unknown', () => {
    expect(isPremium('free')).toBe(false);
    expect(isPremium(null)).toBe(false);
    expect(isPremium(undefined)).toBe(false);
    expect(isPremium('mystery_tier')).toBe(false);
  });

  it('returns true for every paid tier', () => {
    expect(isPremium('starter')).toBe(true);
    expect(isPremium('pro')).toBe(true);
    expect(isPremium('unlimited')).toBe(true);
  });

  it('returns true for legacy paid aliases and billing-cycle variants', () => {
    expect(isPremium('basic')).toBe(true);
    expect(isPremium('premium')).toBe(true);
    expect(isPremium('ultimate_yearly')).toBe(true);
    expect(isPremium('starter_monthly')).toBe(true);
  });
});
