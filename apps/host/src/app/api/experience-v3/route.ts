import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@alfanumrik/lib/supabase-server';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getUserPermissions } from '@alfanumrik/lib/rbac';
import { adminExperiencePermissions } from '@alfanumrik/lib/admin-auth';
import { schoolAdminRoleAllows, schoolAdminRolePermissionIsGoverned, type SchoolAdminRole } from '@alfanumrik/lib/school-admin-auth';
import { ENTITLEMENTS_FLAG, getResolvedEntitlements } from '@alfanumrik/lib/entitlements/resolver';
import { isFeatureEnabled, SCHOOL_ADMIN_RBAC_FLAGS } from '@alfanumrik/lib/feature-flags';
import { getRoleManifest, resolveCapabilities, resolveExperienceV3, resolveRouteCapability, type ExperienceRole } from '@alfanumrik/lib/experience-v3';

const ROLES = new Set<ExperienceRole>(['student', 'teacher', 'parent', 'school-admin', 'super-admin']);

interface SchoolScopeOption { id: string; name: string; }
interface Membership {
  allowed: boolean;
  institutionId?: string;
  childId?: string;
  schoolAdminRole?: SchoolAdminRole;
  adminLevel?: string;
  schools?: SchoolScopeOption[];
}

async function getRoleMembership(
  userId: string,
  role: ExperienceRole,
  requestedScope: { childId?: string; schoolId?: string },
): Promise<Membership> {
  const admin = getSupabaseAdmin();
  switch (role) {
    case 'student': {
      const { data, error } = await admin.from('students').select('id,school_id').eq('auth_user_id', userId).is('deleted_at', null).limit(1).maybeSingle();
      return { allowed: !error && Boolean(data), institutionId: data?.school_id || undefined };
    }
    case 'teacher': {
      const { data, error } = await admin.from('teachers').select('id,school_id').eq('auth_user_id', userId).is('deleted_at', null).limit(1).maybeSingle();
      return { allowed: !error && Boolean(data), institutionId: data?.school_id || undefined };
    }
    case 'parent': {
      const { data: guardian, error } = await admin.from('guardians').select('id').eq('auth_user_id', userId).is('deleted_at', null).limit(1).maybeSingle();
      if (error || !guardian) return { allowed: false };
      let linksQuery = admin
        .from('guardian_student_links')
        .select('student_id, created_at')
        .eq('guardian_id', guardian.id)
        .in('status', ['active', 'approved']);
      if (requestedScope.childId) linksQuery = linksQuery.eq('student_id', requestedScope.childId);
      const { data: links, error: linksError } = await linksQuery.order('created_at', { ascending: true }).limit(1);
      const link = links?.[0];
      // A caller-supplied child is an authorization boundary. Never silently
      // replace an invalid child with the guardian's first linked learner.
      if (linksError || (requestedScope.childId && !link)) return { allowed: false };
      if (!link?.student_id) return { allowed: true };
      const { data: student, error: studentError } = await admin
        .from('students')
        .select('school_id')
        .eq('id', link.student_id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .maybeSingle();
      if (studentError || !student) return { allowed: false };
      return { allowed: true, childId: link.student_id, institutionId: student.school_id || undefined };
    }
    case 'school-admin': {
      const { data, error } = await admin
        .from('school_admins')
        .select('id,school_id,role,schools!inner(id,name,is_active)')
        .eq('auth_user_id', userId)
        .eq('is_active', true)
        .eq('schools.is_active', true);
      if (error) return { allowed: false };
      type Row = { school_id: string; role: SchoolAdminRole; schools: { id: string; name: string } | Array<{ id: string; name: string }> | null };
      const rows = ((data ?? []) as Row[]).slice().sort((left, right) => left.school_id.localeCompare(right.school_id));
      const selected = requestedScope.schoolId
        ? rows.find((item) => item.school_id === requestedScope.schoolId)
        : rows[0];
      // URL scope is untrusted. An inactive/foreign school selection never
      // falls back to another membership.
      if (!selected) return { allowed: false };
      const schools = rows.map((item) => {
        const school = Array.isArray(item.schools) ? item.schools[0] : item.schools;
        return { id: item.school_id, name: school?.name || 'School' };
      });
      return {
        allowed: true,
        institutionId: selected.school_id,
        schoolAdminRole: selected.role,
        schools,
      };
    }
    case 'super-admin': {
      const { data, error } = await admin.from('admin_users').select('id,admin_level').eq('auth_user_id', userId).eq('is_active', true).limit(1).maybeSingle();
      return { allowed: !error && Boolean(data), adminLevel: data?.admin_level || undefined };
    }
  }
}

const CAPABILITY_ENTITLEMENT: Readonly<Record<string, string>> = {
  'student.learn': 'module.lms', 'student.practice': 'module.testing_engine', 'student.progress': 'module.analytics',
  'student.foxy': 'feature.foxy_interact', 'student.downloads': 'feature.report_download_own',
  'teacher.today': 'module.analytics', 'teacher.students': 'module.analytics', 'teacher.assign': 'module.testing_engine',
  'teacher.grade': 'module.testing_engine', 'teacher.insights': 'module.analytics', 'teacher.classes': 'module.lms',
  'parent.progress': 'module.analytics', 'parent.plan': 'module.lms', 'parent.reports': 'feature.report_download_own',
  'school.overview': 'module.analytics', 'school.academics': 'module.lms', 'school.insights': 'module.analytics', 'school.reports': 'module.analytics',
};

async function databaseCapabilityOverrides(role: ExperienceRole, institutionId?: string): Promise<Record<string, boolean>> {
  const capabilities = getRoleManifest(role).desktop.map((item) => item.capability);
  const overrides = Object.fromEntries(capabilities.map((capability) => [capability, true]));
  if (!institutionId) return overrides;
  const enforcementOn = await isFeatureEnabled(ENTITLEMENTS_FLAG, { institutionId, environment: process.env.VERCEL_ENV || process.env.NODE_ENV });
  if (!enforcementOn) return overrides;
  try {
    const { byKey } = await getResolvedEntitlements(institutionId);
    for (const capability of capabilities) {
      const entitlement = CAPABILITY_ENTITLEMENT[capability];
      if (entitlement) overrides[capability] = byKey.get(entitlement)?.effectiveEnabled === true;
    }
  } catch {
    // When entitlement enforcement is ON, a read failure must not expose the
    // affected module. Unmapped core navigation remains role-authorized.
    for (const capability of capabilities) if (CAPABILITY_ENTITLEMENT[capability]) overrides[capability] = false;
  }
  return overrides;
}

async function authenticatedUser(request: NextRequest) {
  try {
    const client = await createSupabaseServerClient();
    const { data: { user } } = await client.auth.getUser();
    if (user) return user;
  } catch { /* localStorage sessions use the Bearer path below */ }

  const header = request.headers.get('authorization');
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const { data: { user } } = await getSupabaseAdmin().auth.getUser(token);
    return user;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const requestedRole = request.nextUrl.searchParams.get('role');
  if (!requestedRole || !ROLES.has(requestedRole as ExperienceRole)) {
    return NextResponse.json({ enabled: false }, { status: 400, headers: { 'Cache-Control': 'private, no-store' } });
  }

  const user = await authenticatedUser(request);
  if (!user) {
    return NextResponse.json({ enabled: false }, { status: 401, headers: { 'Cache-Control': 'private, no-store' } });
  }

  // Authentication is not role authorization. Verify the requested role
  // against its authoritative profile/RBAC table so a student cannot ask the
  // endpoint to reveal a teacher or operator shell. Multi-role users pass for
  // every profile they genuinely own.
  const role = requestedRole as ExperienceRole;
  const requestedChildId = request.nextUrl.searchParams.get('childId')?.trim() || undefined;
  const requestedSchoolId = request.nextUrl.searchParams.get('schoolId')?.trim() || undefined;
  const membership = await getRoleMembership(user.id, role, { childId: requestedChildId, schoolId: requestedSchoolId });
  if (!membership.allowed) {
    return NextResponse.json({ enabled: false }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  }

  // app_metadata is server-controlled in Supabase. It is safe as rollout
  // context; user_metadata is intentionally never used for authorization or
  // institution targeting.
  const institutionId = membership.institutionId;
  const enabled = await resolveExperienceV3({
    role,
    userId: user.id,
    institutionId,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });
  if (!enabled) return NextResponse.json({ enabled: false, capabilities: {}, manifest: null, routeMapped: false, routeAllowed: false }, { headers: { 'Cache-Control': 'private, no-store' } });

  let permissions: string[] = role === 'super-admin'
    ? [...adminExperiencePermissions(membership.adminLevel)]
    : [];
  try {
    const resolved = await getUserPermissions(user.id, institutionId);
    permissions = [...new Set([...permissions, ...resolved.permissions])];
    // The institution_admin RBAC role is a superset. When the existing
    // school-admin role matrix is enabled, narrow the visible manifest to the
    // selected membership's actual role as well; this can only remove access.
    const selectedSchoolAdminRole = membership.schoolAdminRole;
    if (role === 'school-admin' && selectedSchoolAdminRole) {
      const multiSchool = (membership.schools?.length ?? 0) > 1;
      const roleMatrixOn = multiSchool
        || await isFeatureEnabled(SCHOOL_ADMIN_RBAC_FLAGS.V1, { institutionId });
      if (roleMatrixOn) {
        permissions = permissions.filter((permission) => (
          (!multiSchool || resolved.permissionScope !== 'baseline-global' || schoolAdminRolePermissionIsGoverned(permission))
          && schoolAdminRoleAllows(selectedSchoolAdminRole, permission)
        ));
      }
    }
  } catch { /* protected navigation fails closed through an empty list */ }

  const databaseOverrides = await databaseCapabilityOverrides(role, institutionId);
  const resolved = resolveCapabilities({ role, databaseOverrides, permissions });
  const requestedPath = request.nextUrl.searchParams.get('path');
  const routeResolution = requestedPath?.startsWith('/') && requestedPath.length <= 512
    ? resolveRouteCapability(resolved.manifest, requestedPath)
    : null;

  return NextResponse.json({
    enabled: true,
    capabilities: resolved.capabilities,
    manifest: resolved.manifest,
    routeMapped: requestedPath ? routeResolution !== null : true,
    routeAllowed: requestedPath ? routeResolution?.allowed === true : true,
    scope: role === 'parent'
      ? { childId: membership.childId }
      : role === 'school-admin'
        ? { schoolId: institutionId, schools: membership.schools ?? [] }
        : null,
  }, { headers: { 'Cache-Control': 'private, no-store' } });
}
