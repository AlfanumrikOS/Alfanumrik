import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { logSchoolAudit } from '@/lib/audit';
import {
  MODULE_REGISTRY,
  defaultsForTenantType,
  invalidateTenantModulesCache,
  type ModuleKey,
  type ModuleMeta,
} from '@/lib/modules/registry';
import { coerceTenantType } from '@/lib/tenant-domain';

/**
 * GET /api/school-admin/modules
 *
 * Returns the catalog of platform modules with the caller school's current
 * enablement state for each. The response is the source the
 * /school-admin/modules UI binds to.
 *
 * Permission: school.manage_modules (added by migration 20260507110000).
 *
 * Response shape:
 * {
 *   success: true,
 *   data: {
 *     tenant_type: 'school' | 'coaching' | 'corporate' | 'government',
 *     flag_enabled: boolean,    // ff_tenant_module_registry_v1
 *     modules: Array<{
 *       key: string,            // ModuleKey
 *       displayName: string,
 *       displayNameHi: string | null,
 *       description: string,
 *       routePrefix: string | null,
 *       isEnabled: boolean,     // resolved value
 *       isOverride: boolean,    // true when a tenant_modules row exists
 *       config: Record<string, unknown> | null
 *     }>
 *   }
 * }
 *
 * Resolution order matches src/lib/modules/registry.ts isModuleEnabled():
 *   1. ff_tenant_module_registry_v1 OFF → every module reports isEnabled=true
 *      (so the UI shows "all on" and an info banner explaining the rollout
 *      gate).
 *   2. tenant_modules row exists → use its is_enabled.
 *   3. No row → registry default for the tenant's tenant_type.
 */

interface ModuleViewRow {
  key: ModuleKey;
  displayName: string;
  displayNameHi: string | null;
  description: string;
  routePrefix: string | null;
  isEnabled: boolean;
  isOverride: boolean;
  config: Record<string, unknown> | null;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_modules');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    // Fetch tenant_type + active rows for this school + flag state in
    // parallel. Failures fall back to safe defaults so the UI loads.
    const [schoolRes, rowsRes, flagRes] = await Promise.all([
      supabase.from('schools').select('tenant_type').eq('id', schoolId).maybeSingle(),
      supabase.from('tenant_modules').select('module_key, is_enabled, config').eq('school_id', schoolId),
      supabase.from('feature_flags').select('is_enabled, rollout_percentage').eq('flag_name', 'ff_tenant_module_registry_v1').maybeSingle(),
    ]);

    const tenantType = coerceTenantType(schoolRes.data?.tenant_type ?? null);
    const overrides = new Map<string, { is_enabled: boolean; config: unknown }>(
      (rowsRes.data ?? []).map(r => [r.module_key as string, { is_enabled: r.is_enabled as boolean, config: r.config }]),
    );
    // The flag's runtime gate is per-user/per-tenant via hashForRollout, but
    // for the admin UI we surface a coarse "is the flag is_enabled at all"
    // signal. The full per-call resolver still uses isFeatureEnabled().
    const flagEnabled = !!flagRes.data?.is_enabled && (flagRes.data?.rollout_percentage ?? 0) > 0;

    const defaults = defaultsForTenantType(tenantType);

    const modules: ModuleViewRow[] = MODULE_REGISTRY.map((meta: ModuleMeta) => {
      const override = overrides.get(meta.key);
      const resolved = override
        ? override.is_enabled
        : (defaults[meta.key] ?? false);
      return {
        key: meta.key,
        displayName: meta.displayName,
        displayNameHi: meta.displayNameHi,
        description: meta.description,
        routePrefix: meta.routePrefix,
        // When the flag is OFF, the runtime resolver short-circuits to
        // "all enabled". Surface that shape here too so the UI is
        // truthful about what's currently in effect.
        isEnabled: flagEnabled ? resolved : true,
        isOverride: !!override,
        config: (override?.config as Record<string, unknown> | null) ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        tenant_type: tenantType,
        flag_enabled: flagEnabled,
        modules,
      },
    });
  } catch (err) {
    logger.error('school_admin_modules_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/modules',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/school-admin/modules
 *
 * Upserts the tenant_modules row for the caller's school + a single
 * module_key. Used by the toggle switches on /school-admin/modules.
 *
 * Body: { moduleKey: ModuleKey, isEnabled: boolean, config?: object }
 *
 * Why upsert (vs separate insert/update endpoints): admins toggle
 * repeatedly. ON CONFLICT DO UPDATE keeps the request shape and the
 * transaction count constant.
 *
 * Permission: school.manage_modules.
 *
 * Cache: invalidates the in-memory tenant_modules cache for this school
 * so the next GET (and any concurrent isModuleEnabled() call) sees the
 * new value within milliseconds rather than the 5-minute TTL.
 */
const VALID_MODULE_KEYS = new Set<string>(MODULE_REGISTRY.map(m => m.key));

export async function PUT(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_modules');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const body = await request.json().catch(() => null);

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Body must be a JSON object' },
        { status: 400 }
      );
    }

    const { moduleKey, isEnabled, config } = body as {
      moduleKey?: unknown;
      isEnabled?: unknown;
      config?: unknown;
    };

    if (typeof moduleKey !== 'string' || !VALID_MODULE_KEYS.has(moduleKey)) {
      return NextResponse.json(
        { success: false, error: `moduleKey must be one of: ${[...VALID_MODULE_KEYS].join(', ')}` },
        { status: 400 }
      );
    }

    if (typeof isEnabled !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'isEnabled must be a boolean' },
        { status: 400 }
      );
    }

    if (config !== undefined && (typeof config !== 'object' || Array.isArray(config) || config === null)) {
      return NextResponse.json(
        { success: false, error: 'config must be a JSON object' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('tenant_modules')
      .upsert(
        {
          school_id: schoolId,
          module_key: moduleKey,
          is_enabled: isEnabled,
          config: (config ?? {}) as Record<string, unknown>,
        },
        { onConflict: 'school_id,module_key' },
      )
      .select('module_key, is_enabled, config')
      .single();

    if (error) {
      logger.error('school_admin_modules_upsert_failed', {
        error: new Error(error.message),
        schoolId,
        moduleKey,
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update module' },
        { status: 500 }
      );
    }

    invalidateTenantModulesCache(schoolId);

    // Audit trail. Fire-and-forget — `logSchoolAudit` already swallows
    // failures so a flaky audit insert never breaks the user's toggle.
    void logSchoolAudit({
      schoolId,
      actorId: auth.userId ?? 'unknown',
      action: 'module.toggled',
      resourceType: 'module',
      resourceId: moduleKey,
      metadata: {
        is_enabled: isEnabled,
        config_keys: config && typeof config === 'object' ? Object.keys(config) : [],
      },
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error('school_admin_modules_put_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/modules',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
