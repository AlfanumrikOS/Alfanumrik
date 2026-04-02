/**
 * GET /api/auth/onboarding-status
 *
 * Returns the current user's onboarding state.
 * Used by the client to determine if bootstrap is needed.
 *
 * WARNING: Do not modify without updating auth/onboarding tests.
 */

import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Authentication required', status: 'unauthenticated' },
        { status: 401 }
      );
    }

    // Check onboarding state
    const { data: onboarding } = await supabase
      .from('onboarding_state')
      .select(
        'step, intended_role, profile_id, error_message, created_at, completed_at'
      )
      .eq('auth_user_id', user.id)
      .single();

    // Check if profiles exist (fallback if onboarding_state is missing)
    const [
      { data: studentData },
      { data: teacherData },
      { data: guardianData },
    ] = await Promise.all([
      supabase
        .from('students')
        .select('id, name, grade')
        .eq('auth_user_id', user.id)
        .single(),
      supabase
        .from('teachers')
        .select('id, name')
        .eq('auth_user_id', user.id)
        .single(),
      supabase
        .from('guardians')
        .select('id, name')
        .eq('auth_user_id', user.id)
        .single(),
    ]);

    const hasProfile = !!(studentData || teacherData || guardianData);
    const detectedRole = teacherData
      ? 'teacher'
      : guardianData
        ? 'parent'
        : studentData
          ? 'student'
          : null;

    return NextResponse.json({
      success: true,
      data: {
        status: 'authenticated',
        onboarding: onboarding
          ? {
              step: onboarding.step,
              role: onboarding.intended_role,
              completed: onboarding.step === 'completed',
              error: onboarding.error_message,
            }
          : null,
        has_profile: hasProfile,
        detected_role: hasProfile ? detectedRole : null,
        profile: studentData
          ? { type: 'student', ...studentData }
          : teacherData
            ? { type: 'teacher', ...teacherData }
            : guardianData
              ? { type: 'guardian', ...guardianData }
              : null,
      },
    });
  } catch (error) {
    console.error('[OnboardingStatus] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
