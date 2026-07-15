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
 * from client components — use '@alfanumrik/lib/identity/bootstrap-profile' for the
 * pure metadata helpers instead. (Intentionally NOT re-exported from the
 * identity barrel for the same reason.)
 */
/**
 * Unified institution_admin (school-admin) onboarding helper.
 *
 * Phase 3b (B2): a SINGLE helper — ensureSchoolAdminOnboarding — now owns the
 * school-admin onboarding shape so both the self-serve email flow
 * (/auth/callback + /auth/confirm, via complete-signup.ts) and the trial /
 * bulk-provisioning flow (school-provisioning.ts, via
 * writeSchoolAdminOnboardingState) converge on the SAME three guarantees:
 *
 *   1. a `schools` row carrying name / board / city / state / principal_name;
 *   2. a `school_admins` row with the CANONICAL role 'principal' (the
 *      full-capability Wave-C role — NOT the old 'institution_admin' column
 *      default); the sync_school_admin_role DB trigger auto-assigns the
 *      institution_admin RBAC role on insert;
 *   3. an `onboarding_state` row (intended_role='institution_admin',
 *      step='completed', profile_id=school_admins.id) so the admin flows through
 *      the SAME funnel as student/teacher/parent and is visible to
 *      resolveIdentity() / onboarding-status / repair.
 *
 * IMPLEMENTATION CHOICE (why RPC-first + patch):
 *   Phase 3a made bootstrap_user_profile(p_role='institution_admin', ...) a
 *   first-class, IDEMPOTENT branch that creates schools + school_admins(role=
 *   'principal') + onboarding_state through the shared funnel (reuse-before-
 *   insert, so the P15 3-layer retry never duplicates a school). We call that
 *   RPC for the core creation — it is the single source of truth for the funnel
 *   and the RBAC trigger — and then PATCH city/state/principal_name onto the
 *   school row, because the RPC's signature has no params for them (they'd stay
 *   NULL otherwise). This reuses the DB's idempotency instead of re-deriving it
 *   in the app, and keeps onboarding_state on the canonical path. A direct
 *   admin-client fallback (idempotent reuse-before-insert) runs only if the RPC
 *   is unavailable, so school signup can never be blocked (P15).
 *
 * FAIL-SOFT (P15): every write is best-effort. A failed onboarding_state insert,
 * a failed city/state patch, or even a failed RPC never throws out of this
 * helper — school signup completes and the account can be repaired via
 * admin_repair_user_onboarding. No PII is ever logged (P13): only auth_user_id,
 * status flags, and error messages.
 *
 * VALIDATION (B5, P8/P9): required institution_admin fields (school_name, city,
 * state, board) are validated/normalized server-side — the client is never
 * trusted. Missing fields fall back to safe defaults (school_name → 'My School',
 * board → 'CBSE', city/state → null) and are logged (metadata only), rather than
 * breaking signup.
 */

import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { isValidBoard } from './constants';

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

const DEFAULT_SCHOOL_NAME = 'My School';
const DEFAULT_BOARD = 'CBSE';

export interface SchoolAdminOnboardingParams {
  authUserId: string;
  /** The admin's own name → school_admins.name. */
  name: string;
  email: string;
  schoolName: string | null;
  city: string | null;
  state: string | null;
  board: string | null;
  /** Founding principal's name → schools.principal_name. */
  principalName: string | null;
  phone: string | null;
}

export interface SchoolAdminOnboardingResult {
  /** True when a school_admins row now exists for this auth user. */
  ok: boolean;
  schoolId: string | null;
  schoolAdminId: string | null;
  /** True when the onboarding_state row was written/confirmed. */
  onboardingStateWritten: boolean;
}

