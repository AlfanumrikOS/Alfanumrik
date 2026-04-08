/**
 * Foxy Plan Normalization Tests
 *
 * Tests the normalizePlan logic added to src/app/api/foxy/route.ts
 * to handle legacy DB plan code aliases and billing-cycle suffixes.
 *
 * Canonical plan codes: free | starter | pro | unlimited
 *
 * normalizePlan is not exported from route.ts (it is an internal helper),
 * so this file replicates the exact function logic. This is explicitly labeled
 * as a parity test: if the implementation in route.ts changes, this test
 * must be updated to match.
 *
 * Source: src/app/api/foxy/route.ts — normalizePlan()
 */

import { describe, it, expect } from 'vitest';

// ─── Replication of internal normalizePlan from src/app/api/foxy/route.ts ────
//
// Canonical implementation (keep in sync with route.ts):
//
//   function normalizePlan(raw: string): string {
//     return (raw || 'free')
//       .replace(/_(monthly|yearly)$/, '')
//       .replace(/^basic$/, 'starter')
//       .replace(/^premium$/, 'pro')
//       .replace(/^ultimate$/, 'unlimited');
//   }

function normalizePlan(raw: string | null | undefined): string {
  return (raw || 'free')
    .replace(/_(monthly|yearly)$/, '')
    .replace(/^basic$/, 'starter')
    .replace(/^premium$/, 'pro')
    .replace(/^ultimate$/, 'unlimited');
}

// ─── DAILY_QUOTA constants parity ────────────────────────────────────────────
//
// Canonical DAILY_QUOTA from src/app/api/foxy/route.ts:
//   const DAILY_QUOTA: Record<string, number> = {
//     free: 10,
//     starter: 30,
//     pro: 100,
//     unlimited: 999999,
//   };
//
// Keep in sync with route.ts. These values govern how many Foxy chats a
// student can send per day per plan tier.

const DAILY_QUOTA: Record<string, number> = {
  free: 10,
  starter: 30,
  pro: 100,
  unlimited: 999999,
};

// ─── Canonical plan code pass-through ────────────────────────────────────────

describe('normalizePlan: canonical codes pass through unchanged', () => {
  it("'free' normalizes to 'free'", () => {
    expect(normalizePlan('free')).toBe('free');
  });

  it("'starter' normalizes to 'starter'", () => {
    expect(normalizePlan('starter')).toBe('starter');
  });

  it("'pro' normalizes to 'pro'", () => {
    expect(normalizePlan('pro')).toBe('pro');
  });

  it("'unlimited' normalizes to 'unlimited'", () => {
    expect(normalizePlan('unlimited')).toBe('unlimited');
  });
});

// ─── Legacy alias mapping ─────────────────────────────────────────────────────

describe('normalizePlan: legacy plan code aliases', () => {
  it("'basic' maps to 'starter'", () => {
    expect(normalizePlan('basic')).toBe('starter');
  });

  it("'premium' maps to 'pro'", () => {
    expect(normalizePlan('premium')).toBe('pro');
  });

  it("'ultimate' maps to 'unlimited'", () => {
    expect(normalizePlan('ultimate')).toBe('unlimited');
  });
});

// ─── Billing cycle suffix stripping ──────────────────────────────────────────

describe('normalizePlan: billing cycle suffix stripping', () => {
  it("'starter_monthly' strips suffix to 'starter'", () => {
    expect(normalizePlan('starter_monthly')).toBe('starter');
  });

  it("'pro_yearly' strips suffix to 'pro'", () => {
    expect(normalizePlan('pro_yearly')).toBe('pro');
  });

  it("'free_monthly' strips suffix to 'free'", () => {
    expect(normalizePlan('free_monthly')).toBe('free');
  });

  it("'unlimited_yearly' strips suffix to 'unlimited'", () => {
    expect(normalizePlan('unlimited_yearly')).toBe('unlimited');
  });
});

// ─── Alias + billing cycle combined ──────────────────────────────────────────

describe('normalizePlan: legacy alias combined with billing cycle suffix', () => {
  it("'basic_monthly' normalizes to 'starter' (suffix stripped first, then basic→starter alias)", () => {
    // Step 1: 'basic_monthly' → 'basic' (suffix strip)
    // Step 2: 'basic' → 'starter' (alias replacement)
    expect(normalizePlan('basic_monthly')).toBe('starter');
  });

  it("'premium_yearly' normalizes to 'pro' (suffix stripped first, then premium→pro alias)", () => {
    // Step 1: 'premium_yearly' → 'premium' (suffix strip)
    // Step 2: 'premium' → 'pro' (alias replacement)
    expect(normalizePlan('premium_yearly')).toBe('pro');
  });

  it("'ultimate_monthly' normalizes to 'unlimited' (suffix stripped first, then ultimate→unlimited alias)", () => {
    // Step 1: 'ultimate_monthly' → 'ultimate' (suffix strip)
    // Step 2: 'ultimate' → 'unlimited' (alias replacement)
    expect(normalizePlan('ultimate_monthly')).toBe('unlimited');
  });
});

