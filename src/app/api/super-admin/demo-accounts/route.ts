import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl, isValidUUID } from '../../../../lib/admin-auth';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

function generatePassword(): string {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const number = Math.floor(Math.random() * 900) + 100;
  return `Demo${randomPart}!${number}`;
}

function roleToTable(role: string): string {
  if (role === 'teacher') return 'teachers';
  if (role === 'parent') return 'guardians';
  return 'students';
}

/** Seed demo data onto a student profile based on persona. */
async function seedDemoData(
  authUserId: string,
  role: string,
  persona: string,
  demoAccountId: string
): Promise<void> {
  if (role !== 'student') return;

  const personaProfiles: Record<string, { xp_total: number; streak_days: number }> = {
    high_performer: { xp_total: 2500, streak_days: 45 },
    average: { xp_total: 800, streak_days: 12 },
    weak: { xp_total: 150, streak_days: 3 },
  };

  const profile = personaProfiles[persona] || personaProfiles.average;

  // Update student profile with persona stats
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
    }
  );

  if (!patchRes.ok) {
    console.error('[demo-accounts] Failed to seed student profile:', await patchRes.text());
  }

  // Store seed snapshot in demo_seed_data for future resets
  await fetch(supabaseAdminUrl('demo_seed_data'), {
    method: 'POST',
    headers: supabaseAdminHeaders('return=minimal'),
    body: JSON.stringify({
      demo_account_id: demoAccountId,
      data_type: 'student_profile',
      seed_data: { persona, ...profile },
    }),
  });
}

