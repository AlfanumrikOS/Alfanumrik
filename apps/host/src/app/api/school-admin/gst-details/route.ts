import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { schoolAdminPermissionCode } from '@alfanumrik/lib/school-admin/permission-code';
import { z } from 'zod';

/**
 * /api/school-admin/gst-details — a school admin reads/writes ONLY their own
 * school's tax identity (school_gst_details). Track A.3 (per-state GST, B2B).
 *
 * Tenant isolation: every query is scoped to auth.schoolId (resolved by
 * authorizeSchoolAdmin from the caller's school_admins membership). A school
 * admin can never read or write another school's row.
 *
 * Permission (Wave C matrix, flag-conditional via schoolAdminPermissionCode):
 *   GET → flag OFF 'institution.manage' / flag ON 'institution.view_billing'
 *   PUT → flag OFF 'institution.manage' / flag ON 'institution.manage_billing'
 *
 * GSTIN format is validated (15-char) when provided; an unregistered school may
 * pass a null/empty gstin (is_registered=false). No PII (P13) — GSTIN + legal
 * name are business-registration data, uuid-keyed.
 */

// India GSTIN: 2-digit state code + 10-char PAN + 1 entity digit + 'Z' + 1 checksum.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
// 2-letter India state code (e.g. MH, KA, DL).
const STATE_RE = /^[A-Z]{2}$/;

export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(
      request,
      await schoolAdminPermissionCode({ off: 'institution.manage', on: 'institution.view_billing' }),
    );
    if (!auth.authorized) return auth.errorResponse;

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('school_gst_details')
      .select('id, school_id, gstin, legal_name, place_of_supply_state_code, is_registered, created_at, updated_at')
      .eq('school_id', auth.schoolId)
      .maybeSingle();

    if (error) {
      logger.error('school_admin_gst_details_read_error', {
        error: new Error(error.message),
        route: '/api/school-admin/gst-details',
        schoolId: auth.schoolId,
      });
      return NextResponse.json({ success: false, error: 'Failed to read GST details' }, { status: 500 });
    }

    // Null when not yet set — return a typed empty shell so the UI can render a form.
    return NextResponse.json({
      success: true,
      data: data ?? {
        school_id: auth.schoolId,
        gstin: null,
        legal_name: null,
        place_of_supply_state_code: null,
        is_registered: false,
      },
    });
  } catch (err) {
    logger.error('school_admin_gst_details_get_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/gst-details',
    });
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

const putSchema = z
  .object({
    gstin: z.string().trim().toUpperCase().regex(GSTIN_RE, 'Invalid GSTIN format (expected 15-char GSTIN)').nullable().optional(),
    legal_name: z.string().trim().min(1).max(200).nullable().optional(),
    place_of_supply_state_code: z.string().trim().toUpperCase().regex(STATE_RE, 'Invalid state code (expected 2-letter code)').nullable().optional(),
    is_registered: z.boolean().optional(),
  })
  .refine(
    // A registered school must carry a GSTIN; reject is_registered=true with no gstin.
    (d) => d.is_registered !== true || (typeof d.gstin === 'string' && d.gstin.length > 0),
    { message: 'A registered school must provide a GSTIN', path: ['gstin'] },
  );

export async function PUT(request: NextRequest) {
  try {
    const auth = await authorizeSchoolAdmin(
      request,
      await schoolAdminPermissionCode({ off: 'institution.manage', on: 'institution.manage_billing' }),
    );
    if (!auth.authorized) return auth.errorResponse;

    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = putSchema.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid body' },
        { status: 400 },
      );
    }

    // Build the upsert payload from provided fields only. Derive is_registered
    // from gstin presence when the caller didn't set it explicitly.
    const body = parsed.data;
    const payload: Record<string, unknown> = { school_id: auth.schoolId };
    if (body.gstin !== undefined) payload.gstin = body.gstin;
    if (body.legal_name !== undefined) payload.legal_name = body.legal_name;
    if (body.place_of_supply_state_code !== undefined) payload.place_of_supply_state_code = body.place_of_supply_state_code;
    payload.is_registered =
      body.is_registered ?? (typeof body.gstin === 'string' && body.gstin.length > 0);

    const supabase = getSupabaseAdmin();
    // One row per school (uq_school_gst_details_school) → upsert on school_id.
    const { data, error } = await supabase
      .from('school_gst_details')
      .upsert(payload, { onConflict: 'school_id' })
      .select('id, school_id, gstin, legal_name, place_of_supply_state_code, is_registered, updated_at')
      .maybeSingle();

    if (error || !data) {
      logger.error('school_admin_gst_details_write_error', {
        error: new Error(error?.message ?? 'no row returned'),
        route: '/api/school-admin/gst-details',
        schoolId: auth.schoolId,
      });
      return NextResponse.json({ success: false, error: 'Failed to save GST details' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err) {
    logger.error('school_admin_gst_details_put_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/gst-details',
    });
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