/** Trimmed non-empty string, else null. */
function trimOrNull(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

interface NormalizedSchoolAdmin {
  /** Never empty (falls back to 'My School'). */
  schoolName: string;
  /** Never empty; a known VALID_BOARD or 'CBSE'. */
  board: string;
  city: string | null;
  state: string | null;
  principalName: string | null;
  phone: string | null;
  /** Which required fields (school_name/city/state/board) were absent/invalid. */
  missingRequired: string[];
}

/**
 * B5: server-side validation + normalization of institution_admin fields.
 * Never trusts the client. Fail-soft: missing required fields fall back to safe
 * defaults and are surfaced in `missingRequired` for logging — they do NOT
 * throw, because breaking signup would violate P15.
 */
function normalizeSchoolAdminParams(
  params: SchoolAdminOnboardingParams
): NormalizedSchoolAdmin {
  const missingRequired: string[] = [];

  const schoolName = trimOrNull(params.schoolName);
  if (!schoolName) missingRequired.push('school_name');

  const city = trimOrNull(params.city);
  if (!city) missingRequired.push('city');

  const state = trimOrNull(params.state);
  if (!state) missingRequired.push('state');

  const rawBoard = trimOrNull(params.board);
  if (!rawBoard) missingRequired.push('board');
  // Never trust a client-supplied board: unknown value → canonical default.
  const board = rawBoard && isValidBoard(rawBoard) ? rawBoard : DEFAULT_BOARD;

  return {
    schoolName: schoolName ?? DEFAULT_SCHOOL_NAME,
    board,
    city,
    state,
    principalName: trimOrNull(params.principalName),
    phone: trimOrNull(params.phone),
    missingRequired,
  };
}

/**
 * Fail-soft upsert of the school-admin onboarding_state row. Shared by the
 * self-serve helper (ensureSchoolAdminOnboarding) and the trial/bulk provisioning
 * path (school-provisioning.ts::establishPrincipalAdmin). Never throws.
 *
 * The `intended_role='institution_admin'` value is now permitted by the widened
 * CHECK constraint (migration 20260715100000). Idempotent via the unique key on
 * onboarding_state.auth_user_id.
 */
export async function writeSchoolAdminOnboardingState(
  admin: AdminClient,
  authUserId: string,
  schoolAdminId: string,
  logPrefix = '[SchoolAdminOnboarding]'
): Promise<boolean> {
  try {
    const nowIso = new Date().toISOString();
    const { error } = await admin.from('onboarding_state').upsert(
      {
        auth_user_id: authUserId,
        intended_role: 'institution_admin',
        step: 'completed',
        profile_id: schoolAdminId,
        completed_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: 'auth_user_id' }
    );
    if (error) {
      // Non-fatal (P15): the school + admin rows already exist; the account can
      // be repaired via admin_repair_user_onboarding.
      console.error(
        `${logPrefix} onboarding_state upsert failed (non-fatal):`,
        error.message
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `${logPrefix} onboarding_state upsert threw (non-fatal):`,
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/** Resolve the school_id for a given school_admins row id. Null-safe. */
async function resolveSchoolIdForAdmin(
  admin: AdminClient,
  schoolAdminId: string
): Promise<string | null> {
  try {
    const { data } = await admin
      .from('school_admins')
      .select('school_id')
      .eq('id', schoolAdminId)
      .maybeSingle();
    return (data as { school_id?: string } | null)?.school_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Patch city/state/principal_name onto the school row — the columns the RPC
 * signature cannot carry. Only sets columns we actually have values for so a
 * later idempotent re-run never NULLs-out previously-captured data. Fail-soft.
 */
async function patchSchoolDetails(
  admin: AdminClient,
  schoolId: string,
  normalized: NormalizedSchoolAdmin,
  logPrefix: string
): Promise<void> {
  const patch: Record<string, string> = {};
  if (normalized.city) patch.city = normalized.city;
  if (normalized.state) patch.state = normalized.state;
  if (normalized.principalName) patch.principal_name = normalized.principalName;
  if (Object.keys(patch).length === 0) return;

  try {
    const { error } = await admin.from('schools').update(patch).eq('id', schoolId);
    if (error) {
      console.error(`${logPrefix} school detail patch failed (non-fatal):`, error.message);
    }
  } catch (err) {
    console.error(
      `${logPrefix} school detail patch threw (non-fatal):`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Fallback path (P15): create the schools + school_admins rows directly via the
 * admin client when the RPC is unavailable. IDEMPOTENT — reuses the earliest
 * existing membership for this auth user (school_admins has no unique key on
 * auth_user_id, so a naive insert on the retry path would duplicate). Writes the
 * canonical role 'principal'. Returns the school_admins.id, or null on failure.
 */
async function directSchoolAdminInsert(
  admin: AdminClient,
  params: SchoolAdminOnboardingParams,
  normalized: NormalizedSchoolAdmin,
  logPrefix: string
): Promise<string | null> {
  try {
    // Idempotent reuse: earliest membership wins.
    const { data: existing } = await admin
      .from('school_admins')
      .select('id')
      .eq('auth_user_id', params.authUserId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const existingId = (existing as { id?: string } | null)?.id;
    if (existingId) return existingId;

    const { data: newSchool, error: schoolErr } = await admin
      .from('schools')
      .insert({
        name: normalized.schoolName,
        board: normalized.board,
        city: normalized.city,
        state: normalized.state,
        principal_name: normalized.principalName,
      })
      .select('id')
      .single();

    if (schoolErr || !newSchool) {
      if (schoolErr) {
        console.error(`${logPrefix} school insert failed:`, schoolErr.message);
      }
      return null;
    }

    const schoolId = (newSchool as { id: string }).id;

    const { data: newAdmin, error: adminErr } = await admin
      .from('school_admins')
      .insert({
        auth_user_id: params.authUserId,
        school_id: schoolId,
        role: 'principal',
        name: params.name,
        email: params.email,
        phone: normalized.phone,
      })
      .select('id')
      .single();

    if (adminErr || !newAdmin) {
      if (adminErr) {
        console.error(`${logPrefix} school_admins insert failed:`, adminErr.message);
      }
      return null;
    }

    return (newAdmin as { id: string }).id;
  } catch (err) {
    console.error(
      `${logPrefix} direct school-admin insert failed:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Ensure a school admin is fully onboarded: schools + school_admins(role=
 * 'principal') + onboarding_state, with city/state/principal_name persisted.
 * Never throws (P15). Returns a structured result for observability.
 */
export async function ensureSchoolAdminOnboarding(
  params: SchoolAdminOnboardingParams,
  logPrefix = '[SchoolAdminOnboarding]'
): Promise<SchoolAdminOnboardingResult> {
  const notOk: SchoolAdminOnboardingResult = {
    ok: false,
    schoolId: null,
    schoolAdminId: null,
    onboardingStateWritten: false,
  };

  try {
    const admin = getSupabaseAdmin();
    const normalized = normalizeSchoolAdminParams(params);

    // B5: never trust the client. Log (metadata only, P13) which required fields
    // were missing, but proceed with safe defaults rather than breaking signup.
    if (normalized.missingRequired.length > 0) {
      console.warn(
        `${logPrefix} institution_admin signup missing required field(s) — using safe defaults:`,
        normalized.missingRequired.join(', ')
      );
    }

    // Primary path: the idempotent RPC creates schools + school_admins
    // (role='principal') + onboarding_state through the shared funnel and fires
    // the sync_school_admin_role RBAC trigger.
    let schoolAdminId: string | null = null;
    try {
      const { data: rpcResult, error: rpcErr } = await admin.rpc(
        'bootstrap_user_profile',
        {
          p_auth_user_id: params.authUserId,
          p_role: 'institution_admin',
          p_name: params.name,
          p_email: params.email,
          p_grade: null,
          p_board: normalized.board,
          p_school_name: normalized.schoolName,
          p_subjects_taught: null,
          p_grades_taught: null,
          p_phone: normalized.phone,
          p_link_code: null,
        }
      );
      const status =
        typeof (rpcResult as { status?: unknown } | null)?.status === 'string'
          ? (rpcResult as { status: string }).status
          : undefined;
      const profileId =
        typeof (rpcResult as { profile_id?: unknown } | null)?.profile_id === 'string'
          ? (rpcResult as { profile_id: string }).profile_id
          : null;
      if (!rpcErr && status !== 'error' && profileId) {
        schoolAdminId = profileId;
      } else if (rpcErr) {
        console.error(`${logPrefix} bootstrap_user_profile RPC failed:`, rpcErr.message);
      } else if (status === 'error') {
        console.error(`${logPrefix} bootstrap_user_profile returned a logical error`);
      }
    } catch (err) {
      console.error(
        `${logPrefix} bootstrap_user_profile threw:`,
        err instanceof Error ? err.message : err
      );
    }

    // Fallback (P15): if the RPC didn't yield a school_admins id, create the rows
    // directly (idempotent). School signup must never be blocked.
    if (!schoolAdminId) {
      schoolAdminId = await directSchoolAdminInsert(admin, params, normalized, logPrefix);
    }

    if (!schoolAdminId) {
      // Could not establish any school_admins row. Fail-soft: the auth flow still
      // redirects; the account can be repaired later.
      console.error(`${logPrefix} could not establish a school_admins row`);
      return notOk;
    }

    // Resolve the founding school so we can patch the columns the RPC can't carry.
    const schoolId = await resolveSchoolIdForAdmin(admin, schoolAdminId);
    if (schoolId) {
      await patchSchoolDetails(admin, schoolId, normalized, logPrefix);
    }

    // Guarantee onboarding_state (belt-and-suspenders — the RPC writes it on the
    // primary path; this also covers the direct-insert fallback). Idempotent.
    const onboardingStateWritten = await writeSchoolAdminOnboardingState(
      admin,
      params.authUserId,
      schoolAdminId,
      logPrefix
    );

    return { ok: true, schoolId, schoolAdminId, onboardingStateWritten };
  } catch (err) {
    // Absolute backstop — this helper must never throw into the auth flow (P15).
    console.error(
      `${logPrefix} school admin onboarding failed (non-fatal):`,
      err instanceof Error ? err.message : err
    );
    return notOk;
  }
}
