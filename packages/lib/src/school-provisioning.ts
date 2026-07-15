/**
 * school-provisioning.ts — shared trial-school provisioning helper.
 *
 * Extracted from `POST /api/schools/trial` so that the super-admin bulk
 * onboard endpoint (`POST /api/super-admin/institutions/bulk-onboard`) can
 * call the same logic per CSV row without duplicating it inline.
 *
 * The trial route layer remains responsible for HTTP concerns
 * (rate-limit, response shape, Accept-Language locale picking) and only
 * delegates the DB writes + optional email dispatch to this helper.
 *
 * RULES:
 *   - `sendEmail: false` MUST suppress the transactional email — used by
 *     bulk dry-run and by the bulk route's email-deferred flow if we add
 *     batched mail later.
 *   - Idempotency: if a school with `principal_email` already exists, the
 *     helper returns `{ status: 'already_exists' }` WITHOUT throwing.
 *     Callers (bulk endpoint) mark such rows as `skipped`.
 *   - Failures inside subscription/invite inserts do NOT roll back the
 *     school row — same behaviour as the trial route. The caller logs
 *     `subscriptionCreated` / `inviteStored` flags for observability.
 */

import { createHash, randomBytes } from 'crypto';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import {
  deliverEmail,
  truncateInviteCode,
  type EmailLocale,
} from '@alfanumrik/lib/email-delivery';
// Phase 3b (B2): the trial/bulk provisioning path shares the onboarding_state
// writer with the self-serve signup path so both flows produce an identical
// school-admin onboarding shape (school_admins.role='principal' + a completed
// onboarding_state row). Fail-soft — see writeSchoolAdminOnboardingState.
import { writeSchoolAdminOnboardingState } from '@alfanumrik/lib/identity/school-admin-bootstrap';

// ─── Slug + invite code helpers (mirror trial route) ───────────────────

/**
 * Canonical slug normaliser shared by both provisioning paths.
 * Produces a lowercase, hyphen-delimited, alphanumeric string safe for use as
 * a URL path segment and a DB `slug` / `code` column.
 *
 * Examples:
 *   normalizeSlug("St. Xavier's High School")  → "st-xaviers-high-school"
 *   normalizeSlug("  ABC   School ")           → "abc-school"
 *   normalizeSlug("School #1 (Bengaluru)")     → "school-1-bengaluru"
 */
export function normalizeSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** @deprecated Use normalizeSlug() instead. */
function generateSlug(name: string): string {
  return normalizeSlug(name);
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── Admin auth-user + claim-token helpers ─────────────────────────────

/** Days a freshly-issued admin claim token stays valid. */
export const ADMIN_CLAIM_TOKEN_TTL_DAYS = 90;

/**
 * Hash a raw claim token for at-rest storage. Only the SHA-256 hash is ever
 * persisted in `school_admin_claim_tokens`; the raw token is emailed to the
 * principal and never logged. Mirrors the standard "store the hash, mail the
 * secret" pattern used for school_api_keys.key_hash.
 */
export function hashClaimToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/** Generate a high-entropy, URL-safe admin claim token (not the 8-char code). */
function generateClaimToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Canonical app host for principal-facing links. The claim flow lives on the
 * apex host (a stable, already-TLS-terminated origin) rather than the school's
 * `<slug>.alfanumrik.com` subdomain — wildcard subdomain TLS/routing is a
 * separate concern and must never block the principal from reaching the claim
 * screen. Overridable via NEXT_PUBLIC_APP_URL for non-prod environments.
 */
function appHost(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://alfanumrik.com').replace(/\/$/, '');
}

/**
 * Build the fully-formed admin-claim URL embedding the RAW one-time token.
 * The raw token rides ONLY in this URL inside the email body (over TLS) and is
 * never logged nor persisted in plaintext (P13). URL-encode the token so the
 * base64url value survives query-string transport intact.
 */
export function buildClaimUrl(rawToken: string): string {
  return `${appHost()}/school-admin/claim?token=${encodeURIComponent(rawToken)}`;
}

type AdminClient = ReturnType<typeof getSupabaseAdmin>;

/**
 * Idempotently resolve (find-or-create) the Supabase auth user for an email.
 * Returns the auth user id, or null on unrecoverable failure. Mirrors the
 * create-then-link pattern in /api/school-admin/staff: try createUser; on the
 * duplicate-email error, list and match. NEVER logs the email (P13).
 */
async function resolveOrCreateAuthUser(
  admin: AdminClient,
  email: string,
  name: string | null,
): Promise<string | null> {
  const tempPassword = `Alf${randomBytes(6).toString('base64url')}!${Math.floor(Math.random() * 1000)}`;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { role: 'institution_admin', ...(name ? { name } : {}) },
  });

  if (created?.user?.id) return created.user.id;

  if (createErr) {
    // Likely "already registered" — find and link the existing auth user.
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) {
      logger.error('school_provisioning_admin_user_lookup_failed', {
        reason: listErr.message,
      });
      return null;
    }
    const match = list?.users?.find((u) => (u.email ?? '').toLowerCase() === email);
    return match?.id ?? null;
  }

  return null;
}

