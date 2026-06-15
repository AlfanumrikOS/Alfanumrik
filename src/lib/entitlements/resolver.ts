/**
 * ALFANUMRIK — Institution Entitlements Resolver (server-only)
 *
 * Computes a school's EFFECTIVE value for every catalog entitlement key, plus
 * the runtime enforcement gate the rest of the platform calls.
 *
 * ─── Resolution order (highest precedence first) ──────────────────────────
 * For each catalog key:
 *   1. platform_module_overrides  — super-admin GLOBAL force-disable (module.*
 *                                   only). If a module is force-disabled
 *                                   platform-wide, it wins over everything.
 *                                   resolved_by = 'platform_override'.
 *   2. institution_entitlements   — the deal-specific row for (school_id, key).
 *                                   Honours effective_from / effective_to
 *                                   windows (an out-of-window row is ignored).
 *                                   resolved_by = 'institution_entitlement'.
 *   3. tenant_modules             — the school-admin self-serve coarse module
 *                                   toggle (module.* only).
 *                                   resolved_by = 'tenant_module'.
 *   4. plan default               — the catalog's planDefault for the school's
 *                                   subscription plan (module/feature/limit per
 *                                   category — see catalog.ts; numbers come from
 *                                   usage.ts PLAN_LIMITS / MODULE_REGISTRY).
 *                                   resolved_by = 'plan_default'.
 *   5. deny                       — unknown key or no resolvable value.
 *                                   resolved_by = 'deny'.
 *
 * ─── Parent -> child (Q3) ─────────────────────────────────────────────────
 * If a feature's `parentModuleKey` resolves OFF, the feature is FORCED OFF
 * regardless of its own resolution. `resolved_by` then reflects the PARENT's
 * resolution source (so the admin panel can explain "off because module X is
 * off"). The `force_disabled_by_parent` flag is set on the result.
 *
 * ─── Unlimited (Q6) ───────────────────────────────────────────────────────
 * A stored / default limit value of {max: null} is UNLIMITED. The effective
 * value carries `max: null`, and `effectiveMax` maps it to UNLIMITED_SENTINEL
 * (999999, the usage.ts "no cap" sentinel) for callers that compare numerically.
 *
 * ─── Flag gate (config-read ALWAYS vs ENFORCE-only-when-flag-ON) ──────────
 * `getResolvedEntitlements(schoolId)` ALWAYS reads the config and computes
 * effective values — it is FLAG-INDEPENDENT. This is what the super-admin
 * preview panel renders, so an operator can configure a deal and see exactly
 * what it will do BEFORE the flag is flipped on.
 *
 * `isEntitledEnforced(...)` is the RUNTIME GATE. It only ENFORCES (can return
 * "blocked") when isFeatureEnabled('ff_institution_entitlements_v1') is ON. When
 * the flag is OFF, the gate is a NO-OP PASS-THROUGH: it still reads the config
 * (so callers get the resolved value for display) but NEVER blocks. This makes
 * shipping the feature a zero-behavior change until an operator opts in.
 *
 * All DB reads go through supabaseAdmin (service role, bypasses RLS). This file
 * is SERVER-ONLY — never import it into client code (P8).
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { logger } from '@/lib/logger';
import {
  ENTITLEMENT_CATALOG,
  getCatalogEntry,
  isEnabledValue,
  isMaxPeriodValue,
  UNLIMITED_SENTINEL,
  type CatalogEntry,
  type EntitlementValue,
  type EnabledValue,
  type MaxPeriodValue,
  type PlanCode,
} from './catalog';

/** The flag that gates ENFORCEMENT (not config-read). */
export const ENTITLEMENTS_FLAG = 'ff_institution_entitlements_v1';

// ─── Result types ──────────────────────────────────────────────────────────

export type ResolvedBy =
  | 'platform_override'
  | 'institution_entitlement'
  | 'tenant_module'
  | 'plan_default'
  | 'deny';

export interface ResolvedEntitlement {
  key: string;
  /** The effective value. For 'deny', a category-appropriate "off"/"zero". */
  value: EntitlementValue;
  resolved_by: ResolvedBy;
  /** Effective enabled state for toggle entitlements; null for limits. */
  effectiveEnabled: boolean | null;
  /** Effective numeric cap for limits (UNLIMITED_SENTINEL = no cap); null for toggles. */
  effectiveMax: number | null;
  /** True when this feature was forced OFF because its parent module is OFF. */
  force_disabled_by_parent: boolean;
}

// ─── Plan resolution for a school ──────────────────────────────────────────