// ---------------------------------------------------------------------------
// GET - List demo accounts
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    // Fetch all demo accounts
    const res = await fetch(
      supabaseAdminUrl('demo_accounts', 'select=*&order=created_at.desc'),
      { method: 'GET', headers: supabaseAdminHeaders() }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return NextResponse.json({ success: false, error: err.message || 'Failed to fetch demo accounts' }, { status: 500 });
    }

    const accounts = await res.json();

    // Enrich each account with profile data from the role-appropriate table
    const enriched = await Promise.all(
      accounts.map(async (account: Record<string, unknown>) => {
        const table = roleToTable(account.role as string);
        const authUserId = account.auth_user_id as string;

        let profileFields = 'id,name,email,is_active,is_demo_user';
        if (table === 'students') {
          profileFields += ',grade,board,subscription_plan,xp_total,streak_days,account_status,last_active';
        } else if (table === 'teachers') {
          profileFields += ',school_name,subjects_taught,grades_taught';
        } else {
          profileFields += ',phone,relationship';
        }

        const profileRes = await fetch(
          supabaseAdminUrl(table, `select=${profileFields}&auth_user_id=eq.${authUserId}&limit=1`),
          { method: 'GET', headers: supabaseAdminHeaders() }
        );

        let profile = null;
        if (profileRes.ok) {
          const profiles = await profileRes.json();
          profile = Array.isArray(profiles) && profiles.length > 0 ? profiles[0] : null;
        }

        return { ...account, profile };
      })
    );

    return NextResponse.json({ success: true, data: enriched });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// POST - Create demo account
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { role, persona, name, email } = body as {
      role?: string;
      persona?: string;
      name?: string;
      email?: string;
    };

    // Validate required fields
    if (!role || !name || !email) {
      return NextResponse.json({ success: false, error: 'role, name, and email are required' }, { status: 400 });
    }

    const validRoles = ['student', 'teacher', 'parent'];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` },
        { status: 400 }
      );
    }

    const validPersonas = ['weak', 'average', 'high_performer'];
    const effectivePersona = persona && validPersonas.includes(persona) ? persona : 'average';

    const config = getSupabaseConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    const password = generatePassword();

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
        { success: false, error: err.msg || err.message || 'Failed to create auth user' },
        { status: 400 }
      );
    }

    const authUser = await createUserRes.json();
    const authUserId = authUser.id;

    // 2. Create profile in role-appropriate table
    const table = roleToTable(role);
    const profileData: Record<string, unknown> = {
      auth_user_id: authUserId,
      name,
      email,
      is_active: true,
      is_demo_user: true,
    };

    if (role === 'student') {
      profileData.grade = 'Grade 10'; // P5: grade must be string, "Grade X" format
      profileData.board = 'CBSE';
      profileData.subscription_plan = 'unlimited';
      profileData.account_status = 'demo';
      profileData.xp_total = 0;
      profileData.streak_days = 0;
      profileData.preferred_language = 'en';
      profileData.preferred_subject = 'Mathematics';
    } else if (role === 'teacher') {
      profileData.school_name = 'Demo School - Delhi Public School';
      profileData.subjects_taught = ['Mathematics', 'Science'];
      profileData.grades_taught = ['Grade 10', 'Grade 11', 'Grade 12'];
      profileData.board = 'CBSE';
      profileData.preferred_language = 'en';
      profileData.is_verified = true;
      profileData.onboarding_completed = true;
    } else {
      // parent (guardian)
      profileData.phone = '+919876543210';
      profileData.relationship = 'parent';
      profileData.preferred_language = 'en';
      profileData.onboarding_completed = true;
    }

    const profileRes = await fetch(supabaseAdminUrl(table), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(profileData),
    });

    if (!profileRes.ok) {
      const err = await profileRes.json().catch(() => ({}));
      // Clean up auth user on profile creation failure
      await fetch(`${config.url}/auth/v1/admin/users/${authUserId}`, {
        method: 'DELETE',
        headers: { 'apikey': config.key, 'Authorization': `Bearer ${config.key}` },
      });
      return NextResponse.json(
        { success: false, error: err.message || 'Failed to create profile' },
        { status: 400 }
      );
    }

    const profileRows = await profileRes.json();
    const profileId = Array.isArray(profileRows) && profileRows.length > 0 ? profileRows[0].id : null;

    // 3. Create demo_accounts record
    const demoAccountRes = await fetch(supabaseAdminUrl('demo_accounts'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({
        auth_user_id: authUserId,
        role,
        persona: effectivePersona,
        display_name: name,
        email,
        is_active: true,
      }),
    });

    if (!demoAccountRes.ok) {
      const err = await demoAccountRes.json().catch(() => ({}));
      // Clean up profile and auth user
      await fetch(supabaseAdminUrl(table, `auth_user_id=eq.${authUserId}`), {
        method: 'DELETE',
        headers: supabaseAdminHeaders('return=minimal'),
      });
      await fetch(`${config.url}/auth/v1/admin/users/${authUserId}`, {
        method: 'DELETE',
        headers: { 'apikey': config.key, 'Authorization': `Bearer ${config.key}` },
      });
      return NextResponse.json(
        { success: false, error: err.message || 'Failed to create demo account record' },
        { status: 400 }
      );
    }

    const demoAccountRows = await demoAccountRes.json();
    const demoAccountId = Array.isArray(demoAccountRows) && demoAccountRows.length > 0 ? demoAccountRows[0].id : null;

    // 4. Seed demo data if persona specified and account creation succeeded
    if (demoAccountId) {
      await seedDemoData(authUserId, role, effectivePersona, demoAccountId);
    }

    // 5. Audit log
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;
    await logAdminAudit(
      auth,
      'create_demo_account',
      'demo_accounts',
      demoAccountId || authUserId,
      { role, persona: effectivePersona, name, email, is_demo: true },
      ipAddress
    );

    return NextResponse.json({
      success: true,
      data: {
        demo_account_id: demoAccountId,
        profile_id: profileId,
        auth_user_id: authUserId,
        email,
        password,
        role,
        persona: effectivePersona,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// PUT - Update demo account (reset / activate / deactivate / regenerate)
// ---------------------------------------------------------------------------

export async function PUT(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id, action } = body as { id?: string; action?: string };

    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Valid demo account id is required' }, { status: 400 });
    }

    const validActions = ['reset', 'activate', 'deactivate', 'regenerate'];
    if (!action || !validActions.includes(action)) {
      return NextResponse.json(
        { success: false, error: `action must be one of: ${validActions.join(', ')}` },
        { status: 400 }
      );
    }

    const config = getSupabaseConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    // Fetch the demo account to verify it exists
    const accountRes = await fetch(
      supabaseAdminUrl('demo_accounts', `select=*&id=eq.${id}&limit=1`),
      { method: 'GET', headers: supabaseAdminHeaders() }
    );
    if (!accountRes.ok) {
      return NextResponse.json({ success: false, error: 'Failed to look up demo account' }, { status: 500 });
    }
    const accountRows = await accountRes.json();
    if (!Array.isArray(accountRows) || accountRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Demo account not found' }, { status: 404 });
    }
    const account = accountRows[0];
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;

    if (action === 'activate' || action === 'deactivate') {
      const newStatus = action === 'activate';
      const patchRes = await fetch(
        supabaseAdminUrl('demo_accounts', `id=eq.${id}`),
        {
          method: 'PATCH',
          headers: supabaseAdminHeaders('return=minimal'),
          body: JSON.stringify({ is_active: newStatus }),
        }
      );

      if (!patchRes.ok) {
        return NextResponse.json({ success: false, error: `Failed to ${action} demo account` }, { status: 500 });
      }

      await logAdminAudit(auth, `${action}_demo_account`, 'demo_accounts', id, { role: account.role, email: account.email }, ipAddress);

      return NextResponse.json({
        success: true,
        data: { id, action, is_active: newStatus },
      });
    }

    if (action === 'reset' || action === 'regenerate') {
      // Call the reset_demo_account RPC via Supabase REST
      const rpcRes = await fetch(`${config.url}/rest/v1/rpc/reset_demo_account`, {
        method: 'POST',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({ p_demo_account_id: id }),
      });

      if (!rpcRes.ok) {
        const err = await rpcRes.json().catch(() => ({}));
        return NextResponse.json(
          { success: false, error: err.message || 'Failed to reset demo account' },
          { status: 500 }
        );
      }

      const rpcResult = await rpcRes.json();

      // Clear old seed data
      await fetch(
        supabaseAdminUrl('demo_seed_data', `demo_account_id=eq.${id}`),
        { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') }
      );

      // For regenerate, use a varied persona to create fresh data
      let seedPersona = account.persona;
      if (action === 'regenerate') {
        const personas = ['weak', 'average', 'high_performer'];
        const otherPersonas = personas.filter(p => p !== account.persona);
        seedPersona = otherPersonas[Math.floor(Math.random() * otherPersonas.length)];

        // Update the persona on demo_accounts
        await fetch(
          supabaseAdminUrl('demo_accounts', `id=eq.${id}`),
          {
            method: 'PATCH',
            headers: supabaseAdminHeaders('return=minimal'),
            body: JSON.stringify({ persona: seedPersona }),
          }
        );
      }

      // Re-seed demo data
      await seedDemoData(account.auth_user_id, account.role, seedPersona, id);

      await logAdminAudit(auth, `${action}_demo_account`, 'demo_accounts', id, { role: account.role, email: account.email, persona: seedPersona }, ipAddress);

      return NextResponse.json({
        success: true,
        data: {
          id,
          action,
          persona: seedPersona,
          reset_result: rpcResult,
        },
      });
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE - Delete demo account
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Valid demo account id query param is required' }, { status: 400 });
    }

    const config = getSupabaseConfig();
    if (!config) {
      return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
    }

    // Fetch demo account
    const accountRes = await fetch(
      supabaseAdminUrl('demo_accounts', `select=*&id=eq.${id}&limit=1`),
      { method: 'GET', headers: supabaseAdminHeaders() }
    );
    if (!accountRes.ok) {
      return NextResponse.json({ success: false, error: 'Failed to look up demo account' }, { status: 500 });
    }
    const accountRows = await accountRes.json();
    if (!Array.isArray(accountRows) || accountRows.length === 0) {
      return NextResponse.json({ success: false, error: 'Demo account not found' }, { status: 404 });
    }
    const account = accountRows[0];
    const table = roleToTable(account.role);
    const authUserId = account.auth_user_id;
    const ipAddress = request.headers.get('x-forwarded-for') || undefined;

    // 1. Set is_demo_user = false on the profile row first
    await fetch(
      supabaseAdminUrl(table, `auth_user_id=eq.${authUserId}`),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=minimal'),
        body: JSON.stringify({ is_demo_user: false }),
      }
    );

    // 2. Delete demo_seed_data (cascade should handle this, but be explicit)
    await fetch(
      supabaseAdminUrl('demo_seed_data', `demo_account_id=eq.${id}`),
      { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') }
    );

    // 3. Delete demo_accounts record
    await fetch(
      supabaseAdminUrl('demo_accounts', `id=eq.${id}`),
      { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') }
    );

    // 4. Delete profile from role table
    await fetch(
      supabaseAdminUrl(table, `auth_user_id=eq.${authUserId}`),
      { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') }
    );

    // 5. Delete auth user via Supabase Admin API
    const deleteAuthRes = await fetch(`${config.url}/auth/v1/admin/users/${authUserId}`, {
      method: 'DELETE',
      headers: {
        'apikey': config.key,
        'Authorization': `Bearer ${config.key}`,
      },
    });

    if (!deleteAuthRes.ok) {
      // Non-fatal: the profile and demo record are already cleaned up
      console.error('[demo-accounts] Failed to delete auth user:', authUserId);
    }

    // 6. Audit log
    await logAdminAudit(
      auth,
      'delete_demo_account',
      'demo_accounts',
      id,
      { role: account.role, email: account.email, auth_user_id: authUserId },
      ipAddress
    );

    return NextResponse.json({
      success: true,
      data: { id, auth_user_id: authUserId, deleted: true },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 }
    );
  }
}
