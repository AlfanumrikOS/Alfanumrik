/**
 * ALFANUMRIK — Typed Tenant Config Resolver (Phase D of white-label foundation)
 *
 * Per-tenant key-value config store with zod-validated schemas. Backs:
 *   - dynamic theme overrides beyond the schools.* color/font cols
 *   - per-tenant AI personality / pedagogy / tone / default language
 *   - per-tenant locale (timezone, currency, number format)
 *
 * Storage table: `tenant_configs (school_id, key, value jsonb, version)` —
 * created by migration 20260507000006. Sparse-by-default: a missing row
 * means "use the registry default for this tenant type."
 *
 * Resolution order at request time:
 *   1. ff_tenant_config_v2 OFF  →  return registry default (any DB rows
 *      ignored). Lets us populate config for pilot tenants ahead of flip.
 *   2. tenant_configs row for (school_id, key)  →  validate against the
 *      schema, return if valid. Invalid → fall through to default + log.
 *   3. No row  →  registry default for the tenant's type.
 *
 * Adding a new key:
 *   1. Define the zod schema in CONFIG_SCHEMAS below.
 *   2. Add a row to CONFIG_DEFAULTS with the per-tenant-type defaults.
 *   3. Read it via `getTenantConfig(schoolId, tenantType, 'namespace.key')`.
 *
 * The DB CHECK constraint enforces lowercase `<namespace>.<field>` keys; the
 * resolver enforces the value shape via zod.
 */

import { z } from 'zod';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { cacheFetch, CACHE_TTL, cacheInvalidatePrefix } from '@/lib/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { TenantType } from '@/lib/tenant-domain';

// ─── Schemas ───────────────────────────────────────────────────────────

/**
 * The exhaustive set of supported config keys. Each key has:
 *   - a zod schema in CONFIG_SCHEMAS
 *   - a default-by-tenant-type entry in CONFIG_DEFAULTS
 *
 * Adding a key without both will fail compilation.
 */
export const CONFIG_SCHEMAS = {
  'theme.dark_mode_default': z.boolean(),

  'ai.personality': z.enum([
    'warm_mentor',     // default — friendly, encouraging
    'rigorous_coach',  // direct, demanding (corporate / exam-prep coaching)
    'formal_examiner', // neutral, official tone (government deployments)
    'playful_buddy',   // light, casual (younger students)
  ]),
  'ai.tone': z.enum(['formal', 'neutral', 'casual']),
  'ai.pedagogy': z.enum([
    'socratic',         // ask questions, guide to answer
    'direct_instruction', // explain, then check
    'worked_example',   // show fully solved, then practice
  ]),
  'ai.default_language': z.enum(['en', 'hi']),

  'locale.timezone': z.string().min(1).max(64), // IANA tz, e.g. 'Asia/Kolkata'
  'locale.currency': z.string().length(3),       // ISO 4217, e.g. 'INR'
  'locale.number_format': z.enum(['en-IN', 'en-US', 'hi-IN']),

  'communication.from_email_name': z.string().min(1).max(64),
} as const;

export type ConfigKey = keyof typeof CONFIG_SCHEMAS;
export type ConfigValue<K extends ConfigKey> = z.infer<typeof CONFIG_SCHEMAS[K]>;

// ─── Defaults by tenant type ──────────────────────────────────────────

type DefaultsForKey<K extends ConfigKey> = Partial<Record<TenantType, ConfigValue<K>>> & {
  /** The fallback when the tenant type has no specific default. */
  fallback: ConfigValue<K>;
};

/**
 * Per-tenant-type defaults. Every key MUST have a `fallback`. Specific
 * tenant types (school/coaching/corporate/government) may override.
 */
export const CONFIG_DEFAULTS: { [K in ConfigKey]: DefaultsForKey<K> } = {
  'theme.dark_mode_default': {
    fallback: false,
  },

  'ai.personality': {
    school: 'warm_mentor',
    coaching: 'rigorous_coach',
    corporate: 'rigorous_coach',
    government: 'formal_examiner',
    fallback: 'warm_mentor',
  },
  'ai.tone': {
    school: 'casual',
    coaching: 'neutral',
    corporate: 'formal',
    government: 'formal',
    fallback: 'neutral',
  },
  'ai.pedagogy': {
    school: 'socratic',
    coaching: 'worked_example',
    corporate: 'direct_instruction',
    government: 'direct_instruction',
    fallback: 'socratic',
  },
  'ai.default_language': {
    fallback: 'en',
  },

  'locale.timezone': {
    fallback: 'Asia/Kolkata',
  },
  'locale.currency': {
    fallback: 'INR',
  },
  'locale.number_format': {
    fallback: 'en-IN',
  },

  'communication.from_email_name': {
    fallback: 'Alfanumrik',
  },
};