/**
 * Result of attempting to claim an admin invite (POST /api/schools/claim-admin).
 * `status` is a discriminated tag so the route can map it to an HTTP code without
 * re-deriving intent. Idempotent: replaying an already-consumed token for the SAME
 * principal returns `already_claimed` (a success), never an error.
 */
export type ClaimAdminResult =
  | {
      status: 'claimed';
      school_id: string;
      school_admin_id: string;
      auth_user_id: string;
      /**
       * Whether the principal's password was GENUINELY updated in GoTrue. False
       * when no password was supplied OR when the best-effort updateUserById call
       * failed (a password failure never blocks activation — P15). The route
       * surfaces this so the client can tell the principal to use reset-password.
       */
      password_set: boolean;
    }
  | { status: 'already_claimed'; school_id: string; school_admin_id: string; auth_user_id: string }
  | { status: 'invalid_token' }
  | { status: 'expired' }
  | { status: 'failed'; error: string };

/**
 * Verify a raw admin claim token and activate the matching school_admins link.
 *
 * Flow (all via the service-role admin client; server-only):
 *   1. hash the raw token and look it up in `school_admin_claim_tokens`;
 *   2. reject unknown (`invalid_token`) or past-expiry (`expired`) tokens;
 *   3. if the token was already consumed, treat as idempotent success
 *      (`already_claimed`) — re-POSTing the same link must not 4xx the principal;
 *   4. otherwise: optionally set the principal's password (admin updateUserById),
 *      stamp `school_admins.accepted_at` + ensure `is_active=true`, and mark the
 *      token `consumed_at`.
 *
 * NEVER logs the raw token, the password, or the principal's email (P13). The
 * raw token and password live only in the request body and the GoTrue call.
 */
