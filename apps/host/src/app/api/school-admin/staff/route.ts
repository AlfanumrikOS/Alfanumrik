/**
 * /api/school-admin/staff — Phase 3B Wave C school-admin STAFF MANAGEMENT.
 *
 * Lets a school's principal / institution_admin manage the OTHER school admins
 * for their own school: list staff, invite/add a new admin with a role, change
 * an admin's role, and revoke (deactivate) an admin.
 *
 * ─── Authorization ───────────────────────────────────────────────────────────
 * Every handler authorizes on `institution.manage_staff`. Per the CEO-approved
 * Wave C matrix that capability belongs to `principal` and `institution_admin`
 * only (NOT vice_principal / academic_coordinator). The narrowing is enforced by
 * authorizeSchoolAdmin when `ff_school_admin_rbac` is ON.
 *
 * ─── Flag gating ─────────────────────────────────────────────────────────────
 * This is NEW functionality surfaced only by the flag-gated staff UI. When
 * `ff_school_admin_rbac` is OFF the entire endpoint returns 404 (behaves as
 * not-present) so the flag-OFF portal is byte-identical to today. No existing
 * route lives at this path — `/api/school-admin/rbac` is the unrelated platform
 * elevation/delegation API and is left untouched.
 *
 * ─── Safety guards (P11-style lockout prevention, cross-school isolation) ─────
 *  - The caller's school_id is ALWAYS taken from their school_admins record,
 *    never from the request body. Targets are verified to belong to that school.
 *  - The LAST active `principal` of a school cannot be revoked or demoted
 *    (prevents locking the school out of billing/staff management).
 *  - You cannot revoke or demote YOURSELF when you are that last principal.
 *
 * ─── Privacy (P13) ───────────────────────────────────────────────────────────
 * No PII (email / phone / name) is ever written to logs. Audit rows carry the
 * target's school_admins.id + role only; the school audit trail metadata is
 * id/role, not contact details.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeSchoolAdmin, type SchoolAdminRole } from '@alfanumrik/lib/school-admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { logSchoolAudit } from '@alfanumrik/lib/audit';
import { isFeatureEnabled, SCHOOL_ADMIN_RBAC_FLAGS } from '@alfanumrik/lib/feature-flags';

export const runtime = 'nodejs';

const STAFF_PERMISSION = 'institution.manage_staff';

const VALID_ROLES: ReadonlySet<SchoolAdminRole> = new Set<SchoolAdminRole>([
  'principal',
  'vice_principal',
  'academic_coordinator',
  'institution_admin',
]);

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME_LEN = 200;

function ok<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data }, { status });
}

function fail(error: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error, ...(extra ?? {}) }, { status });
}

/** Uniform "feature absent" response when the flag is OFF. */
function notPresent() {
  return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
}

/**
 * Shared gate + authorize. Returns the resolved school context, or a Response to
 * short-circuit (404 when flag OFF, the authorize error otherwise).
 */
async function gate(
  request: NextRequest,
): Promise<
  | { ok: true; schoolId: string; userId: string; selfAdminId: string }
  | { ok: false; response: Response }
> {
  // Flag OFF → endpoint behaves as not-present (byte-identical flag-OFF portal).
  const enabled = await isFeatureEnabled(SCHOOL_ADMIN_RBAC_FLAGS.V1, {
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'production',
  });
  if (!enabled) return { ok: false, response: notPresent() };

  const auth = await authorizeSchoolAdmin(request, STAFF_PERMISSION);
  if (!auth.authorized) return { ok: false, response: auth.errorResponse! };
  if (!auth.schoolId || !auth.userId || !auth.schoolAdminId) {
    return { ok: false, response: fail('Missing school context', 400) };
  }
  return {
    ok: true,
    schoolId: auth.schoolId,
    userId: auth.userId,
    selfAdminId: auth.schoolAdminId,
  };
}

