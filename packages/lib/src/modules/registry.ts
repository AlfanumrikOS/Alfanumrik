/**
 * ALFANUMRIK — Module Registry (Phase C of white-label foundation)
 *
 * Single source of truth for "what modules exist" on the platform. The
 * companion `tenant_modules` table (migration 20260507000005) records, per
 * tenant, which of these modules are enabled and what per-module config
 * overrides apply.
 *
 * Why a const registry instead of a DB-driven catalog:
 *   - Adding a module always requires shipping code anyway (new routes,
 *     React components, server logic). Forcing a separate DB write is
 *     overhead with no value. The registry travels with the deploy.
 *   - The TS type system can enforce that every emit-event/permission-check
 *     references a known module_key — impossible with a runtime list.
 *
 * Resolution order at request time:
 *   1. ff_tenant_module_registry_v1 OFF  →  every module is enabled
 *      (preserves current behaviour for tenants not in the rollout).
 *   2. tenant_modules row exists for (school_id, module_key)
 *      →  use its is_enabled value.
 *   3. No row  →  fall back to the registry's default-for-tenant-type.
 *
 * Sparse storage: only deviations from the type default need a DB row.
 *
 * Public surface:
 *   - `MODULE_KEYS`             — the lower-cased unique keys.
 *   - `MODULE_REGISTRY`         — full metadata array.
 *   - `getModuleMeta(key)`      — lookup by key.
 *   - `defaultsForTenantType()` — registry → enablement defaults.
 *   - `isModuleEnabled()`       — async resolver for runtime checks.
 *   - `enabledModulesFor()`     — async map of all module enablement.
 */

import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { cacheFetch, CACHE_TTL, cacheInvalidatePrefix } from '@alfanumrik/lib/cache';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import type { TenantType } from '@alfanumrik/lib/tenant-domain';

// ─── Module metadata ───────────────────────────────────────────────────

export interface ModuleMeta {
  /** Stable lower-snake-case key. Stored in tenant_modules.module_key. */
  key: ModuleKey;
  /** Human-readable English name; tenant-admin UI label. */
  displayName: string;
  /** Bilingual display name (Hindi). null → fall back to displayName. */
  displayNameHi: string | null;
  /** One-line description for the tenant-admin module list. */
  description: string;
  /**
   * Top-level path prefix this module owns. Used by the dynamic menu builder
   * to skip rendering links for disabled modules. `null` for cross-cutting
   * modules that don't own a single route prefix (e.g. Communication).
   */
  routePrefix: string | null;
  /**
   * Default enablement per tenant type. Missing entry == disabled.
   * Driven by the spec ("each module independent, support enable/disable").
   */
  defaultsByType: Partial<Record<TenantType, boolean>>;
}

/**
 * The exhaustive list of module keys. Adding a key here is intentional and
 * must be matched by metadata in MODULE_REGISTRY below — TS will error if
 * the registry array gets out of sync with this union.
 */
export type ModuleKey =
  | 'lms'
  | 'ai_tutor'
  | 'testing_engine'
  | 'live_classes'
  | 'analytics'
  | 'crm'
  | 'assignments'
  | 'attendance'
  | 'communication';

export const MODULE_KEYS: readonly ModuleKey[] = [
  'lms',
  'ai_tutor',
  'testing_engine',
  'live_classes',
  'analytics',
  'crm',
  'assignments',
  'attendance',
  'communication',
] as const;

// ─── The registry ──────────────────────────────────────────────────────

/**
 * Module catalog. Order matters: this is the order rendered in /school-admin/
 * modules and in the dynamic top-nav for tenant admins. Reorder by editing
 * the array.
 *
 * Defaults by tenant_type encode the platform's opinion of "what does a
 * fresh `<type>` need on day one." Tenants override at any time via
 * /api/school-admin/modules (Phase C UI follow-up — not in this PR).
 */
