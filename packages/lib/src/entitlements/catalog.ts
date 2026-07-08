/**
 * ALFANUMRIK — Institution Entitlements Catalog (MVP)
 *
 * The CANONICAL, code-owned catalog of the 12 deal-driven entitlement keys an
 * ops operator can grant/override per school. This is the SHARED CONTRACT: the
 * super-admin entitlements API, the entitlement resolver, and the frontend
 * admin panel all import from here so they agree byte-for-byte on the key set,
 * value shapes, labels, and per-plan defaults.
 *
 * WHY a const catalog (not a DB table):
 *   - Mirrors the MODULE_REGISTRY stance (src/lib/modules/registry.ts): adding
 *     a new entitlement always requires shipping enforcement code anyway, so the
 *     catalog travels with the deploy. The DB stores only DEVIATIONS from these
 *     defaults (sparse rows in institution_entitlements).
 *   - `entitlement_key` is free-form text in the DB (no enum) — exactly like
 *     tenant_modules.module_key — so a new key ships without a migration. This
 *     catalog is what validates that free-form text at the API boundary
 *     (isValidEntitlementKey).
 *
 * KEY NAMESPACING (matches the migration header 20260615205752):
 *   'module.<slug>'  -> value {"enabled": true|false}
 *   'feature.<slug>' -> value {"enabled": true|false}
 *   'limit.<slug>'   -> value {"max": N | null, "period": "day"|"week"|"month"}
 *                       max === null => UNLIMITED (resolver maps to 999999 — the
 *                       usage.ts sentinel — i.e. "no cap").
 *
 * PARENT -> CHILD (feature ⊂ module):
 *   Some features are sub-capabilities of a module (e.g. feature.foxy_interact
 *   only makes sense if module.ai_tutor is on). `parentModuleKey` records that
 *   relationship; the resolver forces a feature OFF when its parent module
 *   resolves OFF (see resolver.ts Q3).
 *
 * PLAN DEFAULTS source of truth (single source per category — do NOT duplicate
 * numbers, REFERENCE the owning module):
 *   - modules  -> MODULE_REGISTRY.defaultsByType (registry.ts). We project the
 *                 per-tenant-type defaults into the four billing plans. Since
 *                 the platform default for B2C schools is "everything on" for
 *                 the MVP modules, every plan gets the module's `school` default.
 *   - features -> HARDCODED here (the legacy per-plan feature-grant intent;
 *                 there is no other code home for these booleans in the MVP).
 *   - limits   -> usage.ts PLAN_LIMITS (foxy_chat / quiz). 999999 = unlimited.
 *
 * Owner: backend (catalog + resolver + API). Frontend imports the TYPES + the
 * catalog array (read-only) to render the admin panel.
 */

import { MODULE_REGISTRY, type ModuleKey } from '@alfanumrik/lib/modules/registry';

// ─── Plan codes (the 4 canonical billing tiers) ───────────────────────────

/** The four canonical plan codes used across pricing, usage.ts, and billing. */
export type PlanCode = 'free' | 'starter' | 'pro' | 'unlimited';

export const PLAN_CODES: readonly PlanCode[] = ['free', 'starter', 'pro', 'unlimited'] as const;

/** The usage.ts unlimited sentinel. A limit's effective `max` of this value
 *  (or a stored {max:null}) means "no cap". Kept in lockstep with usage.ts. */
export const UNLIMITED_SENTINEL = 999999;

// ─── Value-shape types ─────────────────────────────────────────────────────

/** Stored/effective value for a toggle entitlement (module.* / feature.*). */
export interface EnabledValue {
  enabled: boolean;
}

/** Stored value for a limit entitlement. `max: null` => unlimited. */
export interface MaxPeriodValue {
  /** null => unlimited (resolver maps to UNLIMITED_SENTINEL). */
  max: number | null;
  period: 'day' | 'week' | 'month';
}

export type EntitlementValue = EnabledValue | MaxPeriodValue;

// ─── Catalog entry ─────────────────────────────────────────────────────────

export type EntitlementCategory = 'module' | 'feature' | 'limit';
export type EntitlementControl = 'toggle' | 'number_period';
export type EntitlementValueShape = 'enabled' | 'max_period';

export interface CatalogEntry {
  /** The free-form `entitlement_key` (e.g. 'module.ai_tutor'). */
  key: string;
  category: EntitlementCategory;
  /** UI control hint for the admin panel. */
  control: EntitlementControl;
  /** Discriminates the value JSON shape. */
  valueShape: EntitlementValueShape;
  labelEn: string;
  labelHi: string;
  /**
   * For features that are sub-capabilities of a module. When the parent module
   * resolves OFF, the resolver forces this feature OFF (Q3). Undefined for
   * modules and for top-level features/limits.
   */
  parentModuleKey?: string;
  /** The per-plan default value for each of the 4 billing tiers. */
  planDefault: Record<PlanCode, EntitlementValue>;
}

