import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  MODULE_REGISTRY,
  invalidatePlatformOverridesCache,
  type ModuleKey,
  type ModuleMeta,
} from '@/lib/modules/registry';

/**
 * GET /api/super-admin/module-overrides
 * PUT /api/super-admin/module-overrides
 *
 * Super-admin endpoint for the platform-wide module force-disable feature
 * (migration 20260507120000). Lets ops/founder force-disable a module
 * across EVERY tenant — overriding tenant_modules rows and tenant-type
 * defaults — without touching individual schools.
 *
 * Auth: authorizeAdmin (admin secret + RBAC). NO school-admin reachability;
 *       this is platform-level state.
 *
 * Audit: PUT writes a row to admin_audit_log via logAdminAudit with
 *        action 'platform.module_overridden' — distinct from the existing
 *        school-level actions so ops can grep cleanly.
 *
 * Cache: PUT invalidates the in-memory platform_module_overrides cache
 *        (1 cache key, not per-tenant) so the next isModuleEnabled call
 *        on any tenant sees the change within milliseconds.
 *
 * GET response shape:
 * {
 *   success: true,
 *   data: {
 *     modules: Array<{
 *       key: string,                  // ModuleKey
 *       displayName: string,
 *       displayNameHi: string | null,
 *       description: string,
 *       isForceDisabled: boolean,     // false when no row exists
 *       reason: string | null,
 *       setBy: string | null,         // super-admin auth_user_id
 *       setAt: string | null          // ISO timestamp
 *     }>
 *   }
 * }
 *
 * PUT body shape: { moduleKey: ModuleKey, isForceDisabled: boolean, reason?: string }
 *
 * The behavior is fail-safe: when isForceDisabled flips true, no tenant
 * can re-enable the module from /school-admin/modules — the resolver
 * short-circuits at step 2.
 */

interface OverrideViewRow {
  key: ModuleKey;
  displayName: string;
  displayNameHi: string | null;
  description: string;
  isForceDisabled: boolean;
  reason: string | null;
  setBy: string | null;
  setAt: string | null;
}

const VALID_MODULE_KEYS = new Set<string>(MODULE_REGISTRY.map(m => m.key));

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('platform_module_overrides')
      .select('module_key, is_force_disabled, reason, set_by, set_at');

    if (error) {
      logger.error('platform_module_overrides_get_failed', {
        error: new Error(error.message),
      });
      return NextResponse.json({ error: 'Failed to fetch overrides' }, { status: 500 });
    }

    const overridesByKey = new Map(
      (data ?? []).map(row => [row.module_key as string, row]),
    );

    const modules: OverrideViewRow[] = MODULE_REGISTRY.map((meta: ModuleMeta) => {
      const row = overridesByKey.get(meta.key);
      return {
        key: meta.key,
        displayName: meta.displayName,
        displayNameHi: meta.displayNameHi,
        description: meta.description,
        isForceDisabled: row?.is_force_disabled === true,
        reason: (row?.reason as string | undefined) ?? null,
        setBy: (row?.set_by as string | undefined) ?? null,
        setAt: (row?.set_at as string | undefined) ?? null,
      };
    });

    return NextResponse.json({ success: true, data: { modules } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Body must be a JSON object' },
        { status: 400 },
      );
    }

    const { moduleKey, isForceDisabled, reason } = body as {
      moduleKey?: unknown;
      isForceDisabled?: unknown;
      reason?: unknown;
    };

    if (typeof moduleKey !== 'string' || !VALID_MODULE_KEYS.has(moduleKey)) {
      return NextResponse.json(
        { error: `moduleKey must be one of: ${[...VALID_MODULE_KEYS].join(', ')}` },
        { status: 400 },
      );
    }
    if (typeof isForceDisabled !== 'boolean') {
      return NextResponse.json(
        { error: 'isForceDisabled must be a boolean' },
        { status: 400 },
      );
    }
    if (reason !== undefined && reason !== null && typeof reason !== 'string') {
      return NextResponse.json(
        { error: 'reason must be a string or null' },
        { status: 400 },
      );
    }
    if (typeof reason === 'string' && reason.length > 500) {
      return NextResponse.json(
        { error: 'reason must be 500 characters or less' },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('platform_module_overrides')
      .upsert(
        {
          module_key: moduleKey,
          is_force_disabled: isForceDisabled,
          reason: typeof reason === 'string' ? reason.trim() || null : null,
          // set_by may be null when admin-secret auth doesn't carry an
          // auth_user_id (admin-secret bypass path). Best-effort attribution.
          set_by: (auth as { user?: { id?: string } }).user?.id ?? null,
          set_at: new Date().toISOString(),
        },
        { onConflict: 'module_key' },
      )
      .select('module_key, is_force_disabled, reason, set_at')
      .single();

    if (error) {
      logger.error('platform_module_overrides_upsert_failed', {
        error: new Error(error.message),
        moduleKey,
      });
      return NextResponse.json(
        { error: 'Failed to upsert override' },
        { status: 500 },
      );
    }

    invalidatePlatformOverridesCache();

    await logAdminAudit(auth, 'platform.module_overridden', 'module', moduleKey, {
      isForceDisabled,
      reason: typeof reason === 'string' ? reason : null,
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