// ─── Fallback / edge case handling ───────────────────────────────────────────

describe('normalizePlan: graceful fallback for missing or invalid input', () => {
  it("empty string '' falls back to 'free' — no crash", () => {
    expect(normalizePlan('')).toBe('free');
  });

  it("null falls back to 'free' — no crash", () => {
    expect(normalizePlan(null)).toBe('free');
  });

  it("undefined falls back to 'free' — no crash", () => {
    expect(normalizePlan(undefined)).toBe('free');
  });

  it("unknown plan code passes through unchanged (looked up in DAILY_QUOTA later)", () => {
    // Unknown codes are not mapped to a canonical name — they pass through
    // so the caller falls back to DEFAULT_QUOTA when the key is missing.
    // This is intentional: normalizePlan only maps KNOWN aliases.
    const result = normalizePlan('enterprise');
    expect(result).toBe('enterprise');
  });
});

// ─── DAILY_QUOTA constant values ─────────────────────────────────────────────

describe('DAILY_QUOTA: constants match canonical plan tiers', () => {
  it('free plan quota is 10 chats per day', () => {
    expect(DAILY_QUOTA['free']).toBe(10);
  });

  it('starter plan quota is 30 chats per day', () => {
    expect(DAILY_QUOTA['starter']).toBe(30);
  });

  it('pro plan quota is 100 chats per day', () => {
    expect(DAILY_QUOTA['pro']).toBe(100);
  });

  it('unlimited plan quota is effectively unlimited (999999)', () => {
    expect(DAILY_QUOTA['unlimited']).toBe(999999);
  });

  it('all four canonical plan codes have quota entries', () => {
    const canonicalCodes = ['free', 'starter', 'pro', 'unlimited'];
    for (const code of canonicalCodes) {
      expect(DAILY_QUOTA).toHaveProperty(code);
      expect(typeof DAILY_QUOTA[code]).toBe('number');
      expect(DAILY_QUOTA[code]).toBeGreaterThan(0);
    }
  });

  it('quota is monotonically increasing across plan tiers', () => {
    // Each higher tier must have a higher or equal quota than the tier below
    expect(DAILY_QUOTA['starter']).toBeGreaterThan(DAILY_QUOTA['free']);
    expect(DAILY_QUOTA['pro']).toBeGreaterThan(DAILY_QUOTA['starter']);
    expect(DAILY_QUOTA['unlimited']).toBeGreaterThan(DAILY_QUOTA['pro']);
  });
});

// ─── normalizePlan + DAILY_QUOTA integration ─────────────────────────────────

describe('normalizePlan + DAILY_QUOTA: end-to-end plan resolution', () => {
  const DEFAULT_QUOTA = 10;

  function resolveQuota(rawPlan: string | null | undefined): number {
    const normalized = normalizePlan(rawPlan);
    return DAILY_QUOTA[normalized] ?? DEFAULT_QUOTA;
  }

  it("'basic' resolves to starter quota (30)", () => {
    expect(resolveQuota('basic')).toBe(30);
  });

  it("'premium' resolves to pro quota (100)", () => {
    expect(resolveQuota('premium')).toBe(100);
  });

  it("'ultimate' resolves to unlimited quota (999999)", () => {
    expect(resolveQuota('ultimate')).toBe(999999);
  });

  it("'pro_yearly' resolves to pro quota (100)", () => {
    expect(resolveQuota('pro_yearly')).toBe(100);
  });

  it("'basic_monthly' resolves to starter quota (30)", () => {
    expect(resolveQuota('basic_monthly')).toBe(30);
  });

  it("empty string resolves to free quota (10)", () => {
    expect(resolveQuota('')).toBe(10);
  });

  it("null resolves to free quota (10)", () => {
    expect(resolveQuota(null)).toBe(10);
  });

  it("unknown plan code falls back to DEFAULT_QUOTA (10)", () => {
    // 'enterprise' is not in DAILY_QUOTA, so ?? DEFAULT_QUOTA applies
    expect(resolveQuota('enterprise')).toBe(DEFAULT_QUOTA);
  });
});
