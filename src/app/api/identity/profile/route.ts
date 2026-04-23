/**
 * GET /api/identity/profile
 *
 * Identity service proxy for AuthContext during migration.
 * Routes to identity Edge Function with circuit breaker protection.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { isFeatureEnabled, IDENTITY_MIGRATION_FLAGS } from '@/lib/feature-flags';

export async function GET(request: NextRequest) {
  try {
    // Authenticate user
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required' },
        { status: 401 }
      );
    }

    const targetUserId = request.headers.get('X-User-ID') || user.id;

    // Check if user can access this profile (own profile or admin)
    if (user.id !== targetUserId) {
      const { data: isAdmin } = await supabase
        .from('admin_users')
        .select('id')
        .eq('auth_user_id', user.id)
        .single();

      if (!isAdmin) {
        return NextResponse.json(
          { success: false, error: 'Access denied' },
          { status: 403 }
        );
      }
    }

    // Check if identity service is enabled for this user
    const identityServiceEnabled = await isFeatureEnabled(
      IDENTITY_MIGRATION_FLAGS.IDENTITY_SERVICE_ENABLED,
      { userId: targetUserId, role: 'student' }
    );

    if (!identityServiceEnabled) {
      // Fall back to monolith data
      return await getMonolithProfile(targetUserId, supabase);
    }

    // Try identity service with fallback
    try {
      const identityResponse = await callIdentityService(targetUserId, request);
      if (identityResponse.ok) {
        const identityData = await identityResponse.json();
        return NextResponse.json(identityData);
      }
    } catch (error) {
      console.warn('[Identity API] Service call failed, using fallback:', error);
    }

    // Fallback to monolith
    return await getMonolithProfile(targetUserId, supabase);

  } catch (error) {
    console.error('[Identity API] Unexpected error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Call identity service Edge Function
 */
async function callIdentityService(userId: string, request: NextRequest): Promise<Response> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase configuration missing');
  }

  // Call identity service Edge Function
  const response = await fetch(`${supabaseUrl}/functions/v1/identity/profile/${userId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  });

  return response;
}

/**
 * Get profile data from monolith (fallback)
 */
async function getMonolithProfile(userId: string, supabase: any): Promise<NextResponse> {
  // Get role data
  const { data: roleData } = await supabase.rpc('get_user_role', {
    p_auth_user_id: userId,
  });

  if (!roleData) {
    return NextResponse.json({
      success: false,
      error: 'User profile not found',
    }, { status: 404 });
  }

  const rd = roleData as any;
  let profile = null;

  // Get profile based on primary role
  if (rd.primary_role === 'student' && rd.student) {
    const { data: studentData } = await supabase
      .from('identity.students')
      .select('*')
      .eq('id', rd.student.id)
      .single();
    profile = studentData;
  } else if (rd.primary_role === 'teacher' && rd.teacher) {
    const { data: teacherData } = await supabase
      .from('identity.teachers')
      .select('id, name, school_name, subjects_taught, grades_taught, email, phone')
      .eq('id', rd.teacher.id)
      .single();
    profile = teacherData;
  } else if (rd.primary_role === 'guardian' && rd.guardian) {
    const { data: guardianData } = await supabase
      .from('identity.guardians')
      .select('id, name, email, phone')
      .eq('id', rd.guardian.id)
      .single();
    profile = guardianData;
  }

  return NextResponse.json({
    success: true,
    profile,
    roles: rd,
  });
}