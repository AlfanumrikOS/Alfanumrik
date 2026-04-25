import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@/lib/school-admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getSchoolById } from '@/lib/domains/tenant';
import { logger } from '@/lib/logger';

/**
 * GET /api/school-admin/branding
 *
 * Return school branding fields for the admin's school.
 * Permission: school.manage_branding
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_branding');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;

    const result = await getSchoolById(schoolId);

    if (!result.ok) {
      logger.error('school_admin_branding_get_failed', {
        error: new Error(result.error),
        route: '/api/school-admin/branding',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to fetch branding' },
        { status: 500 }
      );
    }

    if (!result.data) {
      return NextResponse.json(
        { success: false, error: 'School not found' },
        { status: 404 }
      );
    }

    // Preserve the existing response shape (snake_case) for clients. The
    // tenant domain returns camelCase projections; map back here so this is
    // a refactor, not a breaking change.
    const s = result.data;
    const data = {
      id: s.id,
      slug: s.slug,
      logo_url: s.logoUrl,
      primary_color: s.primaryColor,
      secondary_color: s.secondaryColor,
      tagline: s.tagline,
      custom_domain: s.customDomain,
      domain_verified: s.domainVerified,
      billing_email: s.billingEmail,
      settings: s.settings,
    };

    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error('school_admin_branding_fetch_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/branding',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/school-admin/branding
 *
 * Update school branding fields.
 * Permission: school.manage_branding
 *
 * Allowed fields: logo_url, primary_color, secondary_color, tagline, billing_email
 * Hex colors are validated (must be #RRGGBB or #RGB format).
 *
 * Body: { logo_url?: string, primary_color?: string, secondary_color?: string, tagline?: string, billing_email?: string }
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(request, 'school.manage_branding');
    if (!auth.authorized) return auth.errorResponse!;

    const schoolId = auth.schoolId!;
    const supabase = getSupabaseAdmin();

    const body = await request.json();

    const updateFields: Record<string, unknown> = {};

    // logo_url — optional string (URL)
    if (body.logo_url !== undefined) {
      if (body.logo_url !== null && typeof body.logo_url !== 'string') {
        return NextResponse.json(
          { success: false, error: 'logo_url must be a string or null' },
          { status: 400 }
        );
      }
      updateFields.logo_url = body.logo_url || null;
    }

    // primary_color — validate hex
    if (body.primary_color !== undefined) {
      if (body.primary_color !== null && !isValidHexColor(body.primary_color)) {
        return NextResponse.json(
          { success: false, error: 'primary_color must be a valid hex color (e.g., #FF5733 or #F53)' },
          { status: 400 }
        );
      }
      updateFields.primary_color = body.primary_color || null;
    }

    // secondary_color — validate hex
    if (body.secondary_color !== undefined) {
      if (body.secondary_color !== null && !isValidHexColor(body.secondary_color)) {
        return NextResponse.json(
          { success: false, error: 'secondary_color must be a valid hex color (e.g., #FF5733 or #F53)' },
          { status: 400 }
        );
      }
      updateFields.secondary_color = body.secondary_color || null;
    }

    // tagline — optional string, max 200 chars
    if (body.tagline !== undefined) {
      if (body.tagline !== null && typeof body.tagline !== 'string') {
        return NextResponse.json(
          { success: false, error: 'tagline must be a string or null' },
          { status: 400 }
        );
      }
      if (typeof body.tagline === 'string' && body.tagline.length > 200) {
        return NextResponse.json(
          { success: false, error: 'tagline must be 200 characters or less' },
          { status: 400 }
        );
      }
      updateFields.tagline = body.tagline?.trim() || null;
    }

    // billing_email — validate format
    if (body.billing_email !== undefined) {
      if (body.billing_email !== null && typeof body.billing_email === 'string') {
        if (!isValidEmail(body.billing_email)) {
          return NextResponse.json(
            { success: false, error: 'billing_email must be a valid email address' },
            { status: 400 }
          );
        }
        updateFields.billing_email = body.billing_email.trim().toLowerCase();
      } else if (body.billing_email === null) {
        updateFields.billing_email = null;
      } else {
        return NextResponse.json(
          { success: false, error: 'billing_email must be a string or null' },
          { status: 400 }
        );
      }
    }

    if (Object.keys(updateFields).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('schools')
      .update(updateFields)
      .eq('id', schoolId)
      .select('id, slug, logo_url, primary_color, secondary_color, tagline, custom_domain, domain_verified, billing_email, settings')
      .single();

    if (error) {
      logger.error('school_admin_branding_update_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/branding',
      });
      return NextResponse.json(
        { success: false, error: 'Failed to update branding' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error('school_admin_branding_put_failed', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/branding',
    });
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/** Validate hex color: #RGB or #RRGGBB */
function isValidHexColor(color: string): boolean {
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color);
}

/** Basic email format check */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}
