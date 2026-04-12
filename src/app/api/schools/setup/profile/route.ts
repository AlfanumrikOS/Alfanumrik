import { NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * POST /api/schools/setup/profile — Update school branding & profile
 * Permission: institution.manage
 *
 * Body: { school_id, name?, tagline?, logo_url?, primary_color?, secondary_color? }
 */
export async function POST(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'institution.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const body = await request.json();
    const { school_id, name, tagline, logo_url, primary_color, secondary_color } = body;

    if (!school_id || typeof school_id !== 'string') {
      return NextResponse.json(
        { success: false, error: 'school_id is required' },
        { status: 400 }
      );
    }

    // Verify the user is admin of this school
    const { data: adminRecord } = await supabaseAdmin
      .from('school_admins')
      .select('school_id')
      .eq('auth_user_id', auth.userId)
      .eq('school_id', school_id)
      .eq('is_active', true)
      .maybeSingle();

    if (!adminRecord) {
      return NextResponse.json(
        { success: false, error: 'Not authorized for this school' },
        { status: 403 }
      );
    }

    // Build update object (only include provided fields)
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (tagline !== undefined) updates.tagline = tagline;
    if (logo_url !== undefined) updates.logo_url = logo_url;
    if (primary_color !== undefined) updates.primary_color = primary_color;
    if (secondary_color !== undefined) updates.secondary_color = secondary_color;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('schools')
      .update(updates)
      .eq('id', school_id)
      .select('id, name, tagline, logo_url, primary_color, secondary_color, slug')
      .single();

    if (error) {
      logger.error('school_profile_update_failed', {
        error,
        route: '/api/schools/setup/profile',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update school profile' },
        { status: 500 }
      );
    }

    logAudit(auth.userId, {
      action: 'update',
      resourceType: 'school',
      resourceId: school_id,
    });

    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error('school_profile_update_error', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/schools/setup/profile',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