/** Count active principals for a school (used by lockout guards). */
async function countActivePrincipals(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  schoolId: string,
): Promise<number> {
  const { count } = await supabase
    .from('school_admins')
    .select('id', { count: 'exact', head: true })
    .eq('school_id', schoolId)
    .eq('role', 'principal')
    .eq('is_active', true);
  return count ?? 0;
}

// ─── GET — list active school admins for the caller's school ──────────────────

export async function GET(request: NextRequest) {
  const g = await gate(request);
  if (!g.ok) return g.response;

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('school_admins')
      .select('id, name, email, role, is_active, invited_at, accepted_at, created_at')
      .eq('school_id', g.schoolId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (error) {
      logger.error('school_admin_staff_list_failed', {
        error: new Error(error.message),
        route: '/api/school-admin/staff',
      });
      return fail('Failed to list staff', 500);
    }

    return ok({ staff: data ?? [] });
  } catch (err) {
    logger.error('school_admin_staff_get_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/staff',
    });
    return fail('Internal server error', 500);
  }
}

// ─── POST — invite / add a school admin (idempotent on email+school) ──────────

export async function POST(request: NextRequest) {
  const g = await gate(request);
  if (!g.ok) return g.response;

  try {
    const supabase = getSupabaseAdmin();

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail('Invalid JSON body', 400);
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = typeof body.role === 'string' ? body.role.trim() : '';
    const name =
      typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LEN) : null;

    if (!email || !EMAIL_REGEX.test(email)) {
      return fail('A valid email is required', 400);
    }
    if (!VALID_ROLES.has(role as SchoolAdminRole)) {
      return fail(
        'role must be one of: principal, vice_principal, academic_coordinator, institution_admin',
        400,
      );
    }

    // ── Idempotency: an existing school_admins row for this email+school wins.
    const { data: existing, error: existingErr } = await supabase
      .from('school_admins')
      .select('id, auth_user_id, role, is_active')
      .eq('school_id', g.schoolId)
      .eq('email', email)
      .maybeSingle();

    if (existingErr) {
      logger.error('school_admin_staff_dedup_failed', {
        error: new Error(existingErr.message),
        route: '/api/school-admin/staff',
      });
      return fail('Failed to check existing staff', 500);
    }

    if (existing) {
      // Already active → no-op idempotent success (do NOT silently change role).
      if (existing.is_active) {
        return ok(
          { id: existing.id, role: existing.role, reactivated: false, alreadyMember: true },
          200,
        );
      }
      // Reactivate the previously-revoked membership with the requested role.
      const { error: reErr } = await supabase
        .from('school_admins')
        .update({ is_active: true, role, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .eq('school_id', g.schoolId);

      if (reErr) {
        logger.error('school_admin_staff_reactivate_failed', {
          error: new Error(reErr.message),
          route: '/api/school-admin/staff',
        });
        return fail('Failed to reactivate staff member', 500);
      }

      await logSchoolAudit({
        schoolId: g.schoolId,
        actorId: g.userId,
        action: 'school_admin.invited',
        resourceType: 'school_admin',
        resourceId: existing.id,
        metadata: { role, reactivated: true },
      });

      return ok({ id: existing.id, role, reactivated: true, alreadyMember: false }, 200);
    }

    // ── New membership. The school_admins.auth_user_id FK is NOT NULL, so the
    // member must map to an auth user. If the email already has an auth user we
    // link it; otherwise we create one (mirrors the school-admin student-invite
    // pattern in /api/school-admin/students). The sync_school_admin_role trigger
    // grants the institution_admin RBAC role on INSERT.
    let authUserId: string | null = null;

    const tempPassword = `Alf${Math.random().toString(36).slice(2, 10)}!${Math.floor(Math.random() * 1000)}`;
    const { data: created, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role: 'institution_admin', ...(name ? { name } : {}) },
    });

    if (created?.user?.id) {
      authUserId = created.user.id;
    } else if (createErr) {
      // Email already registered → find the existing auth user and link it.
      // (Supabase returns a 422 "already registered" on duplicate email.)
      const { data: list, error: listErr } = await supabase.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });
      if (listErr) {
        logger.error('school_admin_staff_user_lookup_failed', {
          error: new Error(listErr.message),
          route: '/api/school-admin/staff',
        });
        return fail('Failed to resolve user for invite', 500);
      }
      const match = list?.users?.find(
        (u) => (u.email ?? '').toLowerCase() === email,
      );
      if (!match?.id) {
        return fail('Could not create or find a user for this email', 400);
      }
      authUserId = match.id;
    }

    if (!authUserId) {
      return fail('Failed to provision user for invite', 500);
    }

    // Guard: this auth user may already be an admin of this school under a
    // different email casing / linkage. Re-check by auth_user_id to stay
    // idempotent and avoid a duplicate row.
    const { data: byAuth } = await supabase
      .from('school_admins')
      .select('id, role, is_active')
      .eq('school_id', g.schoolId)
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (byAuth) {
      if (!byAuth.is_active) {
        await supabase
          .from('school_admins')
          .update({ is_active: true, role, updated_at: new Date().toISOString() })
          .eq('id', byAuth.id)
          .eq('school_id', g.schoolId);
      }
      return ok(
        { id: byAuth.id, role: byAuth.is_active ? byAuth.role : role, reactivated: !byAuth.is_active, alreadyMember: byAuth.is_active },
        200,
      );
    }

    const nowIso = new Date().toISOString();
    const { data: inserted, error: insertErr } = await supabase
      .from('school_admins')
      .insert({
        auth_user_id: authUserId,
        school_id: g.schoolId,
        role,
        name,
        email,
        is_active: true,
        invited_by: g.userId,
        invited_at: nowIso,
      })
      .select('id, role')
      .single();

    if (insertErr || !inserted) {
      logger.error('school_admin_staff_insert_failed', {
        error: new Error(insertErr?.message ?? 'insert returned no row'),
        route: '/api/school-admin/staff',
      });
      return fail('Failed to add staff member', 500);
    }

    await logSchoolAudit({
      schoolId: g.schoolId,
      actorId: g.userId,
      action: 'school_admin.invited',
      resourceType: 'school_admin',
      resourceId: inserted.id,
      metadata: { role: inserted.role, reactivated: false },
    });

    return ok({ id: inserted.id, role: inserted.role, reactivated: false, alreadyMember: false }, 201);
  } catch (err) {
    logger.error('school_admin_staff_post_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/staff',
    });
    return fail('Internal server error', 500);
  }
}