const VALID_PLANS: ReadonlySet<string> = new Set(['free', 'starter', 'pro', 'unlimited']);
const PLAN_ALIAS: Record<string, string> = { basic: 'starter', premium: 'pro', ultimate: 'unlimited' };

function normalizePlan(raw: string | null | undefined): PlanCode {
  const base = (raw ?? 'free').toLowerCase().replace(/_(monthly|yearly)$/, '');
  const aliased = PLAN_ALIAS[base] ?? base;
  return (VALID_PLANS.has(aliased) ? aliased : 'free') as PlanCode;
}

/**
 * Resolve the billing plan for a school. Reads school_subscriptions.plan
 * (the B2B school subscription), defaulting to 'free'. Fails closed to 'free'
 * on any DB error so a transient failure never grants a higher tier.
 */
async function resolveSchoolPlan(schoolId: string): Promise<PlanCode> {
  const { data, error } = await supabaseAdmin
    .from('school_subscriptions')
    .select('plan, status')
    .eq('school_id', schoolId)
    .maybeSingle();
  if (error) {
    logger.warn('entitlements_plan_lookup_failed', { schoolId, error: error.message });
    return 'free';
  }
  return normalizePlan(data?.plan as string | undefined);
}

/**
 * Resolve the school_id for an auth user (student path). The API works on an
 * explicit schoolId, so this is only used by callers that hold a userId.
 * Returns null when the user is not a school-linked student.
 */
export async function resolveSchoolIdForUser(userId: string): Promise<string | null> {
  if (!userId) return null;
  const { data, error } = await supabaseAdmin
    .from('students')
    .select('school_id')
    .eq('auth_user_id', userId)
    .maybeSingle();
  if (error) {
    logger.warn('entitlements_user_school_lookup_failed', { error: error.message });
    return null;
  }
  return (data?.school_id as string | null) ?? null;
}

// ─── Raw config loaders ────────────────────────────────────────────────────

interface InstitutionEntitlementRow {
  entitlement_key: string;
  value: unknown;
  effective_from: string | null;
  effective_to: string | null;
}

interface TenantModuleRow {
  module_key: string;
  is_enabled: boolean;
}

interface PlatformOverrideRow {
  module_key: string;
  is_force_disabled: boolean;
}

async function loadInstitutionRows(schoolId: string): Promise<InstitutionEntitlementRow[]> {
  const { data, error } = await supabaseAdmin
    .from('institution_entitlements')
    .select('entitlement_key, value, effective_from, effective_to')
    .eq('school_id', schoolId);
  if (error) {
    logger.warn('entitlements_institution_rows_failed', { schoolId, error: error.message });
    return [];
  }
  return (data ?? []) as InstitutionEntitlementRow[];
}

async function loadTenantModuleRows(schoolId: string): Promise<TenantModuleRow[]> {
  const { data, error } = await supabaseAdmin
    .from('tenant_modules')
    .select('module_key, is_enabled')
    .eq('school_id', schoolId);
  if (error) {
    // Fail OPEN at the coarse-module layer (mirrors registry.ts) — a DB error
    // here must not force-disable modules a school had on yesterday.
    logger.warn('entitlements_tenant_modules_failed', { schoolId, error: error.message });
    return [];
  }
  return (data ?? []) as TenantModuleRow[];
}

async function loadPlatformOverrides(): Promise<PlatformOverrideRow[]> {
  const { data, error } = await supabaseAdmin
    .from('platform_module_overrides')
    .select('module_key, is_force_disabled');
  if (error) {
    logger.warn('entitlements_platform_overrides_failed', { error: error.message });
    return [];
  }
  return (data ?? []) as PlatformOverrideRow[];
}

// ─── Value helpers ─────────────────────────────────────────────────────────

/** True if `now` falls within the [from, to] effective window (nulls = open). */
function withinWindow(from: string | null, to: string | null, now: Date): boolean {
  if (from && new Date(from).getTime() > now.getTime()) return false;
  if (to && new Date(to).getTime() < now.getTime()) return false;
  return true;
}

/** A category-appropriate "denied" value (off / zero-cap). */
function denyValue(entry: CatalogEntry): EntitlementValue {
  if (entry.valueShape === 'enabled') return { enabled: false };
  return { max: 0, period: 'day' };
}

function toEffectiveEnabled(value: EntitlementValue): boolean | null {
  return isEnabledValue(value) ? value.enabled : null;
}

function toEffectiveMax(value: EntitlementValue): number | null {
  if (!isMaxPeriodValue(value)) return null;
  // {max:null} => unlimited => UNLIMITED_SENTINEL (no cap).
  return value.max === null ? UNLIMITED_SENTINEL : value.max;
}