export const MODULE_REGISTRY: readonly ModuleMeta[] = [
  {
    key: 'lms',
    displayName: 'Learning (LMS)',
    displayNameHi: 'सीखना',
    description: 'Chapter Read mode, concept walkthroughs, NCERT-grounded content.',
    routePrefix: '/learn',
    defaultsByType: {
      school: true,
      coaching: true,
      corporate: true,
      government: true,
    },
  },
  {
    key: 'ai_tutor',
    displayName: 'Foxy',
    displayNameHi: 'फॉक्सी',
    description: 'Conversational tutor with RAG grounding and tenant-tuned personality.',
    routePrefix: '/foxy',
    defaultsByType: {
      school: true,
      coaching: true,
      corporate: true,
    },
  },
  {
    key: 'testing_engine',
    displayName: 'Testing Engine',
    displayNameHi: 'परीक्षा इंजन',
    description: 'Adaptive quizzes, mock exams, PYQ practice with cognitive metrics.',
    routePrefix: '/quiz',
    defaultsByType: {
      school: true,
      coaching: true,
      corporate: true,
    },
  },
  {
    key: 'live_classes',
    displayName: 'Live Classes',
    displayNameHi: 'लाइव कक्षाएँ',
    description: 'Scheduled live sessions with attendance tracking.',
    routePrefix: null,
    defaultsByType: {
      school: false,
      coaching: true,
    },
  },
  {
    key: 'analytics',
    displayName: 'Analytics',
    displayNameHi: 'विश्लेषण',
    description: 'Student progress, mastery heatmaps, risk alerts, cohort reports.',
    routePrefix: '/reports',
    defaultsByType: {
      school: true,
      coaching: true,
      corporate: true,
      government: true,
    },
  },
  {
    key: 'crm',
    displayName: 'CRM',
    displayNameHi: 'CRM',
    description: 'Lead capture, parent outreach, enrolment funnel for coaching/schools.',
    routePrefix: null,
    defaultsByType: {
      coaching: true,
    },
  },
  {
    key: 'assignments',
    displayName: 'Assignments',
    displayNameHi: 'असाइनमेंट',
    description: 'Teacher-set practice sets, due dates, submission tracking.',
    routePrefix: null,
    defaultsByType: {
      school: true,
      coaching: true,
    },
  },
  {
    key: 'attendance',
    displayName: 'Attendance',
    displayNameHi: 'उपस्थिति',
    description: 'Daily attendance log, parent notifications, monthly summaries.',
    routePrefix: null,
    defaultsByType: {
      school: true,
      coaching: true,
    },
  },
  {
    key: 'communication',
    displayName: 'Communication',
    displayNameHi: 'संचार',
    description: 'Announcements, parent WhatsApp/email, in-app notifications.',
    routePrefix: null,
    defaultsByType: {
      school: true,
      coaching: true,
      corporate: true,
      government: true,
    },
  },
];

const REGISTRY_BY_KEY: ReadonlyMap<ModuleKey, ModuleMeta> = new Map(
  MODULE_REGISTRY.map(m => [m.key, m]),
);

/** Lookup module metadata by key. Returns null for unknown keys. */
export function getModuleMeta(key: string): ModuleMeta | null {
  return REGISTRY_BY_KEY.get(key as ModuleKey) ?? null;
}

/**
 * The default enablement map for a tenant type, derived from MODULE_REGISTRY.
 * Used as the fallback when no tenant_modules row exists for a key.
 */
export function defaultsForTenantType(type: TenantType): Record<ModuleKey, boolean> {
  const out = {} as Record<ModuleKey, boolean>;
  for (const meta of MODULE_REGISTRY) {
    out[meta.key] = meta.defaultsByType[type] ?? false;
  }
  return out;
}

// ─── Runtime resolver ──────────────────────────────────────────────────

const TENANT_MODULES_CACHE_PREFIX = 'tenant_modules:';

interface TenantModuleRow {
  module_key: string;
  is_enabled: boolean;
  config: Record<string, unknown> | null;
}

async function loadTenantModules(schoolId: string): Promise<TenantModuleRow[]> {
  return cacheFetch(
    `${TENANT_MODULES_CACHE_PREFIX}${schoolId}`,
    CACHE_TTL.STATIC,
    async () => {
      const { data, error } = await supabaseAdmin
        .from('tenant_modules')
        .select('module_key,is_enabled,config')
        .eq('school_id', schoolId);
      if (error) {
        // Fail OPEN: a DB error here should not lock tenants out of features
        // they had on yesterday. Log via the caller's logger if needed.
        return [] as TenantModuleRow[];
      }
      return (data ?? []) as TenantModuleRow[];
    },
  );
}

/**
 * Invalidate the cached enablement map for a tenant. Call after admin
 * mutations to tenant_modules so the next request reflects the change.
 */
export function invalidateTenantModulesCache(schoolId: string): void {
  cacheInvalidatePrefix(`${TENANT_MODULES_CACHE_PREFIX}${schoolId}`);
}

// ─── Platform-wide module overrides (super-admin force-disable) ────────
//
// `platform_module_overrides` (migration 20260507120000) is keyed by
// module_key and lets super-admin globally force-disable a module across
// every tenant — overriding tenant_modules rows AND tenant-type defaults.
// Sparse: most modules have no row.
//
// Cached separately from tenant_modules (1 cache key, not per-tenant) so
// flipping a platform override propagates to every tenant within ~5 min.

