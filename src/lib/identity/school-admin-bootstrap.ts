/**
 * ⚠️ CRITICAL AUTH PATH
 * This file is part of the core authentication system.
 * Changes here WILL break school-admin signup for ALL users.
 *
 * Before modifying:
 * 1. Run: npm run test -- --grep "auth"
 * 2. Run: node scripts/auth-guard.js
 *
 * SERVER-ONLY: imports the service-role supabase client. Never import this
 * from client components — use '@/lib/identity/bootstrap-profile' for the
 * pure metadata helpers instead. (Intentionally NOT re-exported from the
 * identity barrel for the same reason.)
 */
/**
 * Shared institution_admin signup bootstrap (R2, 2026-06-10 audit).
 *
 * Extracted from src/app/auth/callback/route.ts (formerly lines 162-192) so
 * the token_hash flow (/auth/confirm) gains the same branch — previously a
 * school admin whose confirmation email used the token_hash link landed with
 * a verified account but NO school/school_admins rows and a broken portal.
 *
 * Behavior preserved exactly from the callback implementation:
 *   - insert schools row (name falls back to 'My School', board to 'CBSE')
 *   - insert school_admins row keyed to the new school
 *   - the sync_school_admin_role DB trigger auto-assigns the
 *     institution_admin RBAC role on school_admins insert
 *   - FAIL-SOFT (P15): all errors are logged and swallowed; the auth flow
 *     never breaks. The admin account can be repaired manually.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';

export interface SchoolAdminBootstrapParams {
  authUserId: string;
  name: string;
  email: string;
  schoolName: string | null;
  city: string | null;
  state: string | null;
  board: string | null;
  phone: string | null;
}

/**
 * Create school + school_admin rows using the admin client.
 * Never throws. Returns true when both rows were created.
 */
export async function bootstrapSchoolAdminProfile(
  params: SchoolAdminBootstrapParams,
  logPrefix = '[SchoolAdminBootstrap]'
): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin();
    const { data: newSchool, error: schoolErr } = await admin
      .from('schools')
      .insert({
        name: params.schoolName || 'My School',
        city: params.city || null,
        state: params.state || null,
        board: params.board || 'CBSE',
      })
      .select('id')
      .single();

    if (schoolErr || !newSchool) {
      if (schoolErr) {
        console.error(`${logPrefix} School insert failed:`, schoolErr.message);
      }
      return false;
    }

    const { error: adminErr } = await admin.from('school_admins').insert({
      auth_user_id: params.authUserId,
      school_id: newSchool.id,
      name: params.name,
      email: params.email,
      phone: params.phone || null,
    });

    if (adminErr) {
      console.error(`${logPrefix} school_admins insert failed:`, adminErr.message);
      return false;
    }

    return true;
  } catch (schoolBootstrapErr) {
    console.error(`${logPrefix} School admin bootstrap failed:`, schoolBootstrapErr);
    // Non-fatal — admin can be set up manually
    return false;
  }
}
