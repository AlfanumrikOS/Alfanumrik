import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  CONFIG_SCHEMAS,
  CONFIG_DEFAULTS,
  invalidateTenantConfigCache,
  type ConfigKey,
} from '@/lib/tenant-config';
import { coerceTenantType } from '@/lib/tenant-domain';

/**
 * GET /api/school-admin/tenant-config
 * PUT /api/school-admin/tenant-config
 *
 * Generic tenant_configs endpoint covering every key in
 * `src/lib/tenant-config/index.ts` (theme, ai, locale, communication).
 * One endpoint serves multiple admin pages — `/school-admin/ai-config`,
 * `/school-admin/locale-settings` (future), etc. — each rendering the
 * subset of keys it owns.
 *
 * Permission: school.manage_settings (re-used from
 * 20260416200100_school_admin_extra_permissions; already bound to
 * institution_admin, no new migration needed).
 *
 * GET response shape:
 * {
 *   success: true,
 *   data: {
 *     tenant_type: 'school' | 'coaching' | 'corporate' | 'government',
 *     flag_enabled: boolean,           // ff_tenant_config_v2
 *     entries: [
 *       {
 *         key: '<namespace>.<field>',  // ConfigKey
 *         value: <ConfigValue>,         // resolved current value
 *         isOverride: boolean,          // true when a tenant_configs row exists
 *         defaultValue: <ConfigValue>,  // tenant-type default for the key
 *         options: <enum literal[]> | null  // for select-rendered keys
 *       },
 *       ...
 *     ]
 *   }
 * }
 *
 * PUT body shape: { entries: Array<{ key: ConfigKey, value: ConfigValue }> }
 *  - Each entry validated against CONFIG_SCHEMAS[key] (zod).
 *  - Invalid entry → 400 with the first failing key called out (no partial writes).
 *  - All-or-nothing upsert: every valid entry replaces or creates its
 *    tenant_configs row.
 *  - Cache invalidated after a successful batch.
 */

interface ConfigEntryView {
  key: ConfigKey;
  value: unknown;
  isOverride: boolean;
  defaultValue: unknown;
  options: ReadonlyArray<string> | null;
}

/**
 * Walk the zod schemas and surface enum options so the UI can render
 * `<select>` for those keys without duplicating the literal lists.
 * Returns null for non-enum schemas (booleans, strings) — UI uses
 * `<input>` / `<switch>` for those.
 */
function optionsForKey(key: ConfigKey): ReadonlyArray<string> | null {
  const schema = CONFIG_SCHEMAS[key];
  // zod v4 enums expose their literal set via .options on z.enum(...).
  // We avoid an `any` cast by reading through unknown.
  const maybeEnum = schema as unknown as { options?: ReadonlyArray<string> };
  return Array.isArray(maybeEnum.options) ? maybeEnum.options : null;
}

function defaultFor<K extends ConfigKey>(key: K, tenantType: 'school' | 'coaching' | 'corporate' | 'government'): unknown {
  const def = CONFIG_DEFAULTS[key] as Record<string, unknown> & { fallback: unknown };
  return def[tenantType] ?? def.fallback;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_settings');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const [schoolRes, rowsRes, flagRes] = await Promise.all([
      supabase.from('schools').select('tenant_type').eq('id', schoolId).maybeSingle(),
      supabase.from('tenant_configs').select('key, value, version').eq('school_id', schoolId),
      supabase.from('feature_flags').select('is_enabled, rollout_percentage').eq('flag_name', 'ff_tenant_config_v2').maybeSingle(),
    ]);

    const tenantType = coerceTenantType(schoolRes.data?.tenant_type ?? null);
    const overrides = new Map<string, unknown>(
      (rowsRes.data ?? []).map(r => [r.key as string, r.value]),
    );
    const flagEnabled = !!flagRes.data?.is_enabled && (flagRes.data?.rollout_percentage ?? 0) > 0;

    const entries: ConfigEntryView[] = (Object.keys(CONFIG_SCHEMAS) as ConfigKey[]).map((key) => {
      const def = defaultFor(key, tenantType);
      const override = overrides.get(key);
      const hasOverride = overrides.has(key);

      // Truthful display: when the flag is OFF, the runtime resolver
      // ignores override rows and returns defaults. Surface that here
      // too so the UI's "current value" matches what code is actually
      // reading. The override row is still surfaced via isOverride.
      let resolved: unknown;
      if (!flagEnabled) {
        resolved = def;
      } else if (hasOverride) {
        // Validate with zod — if the stored row is malformed, fall
        // back to default so the UI doesn't render garbage.
        const parsed = CONFIG_SCHEMAS[key].safeParse(override);
        resolved = parsed.success ? parsed.data : def;
      } else {
        resolved = def;
      }

      return {
        key,
        value: resolved,
        isOverride: hasOverride,
        defaultValue: def,
        options: optionsForKey(key),
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        tenant_type: tenantType,
        flag_enabled: flagEnabled,
        entries,
      },
    });
  } catch (err) {
    logger.error('school_admin_tenant_config_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/tenant-config',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_settings');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object' || !Array.isArray((body as { entries?: unknown }).entries)) {
      return NextResponse.json(
        { success: false, error: 'Body must be { entries: Array<{ key, value }> }' },
        { status: 400 }
      );
    }

    const entries = (body as { entries: unknown[] }).entries;
    if (entries.length === 0) {
      return NextResponse.json(
        { success: false, error: 'entries array must not be empty' },
        { status: 400 }
      );
    }
    if (entries.length > 50) {
      // Defence against accidental spam — there are <20 keys total.
      return NextResponse.json(
        { success: false, error: 'entries array must not exceed 50 items' },
        { status: 400 }
      );
    }

    // Validate every entry first; reject the whole batch on the first
    // failure so we don't half-write. Zod gives us key-specific errors.
    const VALID_KEYS = new Set<string>(Object.keys(CONFIG_SCHEMAS));
    const validated: Array<{ key: ConfigKey; value: unknown }> = [];

    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') {
        return NextResponse.json(
          { success: false, error: 'each entry must be an object' },
          { status: 400 }
        );
      }
      const { key, value } = entry as { key?: unknown; value?: unknown };
      if (typeof key !== 'string' || !VALID_KEYS.has(key)) {
        return NextResponse.json(
          { success: false, error: `Unknown config key: ${String(key)}` },
          { status: 400 }
        );
      }
      const parsed = CONFIG_SCHEMAS[key as ConfigKey].safeParse(value);
      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: `Invalid value for ${key}: ${parsed.error.issues[0]?.message ?? 'validation failed'}`,
          },
          { status: 400 }
        );
      }
      validated.push({ key: key as ConfigKey, value: parsed.data });
    }

    // Batch upsert all validated entries. Postgres handles per-row
    // ON CONFLICT via the UNIQUE(school_id, key) constraint.
    const supabase = getSupabaseAdmin();
    const rows = validated.map(v => ({
      school_id: schoolId,
      key: v.key as string,
      value: v.value as unknown,
      version: 1,
    }));

    const { error } = await supabase
      .from('tenant_configs')
      .upsert(rows, { onConflict: 'school_id,key' });

    if (error) {
      logger.error('school_admin_tenant_config_upsert_failed', {
        error: new Error(error.message),
        schoolId,
        keyCount: rows.length,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update config' },
        { status: 500 }
      );
    }

    invalidateTenantConfigCache(schoolId);

    return NextResponse.json({
      success: true,
      data: { written: validated.length },
    });
  } catch (err) {
    logger.error('school_admin_tenant_config_put_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/tenant-config',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