// ─── PATCH — change a staff member's role ─────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const g = await gate(request);
  if (!g.ok) return g.response;

  try {
    const supabase = getSupabaseAdmin();

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail('Invalid JSON body', 400);
    }

    const targetId = typeof body.id === 'string' ? body.id.trim() : '';
    const role = typeof body.role === 'string' ? body.role.trim() : '';

    if (!targetId) return fail('id is required', 400);
    if (!VALID_ROLES.has(role as SchoolAdminRole)) {
      return fail(
        'role must be one of: principal, vice_principal, academic_coordinator, institution_admin',
        400,
      );
    }

    // Resolve target and verify it belongs to the caller's school (no cross-school).
    const { data: target, error: targetErr } = await supabase
      .from('school_admins')
      .select('id, role, is_active, school_id')
      .eq('id', targetId)
      .maybeSingle();

    if (targetErr) {
      logger.error('school_admin_staff_patch_lookup_failed', {
        error: new Error(targetErr.message),
        route: '/api/school-admin/staff',
      });
      return fail('Failed to resolve staff member', 500);
    }
    if (!target || target.school_id !== g.schoolId) {
      return fail('Staff member not found in your school', 404);
    }
    if (!target.is_active) {
      return fail('Cannot change the role of a revoked staff member', 400);
    }

    // No-op if unchanged.
    if (target.role === role) {
      return ok({ id: target.id, role: target.role, changed: false });
    }

    // Lockout guard: demoting AWAY from principal must leave >=1 active principal.
    if (target.role === 'principal' && role !== 'principal') {
      const principals = await countActivePrincipals(supabase, g.schoolId);
      if (principals <= 1) {
        return fail(
          'Cannot demote the last active principal of the school. Promote another admin to principal first.',
          409,
          { code: 'LAST_PRINCIPAL_LOCKOUT' },
        );
      }
    }

    const { error: updErr } = await supabase
      .from('school_admins')
      .update({ role, updated_at: new Date().toISOString() })
      .eq('id', target.id)
      .eq('school_id', g.schoolId);

    if (updErr) {
      logger.error('school_admin_staff_role_update_failed', {
        error: new Error(updErr.message),
        route: '/api/school-admin/staff',
      });
      return fail('Failed to change role', 500);
    }

    await logSchoolAudit({
      schoolId: g.schoolId,
      actorId: g.userId,
      action: 'school_admin.role_changed',
      resourceType: 'school_admin',
      resourceId: target.id,
      metadata: { from_role: target.role, to_role: role, self: target.id === g.selfAdminId },
    });

    return ok({ id: target.id, role, changed: true });
  } catch (err) {
    logger.error('school_admin_staff_patch_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/staff',
    });
    return fail('Internal server error', 500);
  }
}