export async function claimAdminToken(
  admin: AdminClient,
  rawToken: string,
  newPassword: string | null,
): Promise<ClaimAdminResult> {
  if (!rawToken || rawToken.length < 16) {
    return { status: 'invalid_token' };
  }
  const tokenHash = hashClaimToken(rawToken);

  try {
    const { data: tokenRow, error: lookupErr } = await admin
      .from('school_admin_claim_tokens')
      .select('id, school_id, school_admin_id, expires_at, consumed_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (lookupErr) {
      logger.error('school_admin_claim_lookup_failed', { reason: lookupErr.message });
      return { status: 'failed', error: 'Claim lookup failed.' };
    }
    if (!tokenRow) {
      return { status: 'invalid_token' };
    }

    const row = tokenRow as {
      id: string;
      school_id: string;
      school_admin_id: string;
      expires_at: string;
      consumed_at: string | null;
    };

    // Resolve the auth user behind the linked school_admins row (needed for the
    // response + the optional password set). A missing link is unrecoverable here.
    const { data: linkRow } = await admin
      .from('school_admins')
      .select('id, auth_user_id, is_active')
      .eq('id', row.school_admin_id)
      .maybeSingle();
    const link = linkRow as { id: string; auth_user_id: string; is_active: boolean } | null;
    if (!link) {
      logger.error('school_admin_claim_missing_link', { schoolId: row.school_id });
      return { status: 'failed', error: 'Admin link not found.' };
    }

    // Idempotent: an already-consumed token is a no-op success for the same link.
    if (row.consumed_at) {
      return {
        status: 'already_claimed',
        school_id: row.school_id,
        school_admin_id: row.school_admin_id,
        auth_user_id: link.auth_user_id,
      };
    }

    // Expiry check (only for not-yet-consumed tokens).
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return { status: 'expired' };
    }

    // Optionally set the principal's password (they were created with a random
    // temp password during provisioning). Best-effort: a password-set failure
    // must NOT block activation — the principal can still use the magic-link /
    // reset-password path. NEVER log the password. We thread the REAL outcome
    // into the result so the route reports whether the password genuinely stuck.
    let passwordSet = false;
    if (newPassword && newPassword.length >= 8) {
      const { error: pwErr } = await admin.auth.admin.updateUserById(link.auth_user_id, {
        password: newPassword,
      });
      if (pwErr) {
        logger.warn('school_admin_claim_password_set_skipped', {
          schoolId: row.school_id,
          reason: pwErr.message,
        });
      } else {
        passwordSet = true;
      }
    }

    const nowIso = new Date().toISOString();

    // Activate the link: stamp accepted_at + ensure active. Idempotent UPDATE.
    const { error: activateErr } = await admin
      .from('school_admins')
      .update({ accepted_at: nowIso, is_active: true, updated_at: nowIso })
      .eq('id', row.school_admin_id);
    if (activateErr) {
      logger.error('school_admin_claim_activate_failed', {
        schoolId: row.school_id,
        reason: activateErr.message,
      });
      return { status: 'failed', error: 'Failed to activate admin link.' };
    }

    // Consume the token (so it can't be replayed by a third party). A failure
    // here is non-fatal — the link is already active; worst case the token stays
    // claimable until expiry, and the next claim hits the already_claimed branch.
    const { error: consumeErr } = await admin
      .from('school_admin_claim_tokens')
      .update({ consumed_at: nowIso })
      .eq('id', row.id)
      .is('consumed_at', null);
    if (consumeErr) {
      logger.warn('school_admin_claim_consume_skipped', {
        schoolId: row.school_id,
        reason: consumeErr.message,
      });
    }

    return {
      status: 'claimed',
      school_id: row.school_id,
      school_admin_id: row.school_admin_id,
      auth_user_id: link.auth_user_id,
      password_set: passwordSet,
    };
  } catch (err) {
    logger.error('school_admin_claim_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return { status: 'failed', error: 'Unexpected claim error.' };
  }
}

export interface EstablishPrincipalAdminResult {
  /** Whether a school_admins link now exists & is active for this principal. */
  linked: boolean;
  authUserId: string | null;
  schoolAdminId: string | null;
  /** Raw claim token (emailed; never stored/logged) when a token was minted. */
  claimToken: string | null;
}

/**
 * Establish the principal's path to log in as their school's admin:
 *   1. find-or-create the Supabase auth user for `principalEmail`;
 *   2. idempotently INSERT a `school_admins` row (role 'principal') linking that
 *      auth user to `schoolId` (the `sync_school_admin_role` trigger then grants
 *      the institution_admin RBAC role);
 *   3. mint a one-time admin claim token (store only its hash) so the principal
 *      can accept/activate via POST /api/schools/claim-admin.
 *
 * Fully idempotent: if a school_admins row already exists for this auth user +
 * school, it is reused (and reactivated if revoked) rather than duplicated.
 * Failures here are NON-FATAL to provisioning (the school row already exists) —
 * the caller logs `linked` for observability and a super-admin can repair via
 * POST /api/super-admin/institutions/[id]/admins.
 */
