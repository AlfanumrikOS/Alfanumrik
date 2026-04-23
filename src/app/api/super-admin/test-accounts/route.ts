import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { role, name, email } = await request.json();
    if (!role || !name || !email) {
      return NextResponse.json({ error: 'role, name, and email are required' }, { status: 400 });
    }

    const validRoles = ['student', 'teacher', 'parent'];
    if (!validRoles.includes(role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` }, { status: 400 });
    }

    // Generate a random password
    const password = `Test${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 100)}`;

    // Create auth user via Supabase Admin API
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const createUserRes = await fetch(`${url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, role, is_test_account: true },
      }),
    });

    if (!createUserRes.ok) {
      const err = await createUserRes.json().catch(() => ({}));
      return NextResponse.json({ error: err.msg || err.message || 'Failed to create auth user' }, { status: 400 });
    }

    const authUser = await createUserRes.json();
    const authUserId = authUser.id;

    // Create profile record in the appropriate table
    const table = role === 'teacher' ? 'identity.teachers' : role === 'parent' ? 'identity.guardians' : 'identity.students';
    const profileData: Record<string, unknown> = {
      auth_user_id: authUserId,
      name,
      email,
    };

    if (role === 'student') {
      profileData.is_active = true;
      profileData.is_demo = true;
      profileData.grade = '10';
      profileData.board = 'CBSE';
      profileData.subscription_plan = 'free';
      profileData.xp_total = 0;
      profileData.streak_days = 0;
      profileData.account_status = 'test';
    } else if (role === 'teacher') {
      profileData.is_active = true;
      profileData.is_demo = true;
    } else {
      // parent role maps to guardians table which does NOT have is_active column
      profileData.is_demo = true;
    }

    const profileRes = await fetch(supabaseAdminUrl(table), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(profileData),
    });

    if (!profileRes.ok) {
      const err = await profileRes.json().catch(() => ({}));
      // Clean up auth user if profile creation fails
      await fetch(`${url}/auth/v1/admin/users/${authUserId}`, {
        method: 'DELETE',
        headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
      });
      return NextResponse.json({ error: err.message || 'Failed to create profile' }, { status: 400 });
    }

    // Log audit
    await logAdminAudit(
      auth, 'create_test_account', table, authUserId,
      { role, name, email, is_test: true },
      request.headers.get('x-forwarded-for') || undefined
    );

    return NextResponse.json({
      message: `Test ${role} account created`,
      auth_user_id: authUserId,
      email,
      password,
      role,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