// ─── Helpers to build plan-default maps ────────────────────────────────────

/** Module default: project the MODULE_REGISTRY `school` tenant-type default
 *  across all four plans (MVP B2C schools have the same module set on every
 *  plan; deal-driven deviations are stored as override rows). */
function moduleDefault(moduleKey: ModuleKey): Record<PlanCode, EnabledValue> {
  const meta = MODULE_REGISTRY.find(m => m.key === moduleKey);
  // `school` is the canonical tenant type for the MVP B2C/B2B plan mapping.
  const on = meta?.defaultsByType.school ?? false;
  const v: EnabledValue = { enabled: on };
  return { free: v, starter: v, pro: v, unlimited: v };
}

/** Feature default: explicit per-plan booleans (the legacy grant intent). */
function featureDefault(
  grants: Record<PlanCode, boolean>,
): Record<PlanCode, EnabledValue> {
  return {
    free: { enabled: grants.free },
    starter: { enabled: grants.starter },
    pro: { enabled: grants.pro },
    unlimited: { enabled: grants.unlimited },
  };
}

/** Limit default: explicit per-plan maxima. UNLIMITED_SENTINEL => {max:null}. */
function limitDefault(
  period: 'day' | 'week' | 'month',
  maxima: Record<PlanCode, number>,
): Record<PlanCode, MaxPeriodValue> {
  const toVal = (n: number): MaxPeriodValue => ({
    max: n >= UNLIMITED_SENTINEL ? null : n,
    period,
  });
  return {
    free: toVal(maxima.free),
    starter: toVal(maxima.starter),
    pro: toVal(maxima.pro),
    unlimited: toVal(maxima.unlimited),
  };
}

// ─── The MVP catalog (12 keys) ─────────────────────────────────────────────
//
// Order is the render order in the admin panel: modules, then features (grouped
// under their parent module), then live limits.

export const ENTITLEMENT_CATALOG: readonly CatalogEntry[] = [
  // ── Modules (5) — defaults from MODULE_REGISTRY ──────────────────────────
  {
    key: 'module.lms',
    category: 'module',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Learning (LMS)',
    labelHi: 'सीखना (LMS)',
    planDefault: moduleDefault('lms'),
  },
  {
    key: 'module.ai_tutor',
    category: 'module',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'AI Tutor (Foxy)',
    labelHi: 'AI ट्यूटर (फॉक्सी)',
    planDefault: moduleDefault('ai_tutor'),
  },
  {
    key: 'module.testing_engine',
    category: 'module',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Testing Engine',
    labelHi: 'परीक्षा इंजन',
    planDefault: moduleDefault('testing_engine'),
  },
  {
    key: 'module.analytics',
    category: 'module',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Analytics',
    labelHi: 'विश्लेषण',
    planDefault: moduleDefault('analytics'),
  },
  {
    key: 'module.live_classes',
    category: 'module',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Live Classes',
    labelHi: 'लाइव कक्षाएँ',
    planDefault: moduleDefault('live_classes'),
  },

  // ── Features (5) — explicit per-plan grant intent ────────────────────────
  {
    key: 'feature.foxy_interact',
    category: 'feature',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Foxy Interaction',
    labelHi: 'फॉक्सी से बातचीत',
    parentModuleKey: 'module.ai_tutor',
    // free off / starter on / pro on / unlimited on
    planDefault: featureDefault({ free: false, starter: true, pro: true, unlimited: true }),
  },
  {
    key: 'feature.simulation_interact',
    category: 'feature',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Simulations',
    labelHi: 'सिमुलेशन',
    parentModuleKey: 'module.testing_engine',
    // free off / starter off / pro on / unlimited on
    planDefault: featureDefault({ free: false, starter: false, pro: true, unlimited: true }),
  },
  {
    key: 'feature.report_download_own',
    category: 'feature',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Download Own Reports',
    labelHi: 'अपनी रिपोर्ट डाउनलोड',
    parentModuleKey: 'module.analytics',
    // free off / starter on / pro on / unlimited on
    planDefault: featureDefault({ free: false, starter: true, pro: true, unlimited: true }),
  },
  {
    key: 'feature.exam_create',
    category: 'feature',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Create Exams',
    labelHi: 'परीक्षा बनाएँ',
    parentModuleKey: 'module.testing_engine',
    // free on / starter on / pro on / unlimited on
    planDefault: featureDefault({ free: true, starter: true, pro: true, unlimited: true }),
  },
  {
    key: 'feature.diagnostic_attempt',
    category: 'feature',
    control: 'toggle',
    valueShape: 'enabled',
    labelEn: 'Diagnostic Tests',
    labelHi: 'डायग्नोस्टिक टेस्ट',
    parentModuleKey: 'module.testing_engine',
    // free off / starter on / pro on / unlimited on
    planDefault: featureDefault({ free: false, starter: true, pro: true, unlimited: true }),
  },

  // ── Live limits (2) — defaults from usage.ts PLAN_LIMITS ─────────────────
  {
    key: 'limit.foxy_chat_daily',
    category: 'limit',
    control: 'number_period',
    valueShape: 'max_period',
    labelEn: 'Foxy Chats per Day',
    labelHi: 'प्रतिदिन फॉक्सी चैट',
    // usage.ts PLAN_LIMITS.foxy_chat: 5 / 30 / 100 / unlimited
    planDefault: limitDefault('day', { free: 5, starter: 30, pro: 100, unlimited: UNLIMITED_SENTINEL }),
  },
  {
    key: 'limit.quiz_daily',
    category: 'limit',
    control: 'number_period',
    valueShape: 'max_period',
    labelEn: 'Quizzes per Day',
    labelHi: 'प्रतिदिन क्विज़',
    // usage.ts PLAN_LIMITS.quiz: 5 / 20 / unlimited / unlimited
    planDefault: limitDefault('day', { free: 5, starter: 20, pro: UNLIMITED_SENTINEL, unlimited: UNLIMITED_SENTINEL }),
  },
];

