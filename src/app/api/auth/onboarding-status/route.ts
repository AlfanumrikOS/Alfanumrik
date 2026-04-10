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
import { resolveIdentity } from '@/lib/identity/onboarding';

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

    // Use centralized identity resolution (single source of truth)
    const identity = await resolveIdentity(supabase, user.id);

    return NextResponse.json({
      success: true,
      data: {
        status: 'authenticated',
        onboarding: identity.onboarding
          ? {
              step: identity.onboarding.step,
              role: identity.onboarding.intended_role,
              completed: identity.onboarding.step === 'completed',
              error: identity.onboarding.error_message,
            }
          : null,
        has_profile: identity.hasProfile,
        detected_role: identity.hasProfile ? identity.detectedRole : null,
        profile: identity.profile,
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
