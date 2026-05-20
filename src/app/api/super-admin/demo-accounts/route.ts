import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl, isValidUUID, type AdminAuth } from '../../../../lib/admin-auth';
import { validateBody } from '../../../../lib/validation';
import { z } from 'zod';
import { DEMO_PERSONAS, DEMO_ROLES, DEMO_STREAMS, PERSONA_PROFILES, normalisePersona, streamRequiredForGrade, type DemoRole, type DemoStream } from '../../../../lib/demo/personas';
import { generateSecurePassword } from '../../../../lib/crypto/password';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function roleToTable(role: DemoRole): string {
  if (role === 'teacher')      return 'teachers';
  if (role === 'parent')       return 'guardians';
  if (role === 'student')      return 'students';
  if (role === 'school_admin') return 'school_admins';
  if (role === 'super_admin')  return 'admin_users';
  return 'students';
}

/**
 * Login routing for demo credentials.
 *
 * Why this exists: school_admin demos land in the `school_admins` table, not
 * `admin_users`. Attempting to log in at /super-admin/login (which gates on
 * admin_users) correctly bounces them with "not an authorized administrator"
 * — but the demo-creation response previously didn't tell the operator that
 * platform-admin login and school-admin login are different doors. This map
 * makes the right destination explicit in the API response so the modal /
 * Slack DM / email that surfaces the credentials can tell the operator where
 * to actually sign in.
 *
 * Note: paths are relative (start with `/`); the frontend uses them as-is.
 * Parent is the only role that has a non-/login flow surfaced here — the
 * link-code path at /parent is the demo-friendly entry point even though
 * /login also works for guardians.
 */
function loginRoutingForRole(role: DemoRole): { login_url: string; login_instructions: string } {
  switch (role) {
    case 'student':
      return {
        login_url: '/login',
        login_instructions: "Log in at /login with email + password. You'll land on /dashboard.",
      };
    case 'teacher':
      return {
        login_url: '/login',
        login_instructions: "Log in at /login with email + password. You'll land on /teacher portal.",
      };
    case 'parent':
      return {
        login_url: '/parent',
        login_instructions: 'Parent portal uses link code, not email/password. Go to /parent and enter the student invite code.',
      };
    case 'school_admin':
      return {
        login_url: '/login',
        login_instructions: "Log in at /login with email + password. You'll land on /school-admin portal. NOTE: Do NOT use /super-admin/login — that's for platform admins only.",
      };
    case 'super_admin':
      return {
        login_url: '/super-admin/login',
        login_instructions: "Log in at /super-admin/login with email + password. You'll land on the super-admin panel.",
      };
  }
}

/** Seed demo data onto a student profile based on persona. */
async function seedStudentDemoData(
  authUserId: string,
  persona: string,
  demoAccountId: string,
): Promise<void> {
  const normalised = normalisePersona(persona);
  const profile = PERSONA_PROFILES[normalised];

  const patchRes = await fetch(
    supabaseAdminUrl('students', `auth_user_id=eq.${authUserId}`),
    {
      method: 'PATCH',
      headers: supabaseAdminHeaders('return=minimal'),
      body: JSON.stringify({
        xp_total: profile.xp_total,
        streak_days: profile.streak_days,
        last_active: new Date().toISOString(),
      }),
    },
  );

  if (!patchRes.ok) {
    console.error('[demo-accounts] Failed to seed student profile:', await patchRes.text());
  }

  await fetch(supabaseAdminUrl('demo_seed_data'), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=minimal'),
    body: JSON.stringify({
      demo_account_id: demoAccountId,
      data_type: 'student_profile',
      seed_data: { persona: normalised, ...profile },
    }),
  });
}

// Resolve the plan UUID at runtime. Cached in module scope so the cost is
// paid once per cold start. Required because student_subscriptions.plan_id
// is NOT NULL with no default and the blueprint forbids hardcoded UUIDs.
let _cachedUnlimitedPlanId: string | null = null;
async function resolveUnlimitedPlanId(): Promise<string | null> {
  if (_cachedUnlimitedPlanId) return _cachedUnlimitedPlanId;
  const res = await fetch(
    supabaseAdminUrl('subscription_plans', 'select=id&plan_code=eq.unlimited&limit=1'),
    { method: 'GET', headers: supabaseAdminHeaders() },
  );
  if (!res.ok) return null;
  const rows = await res.json();
  if (Array.isArray(rows) && rows.length > 0 && rows[0].id) {
    _cachedUnlimitedPlanId = rows[0].id as string;
    return _cachedUnlimitedPlanId;
  }
  return null;
}

/**
 * Provision an unlimited-plan subscription for a demo student. Demo subs
 * are flagged is_demo=true so the daily purge cron can cascade-clean them
 * without touching real customer billing rows.
 */