// ─── DELETE — revoke (deactivate) a staff member ──────────────────────────────

export async function DELETE(request: NextRequest) {
  const g = await gate(request);
  if (!g.ok) return g.response;

  try {
    const supabase = getSupabaseAdmin();

    // Accept id from query (?id=) or JSON body.
    let targetId = new URL(request.url).searchParams.get('id')?.trim() ?? '';
    if (!targetId) {
      try {
        const body = (await request.json()) as Record<string, unknown>;
        if (typeof body.id === 'string') targetId = body.id.trim();
      } catch {
        /* no body — fall through to validation */
      }
    }
    if (!targetId) return fail('id is required', 400);

    const { data: target, error: targetErr } = await supabase
      .from('school_admins')
      .select('id, role, is_active, school_id')
      .eq('id', targetId)
      .maybeSingle();

    if (targetErr) {
      logger.error('school_admin_staff_delete_lookup_failed', {
        error: new Error(targetErr.message),
        route: '/api/school-admin/staff',
      });
      return fail('Failed to resolve staff member', 500);
    }
    if (!target || target.school_id !== g.schoolId) {
      return fail('Staff member not found in your school', 404);
    }
    if (!target.is_active) {
      // Already revoked → idempotent success.
      return ok({ id: target.id, revoked: true, alreadyRevoked: true });
    }

    // Lockout guard: revoking a principal must leave >=1 active principal.
    // This also covers the "cannot revoke yourself if you are the last
    // principal" case, since the caller's own row is the principal being counted.
    if (target.role === 'principal') {
      const principals = await countActivePrincipals(supabase, g.schoolId);
      if (principals <= 1) {
        return fail(
          'Cannot revoke the last active principal of the school. Assign another principal first.',
          409,
          { code: 'LAST_PRINCIPAL_LOCKOUT' },
        );
      }
    }

    const { error: revErr } = await supabase
      .from('school_admins')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', target.id)
      .eq('school_id', g.schoolId);

    if (revErr) {
      logger.error('school_admin_staff_revoke_failed', {
        error: new Error(revErr.message),
        route: '/api/school-admin/staff',
      });
      return fail('Failed to revoke staff member', 500);
    }

    await logSchoolAudit({
      schoolId: g.schoolId,
      actorId: g.userId,
      action: 'school_admin.revoked',
      resourceType: 'school_admin',
      resourceId: target.id,
      metadata: { role: target.role, self: target.id === g.selfAdminId },
    });

    return ok({ id: target.id, revoked: true, alreadyRevoked: false });
  } catch (err) {
    logger.error('school_admin_staff_delete_exception', {
      error: err instanceof Error ? err : new Error(String(err)),
      route: '/api/school-admin/staff',
    });
    return fail('Internal server error', 500);
  }
}
