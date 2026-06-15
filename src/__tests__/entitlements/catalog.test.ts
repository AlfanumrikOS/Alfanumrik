import { describe, it, expect } from 'vitest';

/**
 * REG-147 (catalog half) — Institution Entitlements Catalog (MVP 12-key contract).
 *
 * Under test: src/lib/entitlements/catalog.ts
 *   - ENTITLEMENT_CATALOG        — the canonical 12-key catalog (5 modules, 5
 *                                  features, 2 limits) with category/control/
 *                                  valueShape per key.
 *   - isValidEntitlementKey()    — code-owned gate the API uses to reject the
 *                                  free-form `entitlement_key` text column.
 *   - validateEntitlementValue() — value-shape gate: {enabled:bool} for
 *                                  module/feature, {max,period} for limit.
 *
 * These are PURE functions over a const catalog (catalog.ts imports only the
 * pure MODULE_REGISTRY), so no mocking is needed — assertions run directly
 * against the real catalog. This is the byte-for-byte shared contract that the
 * resolver, the super-admin API, and the admin panel all import.
 */

import {
  ENTITLEMENT_CATALOG,
  ENTITLEMENT_KEYS,
  getCatalogEntry,
  isValidEntitlementKey,
  validateEntitlementValue,
  type CatalogEntry,
} from '@/lib/entitlements/catalog';