async function provisionDemoStudentSubscription(studentId: string): Promise<void> {
  const planId = await resolveUnlimitedPlanId();
  if (!planId) {
    console.error('[demo-accounts] subscription_plans.unlimited not found; cannot provision demo sub');
    return;
  }

  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setFullYear(periodEnd.getFullYear() + 1);

  // Phase F.8 follow-up (2026-05-18): the `on_student_created` trigger
  // auto-inserts a `plan_code='free', status='active'` row on every new
  // students row. Our plain POST was hitting the unique constraint on
  // student_id and silently failing, leaving the demo student on 'free'
  // — which then locked physics/chemistry/biology/computer_science behind
  // a 422 plan_not_allowed from validateSubjectWrite → UI showed "Oops!".
  //
  // Switch to PATCH (update) first, with INSERT as fallback if no row
  // exists. PostgREST returns 204 with content-range "0-0" if no rows
  // matched; we detect that and POST.

  const patchBody = {
    plan_id: planId,
    plan_code: 'unlimited',
    status: 'active',
    billing_cycle: 'yearly',
    current_period_start: periodStart.toISOString(),
    current_period_end: periodEnd.toISOString(),
    is_demo: true,
  };

  const patchRes = await fetch(
    supabaseAdminUrl('student_subscriptions', `student_id=eq.${studentId}`),
    {
      method: 'PATCH',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(patchBody),
    },
  );

  if (patchRes.ok) {
    const rows = await patchRes.json().catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return; // updated the auto-created free sub
  } else {
    console.error('[demo-accounts] subscription PATCH failed:', await patchRes.text());
  }

  // No row existed (or PATCH failed) — fall back to INSERT.
  const insertRes = await fetch(supabaseAdminUrl('student_subscriptions'), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=minimal'),
    body: JSON.stringify({
      student_id: studentId,
      ...patchBody,
    }),
  });

  if (!insertRes.ok) {
    console.error('[demo-accounts] subscription INSERT fallback failed:', await insertRes.text());
  }
}

/** Build the role-specific profile payload. */
function buildProfilePayload(
  role: DemoRole,
  authUserId: string,
  name: string,
  email: string,
  opts: { grade?: string; stream?: DemoStream | null; schoolId?: string | null } = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = { auth_user_id: authUserId, name, email, is_demo: true };

  switch (role) {
    case 'student': {
      const grade = opts.grade || '10';
      // Phase F.7 follow-up (2026-05-18): stream is REQUIRED on grade 11/12
      // for the subject list RPC to return the right subjects. Default to
      // 'science' if the operator forgot — better than NULL which makes the
      // RPC return zero/wrong rows. Grades 6-10 leave stream null.
      const stream = streamRequiredForGrade(grade)
        ? (opts.stream || 'science')
        : null;
      return {
        ...base,
        is_active: true,
        grade,
        board: 'CBSE',
        subscription_plan: 'unlimited',
        account_status: 'demo',
        xp_total: 0,
        streak_days: 0,
        preferred_language: 'en',
        preferred_subject: stream === 'commerce' ? 'accountancy' : stream === 'humanities' ? 'history_sr' : 'math',
        ...(stream ? { stream } : {}),
        ...(opts.schoolId ? { school_id: opts.schoolId } : {}),
      };
    }
    case 'teacher':
      return {
        ...base,
        is_active: true,
        school_name: 'Demo School — Delhi Public School',
        subjects_taught: ['math', 'science'],
        grades_taught: ['10', '11', '12'],
        board: 'CBSE',
        preferred_language: 'en',
        is_verified: true,
        onboarding_completed: true,
        ...(opts.schoolId ? { school_id: opts.schoolId } : {}),
      };
    case 'parent':
      // guardians table has no is_active column
      return {
        ...base,
        phone: '+919876543210',
        relationship: 'parent',
        preferred_language: 'en',
        onboarding_completed: true,
      };
    case 'school_admin':
      // Defensive: stamp role explicitly even though the column has a default.
      // (a) Makes intent visible to operators reading the code; (b) survives
      // any future change to the default value.
      return {
        ...base,
        is_active: true,
        role: 'institution_admin',
        ...(opts.schoolId ? { school_id: opts.schoolId } : {}),
      };
    case 'super_admin':
      return {
        auth_user_id: authUserId,
        email,
        name,
        is_active: true,
        is_demo: true,
        admin_level: 'super_admin',
      };
  }
}

type ProvisionResult =
  | { ok: true; schoolId: string }
  | { ok: false; code: 'school_insert_failed' | 'school_id_missing' | 'subscription_insert_failed' | 'config_missing'; details: string };

/**
 * For school_admin demo accounts: create a demo school + 3 seed students +
 * a trial school subscription. Returns a discriminated result so the caller
 * can surface actionable error codes to the operator instead of collapsing
 * every failure into a generic `profile_failed`.
 */
