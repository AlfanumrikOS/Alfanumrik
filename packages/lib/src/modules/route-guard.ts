/**
 * ALFANUMRIK — Module Route Guard (Phase 3C Wave A, step A2)
 *
 * A thin, reusable guard that maps an API route (or, later, a page) to its
 * owning module and 404s the request when that module is DISABLED for the
 * caller's tenant. The enablement decision is delegated entirely to the
 * registry resolver `isModuleEnabled()` — this file owns NO enablement logic,
 * only the request→school→module wiring and the disabled→404 mapping.
 *
 * ─── FAIL-OPEN CONTRACT (never lock a tenant out) ───────────────────────────
 * The guard ALLOWS the request whenever:
 *   1. `ff_tenant_module_registry_v1` is OFF — `isModuleEnabled()` already
 *      short-circuits to `true` for every module, so the guard is a no-op and
 *      behaviour is byte-identical to pre-A2. (The flag is read inside the
 *      resolver; this file does not re-check it.)
 *   2. No tenant context can be resolved (no school_id, B2C, header absent).
 *   3. The tenant_type lookup fails or the school row is missing.
 *   4. ANY error is thrown while resolving.
 * Only an explicit `isModuleEnabled(...) === false` produces a 404. A failure
 * to *determine* enablement is treated as "allow", matching the resolver's own
 * fail-open posture (registry.ts loadTenantModules/loadPlatformOverrides).
 *
 * ─── PII (P13) ──────────────────────────────────────────────────────────────
 * No request body, email, phone, name, or IP is logged here. The only
 * identifiers touched are the opaque school_id (UUID) and the module key, and
 * even those are not logged on the allow path. On a disabled→404 we emit a
 * single structured debug line carrying the module key only.
 *
 * ─── MODULE → ROUTE MAPPING ─────────────────────────────────────────────────
 * The registry's `routePrefix` is the single source of truth for which module
 * owns which surface. Call sites pass the `ModuleKey` directly (derived from
 * that prefix); this file never re-declares a parallel prefix→module table.
 */

import { NextResponse } from 'next/server';
import {
  isModuleEnabled,
  type ModuleKey,
} from '@alfanumrik/lib/modules/registry';
import { getSchoolById } from '@alfanumrik/lib/domains/tenant';
import { tenantFromHeaders } from '@alfanumrik/lib/tenant';
import { logger } from '@alfanumrik/lib/logger';
import type { TenantType } from '@alfanumrik/lib/tenant-domain';

// ─── Result type ────────────────────────────────────────────────────────────

/**
 * Discriminated guard result. `allowed: false` carries a ready-to-return
 * `NextResponse` (a 404 `{ success, error }` envelope). Callers do:
 *
 *   const gate = await assertModuleEnabledForSchool(auth.schoolId, 'testing_engine');
 *   if (!gate.allowed) return gate.response;
 */
export type ModuleGateResult =
  | { allowed: true }
  | { allowed: false; response: NextResponse };

const ALLOWED: ModuleGateResult = { allowed: true };

/**
 * Build the 404 returned when a module is explicitly disabled. We use 404
 * (not 403) deliberately: a disabled module should look as if the surface does
 * not exist for this tenant, not as if access was denied. Never 500 — a
 * resolution *failure* fails open (returns ALLOWED) rather than erroring.
 */
function moduleDisabledResponse(moduleKey: ModuleKey): NextResponse {
  return NextResponse.json(
    {
      success: false,
      error: 'This module is not enabled for your organization.',
      code: 'MODULE_DISABLED',
      module: moduleKey,
    },
    { status: 404 },
  );
}

// ─── Core resolver ──────────────────────────────────────────────────────────

/**
 * Resolve the tenant_type for a school, then ask the registry resolver whether
 * `moduleKey` is enabled. Fail-OPEN on every uncertainty (see contract above).
 *
 * Returns `true` to ALLOW, `false` to BLOCK. Only an explicit
 * `isModuleEnabled(...) === false` returns `false`.
 */
async function isModuleAllowedForSchool(
  schoolId: string | null | undefined,
  moduleKey: ModuleKey,
): Promise<boolean> {
  // No tenant context → fail open. (`isModuleEnabled(null, ...)` already
  // returns true, but short-circuiting here saves the school lookup.)
  if (!schoolId) return true;

  try {
    // Resolve tenant_type. getSchoolById is service-role + table-cached; one
    // read per request, no N+1. A missing row or DB error → fail open.
    const schoolResult = await getSchoolById(schoolId);
    if (!schoolResult.ok || !schoolResult.data) return true;

    const tenantType: TenantType = schoolResult.data.tenantType;

    // Delegate the enablement decision. When the flag is OFF, or a platform/
    // tenant override can't be loaded, the resolver itself returns true.
    return await isModuleEnabled(schoolId, tenantType, moduleKey);
  } catch (err) {
    // Any unexpected failure → fail open. Never lock a tenant out on an error.
    logger.warn('module_route_guard_resolve_failed', {
      route: 'modules/route-guard',
      module: moduleKey,
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return true;
  }
}

// ─── Public entry points ────────────────────────────────────────────────────

/**
 * Guard a SCHOOL-ADMIN route by module. Pass the `school_id` already resolved
 * by `authorizeSchoolAdmin()` (i.e. `auth.schoolId`) — do NOT re-resolve auth
 * here; this runs AFTER the route's `authorizeSchoolAdmin` check.
 *
 * Usage:
 *   const auth = await authorizeSchoolAdmin(request, 'school.manage_exams');
 *   if (!auth.authorized) return auth.errorResponse;
 *   const gate = await assertModuleEnabledForSchool(auth.schoolId, 'testing_engine');
 *   if (!gate.allowed) return gate.response;
 *
 * Disabled → 404. Flag OFF / unresolved / error → allowed.
 */
export async function assertModuleEnabledForSchool(
  schoolId: string | null | undefined,
  moduleKey: ModuleKey,
): Promise<ModuleGateResult> {
  const allowed = await isModuleAllowedForSchool(schoolId, moduleKey);
  if (allowed) return ALLOWED;

  logger.debug('module_route_guard_blocked', {
    route: 'modules/route-guard',
    module: moduleKey,
  });
  return { allowed: false, response: moduleDisabledResponse(moduleKey) };
}

/**
 * Guard a TENANT-CONTEXT route by module, resolving the active school from the
 * proxy-injected `x-school-id` header (set in `src/proxy.ts`). This is the
 * REUSABLE entry point intended for the deferred student-facing enforcement
 * (e.g. a student whose school disabled `ai_tutor` should not reach `/foxy`).
 *
 * B2C / header-absent requests carry no `x-school-id` → `tenantFromHeaders`
 * yields a null `schoolId` → fail open (every module implicitly available).
 *
 * Disabled → 404. Flag OFF / no tenant header / error → allowed.
 */
export async function assertModuleEnabled(
  request: Request,
  moduleKey: ModuleKey,
): Promise<ModuleGateResult> {
  let schoolId: string | null = null;
  try {
    schoolId = tenantFromHeaders(request.headers).schoolId;
  } catch {
    // Header parse failure → no tenant context → fail open.
    schoolId = null;
  }

  const allowed = await isModuleAllowedForSchool(schoolId, moduleKey);
  if (allowed) return ALLOWED;

  logger.debug('module_route_guard_blocked', {
    route: 'modules/route-guard',
    module: moduleKey,
  });
  return { allowed: false, response: moduleDisabledResponse(moduleKey) };
}
