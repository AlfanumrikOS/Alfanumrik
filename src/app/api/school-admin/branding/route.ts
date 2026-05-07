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
    //
    // Phase B fields (tenant_type, font_heading, font_body, border_radius_px)
    // are added to the response so /school-admin/branding can render the
    // typography section + a read-only "Tenant type: <type>" label.
    // tenant_type is read-only here — changing it is a super-admin concern
    // (alters default modules, copy, billing assumptions). The PUT handler
    // ignores tenant_type in the body.
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
      tenant_type: s.tenantType,
      font_heading: s.fontHeading,
      font_body: s.fontBody,
      border_radius_px: s.borderRadiusPx,
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
 * Allowed fields:
 *   - logo_url, primary_color, secondary_color, tagline, billing_email
 *   - font_heading, font_body, border_radius_px (Phase B typography)
 *
 * Hex colors are validated (must be #RRGGBB or #RGB format).
 * Border radius must be 0–32 (matches the CHECK constraint on the column).
 * Font fields are capped at 200 chars to keep the CSS var emit reasonable.
 *
 * `tenant_type` is intentionally NOT writable here — it changes defaults,
 * copy variants, and billing assumptions. Super-admin owns it via
 * /api/super-admin/institutions PATCH (separate work).
 *
 * Body: { logo_url?, primary_color?, secondary_color?, tagline?, billing_email?,
 *         font_heading?, font_body?, border_radius_px? }
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

    // ── Phase B: typography fields ────────────────────────────────────
    // font_heading / font_body — string or null, max 200 chars (keeps
    // the emitted CSS var sane and prevents abuse via huge font stacks).
    if (body.font_heading !== undefined) {
      const v = body.font_heading;
      if (v !== null && typeof v !== 'string') {
        return NextResponse.json(
          { success: false, error: 'font_heading must be a string or null' },
          { status: 400 }
        );
      }
      if (typeof v === 'string' && v.length > 200) {
        return NextResponse.json(
          { success: false, error: 'font_heading must be 200 characters or less' },
          { status: 400 }
        );
      }
      updateFields.font_heading = typeof v === 'string' ? v.trim() || null : null;
    }

    if (body.font_body !== undefined) {
      const v = body.font_body;
      if (v !== null && typeof v !== 'string') {
        return NextResponse.json(
          { success: false, error: 'font_body must be a string or null' },
          { status: 400 }
        );
      }
      if (typeof v === 'string' && v.length > 200) {
        return NextResponse.json(
          { success: false, error: 'font_body must be 200 characters or less' },
          { status: 400 }
        );
      }
      updateFields.font_body = typeof v === 'string' ? v.trim() || null : null;
    }

    // border_radius_px — integer 0–32 (matches CHECK on column) or null.
    if (body.border_radius_px !== undefined) {
      const v = body.border_radius_px;
      if (v === null) {
        updateFields.border_radius_px = null;
      } else if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= 32) {
        updateFields.border_radius_px = v;
      } else {
        return NextResponse.json(
          { success: false, error: 'border_radius_px must be an integer 0–32 or null' },
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
      .select('id, slug, logo_url, primary_color, secondary_color, tagline, custom_domain, domain_verified, billing_email, tenant_type, font_heading, font_body, border_radius_px, settings')
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