/** Validate a stored institution_entitlements value against the catalog shape.
 *  A malformed stored value is ignored (resolution falls through to the next
 *  layer) rather than trusted blindly. */
function coerceStoredValue(entry: CatalogEntry, raw: unknown): EntitlementValue | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (entry.valueShape === 'enabled') {
    if (typeof v.enabled !== 'boolean') return null;
    return { enabled: v.enabled } as EnabledValue;
  }
  // max_period
  const max = v.max;
  const period = v.period;
  const maxOk = max === null || (typeof max === 'number' && Number.isInteger(max) && max >= 0);
  const periodOk = period === 'day' || period === 'week' || period === 'month';
  if (!maxOk || !periodOk) return null;
  return { max: (max as number | null), period: period as 'day' | 'week' | 'month' } as MaxPeriodValue;
}

// ─── Core resolution ───────────────────────────────────────────────────────

interface ResolverConfig {
  plan: PlanCode;
  institutionByKey: Map<string, InstitutionEntitlementRow>;
  tenantModuleByKey: Map<string, boolean>;
  platformDisabled: Set<string>;
  now: Date;
}

/** Resolve a SINGLE key (without parent→child enforcement). */
function resolveOne(entry: CatalogEntry, cfg: ResolverConfig): ResolvedEntitlement {
  // 1. platform_module_overrides (module.* force-disable wins over all).
  if (entry.category === 'module' && cfg.platformDisabled.has(moduleSlug(entry.key))) {
    const value: EntitlementValue = { enabled: false };
    return {
      key: entry.key,
      value,
      resolved_by: 'platform_override',
      effectiveEnabled: false,
      effectiveMax: null,
      force_disabled_by_parent: false,
    };
  }

  // 2. institution_entitlements row for this key (window-checked).
  const inst = cfg.institutionByKey.get(entry.key);
  if (inst && withinWindow(inst.effective_from, inst.effective_to, cfg.now)) {
    const coerced = coerceStoredValue(entry, inst.value);
    if (coerced) {
      return {
        key: entry.key,
        value: coerced,
        resolved_by: 'institution_entitlement',
        effectiveEnabled: toEffectiveEnabled(coerced),
        effectiveMax: toEffectiveMax(coerced),
        force_disabled_by_parent: false,
      };
    }
    // malformed stored value → fall through to the next layer.
  }

  // 3. tenant_modules coarse toggle (module.* only).
  if (entry.category === 'module') {
    const coarse = cfg.tenantModuleByKey.get(moduleSlug(entry.key));
    if (coarse !== undefined) {
      const value: EntitlementValue = { enabled: coarse };
      return {
        key: entry.key,
        value,
        resolved_by: 'tenant_module',
        effectiveEnabled: coarse,
        effectiveMax: null,
        force_disabled_by_parent: false,
      };
    }
  }

  // 4. plan default (catalog / usage.ts / registry per category).
  const planVal = entry.planDefault[cfg.plan];
  if (planVal) {
    return {
      key: entry.key,
      value: planVal,
      resolved_by: 'plan_default',
      effectiveEnabled: toEffectiveEnabled(planVal),
      effectiveMax: toEffectiveMax(planVal),
      force_disabled_by_parent: false,
    };
  }

  // 5. deny.
  const value = denyValue(entry);
  return {
    key: entry.key,
    value,
    resolved_by: 'deny',
    effectiveEnabled: toEffectiveEnabled(value),
    effectiveMax: toEffectiveMax(value),
    force_disabled_by_parent: false,
  };
}

/** 'module.ai_tutor' -> 'ai_tutor' (tenant_modules / platform_overrides store the bare slug). */
function moduleSlug(moduleKey: string): string {
  return moduleKey.startsWith('module.') ? moduleKey.slice('module.'.length) : moduleKey;
}

// ─── Public: full resolved set (FLAG-INDEPENDENT — for the admin preview) ───

/**
 * Resolve the EFFECTIVE value of EVERY catalog key for a school.
 *
 * This ALWAYS reads the config and computes effective values regardless of the
 * ff_institution_entitlements_v1 flag — it powers the super-admin preview panel
 * (an operator must see what a deal will do before flipping the flag). The
 * runtime ENFORCEMENT gate (isEntitledEnforced) is the flag-aware caller.
 *
 * Returns a Map keyed by entitlement key, plus the resolved plan.
 */