export async function establishPrincipalAdmin(
  admin: AdminClient,
  schoolId: string,
  principalEmail: string,
  principalName: string | null,
  invitedBy: string | null,
): Promise<EstablishPrincipalAdminResult> {
  const empty: EstablishPrincipalAdminResult = {
    linked: false,
    authUserId: null,
    schoolAdminId: null,
    claimToken: null,
  };

  const authUserId = await resolveOrCreateAuthUser(admin, principalEmail, principalName);
  if (!authUserId) return empty;

  const nowIso = new Date().toISOString();

  // Idempotent link: reuse an existing row for this auth user + school.
  let schoolAdminId: string | null = null;
  const { data: existing } = await admin
    .from('school_admins')
    .select('id, is_active')
    .eq('school_id', schoolId)
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (existing) {
    schoolAdminId = (existing as { id: string }).id;
    if (!(existing as { is_active: boolean }).is_active) {
      await admin
        .from('school_admins')
        .update({ is_active: true, updated_at: nowIso })
        .eq('id', schoolAdminId);
    }
  } else {
    const { data: inserted, error: insertErr } = await admin
      .from('school_admins')
      .insert({
        auth_user_id: authUserId,
        school_id: schoolId,
        role: 'principal',
        name: principalName,
        email: principalEmail,
        is_active: true,
        invited_by: invitedBy,
        invited_at: nowIso,
      })
      .select('id')
      .single();

    if (insertErr || !inserted) {
      logger.error('school_provisioning_admin_link_failed', {
        schoolId,
        reason: insertErr?.message ?? 'no row returned',
      });
      return { ...empty, authUserId };
    }
    schoolAdminId = (inserted as { id: string }).id;
  }

  // Phase 3b (B2): write the SAME onboarding_state row the self-serve signup
  // path writes (intended_role='institution_admin', step='completed',
  // profile_id=school_admins.id), so a provisioned/claimed principal is visible
  // to resolveIdentity() / onboarding-status / repair exactly like a self-serve
  // school admin. Fully fail-soft (P15): a failure here never blocks
  // provisioning — the school + admin rows already exist.
  if (schoolAdminId) {
    await writeSchoolAdminOnboardingState(
      admin,
      authUserId,
      schoolAdminId,
      '[SchoolProvisioning]'
    );
  }

  // Mint a one-time claim token (store hash only). Best-effort — a failure here
  // still leaves a usable admin link (the super-admin repair path can re-issue).
  let claimToken: string | null = null;
  try {
    const raw = generateClaimToken();
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + ADMIN_CLAIM_TOKEN_TTL_DAYS);
    const { error: tokenErr } = await admin
      .from('school_admin_claim_tokens')
      .insert({
        school_id: schoolId,
        school_admin_id: schoolAdminId,
        token_hash: hashClaimToken(raw),
        expires_at: expiry.toISOString(),
      });
    if (!tokenErr) {
      claimToken = raw;
    } else {
      logger.warn('school_provisioning_claim_token_insert_skipped', {
        schoolId,
        reason: tokenErr.message,
      });
    }
  } catch (err) {
    logger.warn('school_provisioning_claim_token_table_missing', {
      schoolId,
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  return { linked: true, authUserId, schoolAdminId, claimToken };
}

// ─── Public API ────────────────────────────────────────────────────────

export interface ProvisionTrialSchoolInput {
  school_name: string;
  principal_name: string;
  principal_email: string;
  board?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  /** When false, suppress the transactional email send entirely. */
  sendEmail?: boolean;
  /** Locale for the transactional email; defaults to 'en'. */
  locale?: EmailLocale;
  /**
   * Optional auth_user_id of the actor provisioning this school (e.g. the
   * super-admin running bulk-onboard). Stored as school_admins.invited_by for
   * attribution. Null for the self-serve public trial path.
   */
  invitedBy?: string | null;
}

export type ProvisionTrialSchoolResult =
  | {
      status: 'created';
      school_id: string;
      slug: string;
      subdomain: string;
      invite_code?: string;
      trial_days: number;
      seats: number;
      subscription_created: boolean;
      invite_stored: boolean;
      email_dispatched: boolean;
      /** Whether the principal's school_admins login link was established. */
      admin_linked: boolean;
      /** The principal's school_admins row id (when linked). */
      school_admin_id?: string;
    }
  | {
      status: 'already_exists';
      existing_school_id: string;
    }
  | {
      status: 'validation_error';
      error: string;
    }
  | {
      status: 'failed';
      error: string;
    };

/**
 * Validate input + create a trial school. Returns a discriminated union so
 * callers (route, bulk) can branch on `status` without re-implementing
 * validation. Does NOT throw on duplicate-email — caller decides skip vs fail.
 *
 * Email is only dispatched when `sendEmail !== false` AND the invite code
 * row persisted to `school_invite_codes`. This preserves the rule that
 * dry-run mode (sendEmail=false) is side-effect free w.r.t. mail.
 */
export async function provisionTrialSchool(
  input: ProvisionTrialSchoolInput,
): Promise<ProvisionTrialSchoolResult> {
  const school_name = (input.school_name ?? '').trim();
  const principal_name = (input.principal_name ?? '').trim();
  const principal_email = (input.principal_email ?? '').trim().toLowerCase();
  const board = (input.board ?? 'CBSE').trim() || 'CBSE';
  const city = input.city ? String(input.city).trim() : null;
  const state = input.state ? String(input.state).trim() : null;
  const phone = input.phone ? String(input.phone).trim() : null;

  if (!school_name) {
    return { status: 'validation_error', error: 'School name is required.' };
  }
  if (!principal_name) {
    return { status: 'validation_error', error: 'Principal name is required.' };
  }
  if (!principal_email || !validateEmail(principal_email)) {
    return { status: 'validation_error', error: 'Valid email address is required.' };
  }
  if (school_name.length > 200 || principal_name.length > 100 || principal_email.length > 254) {
    return { status: 'validation_error', error: 'Input exceeds maximum length.' };
  }

  try {
    const admin = getSupabaseAdmin();

    // 1. Unique slug for the school `code` column
    let baseSlug = generateSlug(school_name);
    if (!baseSlug) baseSlug = 'school';

    let finalSlug = baseSlug;
    let slugAttempt = 0;
    const MAX_SLUG_ATTEMPTS = 10;
    while (slugAttempt < MAX_SLUG_ATTEMPTS) {
      const { data: existing } = await admin
        .from('schools')
        .select('id')
        .eq('code', finalSlug)
        .maybeSingle();
      if (!existing) break;
      slugAttempt++;
      finalSlug = `${baseSlug}-${slugAttempt}`;
    }
    if (slugAttempt >= MAX_SLUG_ATTEMPTS) {
      finalSlug = `${baseSlug}-${Date.now().toString(36).slice(-4)}`;
    }

    // 2. Duplicate-email check (idempotent skip path for bulk callers)
    const { data: existingSchool } = await admin
      .from('schools')
      .select('id')
      .eq('email', principal_email)
      .maybeSingle();

    if (existingSchool) {
      return {
        status: 'already_exists',
        existing_school_id: (existingSchool as { id: string }).id,
      };
    }

    // 3. Create school row
    // NOTE: both `code` and `slug` are written with the same finalSlug value so
    // that self-serve-provisioned schools are discoverable via /api/schools/join
    // (which filters on the `slug` column) as well as legacy code-keyed look-ups.
    const { data: school, error: schoolError } = await admin
      .from('schools')
      .insert({
        name: school_name,
        code: finalSlug,
        slug: finalSlug,
        board,
        city,
        state,
        principal_name,
        email: principal_email,
        phone,
        school_type: 'private',
        is_active: true,
      })
      .select('id, code')
      .single();

    if (schoolError || !school) {
      logger.error('school_provisioning_create_failed', {
        error: schoolError ? new Error(schoolError.message) : new Error('No school returned'),
        slug: finalSlug,
      });
      return { status: 'failed', error: 'Failed to create school.' };
    }

    const schoolRow = school as { id: string; code: string };

    // 4. Subscription row (table may not exist yet — non-fatal)
    let subscriptionCreated = false;
    try {
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 30);
      const { error: subError } = await admin
        .from('school_subscriptions')
        .insert({
          school_id: schoolRow.id,
          plan: 'trial',
          seats_purchased: 50,
          price_per_seat_monthly: 0,
          status: 'trial',
          current_period_end: trialEnd.toISOString(),
        });
      if (!subError) {
        subscriptionCreated = true;
      } else {
        logger.warn('school_provisioning_subscription_insert_skipped', {
          schoolId: schoolRow.id,
          reason: subError.message,
        });
      }
    } catch {
      logger.warn('school_provisioning_subscription_table_missing', {
        schoolId: schoolRow.id,
      });
    }

    // 5. ADMIN invite code for the school's principal (admin-claim flow).
    //    CHANGED (Track A): role_type is now 'admin' (was 'teacher'). The
    //    principal's invite is an ADMIN claim, not a teacher join. Optional
    //    teacher invite-code generation is a separate, later concern.
    const inviteCode = generateInviteCode();
    let inviteStored = false;
    try {
      const inviteExpiry = new Date();
      inviteExpiry.setDate(inviteExpiry.getDate() + 90);
      const { error: inviteError } = await admin
        .from('school_invite_codes')
        .insert({
          school_id: schoolRow.id,
          code: inviteCode,
          role_type: 'admin',
          max_uses: 1,
          used_count: 0,
          expires_at: inviteExpiry.toISOString(),
        });
      if (!inviteError) {
        inviteStored = true;
      } else {
        logger.warn('school_provisioning_invite_code_insert_skipped', {
          schoolId: schoolRow.id,
          reason: inviteError.message,
        });
      }
    } catch {
      logger.warn('school_provisioning_invite_code_table_missing', {
        schoolId: schoolRow.id,
      });
    }

    // 6. Establish the principal's actual login path: find-or-create their auth
    //    user, link a school_admins (role 'principal') row, mint a claim token.
    //    Non-fatal — the school row already exists; admin_linked is reported.
    const adminLink = await establishPrincipalAdmin(
      admin,
      schoolRow.id,
      principal_email,
      principal_name,
      input.invitedBy ?? null,
    );

    logger.info('school_provisioning_created', {
      schoolId: schoolRow.id,
      slug: finalSlug,
      board,
      subscriptionCreated,
      inviteStored,
      adminLinked: adminLink.linked,
      inviteCodeTruncated: truncateInviteCode(inviteCode),
      sendEmail: input.sendEmail !== false,
    });

    // 7. Email dispatch — skipped when sendEmail===false (dry-run / bulk).
    //    The email carries the admin invite code (the principal's claim code).
    let emailDispatched = false;
    if (input.sendEmail !== false && inviteStored) {
      const trialEndIso = new Date();
      trialEndIso.setDate(trialEndIso.getDate() + 90);
      const subdomainUrl = `https://${finalSlug}.alfanumrik.com`;

      // P15: the principal needs the RAW claim token to actually claim. When the
      // claim token was minted (adminLink.claimToken non-null), embed it in a
      // fully-formed claim URL so the email is the delivery channel for it. The
      // raw token travels ONLY in the email body — never logged/persisted plain.
      const claimUrl = adminLink.claimToken ? buildClaimUrl(adminLink.claimToken) : undefined;

      void deliverEmail({
        template: 'school-trial-provisioned',
        to: principal_email,
        locale: input.locale ?? 'en',
        params: {
          school_name,
          invite_code: inviteCode,
          expires_at: trialEndIso.toISOString(),
          subdomain_url: subdomainUrl,
          recipient_name: principal_name,
          ...(claimUrl ? { claim_url: claimUrl } : {}),
        },
      }).catch((err) => {
        logger.warn('school_provisioning_email_dispatch_failed', {
          schoolId: schoolRow.id,
          codeTruncated: truncateInviteCode(inviteCode),
          reason: err instanceof Error ? err.message : String(err),
        });
      });
      emailDispatched = true;
    }

    return {
      status: 'created',
      school_id: schoolRow.id,
      slug: finalSlug,
      subdomain: `${finalSlug}.alfanumrik.com`,
      invite_code: inviteStored ? inviteCode : undefined,
      trial_days: 30,
      seats: 50,
      subscription_created: subscriptionCreated,
      invite_stored: inviteStored,
      email_dispatched: emailDispatched,
      admin_linked: adminLink.linked,
      school_admin_id: adminLink.schoolAdminId ?? undefined,
    };
  } catch (err) {
    logger.error('school_provisioning_unexpected_error', {
      error: err instanceof Error ? err : new Error(String(err)),
    });
    return {
      status: 'failed',
      error: err instanceof Error ? err.message : 'Unexpected provisioning error.',
    };
  }
}