async function provisionDemoSchool(adminAuthUserId: string, adminName: string): Promise<ProvisionResult> {
  const config = getSupabaseConfig();
  if (!config) {
    return { ok: false, code: 'config_missing', details: 'Supabase service-role config missing (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY).' };
  }

  const schoolRes = await fetch(supabaseAdminUrl('schools', undefined), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=representation'),
    body: JSON.stringify({
      name: `Demo School — ${adminName}`,
      board: 'CBSE',
      is_active: true,
      is_demo: true,
    }),
  });

  if (!schoolRes.ok) {
    const body = await schoolRes.text();
    console.error('[demo-accounts] Failed to provision demo school:', body);
    return { ok: false, code: 'school_insert_failed', details: body.slice(0, 280) };
  }

  const schoolRows = await schoolRes.json();
  const schoolId = Array.isArray(schoolRows) && schoolRows.length > 0 ? schoolRows[0].id as string : null;
  if (!schoolId) {
    return { ok: false, code: 'school_id_missing', details: 'schools INSERT returned no id (empty response or unexpected shape).' };
  }

  // Trial subscription so school billing surfaces work
  const periodStart = new Date();
  const periodEnd = new Date(periodStart);
  periodEnd.setDate(periodEnd.getDate() + 30);

  // Note: school_subscriptions in prod uses `plan` (not plan_code) and
  // `seats_purchased` (not seats). Verified via Supabase MCP 2026-05-17.
  //
  // Subscription failure does NOT block school creation — the school is the
  // critical part. We log the failure and continue so the operator gets a
  // usable demo school even if billing surfaces are temporarily broken.
  const subRes = await fetch(supabaseAdminUrl('school_subscriptions'), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=minimal'),
    body: JSON.stringify({
      school_id: schoolId,
      plan: 'institutional',
      status: 'trial',
      seats_purchased: 50,
      billing_cycle: 'yearly',
      current_period_start: periodStart.toISOString(),
      current_period_end: periodEnd.toISOString(),
      is_demo: true,
    }),
  });
  if (!subRes.ok) {
    console.error('[demo-accounts] school_subscriptions INSERT failed (non-blocking):', await subRes.text());
  }

  // Three seed students under the demo school
  const seedStudents = [
    { name: 'Aanya Sharma',  email: `aanya.${schoolId.slice(0, 8)}@alfanumrik.demo`,  persona: 'high_performer' },
    { name: 'Rohan Verma',   email: `rohan.${schoolId.slice(0, 8)}@alfanumrik.demo`,   persona: 'average' },
    { name: 'Priya Singh',   email: `priya.${schoolId.slice(0, 8)}@alfanumrik.demo`,   persona: 'weak_student' },
  ];

  for (const seed of seedStudents) {
    const userRes = await fetch(`${config.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${config.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: seed.email,
        password: generateSecurePassword('Demo'),
        email_confirm: true,
        user_metadata: { name: seed.name, role: 'student', is_demo_account: true, persona: seed.persona },
      }),
    });
    if (!userRes.ok) continue;
    const authUser = await userRes.json();
    const studentRes = await fetch(supabaseAdminUrl('students'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(buildProfilePayload('student', authUser.id, seed.name, seed.email, { schoolId })),
    });
    if (!studentRes.ok) continue;
    const studentRows = await studentRes.json();
    const studentId = Array.isArray(studentRows) && studentRows.length > 0 ? studentRows[0].id as string : null;
    if (studentId) await provisionDemoStudentSubscription(studentId);
  }

  // Mark the admin's row with school_id
  await fetch(supabaseAdminUrl('admin_users', `auth_user_id=eq.${adminAuthUserId}`), {
    method: 'PATCH',
    headers: supabaseAdminHeaders('return=minimal'),
    body: JSON.stringify({ school_id: schoolId }),
  }).catch(() => {});

  return { ok: true, schoolId };
}

// ---------------------------------------------------------------------------
// GET — List demo accounts
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Phase G.1: read-only list of demo accounts is fine at support level.
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const res = await fetch(
      supabaseAdminUrl('demo_accounts', 'select=*&order=created_at.desc'),
      { method: 'GET', headers: supabaseAdminHeaders() },
    );

    if (!res.ok) {
      const body = await res.text();
      // Surface the real cause to the operator instead of a silent zero.
      const code = res.status === 404 || body.includes('relation') ? 'demo_table_missing' : 'fetch_failed';
      return NextResponse.json(
        { success: false, code, message: `Failed to fetch demo accounts (${res.status})`, details: body.slice(0, 280) },
        { status: 500 },
      );
    }

    const accounts = await res.json();

    const enriched = await Promise.all(
      accounts.map(async (account: Record<string, unknown>) => {
        const role = account.role as DemoRole;
        const table = roleToTable(role);
        const authUserId = account.auth_user_id as string;

        let profileFields = 'id,name,email,is_demo';
        if (table === 'students') {
          profileFields += ',is_active,grade,board,subscription_plan,xp_total,streak_days,account_status,last_active';
        } else if (table === 'teachers') {
          profileFields += ',is_active,school_name,subjects_taught,grades_taught';
        } else if (table === 'admin_users') {
          profileFields = 'id,email,is_active,admin_level,is_demo';
        } else if (table === 'school_admins') {
          profileFields = 'id,name,email,is_active,school_id';
        } else {
          profileFields += ',phone,relationship';
        }

        const profileRes = await fetch(
          supabaseAdminUrl(table, `select=${profileFields}&auth_user_id=eq.${authUserId}&limit=1`),
          { method: 'GET', headers: supabaseAdminHeaders() },
        );

        let profile = null;
        if (profileRes.ok) {
          const profiles = await profileRes.json();
          profile = Array.isArray(profiles) && profiles.length > 0 ? profiles[0] : null;
        }

        return { ...account, profile };
      }),
    );

    return NextResponse.json({ success: true, data: enriched });
  } catch (err) {
    return NextResponse.json(
      { success: false, code: 'internal_error', message: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Create demo account
// ---------------------------------------------------------------------------

// Single source of truth for create input
const demoAccountSchema = z.object({
  role: z.enum(DEMO_ROLES),
  name: z.string().min(1, 'Name is required').max(200),
  email: z.string().email('Valid email is required').max(254),
  persona: z.enum(DEMO_PERSONAS).optional(),
  grade: z.string().regex(/^(6|7|8|9|10|11|12)$/, 'Grade must be a string "6"-"12"').optional(),
  // Phase F.7 follow-up (2026-05-18): stream is required for grade 11/12;
  // optional in the schema so grades 6-10 don't have to send it.
  stream: z.enum(DEMO_STREAMS).optional(),
});

async function createSingleDemoAccount(
  body: unknown,
  auth: AdminAuth,
  ipAddress: string | undefined,
): Promise<NextResponse> {
  const validation = validateBody(demoAccountSchema, body);
  if (!validation.success) return validation.error;

  const { role, name, email, persona, grade, stream } = validation.data;
  const effectivePersona = persona || 'average';

  const config = getSupabaseConfig();
  if (!config) {
    return NextResponse.json(
      { success: false, code: 'config_missing', message: 'Server configuration error' },
      { status: 500 },
    );
  }

  const password = generateSecurePassword('Demo');

  // 1. Create auth user
  const createUserRes = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      'apikey': config.key,
      'Authorization': `Bearer ${config.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { name, role, is_demo_account: true, persona: effectivePersona },
    }),
  });

  if (!createUserRes.ok) {
    const err = await createUserRes.json().catch(() => ({}));
    return NextResponse.json(
      { success: false, code: 'auth_user_failed', message: err.msg || err.message || 'Failed to create auth user' },
      { status: 400 },
    );
  }

  const authUser = await createUserRes.json();
  const authUserId: string = authUser.id;

  // 2. For school_admin: provision the school first so the profile can hold school_id.
  // Caveat: if the subsequent school_admin profile insert fails, the school + its
  // 3 seed students + their subscriptions + auth users are orphaned. They're all
  // flagged is_demo=true and will be reaped by the daily purge cron (Phase F.4
  // migration 20260528000004). Acceptable trade-off vs. a multi-step transactional
  // rollback that would balloon this function.
  let schoolId: string | null = null;
  if (role === 'school_admin') {
    const result = await provisionDemoSchool(authUserId, name);
    if (!result.ok) {
      // Roll back the auth user so the operator can retry with the same email.
      await fetch(`${config.url}/auth/v1/admin/users/${authUserId}`, {
        method: 'DELETE',
        headers: { 'apikey': config.key, 'Authorization': `Bearer ${config.key}` },
      });
      return NextResponse.json(
        { success: false, code: result.code, message: 'Failed to provision demo school', details: result.details },
        { status: 400 },
      );
    }
    schoolId = result.schoolId;
  }

  // 3. Create the role-specific profile row
  const table = roleToTable(role);
  const profileData = buildProfilePayload(role, authUserId, name, email, { grade, stream, schoolId });

  const profileRes = await fetch(supabaseAdminUrl(table), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=representation'),
    body: JSON.stringify(profileData),
  });

  if (!profileRes.ok) {
    const errBody = await profileRes.text();
    // Roll back the auth user
    await fetch(`${config.url}/auth/v1/admin/users/${authUserId}`, {
      method: 'DELETE',
      headers: { 'apikey': config.key, 'Authorization': `Bearer ${config.key}` },
    });
    return NextResponse.json(
      { success: false, code: 'profile_failed', message: `Failed to create ${table} profile`, details: errBody.slice(0, 280) },
      { status: 400 },
    );
  }

  const profileRows = await profileRes.json();
  const profileId = Array.isArray(profileRows) && profileRows.length > 0 ? profileRows[0].id : null;

  // 4. Provision subscription for student demos
  if (role === 'student' && profileId) {
    await provisionDemoStudentSubscription(profileId);
  }

  // 5. Auto-link parent to first active demo student (approved_by must be UUID, not the string 'admin')
  let studentInviteCode: string | null = null;
  if (role === 'parent' && profileId) {
    const demoStudentRes = await fetch(
      supabaseAdminUrl('students', 'select=id,invite_code,name&is_demo=eq.true&is_active=eq.true&limit=1'),
      { method: 'GET', headers: supabaseAdminHeaders() },
    );
    if (demoStudentRes.ok) {
      const demoStudents = await demoStudentRes.json();
      if (Array.isArray(demoStudents) && demoStudents.length > 0) {
        const demoStudent = demoStudents[0];
        studentInviteCode = demoStudent.invite_code;
        const linkRes = await fetch(supabaseAdminUrl('guardian_student_links'), {
          method: 'POST',
          headers: supabaseAdminHeaders('return=minimal'),
          body: JSON.stringify({
            guardian_id: profileId,
            student_id: demoStudent.id,
            status: 'active',
            permission_level: 'view',
            is_verified: true,
            linked_at: new Date().toISOString(),
            initiated_by: auth.userId,
            approved_by: auth.userId,
            approved_at: new Date().toISOString(),
          }),
        });
        if (!linkRes.ok) {
          console.error('[demo-accounts] guardian_student_links insert failed:', await linkRes.text());
        }
      }
    }
  }

  // 6. demo_accounts registry row
  const demoAccountRes = await fetch(supabaseAdminUrl('demo_accounts'), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=representation'),
    body: JSON.stringify({
      auth_user_id: authUserId,
      role,
      persona: effectivePersona,
      display_name: name,
      email,
      school_id: schoolId,
      created_by: auth.userId,
      is_active: true,
    }),
  });

  if (!demoAccountRes.ok) {
    const errBody = await demoAccountRes.text();
    // Roll back profile + auth user
    await fetch(supabaseAdminUrl(table, `auth_user_id=eq.${authUserId}`), {
      method: 'DELETE',
      headers: supabaseAdminHeaders('return=minimal'),
    });
    await fetch(`${config.url}/auth/v1/admin/users/${authUserId}`, {
      method: 'DELETE',
      headers: { 'apikey': config.key, 'Authorization': `Bearer ${config.key}` },
    });
    return NextResponse.json(
      { success: false, code: 'registry_failed', message: 'Failed to create demo account record', details: errBody.slice(0, 280) },
      { status: 500 },
    );
  }

  const demoAccountRows = await demoAccountRes.json();
  const demoAccountId = Array.isArray(demoAccountRows) && demoAccountRows.length > 0 ? demoAccountRows[0].id : null;

  // 7. Persona seed for students
  if (demoAccountId && role === 'student') {
    await seedStudentDemoData(authUserId, effectivePersona, demoAccountId);
  }

  // 8. Audit
  await logAdminAudit(
    auth,
    'create_demo_account',
    'demo_accounts',
    demoAccountId || authUserId,
    { role, persona: effectivePersona, name, email, school_id: schoolId, is_demo: true },
    ipAddress,
  );

  const routing = loginRoutingForRole(role);

  return NextResponse.json({
    success: true,
    data: {
      demo_account_id: demoAccountId,
      profile_id: profileId,
      auth_user_id: authUserId,
      school_id: schoolId,
      email,
      password,
      role,
      persona: effectivePersona,
      // Always surface login routing so the demo modal / Slack DM / ops email
      // can point the operator to the correct sign-in door. school_admin
      // demos in particular were silently being sent to /super-admin/login
      // and bouncing with ADMIN_NOT_FOUND — see Phase G follow-up 2026-05-20.
      login_url: routing.login_url,
      login_instructions: routing.login_instructions,
      ...(role === 'parent' && studentInviteCode
        ? { student_invite_code: studentInviteCode }
        : {}),
    },
  });
}

