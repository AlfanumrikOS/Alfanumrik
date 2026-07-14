/**
 * Foxy Plan Normalization + DB-authoritative quota-model tests.
 *
 * These symbols are imported REAL from the route's co-located `_lib/constants`
 * (they are exported now, so there is nothing left to "replicate" and no parity
 * drift is possible — the older version of this file hand-copied them):
 *   - normalizePlan   — legacy alias + billing-cycle-suffix canonicalization
 *   - UNLIMITED_QUOTA — the 999999 sentinel the DB maps foxy_chats_per_day=-1 to
 *   - UPGRADE_PROMPTS — soft-upsell config; ONLY the finite free tier has an entry
 *
 * HISTORY (2026-07-14 quota fix): the old Node-side `DAILY_QUOTA` map
 * (free:10 / starter:30 / pro:100 / unlimited:999999) was DELETED. It implied a
 * false Node-side authority — enforcement is DB-authoritative
 * (`check_and_record_usage` → `get_plan_limit` → `subscription_plans.
 * foxy_chats_per_day`). Paid plans are now UNLIMITED (-1 → 999999); only the
 * free plan keeps a finite cap. These tests reflect that reality; the previous
 * assertions on the deleted DAILY_QUOTA values were stale.
 *
 * Source: src/app/api/foxy/_lib/constants.ts (normalizePlan, UNLIMITED_QUOTA,
 *         UPGRADE_PROMPTS) + the route's soft-upgrade-prompt gating block in
 *         src/app/api/foxy/route.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizePlan,
  UNLIMITED_QUOTA,
  UPGRADE_PROMPTS,
} from '@/app/api/foxy/_lib/constants';

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
    // Runtime signature is (raw: string); the `raw || 'free'` guard tolerates a
    // null/undefined that leaks through at runtime. Cast so the type-checker
    // still models the real string-typed public contract.
    expect(normalizePlan(null as unknown as string)).toBe('free');
  });

  it("undefined falls back to 'free' — no crash", () => {
    expect(normalizePlan(undefined as unknown as string)).toBe('free');
  });

  it('unknown plan code passes through unchanged (canonical map lookup misses later)', () => {
    // Unknown codes are not mapped to a canonical name — they pass through so
    // the caller falls back to its default when the key is missing. This is
    // intentional: normalizePlan only maps KNOWN aliases.
    expect(normalizePlan('enterprise')).toBe('enterprise');
  });
});

// ─── UNLIMITED_QUOTA sentinel ────────────────────────────────────────────────

describe('UNLIMITED_QUOTA: mirrors the DB unlimited cap', () => {
  it('is 999999 (the value get_plan_limit maps foxy_chats_per_day=-1 to)', () => {
    expect(UNLIMITED_QUOTA).toBe(999999);
  });
});

// ─── UPGRADE_PROMPTS: only the finite free tier can be nudged ─────────────────

describe('UPGRADE_PROMPTS: only the finite free tier has an entry', () => {
  it('free has a bilingual (P7) message with a showAtRemaining threshold and nextPlan', () => {
    const free = UPGRADE_PROMPTS.free;
    expect(free).toBeDefined();
    expect(typeof free.showAtRemaining).toBe('number');
    expect(free.showAtRemaining).toBeGreaterThan(0);
    // {remaining} placeholder is interpolated by the route.
    expect(free.message).toContain('{remaining}');
    expect(free.messageHi).toContain('{remaining}');
    // Hindi copy carries Devanagari (P7).
    expect(/[ऀ-ॿ]/.test(free.messageHi)).toBe(true);
    expect(free.nextPlan).toBe('starter');
  });

  it('has NO entry for any paid plan — unlimited means nothing to upsell', () => {
    for (const paid of ['starter', 'pro', 'unlimited']) {
      expect(UPGRADE_PROMPTS[paid]).toBeUndefined();
    }
  });
});

// ─── Upgrade-prompt gating (parity with route.ts) ────────────────────────────
//
// Parity helper for the route's "Build soft upgrade prompt" block
// (src/app/api/foxy/route.ts). Keep in sync with that gate: a prompt is shown
// ONLY when the plan has an UPGRADE_PROMPTS entry AND the DB-authoritative limit
// is finite (< UNLIMITED_QUOTA) AND remaining is at/below the threshold.
function wouldShowUpgradePrompt(plan: string, remaining: number, limit: number): boolean {
  const cfg = UPGRADE_PROMPTS[plan];
  return Boolean(
    cfg
      && limit < UNLIMITED_QUOTA
      && typeof remaining === 'number'
      && remaining <= cfg.showAtRemaining,
  );
}

describe('upgrade-prompt gating: DB-authoritative, unlimited paid plans never nudge', () => {
  it('free near exhaustion (finite limit, remaining <= threshold) → prompt shown', () => {
    const threshold = UPGRADE_PROMPTS.free.showAtRemaining;
    expect(wouldShowUpgradePrompt('free', threshold, 5)).toBe(true);
    expect(wouldShowUpgradePrompt('free', 0, 5)).toBe(true);
  });

  it('free with plenty remaining (above threshold) → no prompt', () => {
    const threshold = UPGRADE_PROMPTS.free.showAtRemaining;
    expect(wouldShowUpgradePrompt('free', threshold + 1, 5)).toBe(false);
  });

  it('paid unlimited plans (limit === UNLIMITED_QUOTA) → never prompt, even at remaining 0', () => {
    for (const paid of ['starter', 'pro', 'unlimited']) {
      expect(wouldShowUpgradePrompt(paid, 0, UNLIMITED_QUOTA)).toBe(false);
      expect(wouldShowUpgradePrompt(paid, 2, UNLIMITED_QUOTA)).toBe(false);
    }
  });

  it('normalized legacy paid aliases also never prompt (basic→starter, premium→pro are unlimited)', () => {
    expect(wouldShowUpgradePrompt(normalizePlan('basic'), 0, UNLIMITED_QUOTA)).toBe(false);
    expect(wouldShowUpgradePrompt(normalizePlan('premium_yearly'), 0, UNLIMITED_QUOTA)).toBe(false);
    expect(wouldShowUpgradePrompt(normalizePlan('ultimate_monthly'), 0, UNLIMITED_QUOTA)).toBe(false);
  });
});