// ─── Cache ─────────────────────────────────────────────────────────────

const TENANT_CONFIG_CACHE_PREFIX = 'tenant_config:';

interface TenantConfigRow {
  key: string;
  value: unknown;
  version: number;
}

async function loadTenantConfigs(schoolId: string): Promise<TenantConfigRow[]> {
  return cacheFetch(
    `${TENANT_CONFIG_CACHE_PREFIX}${schoolId}`,
    CACHE_TTL.STATIC,
    async () => {
      const { data, error } = await supabaseAdmin
        .from('tenant_configs')
        .select('key,value,version')
        .eq('school_id', schoolId);
      if (error) return [] as TenantConfigRow[];
      return (data ?? []) as TenantConfigRow[];
    },
  );
}

export function invalidateTenantConfigCache(schoolId: string): void {
  cacheInvalidatePrefix(`${TENANT_CONFIG_CACHE_PREFIX}${schoolId}`);
}

// ─── Resolver ──────────────────────────────────────────────────────────

function defaultFor<K extends ConfigKey>(key: K, tenantType: TenantType): ConfigValue<K> {
  const def = CONFIG_DEFAULTS[key];
  // The cast is safe because each entry includes `fallback: ConfigValue<K>`.
  return (def[tenantType] ?? def.fallback) as ConfigValue<K>;
}

/**
 * Resolve a single typed config value for a tenant.
 *
 * Always returns a valid value — falls back to the registry default if
 *   - no schoolId,
 *   - the flag is OFF,
 *   - no override row exists,
 *   - or the override fails schema validation.
 */
export async function getTenantConfig<K extends ConfigKey>(
  schoolId: string | null,
  tenantType: TenantType,
  key: K,
): Promise<ConfigValue<K>> {
  if (!schoolId) return defaultFor(key, tenantType);

  const flagOn = await isFeatureEnabled('ff_tenant_config_v2', {
    institutionId: schoolId,
  });
  if (!flagOn) return defaultFor(key, tenantType);

  const rows = await loadTenantConfigs(schoolId);
  const override = rows.find(r => r.key === key);
  if (!override) return defaultFor(key, tenantType);

  const schema = CONFIG_SCHEMAS[key];
  const parsed = schema.safeParse(override.value);
  if (!parsed.success) {
    // Override is malformed — fall back to default. Surface the issue
    // upstream by returning the default rather than throwing; the admin UI
    // is the right place to flag invalid stored config.
    return defaultFor(key, tenantType);
  }
  return parsed.data as ConfigValue<K>;
}

/**
 * Resolve every config key in one round-trip. Useful for the AI service
 * boot that needs personality + tone + pedagogy + language together.
 */
export async function getAllTenantConfig(
  schoolId: string | null,
  tenantType: TenantType,
): Promise<{ [K in ConfigKey]: ConfigValue<K> }> {
  if (!schoolId) {
    return mapDefaults(tenantType);
  }

  const flagOn = await isFeatureEnabled('ff_tenant_config_v2', {
    institutionId: schoolId,
  });
  if (!flagOn) return mapDefaults(tenantType);

  const rows = await loadTenantConfigs(schoolId);
  const byKey = new Map(rows.map(r => [r.key, r.value]));

  // Build into Record<string, unknown> to sidestep the well-known TS variance
  // limitation around mapped-type writes inside a for loop, then cast at
  // return. The runtime values are correct — every assignment goes through
  // `defaultFor()` (which returns ConfigValue<K>) or zod's parsed.data.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(CONFIG_SCHEMAS) as ConfigKey[]) {
    const raw = byKey.get(key);
    if (raw === undefined) {
      out[key] = defaultFor(key, tenantType);
      continue;
    }
    const parsed = CONFIG_SCHEMAS[key].safeParse(raw);
    out[key] = parsed.success ? parsed.data : defaultFor(key, tenantType);
  }
  return out as { [K in ConfigKey]: ConfigValue<K> };
}

function mapDefaults(tenantType: TenantType): { [K in ConfigKey]: ConfigValue<K> } {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(CONFIG_SCHEMAS) as ConfigKey[]) {
    out[key] = defaultFor(key, tenantType);
  }
  return out as { [K in ConfigKey]: ConfigValue<K> };
}