// The frozen MVP key set — the test is the contract. Reordering/renaming a key
// MUST update this list (and that is a deliberate, reviewed change).
const EXPECTED_KEYS = [
  // modules (5)
  'module.lms',
  'module.ai_tutor',
  'module.testing_engine',
  'module.analytics',
  'module.live_classes',
  // features (5)
  'feature.foxy_interact',
  'feature.simulation_interact',
  'feature.report_download_own',
  'feature.exam_create',
  'feature.diagnostic_attempt',
  // limits (2)
  'limit.foxy_chat_daily',
  'limit.quiz_daily',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Catalog shape — exactly 12 keys, right categories/controls/value-shapes
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 catalog — exactly the 12 MVP keys', () => {
  it('ENTITLEMENT_CATALOG has exactly 12 entries', () => {
    expect(ENTITLEMENT_CATALOG).toHaveLength(12);
  });

  it('the 12 keys are exactly the expected set, in render order', () => {
    expect(ENTITLEMENT_KEYS).toEqual([...EXPECTED_KEYS]);
  });

  it('5 modules, 5 features, 2 limits', () => {
    const byCat = (c: string) => ENTITLEMENT_CATALOG.filter(e => e.category === c);
    expect(byCat('module')).toHaveLength(5);
    expect(byCat('feature')).toHaveLength(5);
    expect(byCat('limit')).toHaveLength(2);
  });

  it('every key is unique (no duplicate entitlement_key)', () => {
    const keys = ENTITLEMENT_CATALOG.map(e => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('module/feature entries are toggle + enabled-shape; limit entries are number_period + max_period-shape', () => {
    for (const e of ENTITLEMENT_CATALOG) {
      if (e.category === 'module' || e.category === 'feature') {
        expect(e.control).toBe('toggle');
        expect(e.valueShape).toBe('enabled');
      } else {
        expect(e.category).toBe('limit');
        expect(e.control).toBe('number_period');
        expect(e.valueShape).toBe('max_period');
      }
    }
  });

  it('every entry carries bilingual labels (labelEn + labelHi non-empty)', () => {
    for (const e of ENTITLEMENT_CATALOG) {
      expect(typeof e.labelEn).toBe('string');
      expect(e.labelEn.length).toBeGreaterThan(0);
      expect(typeof e.labelHi).toBe('string');
      expect(e.labelHi.length).toBeGreaterThan(0);
    }
  });

  it('features that are sub-capabilities declare a parentModuleKey that exists in the catalog', () => {
    const moduleKeys = new Set(
      ENTITLEMENT_CATALOG.filter(e => e.category === 'module').map(e => e.key),
    );
    const feats = ENTITLEMENT_CATALOG.filter(e => e.category === 'feature');
    // At least one feature has a parent (the parent→child Q3 contract relies on it).
    expect(feats.some(f => f.parentModuleKey)).toBe(true);
    for (const f of feats) {
      if (f.parentModuleKey) expect(moduleKeys.has(f.parentModuleKey)).toBe(true);
    }
  });

  it('every entry has a planDefault for all 4 plans (free/starter/pro/unlimited)', () => {
    for (const e of ENTITLEMENT_CATALOG) {
      expect(Object.keys(e.planDefault).sort()).toEqual(['free', 'pro', 'starter', 'unlimited']);
    }
  });

  it('feature.foxy_interact plan defaults: free off, pro on (the documented per-plan grant)', () => {
    const entry = getCatalogEntry('feature.foxy_interact') as CatalogEntry;
    expect((entry.planDefault.free as { enabled: boolean }).enabled).toBe(false);
    expect((entry.planDefault.pro as { enabled: boolean }).enabled).toBe(true);
  });

  it('limit.foxy_chat_daily free default is {max:5, period:"day"} (usage.ts PLAN_LIMITS)', () => {
    const entry = getCatalogEntry('limit.foxy_chat_daily') as CatalogEntry;
    expect(entry.planDefault.free).toEqual({ max: 5, period: 'day' });
  });

  it('limit.quiz_daily pro default is unlimited → stored {max:null}', () => {
    const entry = getCatalogEntry('limit.quiz_daily') as CatalogEntry;
    expect(entry.planDefault.pro).toEqual({ max: null, period: 'day' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isValidEntitlementKey — accepts the 12, rejects everything else
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 catalog — isValidEntitlementKey', () => {
  it('accepts every one of the 12 catalog keys', () => {
    for (const k of EXPECTED_KEYS) {
      expect(isValidEntitlementKey(k)).toBe(true);
    }
  });

  it('rejects an unknown key', () => {
    expect(isValidEntitlementKey('module.does_not_exist')).toBe(false);
    expect(isValidEntitlementKey('feature.totally_made_up')).toBe(false);
    expect(isValidEntitlementKey('limit.nonexistent_cap')).toBe(false);
  });

  it('rejects a bare module slug (must be the namespaced key)', () => {
    expect(isValidEntitlementKey('ai_tutor')).toBe(false);
    expect(isValidEntitlementKey('lms')).toBe(false);
  });

  it('rejects non-string inputs (null/undefined/number/object/array)', () => {
    expect(isValidEntitlementKey(null)).toBe(false);
    expect(isValidEntitlementKey(undefined)).toBe(false);
    expect(isValidEntitlementKey(42)).toBe(false);
    expect(isValidEntitlementKey({})).toBe(false);
    expect(isValidEntitlementKey(['module.lms'])).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidEntitlementKey('')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateEntitlementValue — shape gate per category
// ─────────────────────────────────────────────────────────────────────────────

describe('REG-147 catalog — validateEntitlementValue (toggle / enabled shape)', () => {
  it('accepts {enabled:true} and {enabled:false} for a module key', () => {
    expect(validateEntitlementValue('module.ai_tutor', { enabled: true })).toBeNull();
    expect(validateEntitlementValue('module.ai_tutor', { enabled: false })).toBeNull();
  });

  it('accepts {enabled:bool} for a feature key', () => {
    expect(validateEntitlementValue('feature.foxy_interact', { enabled: true })).toBeNull();
  });

  it('rejects {max,period} (a limit shape) for a toggle key', () => {
    const err = validateEntitlementValue('module.ai_tutor', { max: 10, period: 'day' });
    expect(err).not.toBeNull();
    expect(err).toContain('module.ai_tutor');
  });

  it('rejects {enabled:"true"} (string, not boolean)', () => {
    expect(validateEntitlementValue('module.lms', { enabled: 'true' })).not.toBeNull();
  });

  it('rejects a bare {} with no enabled key', () => {
    expect(validateEntitlementValue('feature.exam_create', {})).not.toBeNull();
  });
});

describe('REG-147 catalog — validateEntitlementValue (limit / max_period shape)', () => {
  it('accepts {max:N, period:"day"|"week"|"month"} for a limit key', () => {
    expect(validateEntitlementValue('limit.quiz_daily', { max: 20, period: 'day' })).toBeNull();
    expect(validateEntitlementValue('limit.quiz_daily', { max: 100, period: 'week' })).toBeNull();
    expect(validateEntitlementValue('limit.foxy_chat_daily', { max: 5, period: 'month' })).toBeNull();
  });

  it('accepts {max:null, period:"day"} (unlimited)', () => {
    expect(validateEntitlementValue('limit.foxy_chat_daily', { max: null, period: 'day' })).toBeNull();
  });

  it('accepts {max:0, period:"day"} (a zero cap is a valid non-negative integer)', () => {
    expect(validateEntitlementValue('limit.quiz_daily', { max: 0, period: 'day' })).toBeNull();
  });

  it('rejects {enabled:true} (a toggle shape) for a limit key', () => {
    const err = validateEntitlementValue('limit.quiz_daily', { enabled: true });
    expect(err).not.toBeNull();
    expect(err).toContain('limit.quiz_daily');
  });

  it('rejects a missing period', () => {
    expect(validateEntitlementValue('limit.quiz_daily', { max: 10 })).not.toBeNull();
  });

  it('rejects an invalid period value', () => {
    expect(validateEntitlementValue('limit.quiz_daily', { max: 10, period: 'year' })).not.toBeNull();
  });

  it('rejects a negative max', () => {
    expect(validateEntitlementValue('limit.quiz_daily', { max: -1, period: 'day' })).not.toBeNull();
  });

  it('rejects a non-integer max', () => {
    expect(validateEntitlementValue('limit.quiz_daily', { max: 3.5, period: 'day' })).not.toBeNull();
  });
});

describe('REG-147 catalog — validateEntitlementValue (universal rejections)', () => {
  it('rejects an unknown key regardless of value', () => {
    const err = validateEntitlementValue('module.unknown', { enabled: true });
    expect(err).not.toBeNull();
    expect(err).toContain('Unknown entitlement key');
  });

  it('rejects null / non-object / array values', () => {
    expect(validateEntitlementValue('module.lms', null)).not.toBeNull();
    expect(validateEntitlementValue('module.lms', 'enabled')).not.toBeNull();
    expect(validateEntitlementValue('module.lms', 42)).not.toBeNull();
    expect(validateEntitlementValue('module.lms', [{ enabled: true }])).not.toBeNull();
  });
});