export async function getResolvedEntitlements(
  schoolId: string,
): Promise<{ plan: PlanCode; byKey: Map<string, ResolvedEntitlement> }> {
  const [plan, instRows, tmRows, platformRows] = await Promise.all([
    resolveSchoolPlan(schoolId),
    loadInstitutionRows(schoolId),
    loadTenantModuleRows(schoolId),
    loadPlatformOverrides(),
  ]);

  const cfg: ResolverConfig = {
    plan,
    institutionByKey: new Map(instRows.map(r => [r.entitlement_key, r])),
    tenantModuleByKey: new Map(tmRows.map(r => [r.module_key, r.is_enabled])),
    platformDisabled: new Set(platformRows.filter(r => r.is_force_disabled).map(r => r.module_key)),
    now: new Date(),
  };

  // First pass: resolve every key independently.
  const byKey = new Map<string, ResolvedEntitlement>();
  for (const entry of ENTITLEMENT_CATALOG) {
    byKey.set(entry.key, resolveOne(entry, cfg));
  }

  // Second pass: parent -> child (Q3). If a feature's parent module resolves
  // OFF, force the feature OFF and reflect the PARENT's resolution source.
  for (const entry of ENTITLEMENT_CATALOG) {
    if (entry.category !== 'feature' || !entry.parentModuleKey) continue;
    const parent = byKey.get(entry.parentModuleKey);
    if (parent && parent.effectiveEnabled === false) {
      byKey.set(entry.key, {
        key: entry.key,
        value: { enabled: false },
        // Reflect the parent's source so the panel can explain the cause.
        resolved_by: parent.resolved_by,
        effectiveEnabled: false,
        effectiveMax: null,
        force_disabled_by_parent: true,
      });
    }
  }

  return { plan, byKey };
}

/** Resolve a single key's effective entitlement for a school (flag-independent). */
export async function getResolvedEntitlement(
  schoolId: string,
  key: string,
): Promise<ResolvedEntitlement | null> {
  if (!getCatalogEntry(key)) return null;
  const { byKey } = await getResolvedEntitlements(schoolId);
  return byKey.get(key) ?? null;
}

// ─── Public: the ENFORCEMENT gate (flag-aware) ─────────────────────────────

export interface EnforcementResult {
  /** Whether the gate ALLOWS the action. When the flag is OFF this is always
   *  true (no-op pass-through). When ON, it reflects the resolved entitlement. */
  allowed: boolean;
  /** True when ff_institution_entitlements_v1 is ON and enforcement actually ran. */
  enforced: boolean;
  /** The resolved entitlement that was read (always populated when the key/school exist). */
  resolved: ResolvedEntitlement | null;
}

/**
 * The runtime gate the platform calls to decide whether a school is entitled to
 * a capability.
 *
 * FLAG-GATE CONTRACT:
 *   - Config is ALWAYS read (so the caller can render the resolved value).
 *   - ENFORCEMENT only happens when ff_institution_entitlements_v1 is ON.
 *   - When the flag is OFF, this is a NO-OP PASS-THROUGH: `allowed: true`,
 *     `enforced: false` — the resolved value is returned for display but the
 *     gate NEVER blocks. Shipping is a zero-behavior change.
 *
 * For toggle entitlements, "allowed" means effectiveEnabled === true.
 * For limit entitlements, this gate only reports the cap (effectiveMax) and
 * leaves the numeric usage comparison to the existing usage.ts path; `allowed`
 * is true whenever the cap is > 0 (a 0 cap means the capability is off).
 */
export async function isEntitledEnforced(
  schoolId: string,
  key: string,
): Promise<EnforcementResult> {
  const entry = getCatalogEntry(key);
  if (!entry) {
    // Unknown key: nothing to enforce. Pass through.
    return { allowed: true, enforced: false, resolved: null };
  }

  // Always read the config (flag-independent).
  const resolved = await getResolvedEntitlement(schoolId, key);

  // Only ENFORCE when the flag is ON.
  const flagOn = await isFeatureEnabled(ENTITLEMENTS_FLAG, {
    institutionId: schoolId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  });

  if (!flagOn) {
    // No-op pass-through: read config, never block.
    return { allowed: true, enforced: false, resolved };
  }

  if (!resolved) {
    // Flag ON but no resolvable value → deny (fail closed under enforcement).
    return { allowed: false, enforced: true, resolved: null };
  }

  let allowed: boolean;
  if (entry.valueShape === 'enabled') {
    allowed = resolved.effectiveEnabled === true;
  } else {
    // limit: a positive (or unlimited) cap means the capability is available.
    allowed = (resolved.effectiveMax ?? 0) > 0;
  }

  return { allowed, enforced: true, resolved };
}
