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
import { authorizeAdmin, logAdminAudit, isValidUUID } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { buildClaimUrl, establishPrincipalAdmin, validateEmail } from '@alfanumrik/lib/school-provisioning';
import { deliverEmail } from '@alfanumrik/lib/email-delivery';
import { logger } from '@alfanumrik/lib/logger';

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
  // `name` is needed for the principal-facing claim email.
  const { data: school, error: schoolErr } = await admin
    .from('schools')
    .select('id, name, is_active')
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

  // P15: deliver the raw claim token to the principal directly so the claim flow
  // is reachable end-to-end — the operator no longer HAS to hand-relay it (the
  // raw token also remains in the TLS response below as a manual-relay fallback).
  // The raw token rides ONLY inside the email body (over TLS); fire-and-forget,
  // a mail failure must never fail the repair. We display the school's real
  // 8-char admin invite code (looked up best-effort) — never the raw token — and
  // email-delivery keys idempotency on that code (P13: the raw token is never an
  // idempotency/log key). On re-repair the operator still has the TLS-returned
  // token to relay even if the per-code email dedups.
  let emailDispatched = false;
  if (linkResult.claimToken) {
    const schoolName = (school as { name?: string | null }).name ?? 'your school';
    const { data: codeRow } = await admin
      .from('school_invite_codes')
      .select('code, expires_at')
      .eq('school_id', schoolId)
      .eq('role_type', 'admin')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const code = (codeRow as { code?: string } | null)?.code;
    const codeExpiry = (codeRow as { expires_at?: string } | null)?.expires_at;

    if (code) {
      void deliverEmail({
        template: 'school-trial-provisioned',
        to: email,
        locale: 'en',
        params: {
          school_name: schoolName,
          invite_code: code,
          expires_at: codeExpiry ?? new Date(Date.now() + 90 * 86400_000).toISOString(),
          claim_url: buildClaimUrl(linkResult.claimToken),
          recipient_name: name || undefined,
        },
      }).catch((err) => {
        logger.warn('school_admin_repair_email_dispatch_failed', {
          schoolId,
          reason: err instanceof Error ? err.message : String(err),
        });
      });
      emailDispatched = true;
    }
  }

  return NextResponse.json({
    success: true,
    data: {
      school_id: schoolId,
      school_admin_id: linkResult.schoolAdminId,
      // Whether the principal-facing claim email was dispatched (best-effort).
      email_dispatched: emailDispatched,
      // Raw claim token for the operator to relay to the principal (over TLS).
      // Never logged / persisted in plaintext. Null if token minting was skipped.
      claim_token: linkResult.claimToken,
    },
  });
}