export async function POST(request: NextRequest) {
  // Phase G.1: creating accounts (esp. super_admin / school_admin) is a
  // high-blast-radius mutation. super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;

    // Bulk "create-set" — student + teacher + parent + school_admin + super_admin
    if (body.action === 'create-set') {
      const timestamp = Date.now();
      const demoSet: Array<{ role: DemoRole; name: string; email: string; persona?: string }> = [
        { role: 'student',      name: 'Demo Student',      email: `demo.student.${timestamp}@alfanumrik.demo`,      persona: 'average' },
        { role: 'teacher',      name: 'Demo Teacher',      email: `demo.teacher.${timestamp}@alfanumrik.demo`,      persona: 'average' },
        { role: 'parent',       name: 'Demo Parent',       email: `demo.parent.${timestamp}@alfanumrik.demo`,       persona: 'average' },
        { role: 'school_admin', name: 'Demo Principal',    email: `demo.principal.${timestamp}@alfanumrik.demo`,    persona: 'average' },
        { role: 'super_admin',  name: 'Demo Super-Admin',  email: `demo.superadmin.${timestamp}@alfanumrik.demo`,   persona: 'average' },
      ];

      const results: unknown[] = [];
      for (const item of demoSet) {
        const res = await createSingleDemoAccount(item, auth, ipAddress);
        // Forward only the data block; skip failures silently in bulk mode but log them
        if (res.status === 200) {
          const payload = await res.json();
          if (payload.success) results.push({ ...payload.data, name: item.name });
        } else {
          const err = await res.json().catch(() => ({}));
          console.error(`[demo-accounts] create-set failed for ${item.role}:`, err);
        }
      }

      await logAdminAudit(auth, 'create_demo_set', 'demo_accounts', 'bulk', { count: results.length }, ipAddress);
      return NextResponse.json({ success: true, data: results });
    }

    // Single create
    return await createSingleDemoAccount(body, auth, ipAddress);
  } catch (err) {
    return NextResponse.json(
      { success: false, code: 'internal_error', message: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// PUT — Update demo account (reset / activate / deactivate / toggle / regenerate)
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  // Phase G.1: reset / regenerate / toggle on demo accounts is a mutation
  // that can clear customer-visible (in sales walk-throughs) demo state.
  // admin level is the floor — super_admin not required, but support is too low.
  const auth = await authorizeAdmin(request, 'admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;

    // Bulk reset-all
    if (body.action === 'reset-all') {
      const config = getSupabaseConfig();
      if (!config) {
        return NextResponse.json(
          { success: false, code: 'config_missing', message: 'Server configuration error' },
          { status: 500 },
        );
      }

      const allRes = await fetch(
        supabaseAdminUrl('demo_accounts', 'select=id,role,persona,auth_user_id&is_active=eq.true'),
        { method: 'GET', headers: supabaseAdminHeaders() },
      );

      if (!allRes.ok) {
        return NextResponse.json(
          { success: false, code: 'fetch_failed', message: 'Failed to fetch demo accounts' },
          { status: 500 },
        );
      }

      const allAccounts = await allRes.json();
      const resetResults: Array<{ id: string; role: string; reset: boolean }> = [];

      for (const account of (allAccounts || [])) {
        const rpcRes = await fetch(`${config.url}/rest/v1/rpc/reset_demo_account`, {
          method: 'POST',
          headers: supabaseAdminHeaders('return=representation'),
          body: JSON.stringify({ p_demo_account_id: account.id }),
        });

        await fetch(
          supabaseAdminUrl('demo_seed_data', `demo_account_id=eq.${account.id}`),
          { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') },
        );

        if (account.role === 'student') {
          await seedStudentDemoData(account.auth_user_id, account.persona || 'average', account.id);
        }

        resetResults.push({ id: account.id, role: account.role, reset: rpcRes.ok });
      }

      const failures = resetResults.filter(r => !r.reset).length;
      await logAdminAudit(auth, 'reset_all_demo_accounts', 'demo_accounts', 'bulk', { count: resetResults.length, failures }, ipAddress);

      return NextResponse.json({
        success: failures === 0,
        data: { reset_count: resetResults.length, failures, results: resetResults },
      });
    }

    const { id, action } = body as { id?: string; action?: string };
    if (!id || !isValidUUID(id)) {
      return NextResponse.json(
        { success: false, code: 'invalid_id', message: 'Valid demo account id is required' },
        { status: 400 },
      );
    }

    const validActions = ['reset', 'activate', 'deactivate', 'toggle', 'regenerate'];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { success: false, code: 'invalid_action', message: `action must be one of: ${validActions.join(', ')}` },
        { status: 400 },
      );
    }

    const config = getSupabaseConfig();
    if (!config) {
      return NextResponse.json(
        { success: false, code: 'config_missing', message: 'Server configuration error' },
        { status: 500 },
      );
    }

    const accountRes = await fetch(
      supabaseAdminUrl('demo_accounts', `select=*&id=eq.${id}&limit=1`),
      { method: 'GET', headers: supabaseAdminHeaders() },
    );
    if (!accountRes.ok) {
      return NextResponse.json(
        { success: false, code: 'fetch_failed', message: 'Failed to look up demo account' },
        { status: 500 },
      );
    }
    const accountRows = await accountRes.json();
    if (!Array.isArray(accountRows) || accountRows.length === 0) {
      return NextResponse.json(
        { success: false, code: 'not_found', message: 'Demo account not found' },
        { status: 404 },
      );
    }
    const account = accountRows[0];

    // Resolve toggle to activate or deactivate
    let resolvedAction = action;
    if (action === 'toggle') resolvedAction = account.is_active ? 'deactivate' : 'activate';

    if (resolvedAction === 'activate' || resolvedAction === 'deactivate') {
      const newStatus = resolvedAction === 'activate';
      const patchRes = await fetch(
        supabaseAdminUrl('demo_accounts', `id=eq.${id}`),
        {
          method: 'PATCH',
          headers: supabaseAdminHeaders('return=minimal'),
          body: JSON.stringify({ is_active: newStatus }),
        },
      );
      if (!patchRes.ok) {
        return NextResponse.json(
          { success: false, code: 'patch_failed', message: `Failed to ${resolvedAction} demo account` },
          { status: 500 },
        );
      }
      await logAdminAudit(auth, `${resolvedAction}_demo_account`, 'demo_accounts', id, { role: account.role, email: account.email }, ipAddress);
      return NextResponse.json({ success: true, data: { id, action: resolvedAction, is_active: newStatus } });
    }

    if (resolvedAction === 'reset' || resolvedAction === 'regenerate') {
      const rpcRes = await fetch(`${config.url}/rest/v1/rpc/reset_demo_account`, {
        method: 'POST',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({ p_demo_account_id: id }),
      });
      if (!rpcRes.ok) {
        const errBody = await rpcRes.text();
        return NextResponse.json(
          { success: false, code: 'rpc_failed', message: 'Failed to reset demo account', details: errBody.slice(0, 280) },
          { status: 500 },
        );
      }
      const rpcResult = await rpcRes.json();

      await fetch(
        supabaseAdminUrl('demo_seed_data', `demo_account_id=eq.${id}`),
        { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') },
      );

      let seedPersona = account.persona;
      if (resolvedAction === 'regenerate' && account.role === 'student') {
        // Cycle to a different persona deterministically (no Math.random)
        const personas = DEMO_PERSONAS.filter(p => p !== normalisePersona(account.persona));
        if (personas.length > 0) {
          // Use a hash of the demo account id for deterministic rotation
          const idx = Math.abs(id.charCodeAt(0) + id.charCodeAt(id.length - 1)) % personas.length;
          seedPersona = personas[idx];
          await fetch(
            supabaseAdminUrl('demo_accounts', `id=eq.${id}`),
            {
              method: 'PATCH',
              headers: supabaseAdminHeaders('return=minimal'),
              body: JSON.stringify({ persona: seedPersona }),
            },
          );
        }
      }

      if (account.role === 'student') {
        await seedStudentDemoData(account.auth_user_id, seedPersona, id);
      }

      await logAdminAudit(auth, `${resolvedAction}_demo_account`, 'demo_accounts', id, { role: account.role, email: account.email, persona: seedPersona }, ipAddress);

      return NextResponse.json({
        success: true,
        data: { id, action: resolvedAction, persona: seedPersona, reset_result: rpcResult },
      });
    }

    return NextResponse.json(
      { success: false, code: 'unknown_action', message: 'Unknown action' },
      { status: 400 },
    );
  } catch (err) {
    return NextResponse.json(
      { success: false, code: 'internal_error', message: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — Delete demo account (cascades through profile + auth user)
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  // Phase G.1: delete (cascades to schools/students/subscriptions for
  // school_admin demos) — super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id || !isValidUUID(id)) {
      return NextResponse.json(
        { success: false, code: 'invalid_id', message: 'Valid demo account id query param is required' },
        { status: 400 },
      );
    }

    const config = getSupabaseConfig();
    if (!config) {
      return NextResponse.json(
        { success: false, code: 'config_missing', message: 'Server configuration error' },
        { status: 500 },
      );
    }

    const accountRes = await fetch(
      supabaseAdminUrl('demo_accounts', `select=*&id=eq.${id}&limit=1`),
      { method: 'GET', headers: supabaseAdminHeaders() },
    );
    if (!accountRes.ok) {
      return NextResponse.json(
        { success: false, code: 'fetch_failed', message: 'Failed to look up demo account' },
        { status: 500 },
      );
    }
    const accountRows = await accountRes.json();
    if (!Array.isArray(accountRows) || accountRows.length === 0) {
      return NextResponse.json(
        { success: false, code: 'not_found', message: 'Demo account not found' },
        { status: 404 },
      );
    }
    const account = accountRows[0];
    const role = account.role as DemoRole;
    const table = roleToTable(role);
    const authUserId = account.auth_user_id;
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;

    // For school_admin: cascade-delete the demo school + everything under it.
    //
    // NOTE: PostgREST does NOT support `student_id=in.(select ...)` — that
    // syntax silently no-ops (or 400s) because PostgREST expects a literal
    // CSV inside `in.(...)`. Two-step: GET the ids, then DELETE against the
    // CSV. Wrapped in .catch(() => {}) like the rest of this best-effort
    // cascade so a transient failure doesn't break the parent delete.
    if (role === 'school_admin' && account.school_id) {
      // Step 1: collect demo-student ids under this school
      let demoStudentIds: string[] = [];
      try {
        const idsRes = await fetch(
          supabaseAdminUrl('students', `select=id&school_id=eq.${account.school_id}&is_demo=eq.true`),
          { method: 'GET', headers: supabaseAdminHeaders() },
        );
        if (idsRes.ok) {
          const idRows = await idsRes.json();
          demoStudentIds = Array.isArray(idRows)
            ? idRows.map((r: { id?: string }) => r.id).filter((x): x is string => typeof x === 'string')
            : [];
        } else {
          console.error('[demo-accounts] Failed to list demo students for school cascade:', account.school_id, idsRes.status);
        }
      } catch (err) {
        console.error('[demo-accounts] Exception listing demo students for school cascade:', err);
      }

      // Step 2: delete their demo subscriptions (only if we have ids)
      if (demoStudentIds.length > 0) {
        const csv = demoStudentIds.join(',');
        await fetch(
          supabaseAdminUrl('student_subscriptions', `student_id=in.(${csv})&is_demo=eq.true`),
          { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') },
        ).catch(() => {});
      }

      await fetch(supabaseAdminUrl('students', `school_id=eq.${account.school_id}&is_demo=eq.true`), {
        method: 'DELETE', headers: supabaseAdminHeaders('return=minimal'),
      }).catch(() => {});
      await fetch(supabaseAdminUrl('school_subscriptions', `school_id=eq.${account.school_id}&is_demo=eq.true`), {
        method: 'DELETE', headers: supabaseAdminHeaders('return=minimal'),
      }).catch(() => {});
      await fetch(supabaseAdminUrl('schools', `id=eq.${account.school_id}&is_demo=eq.true`), {
        method: 'DELETE', headers: supabaseAdminHeaders('return=minimal'),
      }).catch(() => {});
    }

    // For student: also wipe their demo subscription. Same PostgREST
    // `in.(select ...)` caveat — replace with two-step.
    if (role === 'student' && account.auth_user_id) {
      let studentIds: string[] = [];
      try {
        const idsRes = await fetch(
          supabaseAdminUrl('students', `select=id&auth_user_id=eq.${authUserId}`),
          { method: 'GET', headers: supabaseAdminHeaders() },
        );
        if (idsRes.ok) {
          const idRows = await idsRes.json();
          studentIds = Array.isArray(idRows)
            ? idRows.map((r: { id?: string }) => r.id).filter((x): x is string => typeof x === 'string')
            : [];
        } else {
          console.error('[demo-accounts] Failed to list student ids for demo-subscription cleanup:', authUserId, idsRes.status);
        }
      } catch (err) {
        console.error('[demo-accounts] Exception listing student ids for demo-subscription cleanup:', err);
      }

      if (studentIds.length > 0) {
        const csv = studentIds.join(',');
        await fetch(
          supabaseAdminUrl('student_subscriptions', `student_id=in.(${csv})&is_demo=eq.true`),
          { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') },
        ).catch(() => {});
      }
    }

    await fetch(
      supabaseAdminUrl(table, `auth_user_id=eq.${authUserId}`),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=minimal'),
        body: JSON.stringify({ is_demo: false }),
      },
    );

    await fetch(
      supabaseAdminUrl('demo_seed_data', `demo_account_id=eq.${id}`),
      { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') },
    );

    await fetch(
      supabaseAdminUrl('demo_accounts', `id=eq.${id}`),
      { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') },
    );

    await fetch(
      supabaseAdminUrl(table, `auth_user_id=eq.${authUserId}`),
      { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') },
    );

    const deleteAuthRes = await fetch(`${config.url}/auth/v1/admin/users/${authUserId}`, {
      method: 'DELETE',
      headers: { 'apikey': config.key, 'Authorization': `Bearer ${config.key}` },
    });
    if (!deleteAuthRes.ok) {
      console.error('[demo-accounts] Failed to delete auth user:', authUserId);
    }

    await logAdminAudit(
      auth,
      'delete_demo_account',
      'demo_accounts',
      id,
      { role: account.role, email: account.email, auth_user_id: authUserId, school_id: account.school_id },
      ipAddress,
    );

    return NextResponse.json({
      success: true,
      data: { id, auth_user_id: authUserId, deleted: true },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, code: 'internal_error', message: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
