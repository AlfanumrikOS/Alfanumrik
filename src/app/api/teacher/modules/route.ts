/**
 * GET /api/teacher/modules
 *
 * Returns module enablement for the teacher's school. Consumed by
 * `TeacherShell` to hide nav entries (Assignments, Worksheets, Reports)
 * when the school has the corresponding module disabled.
 *
 * The response shape mirrors `/api/school-admin/modules` GET so the same
 * client-side parser works for both shells. Teachers can READ enablement
 * but not WRITE — module configuration remains the school admin's concern.
 *
 * Auth: cookie session OR Bearer JWT (resolved via `authorizeRequest`).
 * The shell calls this with `credentials: 'same-origin'`, so the cookie
 * path is the primary route.
 *
 * Fail-open philosophy:
 * - Unauthenticated → 401 (shell fail-opens: shows all items).
 * - Authenticated but no teacher row → 200 with empty modules (shell shows all).
 * - DB error → 500 (shell fail-opens: shows all items).
 *
 * The shell never displays a fewer-items view due to a transient backend
 * issue; that's intentional. False-positive nav entries are recoverable
 * (the destination page enforces its own permission); false-negatives are
 * not (a teacher who can't see "Reports" thinks the feature doesn't exist).
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  MODULE_REGISTRY,
  enabledModulesFor,
  type ModuleKey,
  type ModuleMeta,
} from '@/lib/modules/registry';
import { coerceTenantType } from '@/lib/tenant-domain';

interface ModuleViewRow {
  key: ModuleKey;
  displayName: string;
  displayNameHi: string | null;
  description: string;
  routePrefix: string | null;
  isEnabled: boolean;
}

export async function GET(request: NextRequest) {
  try {
    // `class.view_analytics` is the read-side permission granted to the
    // teacher role in the RBAC conformance migration. Listing module
    // enablement is a read, so this is the semantically correct gate.
    // (The previous code authorized against the orphan `teacher.read` code,
    // which is granted to no role and 403'd every teacher.)
    const auth = await authorizeRequest(request, 'class.view_analytics');
    if (!auth.authorized) return auth.errorResponse as unknown as NextResponse;

    const supabase = getSupabaseAdmin();

    // Find the teacher's school. We use a join so a single round-trip
    // gets us both the school_id and the tenant_type used by the
    // registry resolver.
    const { data: teacherRow, error: teacherErr } = await supabase
      .from('teachers')
      .select('school_id, schools(tenant_type)')
      .eq('auth_user_id', auth.userId)
      .maybeSingle();

    if (teacherErr) {
      logger.error('teacher_modules_lookup_failed', {
        error: new Error(teacherErr.message),
        route: '/api/teacher/modules',
      });
      return NextResponse.json(
        { success: false, error: 'Internal server error' },
        { status: 500 },
      );
    }

    // Teacher with no school (e.g. solo coach onboarding mid-flight) — return
    // an empty modules array so the shell shows everything by default.
    if (!teacherRow?.school_id) {
      return NextResponse.json({
        success: true,
        data: { tenant_type: 'school', modules: [] as ModuleViewRow[] },
      });
    }

    // Supabase FK join may return the related row as object or array
    // depending on relation cardinality. Normalise.
    const rawSchool = teacherRow.schools as unknown;
    const schoolObj = Array.isArray(rawSchool) ? rawSchool[0] : rawSchool;
    const tenantTypeRaw =
      schoolObj && typeof schoolObj === 'object' && 'tenant_type' in schoolObj
        ? (schoolObj as { tenant_type?: string | null }).tenant_type ?? null
        : null;
    const tenantType = coerceTenantType(tenantTypeRaw);

    const enablement = await enabledModulesFor(teacherRow.school_id, tenantType);

    const modules: ModuleViewRow[] = MODULE_REGISTRY.map((meta: ModuleMeta) => ({
      key: meta.key,
      displayName: meta.displayName,
      displayNameHi: meta.displayNameHi,
      description: meta.description,
      routePrefix: meta.routePrefix,
      isEnabled: enablement[meta.key] ?? false,
    }));

    return NextResponse.json({
      success: true,
      data: { tenant_type: tenantType, modules },
    });
  } catch (err) {
    logger.error('teacher_modules_get_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/teacher/modules',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 },
    );
  }
}
