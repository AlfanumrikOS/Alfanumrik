import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

const DEMO_PASSWORD = 'DemoAlfa2026!';

// ---------------------------------------------------------------------------
// GET — List all demo accounts
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const rpcRes = await fetch(`${url}/rest/v1/rpc/get_demo_accounts`, {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    if (!rpcRes.ok) {
      const err = await rpcRes.json().catch(() => ({}));
      return NextResponse.json({ success: false, error: err.message || 'Failed to fetch demo accounts' }, { status: 400 });
    }

    const data = await rpcRes.json();
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — Create a linked set of demo accounts (student + teacher + parent)
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json().catch(() => ({}));
    const scenario: string = body.scenario || 'average';

    const validScenarios = ['weak', 'average', 'high_performer'];
    if (!validScenarios.includes(scenario)) {
      return NextResponse.json(
        { success: false, error: `Invalid scenario. Must be one of: ${validScenarios.join(', ')}` },
        { status: 400 },
      );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const authHeaders = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };

    // Unique suffix so multiple demo sets can coexist
    const suffix = Date.now().toString(36);

    // --- 1. Create three auth users ---------------------------------------------------
    const accounts = [
      { role: 'student', email: `demo-student-${suffix}@alfanumrik.com`, name: 'Demo Student' },
      { role: 'teacher', email: `demo-teacher-${suffix}@alfanumrik.com`, name: 'Demo Teacher' },
      { role: 'parent',  email: `demo-parent-${suffix}@alfanumrik.com`,  name: 'Demo Parent' },
    ];

    const createdAuthUsers: Record<string, { id: string; email: string }> = {};

    for (const acct of accounts) {
      const res = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          email: acct.email,
          password: DEMO_PASSWORD,
          email_confirm: true,
          user_metadata: { name: acct.name, role: acct.role, is_demo: true },
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        // Clean up any already-created auth users
        for (const uid of Object.values(createdAuthUsers)) {
          await fetch(`${url}/auth/v1/admin/users/${uid.id}`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
        }
        return NextResponse.json(
          { success: false, error: `Failed to create ${acct.role} auth user: ${err.msg || err.message || 'unknown'}` },
          { status: 400 },
        );
      }

      const userData = await res.json();
      createdAuthUsers[acct.role] = { id: userData.id, email: acct.email };
    }

    const studentAuthId = createdAuthUsers['student'].id;
    const teacherAuthId = createdAuthUsers['teacher'].id;
    const parentAuthId  = createdAuthUsers['parent'].id;

    // Helper to clean up everything on failure
    const cleanupAll = async () => {
      for (const uid of Object.values(createdAuthUsers)) {
        await fetch(`${url}/auth/v1/admin/users/${uid.id}`, { method: 'DELETE', headers: authHeaders }).catch(() => {});
      }
    };

    // --- 2. Create student profile ----------------------------------------------------
    const studentProfileRes = await fetch(supabaseAdminUrl('students'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({
        auth_user_id: studentAuthId,
        name: 'Demo Student',
        email: createdAuthUsers['student'].email,
        grade: '10',
        board: 'CBSE',
        subscription_plan: 'pro',
        is_demo: true,
        is_active: true,
        xp_total: 0,
        streak_days: 0,
        account_status: 'demo',
      }),
    });

    if (!studentProfileRes.ok) {
      const err = await studentProfileRes.json().catch(() => ({}));
      await cleanupAll();
      return NextResponse.json({ success: false, error: `Failed to create student profile: ${err.message || 'unknown'}` }, { status: 400 });
    }

    const studentProfile = (await studentProfileRes.json())[0];
    const studentId = studentProfile.id;

    // --- 3. Create teacher profile ----------------------------------------------------
    const teacherProfileRes = await fetch(supabaseAdminUrl('teachers'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({
        auth_user_id: teacherAuthId,
        name: 'Demo Teacher',
        email: createdAuthUsers['teacher'].email,
        is_demo: true,
        is_active: true,
      }),
    });

    if (!teacherProfileRes.ok) {
      const err = await teacherProfileRes.json().catch(() => ({}));
      await cleanupAll();
      return NextResponse.json({ success: false, error: `Failed to create teacher profile: ${err.message || 'unknown'}` }, { status: 400 });
    }

    const teacherProfile = (await teacherProfileRes.json())[0];
    const teacherId = teacherProfile.id;

    // --- 4. Create guardian profile ---------------------------------------------------
    const guardianProfileRes = await fetch(supabaseAdminUrl('guardians'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({
        auth_user_id: parentAuthId,
        name: 'Demo Parent',
        email: createdAuthUsers['parent'].email,
        is_demo: true,
        is_active: true,
      }),
    });

    if (!guardianProfileRes.ok) {
      const err = await guardianProfileRes.json().catch(() => ({}));
      await cleanupAll();
      return NextResponse.json({ success: false, error: `Failed to create guardian profile: ${err.message || 'unknown'}` }, { status: 400 });
    }

    const guardianProfile = (await guardianProfileRes.json())[0];
    const guardianId = guardianProfile.id;

    // --- 5. Create class and enroll demo student under demo teacher -------------------
    const classRes = await fetch(supabaseAdminUrl('classes'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({
        teacher_id: teacherId,
        name: `Demo Class ${suffix}`,
        grade: '10',
        board: 'CBSE',
        is_active: true,
      }),
    });

    if (!classRes.ok) {
      const err = await classRes.json().catch(() => ({}));
      await cleanupAll();
      return NextResponse.json({ success: false, error: `Failed to create class: ${err.message || 'unknown'}` }, { status: 400 });
    }

    const classData = (await classRes.json())[0];
    const classId = classData.id;

    const enrollRes = await fetch(supabaseAdminUrl('class_enrollments'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=minimal'),
      body: JSON.stringify({
        class_id: classId,
        student_id: studentId,
      }),
    });

    if (!enrollRes.ok) {
      const err = await enrollRes.json().catch(() => ({}));
      await cleanupAll();
      return NextResponse.json({ success: false, error: `Failed to enroll student: ${err.message || 'unknown'}` }, { status: 400 });
    }

    // --- 6. Link parent to student via guardian_student_links -------------------------
    const linkRes = await fetch(supabaseAdminUrl('guardian_student_links'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=minimal'),
      body: JSON.stringify({
        guardian_id: guardianId,
        student_id: studentId,
        status: 'approved',
      }),
    });

    if (!linkRes.ok) {
      const err = await linkRes.json().catch(() => ({}));
      await cleanupAll();
      return NextResponse.json({ success: false, error: `Failed to link parent to student: ${err.message || 'unknown'}` }, { status: 400 });
    }

    // --- 7. Seed demo student data via RPC -------------------------------------------
    const seedRes = await fetch(`${url}/rest/v1/rpc/seed_demo_student_data`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ p_student_id: studentId, p_scenario: scenario }),
    });

    if (!seedRes.ok) {
      const err = await seedRes.json().catch(() => ({}));
      // Non-fatal: accounts exist, seed data just did not populate
      console.error('[demo-accounts] seed_demo_student_data failed:', err.message || err);
    }

    // --- 8. Audit log ----------------------------------------------------------------
    await logAdminAudit(
      auth, 'create_demo_accounts', 'demo_set', studentId,
      { scenario, student_email: createdAuthUsers['student'].email, teacher_email: createdAuthUsers['teacher'].email, parent_email: createdAuthUsers['parent'].email },
      request.headers.get('x-forwarded-for') || undefined,
    );

    return NextResponse.json({
      success: true,
      data: {
        scenario,
        password: DEMO_PASSWORD,
        student: { auth_user_id: studentAuthId, profile_id: studentId, email: createdAuthUsers['student'].email },
        teacher: { auth_user_id: teacherAuthId, profile_id: teacherId, email: createdAuthUsers['teacher'].email },
        parent:  { auth_user_id: parentAuthId,  profile_id: guardianId, email: createdAuthUsers['parent'].email },
        class_id: classId,
      },
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT — Reset or re-seed demo account data
// ---------------------------------------------------------------------------
export async function PUT(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { action, student_id, scenario } = body as {
      action?: string;
      student_id?: string;
      scenario?: string;
    };

    if (!action || !['reset', 'seed'].includes(action)) {
      return NextResponse.json({ success: false, error: 'action must be "reset" or "seed"' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const authHeaders = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };

    if (action === 'reset') {
      const rpcBody: Record<string, unknown> = {};
      if (student_id) rpcBody.p_student_id = student_id;

      const res = await fetch(`${url}/rest/v1/rpc/reset_demo_student`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(rpcBody),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return NextResponse.json({ success: false, error: err.message || 'Reset failed' }, { status: 400 });
      }

      const data = await res.json();

      await logAdminAudit(
        auth, 'reset_demo_accounts', 'demo_set', student_id || 'all',
        { action },
        request.headers.get('x-forwarded-for') || undefined,
      );

      return NextResponse.json({ success: true, data });
    }

    // action === 'seed'
    if (!student_id) {
      return NextResponse.json({ success: false, error: 'student_id is required for seed action' }, { status: 400 });
    }

    const seedScenario = scenario || 'average';
    const res = await fetch(`${url}/rest/v1/rpc/seed_demo_student_data`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ p_student_id: student_id, p_scenario: seedScenario }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json({ success: false, error: err.message || 'Seed failed' }, { status: 400 });
    }

    const data = await res.json();

    await logAdminAudit(
      auth, 'seed_demo_accounts', 'demo_set', student_id,
      { action, scenario: seedScenario },
      request.headers.get('x-forwarded-for') || undefined,
    );

    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove all demo accounts
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const authHeaders = { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' };
    const deleted: { students: number; teachers: number; guardians: number; auth_users: number } = {
      students: 0, teachers: 0, guardians: 0, auth_users: 0,
    };

    // Collect auth_user_ids before deleting profiles
    const authUserIds: string[] = [];

    // --- Fetch demo students ----------------------------------------------------------
    const studentsRes = await fetch(supabaseAdminUrl('students', 'select=id,auth_user_id&is_demo=eq.true'), {
      headers: supabaseAdminHeaders(),
    });
    const students = studentsRes.ok ? await studentsRes.json() : [];
    for (const s of students) {
      if (s.auth_user_id) authUserIds.push(s.auth_user_id);
    }

    // --- Fetch demo teachers ----------------------------------------------------------
    const teachersRes = await fetch(supabaseAdminUrl('teachers', 'select=id,auth_user_id&is_demo=eq.true'), {
      headers: supabaseAdminHeaders(),
    });
    const teachers = teachersRes.ok ? await teachersRes.json() : [];
    for (const t of teachers) {
      if (t.auth_user_id) authUserIds.push(t.auth_user_id);
    }

    // --- Fetch demo guardians ---------------------------------------------------------
    const guardiansRes = await fetch(supabaseAdminUrl('guardians', 'select=id,auth_user_id&is_demo=eq.true'), {
      headers: supabaseAdminHeaders(),
    });
    const guardians = guardiansRes.ok ? await guardiansRes.json() : [];
    for (const g of guardians) {
      if (g.auth_user_id) authUserIds.push(g.auth_user_id);
    }

    // --- Delete profile rows (CASCADE will clean up enrollments, links, etc.) ---------
    if (students.length > 0) {
      const delRes = await fetch(supabaseAdminUrl('students', 'is_demo=eq.true'), {
        method: 'DELETE',
        headers: supabaseAdminHeaders('return=representation'),
      });
      if (delRes.ok) {
        const rows = await delRes.json();
        deleted.students = Array.isArray(rows) ? rows.length : 0;
      }
    }

    if (teachers.length > 0) {
      const delRes = await fetch(supabaseAdminUrl('teachers', 'is_demo=eq.true'), {
        method: 'DELETE',
        headers: supabaseAdminHeaders('return=representation'),
      });
      if (delRes.ok) {
        const rows = await delRes.json();
        deleted.teachers = Array.isArray(rows) ? rows.length : 0;
      }
    }

    if (guardians.length > 0) {
      const delRes = await fetch(supabaseAdminUrl('guardians', 'is_demo=eq.true'), {
        method: 'DELETE',
        headers: supabaseAdminHeaders('return=representation'),
      });
      if (delRes.ok) {
        const rows = await delRes.json();
        deleted.guardians = Array.isArray(rows) ? rows.length : 0;
      }
    }

    // --- Delete auth users ------------------------------------------------------------
    for (const authUserId of authUserIds) {
      const delRes = await fetch(`${url}/auth/v1/admin/users/${authUserId}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      if (delRes.ok) deleted.auth_users++;
    }

    await logAdminAudit(
      auth, 'delete_demo_accounts', 'demo_set', 'all',
      { deleted },
      request.headers.get('x-forwarded-for') || undefined,
    );

    return NextResponse.json({ success: true, data: { deleted } });
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