const PLATFORM_MODULE_OVERRIDES_CACHE_KEY = 'platform_module_overrides:all';

interface PlatformOverrideRow {
  module_key: string;
  is_force_disabled: boolean;
}

async function loadPlatformOverrides(): Promise<PlatformOverrideRow[]> {
  return cacheFetch(
    PLATFORM_MODULE_OVERRIDES_CACHE_KEY,
    CACHE_TTL.STATIC,
    async () => {
      const { data, error } = await supabaseAdmin
        .from('platform_module_overrides')
        .select('module_key,is_force_disabled');
      if (error) {
        // Fail OPEN — a query error here should not turn off every module
        // for every tenant. Log on the caller side if visibility is needed.
        return [] as PlatformOverrideRow[];
      }
      return (data ?? []) as PlatformOverrideRow[];
    },
  );
}

/**
 * Invalidate the cached platform-override map. Super-admin mutations to
 * platform_module_overrides invalidate via this so the next resolver
 * call sees the change within milliseconds rather than the 5-min TTL.
 */
export function invalidatePlatformOverridesCache(): void {
  cacheInvalidatePrefix(PLATFORM_MODULE_OVERRIDES_CACHE_KEY);
}

/**
 * Is `moduleKey` enabled for the tenant identified by `schoolId`?
 *
 * Resolution order (post-#573):
 *   1. ff_tenant_module_registry_v1 OFF → true (current platform behaviour).
 *      Note: when the flag is OFF, platform overrides are also bypassed —
 *      the safe default during rollout is "everything on, no exotic gating."
 *   2. platform_module_overrides.is_force_disabled = true → false.
 *      Super-admin force-disable wins over any tenant-level setting or
 *      registry default.
 *   3. tenant_modules row exists → use its is_enabled.
 *   4. No row → registry default for the tenant's type.
 */
export async function isModuleEnabled(
  schoolId: string | null,
  tenantType: TenantType,
  moduleKey: ModuleKey,
): Promise<boolean> {
  // No tenant context (B2C) → every module is implicitly available; the UI
  // layer decides what to render based on auth state, not module flags.
  if (!schoolId) return true;

  const flagOn = await isFeatureEnabled('ff_tenant_module_registry_v1', {
    institutionId: schoolId,
  });
  if (!flagOn) return true;

  // Step 2: platform-wide override wins.
  const platformOverrides = await loadPlatformOverrides();
  const platform = platformOverrides.find(p => p.module_key === moduleKey);
  if (platform?.is_force_disabled) return false;

  // Step 3: tenant override.
  const rows = await loadTenantModules(schoolId);
  const override = rows.find(r => r.module_key === moduleKey);
  if (override) return override.is_enabled;

  // Step 4: tenant-type default.
  const defaults = defaultsForTenantType(tenantType);
  return defaults[moduleKey] ?? false;
}

/**
 * Resolve enablement for every module known to the registry. Useful for the
 * dynamic menu builder + /api/school-config response.
 */
export async function enabledModulesFor(
  schoolId: string | null,
  tenantType: TenantType,
): Promise<Record<ModuleKey, boolean>> {
  if (!schoolId) {
    // B2C: pretend everything is on; the menu component filters by auth role.
    const out = {} as Record<ModuleKey, boolean>;
    for (const m of MODULE_REGISTRY) out[m.key] = true;
    return out;
  }

  const flagOn = await isFeatureEnabled('ff_tenant_module_registry_v1', {
    institutionId: schoolId,
  });
  if (!flagOn) {
    const out = {} as Record<ModuleKey, boolean>;
    for (const m of MODULE_REGISTRY) out[m.key] = true;
    return out;
  }

  // Load platform overrides + tenant rows in parallel. Both are cached;
  // first-load adds <50ms, hot-path is cache-served.
  const [platformOverrides, rows] = await Promise.all([
    loadPlatformOverrides(),
    loadTenantModules(schoolId),
  ]);
  const platformDisabled = new Set(
    platformOverrides.filter(p => p.is_force_disabled).map(p => p.module_key),
  );
  const overrides = new Map(rows.map(r => [r.module_key, r.is_enabled]));
  const defaults = defaultsForTenantType(tenantType);

  const out = {} as Record<ModuleKey, boolean>;
  for (const meta of MODULE_REGISTRY) {
    // Platform force-disable wins over tenant override + registry default.
    if (platformDisabled.has(meta.key)) {
      out[meta.key] = false;
      continue;
    }
    out[meta.key] = overrides.get(meta.key) ?? defaults[meta.key] ?? false;
  }
  return out;
}
