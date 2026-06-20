/**
 * POST /api/super-admin/institutions/[id]/admins
 *
 * Track A.1 — super-admin create / REPAIR of a school admin.
 *
 * Use cases:
 *   - A school was provisioned before Track A.1 (no auth user / no
 *     `school_admins` link existed) and its principal still cannot log in.
 *   - A provisioning attempt half-failed (school row exists, admin link does not).
 *   - Ops needs to (re)issue a principal's claim token.
 *
 * Behaviour: find-or-create the Supabase auth user for the supplied email and
 * idempotently ensure an ACTIVE `school_admins` row (role 'principal') linking it
 * to this school, then mint a fresh one-time claim token. Delegates to the shared
 * `establishPrincipalAdmin()` so the create path matches provisioning exactly.
 *
 * Idempotent (P15): re-running for the same school + email reuses the existing
 * link (reactivating it if revoked) rather than failing or duplicating.
 *
 * Auth (P9): `authorizeAdmin(request, 'super_admin')` — this mints auth users and
 * grants institution-admin access, so it is super-admin-only.
 *
 * Audit (P13): `logAdminAudit` records the action with METADATA ONLY — never the
 * email, name, password, or raw claim token. The raw token is returned in the
 * HTTP response (over TLS) for the operator to relay; it is never persisted in
 * plaintext nor logged.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, isValidUUID } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { establishPrincipalAdmin, validateEmail } from '@/lib/school-provisioning';
import { logger } from '@/lib/logger';

interface CreateAdminBody {
  email?: string;
  name?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  // P9: super-admin only — this provisions auth users + admin access.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  const { id: schoolId } = await params;
  if (!isValidUUID(schoolId)) {
    return NextResponse.json({ success: false, error: 'Invalid school id.' }, { status: 400 });
  }

  let body: CreateAdminBody;
  try {
    body = (await request.json()) as CreateAdminBody;
  } catch {
    return NextResponse.json({ success: false, error: 'Body must be JSON.' }, { status: 400 });
  }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!email || !validateEmail(email)) {
    return NextResponse.json(
      { success: false, error: 'A valid principal email is required.' },
      { status: 400 },
    );
  }
  if (email.length > 254 || name.length > 100) {
    return NextResponse.json(
      { success: false, error: 'Input exceeds maximum length.' },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();

  // Verify the school exists (and is not soft-deleted) before minting an admin.
  const { data: school, error: schoolErr } = await admin
    .from('schools')
    .select('id, is_active')
    .eq('id', schoolId)
    .is('deleted_at', null)
    .maybeSingle();

  if (schoolErr) {
    logger.error('school_admin_repair_school_lookup_failed', {
      schoolId,
      reason: schoolErr.message,
    });
    return NextResponse.json(
      { success: false, error: 'School lookup failed.' },
      { status: 500 },
    );
  }
  if (!school) {
    return NextResponse.json({ success: false, error: 'School not found.' }, { status: 404 });
  }

  // Find-or-create the auth user + idempotently ensure the active 'principal'
  // school_admins link, and mint a fresh claim token. invitedBy = the operator.
  const linkResult = await establishPrincipalAdmin(
    admin,
    schoolId,
    email,
    name || null,
    auth.userId,
  );

  if (!linkResult.linked) {
    logger.error('school_admin_repair_link_failed', { schoolId });
    return NextResponse.json(
      { success: false, error: 'Failed to establish the school-admin link.' },
      { status: 500 },
    );
  }

  // Audit — METADATA ONLY (no email / name / password / raw token).
  await logAdminAudit(auth, 'school_admin.provisioned', 'school', schoolId, {
    school_admin_id: linkResult.schoolAdminId,
    role: 'principal',
    auth_user_linked: linkResult.authUserId !== null,
    claim_token_issued: linkResult.claimToken !== null,
  });

  return NextResponse.json({
    success: true,
    data: {
      school_id: schoolId,
      school_admin_id: linkResult.schoolAdminId,
      // Raw claim token for the operator to relay to the principal (over TLS).
      // Never logged / persisted in plaintext. Null if token minting was skipped.
      claim_token: linkResult.claimToken,
    },
  });
}
