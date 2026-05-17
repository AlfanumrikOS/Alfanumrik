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

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  deliverEmail,
  truncateInviteCode,
  type EmailLocale,
} from '@/lib/email-delivery';

// ─── Slug + invite code helpers (mirror trial route) ───────────────────

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
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
    const { data: school, error: schoolError } = await admin
      .from('schools')
      .insert({
        name: school_name,
        code: finalSlug,
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

    // 5. Invite code for the school admin
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
          role: 'teacher',
          max_uses: 1,
          use_count: 0,
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

    logger.info('school_provisioning_created', {
      schoolId: schoolRow.id,
      slug: finalSlug,
      board,
      subscriptionCreated,
      inviteStored,
      inviteCodeTruncated: truncateInviteCode(inviteCode),
      sendEmail: input.sendEmail !== false,
    });

    // 6. Email dispatch — skipped when sendEmail===false (dry-run / bulk)
    let emailDispatched = false;
    if (input.sendEmail !== false && inviteStored) {
      const trialEndIso = new Date();
      trialEndIso.setDate(trialEndIso.getDate() + 90);
      const subdomainUrl = `https://${finalSlug}.alfanumrik.com`;

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
