/**
 * POST /api/super-admin/debug/whoami
 *
 * Diagnostic-only endpoint: returns the COMPLETE role/profile state for any user
 * by email, queried via service-role (RLS bypassed) so nothing is filtered out.
 *
 * Tests deferred — this is short-lived ops infrastructure to unblock the
 * school_admin demo login investigation. Promote to a tested route once it
 * stops being an emergency hotline.
 *
 * Auth: EITHER super_admin admin auth OR the x-debug-secret header matching
 * SUPER_ADMIN_SECRET. The secret path exists so ops can hit prod from a curl
 * session without first solving a chicken-and-egg admin-login problem.
 *
 * Privacy: response body is NEVER logged anywhere. Only the fact of the
 * lookup is audited (and only when admin-session auth was used — secret-path
 * usage is intentionally untracked for emergency ops access).
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { authorizeAdmin, logAdminAudit } from '@alfanumrik/lib/admin-auth';
import { secureEqual } from '@alfanumrik/lib/secure-compare';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { getRoleDestination } from '@alfanumrik/lib/identity';

type RoleName =
  | 'student'
  | 'teacher'
  | 'guardian'
  | 'institution_admin'
  | 'none';

const BodySchema = z.object({
  email: z.string().email().max(254),
});

// Profile tables to introspect, keyed by AuthContext role bucket.
const PROFILE_TABLES = [
  'students',
  'teachers',
  'guardians',
  'school_admins',
  'admin_users',
] as const;
type ProfileTable = (typeof PROFILE_TABLES)[number];

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // Dual auth: either admin session OR shared secret header.
  const auth = await authorizeAdmin(request, 'super_admin');
  const providedSecret = request.headers.get('x-debug-secret');
  const expectedSecret = process.env.SUPER_ADMIN_SECRET;
  const secretOk =
    !!providedSecret &&
    !!expectedSecret &&
    secureEqual(providedSecret, expectedSecret);

  if (!auth.authorized && !secretOk) {
    return (
      auth.response ??
      NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    );
  }

  // Parse + validate body.
  let parsedBody: { email: string };
  try {
    const raw = await request.json();
    parsedBody = BodySchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof z.ZodError
            ? 'Invalid request body'
            : 'Failed to parse request body',
        details:
          err instanceof z.ZodError
            ? err.flatten()
            : err instanceof Error
              ? err.message
              : String(err),
      },
      { status: 400 },
    );
  }

  const emailLower = parsedBody.email.trim().toLowerCase();
  const supabase = getSupabaseAdmin();

  const issues: string[] = [];

  // -------------------------------------------------------------------------
  // 1. Auth user lookup by email (admin Auth API)
  // -------------------------------------------------------------------------
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: 'Server misconfigured (Supabase URL or service key missing)' },
      { status: 500 },
    );
  }

  let authUser: {
    id: string;
    email: string | null;
    created_at: string | null;
    email_confirmed_at: string | null;
    last_sign_in_at: string | null;
    raw_user_meta_data: Record<string, unknown> | null;
  } | null = null;

  try {
    const authUserRes = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?email=${encodeURIComponent(emailLower)}`,
      {
        method: 'GET',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
        },
      },
    );

    if (authUserRes.ok) {
      const authJson = await authUserRes.json();
      // GoTrue returns either {users: [...]} or a single object depending on
      // version / query shape. Normalise to an array.
      const usersArr: Array<Record<string, unknown>> = Array.isArray(
        authJson?.users,
      )
        ? authJson.users
        : Array.isArray(authJson)
          ? authJson
          : authJson?.id
            ? [authJson]
            : [];

      // Filter to exact email match (the ?email= param is a prefix/contains
      // search in some GoTrue versions).
      const exact = usersArr.find(
        (u) =>
          typeof u?.email === 'string' &&
          (u.email as string).toLowerCase() === emailLower,
      );

      if (exact) {
        authUser = {
          id: String(exact.id),
          email: (exact.email as string) ?? null,
          created_at: (exact.created_at as string) ?? null,
          email_confirmed_at: (exact.email_confirmed_at as string) ?? null,
          last_sign_in_at: (exact.last_sign_in_at as string) ?? null,
          raw_user_meta_data:
            (exact.raw_user_meta_data as Record<string, unknown>) ??
            (exact.user_metadata as Record<string, unknown>) ??
            null,
        };
      }
    } else {
      issues.push(
        `auth.users lookup returned HTTP ${authUserRes.status} — service-role key may be misconfigured`,
      );
    }
  } catch (err) {
    issues.push(
      `auth.users lookup threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Nothing else to do if we couldn't resolve a user.
  if (!authUser) {
    if (issues.length === 0) {
      issues.push('auth user not found by email');
    }
    return NextResponse.json({
      email: emailLower,
      auth_user: null,
      profiles: {
        students: [],
        teachers: [],
        guardians: [],
        school_admins: [],
        admin_users: [],
      },
      user_roles: [],
      get_user_role_rpc: null,
      demo_account: null,
      diagnostics: {
        is_school_admin: false,
        is_active_school_admin: false,
        expected_active_role_via_rpc: 'none' as RoleName,
        expected_active_role_via_fallback: 'none' as RoleName,
        expected_destination: '/login',
        issues_detected: issues,
      },
    });
  }

  const userId = authUser.id;

  // -------------------------------------------------------------------------
  // 2. Profile tables (each by auth_user_id, service-role bypasses RLS)
  // -------------------------------------------------------------------------
  const profileResults = await Promise.all(
    PROFILE_TABLES.map(async (table) => {
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('auth_user_id', userId);
      if (error) {
        issues.push(`${table} lookup error: ${error.message}`);
        return { table, rows: [] as Array<Record<string, unknown>> };
      }
      return {
        table,
        rows: (data ?? []) as Array<Record<string, unknown>>,
      };
    }),
  );

  const profiles: Record<ProfileTable, Array<Record<string, unknown>>> = {
    students: [],
    teachers: [],
    guardians: [],
    school_admins: [],
    admin_users: [],
  };
  for (const r of profileResults) {
    profiles[r.table] = r.rows;
  }

  // -------------------------------------------------------------------------
  // 3. user_roles joined with roles
  // -------------------------------------------------------------------------
  type UserRoleJoined = {
    id: string;
    auth_user_id: string;
    role_id: string;
    is_active: boolean | null;
    assigned_at: string | null;
    roles: { name: string; display_name: string } | { name: string; display_name: string }[] | null;
  };

  const { data: userRolesRaw, error: userRolesErr } = await supabase
    .from('user_roles')
    .select('id, auth_user_id, role_id, is_active, assigned_at, roles:role_id(name, display_name)')
    .eq('auth_user_id', userId);

  if (userRolesErr) {
    issues.push(`user_roles lookup error: ${userRolesErr.message}`);
  }

  const userRoles = ((userRolesRaw ?? []) as UserRoleJoined[]).map((row) => {
    // Supabase typed the embedded relation as either object or array depending
    // on FK direction; normalise to a single object for the response.
    const roleObj = Array.isArray(row.roles) ? row.roles[0] : row.roles;
    return {
      id: row.id,
      auth_user_id: row.auth_user_id,
      role_id: row.role_id,
      is_active: row.is_active,
      assigned_at: row.assigned_at,
      role_name: roleObj?.name ?? null,
      role_display_name: roleObj?.display_name ?? null,
    };
  });

  // -------------------------------------------------------------------------
  // 4. get_user_role RPC — same call AuthContext makes
  // -------------------------------------------------------------------------
  type RpcSnapshot =
    | {
        raw: unknown;
        primary_role: string | null;
        roles_count: number;
      }
    | { error: string };

  let rpcSnapshot: RpcSnapshot;
  try {
    const { data: rpcData, error: rpcErr } = await supabase.rpc(
      'get_user_role',
      { p_auth_user_id: userId },
    );
    if (rpcErr) {
      rpcSnapshot = { error: rpcErr.message };
      issues.push(`get_user_role RPC errored: ${rpcErr.message}`);
    } else {
      const rd = rpcData as Record<string, unknown> | null;
      const rolesArr = Array.isArray(rd?.roles)
        ? (rd!.roles as unknown[])
        : [];
      rpcSnapshot = {
        raw: rpcData ?? null,
        primary_role: (rd?.primary_role as string) ?? null,
        roles_count: rolesArr.length,
      };
    }
  } catch (err) {
    rpcSnapshot = {
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // -------------------------------------------------------------------------
  // 5. demo_accounts row (may not exist if table absent in this env)
  // -------------------------------------------------------------------------
  let demoAccount: Record<string, unknown> | null = null;
  try {
    const { data: demoRow, error: demoErr } = await supabase
      .from('demo_accounts')
      .select('*')
      .eq('auth_user_id', userId)
      .maybeSingle();
    if (demoErr) {
      // PGRST116 = no rows; treat as null silently. Anything else → surface.
      if (demoErr.code !== 'PGRST116') {
        issues.push(`demo_accounts lookup error: ${demoErr.message}`);
      }
    } else {
      demoAccount = (demoRow as Record<string, unknown>) ?? null;
    }
  } catch (err) {
    issues.push(
      `demo_accounts lookup threw: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // -------------------------------------------------------------------------
  // 6. Diagnostics
  // -------------------------------------------------------------------------
  const hasStudent = profiles.students.length > 0;
  const hasTeacher = profiles.teachers.length > 0;
  const hasGuardian = profiles.guardians.length > 0;
  const hasSchoolAdmin = profiles.school_admins.length > 0;
  const hasActiveSchoolAdmin = profiles.school_admins.some(
    (row) => row.is_active === true,
  );

  // RPC-derived role: the RPC returns a `primary_role` string. AuthContext
  // treats absent/empty roles as a fallback signal.
  let expectedViaRpc: RoleName = 'none';
  if ('primary_role' in rpcSnapshot) {
    const pr = rpcSnapshot.primary_role;
    if (pr === 'student' || pr === 'teacher' || pr === 'guardian' || pr === 'institution_admin') {
      expectedViaRpc = pr;
    }
  }

  // Fallback simulation: mirror AuthContext order — student, teacher, guardian,
  // school_admin (active only). Teacher takes priority over student for
  // detectedPrimary in AuthContext, so we replay the same precedence here.
  let expectedViaFallback: RoleName = 'none';
  const fallbackOrder: Array<[boolean, RoleName]> = [
    [hasStudent, 'student'],
    [hasTeacher, 'teacher'],
    [hasGuardian, 'guardian'],
    [hasActiveSchoolAdmin, 'institution_admin'],
  ];
  for (const [present, role] of fallbackOrder) {
    if (!present) continue;
    // AuthContext promotes teacher over student. We honour the
    // "later wins if it's teacher" quirk: first detected role sticks,
    // unless a later iteration discovers a teacher profile (which
    // takes priority over student per AuthContext lines 304-307).
    if (expectedViaFallback === 'none') {
      expectedViaFallback = role;
    } else if (role === 'teacher') {
      expectedViaFallback = 'teacher';
    }
  }

  // Curated diagnostics — pattern-match common school_admin / orphan states.
  if (
    !hasStudent &&
    !hasTeacher &&
    !hasGuardian &&
    !hasSchoolAdmin &&
    profiles.admin_users.length === 0
  ) {
    issues.push('auth user has no profile in any role table');
  }
  if (hasSchoolAdmin && !hasActiveSchoolAdmin) {
    issues.push('school_admins row exists but is_active=false');
  }
  if (hasSchoolAdmin) {
    const hasInstitutionAdminUserRole = userRoles.some(
      (r) => r.role_name === 'institution_admin' && r.is_active !== false,
    );
    if (!hasInstitutionAdminUserRole) {
      issues.push(
        'school_admins row exists but no matching user_roles row (sync_school_admin_role trigger may have failed)',
      );
    }
  }
  const hasOrphanInstitutionRole = userRoles.some(
    (r) => r.role_name === 'institution_admin' && r.is_active !== false,
  );
  if (hasOrphanInstitutionRole && !hasSchoolAdmin) {
    issues.push(
      'user_roles has institution_admin entry but school_admins row missing (orphan)',
    );
  }
  if (
    'roles_count' in rpcSnapshot &&
    rpcSnapshot.roles_count === 0 &&
    (hasStudent || hasTeacher || hasGuardian || hasSchoolAdmin)
  ) {
    if (hasSchoolAdmin) {
      issues.push(
        'RPC returns empty roles array (known: baseline get_user_role RPC does not inspect school_admins)',
      );
    } else {
      issues.push(
        'RPC returns empty roles array despite profile rows existing — RPC is out of sync with profile tables',
      );
    }
  }
  if ('error' in rpcSnapshot) {
    issues.push('RPC errored — client-side fallback must work for this user to log in');
  }

  const expectedDestination =
    expectedViaFallback === 'none' ? '/login' : getRoleDestination(expectedViaFallback);

  // -------------------------------------------------------------------------
  // 7. Audit (only when admin session was used; secret-path is untracked)
  // -------------------------------------------------------------------------
  if (auth.authorized) {
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;
    // Fire-and-forget. Don't await — never block diagnostics on audit write.
    void logAdminAudit(
      auth,
      'debug_whoami_queried',
      'auth_user',
      userId,
      { email_queried: emailLower },
      ipAddress,
    );
  }

  // -------------------------------------------------------------------------
  // 8. Build response
  // -------------------------------------------------------------------------
  return NextResponse.json({
    email: emailLower,
    auth_user: authUser,
    profiles,
    user_roles: userRoles,
    get_user_role_rpc: rpcSnapshot,
    demo_account: demoAccount,
    diagnostics: {
      is_school_admin: hasSchoolAdmin,
      is_active_school_admin: hasActiveSchoolAdmin,
      expected_active_role_via_rpc: expectedViaRpc,
      expected_active_role_via_fallback: expectedViaFallback,
      expected_destination: expectedDestination,
      issues_detected: issues,
    },
  });
}