// ─── Lookups + validators ──────────────────────────────────────────────────

const CATALOG_BY_KEY: ReadonlyMap<string, CatalogEntry> = new Map(
  ENTITLEMENT_CATALOG.map(e => [e.key, e]),
);

/** All catalog keys, in render order. */
export const ENTITLEMENT_KEYS: readonly string[] = ENTITLEMENT_CATALOG.map(e => e.key);

/** Lookup a catalog entry by its free-form key. null for unknown keys. */
export function getCatalogEntry(key: string): CatalogEntry | null {
  return CATALOG_BY_KEY.get(key) ?? null;
}

/**
 * Validate a free-form entitlement key against the catalog. The DB column is
 * free-form text (no enum); this is the code-owned gate the API uses to reject
 * unknown keys before any write.
 */
export function isValidEntitlementKey(k: unknown): k is string {
  return typeof k === 'string' && CATALOG_BY_KEY.has(k);
}

/**
 * Validate that a candidate value matches the shape required by the catalog
 * entry for `key`. Returns a typed error string on mismatch, or null when OK.
 *
 * - 'enabled'    => { enabled: boolean }  (no extra keys required)
 * - 'max_period' => { max: number(>=0)|null, period: 'day'|'week'|'month' }
 */
export function validateEntitlementValue(key: string, value: unknown): string | null {
  const entry = getCatalogEntry(key);
  if (!entry) return `Unknown entitlement key: ${key}`;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return `Value for ${key} must be a JSON object`;
  }
  const v = value as Record<string, unknown>;

  if (entry.valueShape === 'enabled') {
    if (typeof v.enabled !== 'boolean') {
      return `Value for ${key} must be { enabled: boolean }`;
    }
    return null;
  }

  // max_period
  if (!('max' in v) || !('period' in v)) {
    return `Value for ${key} must be { max: number|null, period: 'day'|'week'|'month' }`;
  }
  if (v.max !== null) {
    if (typeof v.max !== 'number' || !Number.isFinite(v.max) || !Number.isInteger(v.max) || v.max < 0) {
      return `Value for ${key}: max must be a non-negative integer or null (unlimited)`;
    }
  }
  if (v.period !== 'day' && v.period !== 'week' && v.period !== 'month') {
    return `Value for ${key}: period must be one of 'day' | 'week' | 'month'`;
  }
  return null;
}

/** Type guard: is this the enabled (toggle) value shape? */
export function isEnabledValue(v: EntitlementValue): v is EnabledValue {
  return typeof (v as EnabledValue).enabled === 'boolean';
}

/** Type guard: is this the max/period (limit) value shape? */
export function isMaxPeriodValue(v: EntitlementValue): v is MaxPeriodValue {
  return 'max' in (v as MaxPeriodValue) && 'period' in (v as MaxPeriodValue);
}
