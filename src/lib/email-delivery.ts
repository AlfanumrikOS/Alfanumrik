/**
 * email-delivery.ts — fire-and-forget transactional email helper.
 *
 * Invokes the `send-transactional-email` Edge Function for school-onboarding
 * flows (trial provisioned, invite-code issued). The Edge Function wraps the
 * Mailgun provider used by the rest of the platform (`send-auth-email`,
 * `send-welcome-email`, `alert-deliverer`) — no new email-provider library is
 * introduced.
 *
 * RULES (Phase B.2):
 *   - Caller MUST NOT await this if the surrounding business operation should
 *     succeed even when email delivery fails. Use `void deliverEmail(...)` or
 *     `deliverEmail(...).catch(noop)`.
 *   - Idempotency: each call records an `ops_events` row keyed by the
 *     invite-code (subject_id). On a Vercel function retry the second invocation
 *     short-circuits before contacting Mailgun.
 *   - Never log full invite codes at INFO. Truncate to first 4 chars + `****`.
 */

import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

export type EmailTemplate =
  | 'school-trial-provisioned'
  | 'school-invite-code-issued'
  | 'parent-link-code-otp';

export type EmailLocale = 'en' | 'hi';

export interface EmailTemplateParams {
  // school-onboarding templates use these.
  school_name?: string;
  invite_code?: string;
  expires_at?: string;
  subdomain_url?: string;
  recipient_name?: string;
  /**
   * Fully-formed admin-claim URL embedding the RAW one-time claim token
   * (e.g. `https://alfanumrik.com/school-admin/claim?token=<raw>`). Travels
   * ONLY in the email body — never logged, never persisted in plaintext (P13).
   * Present for the principal's `school-trial-provisioned` email so the claim
   * flow is reachable end-to-end. Absent for teacher/student invite emails.
   */
  claim_url?: string;
  // parent-link-code-otp uses these. We share the type rather than adding a
  // union — the Edge Function validates the right combination per template.
  otp?: string;
  // Idempotency / log key for the OTP path. Required so the email-delivery
  // idempotency guard keyed on invite_code doesn't accidentally collapse two
  // distinct OTP challenges (each new request-otp call must email a fresh
  // OTP). The route layer passes a fresh challenge id here.
  idempotency_key?: string;
}

export interface DeliverEmailInput {
  template: EmailTemplate;
  to: string;
  locale?: EmailLocale;
  params: EmailTemplateParams;
}

export interface DeliverEmailResult {
  sent: boolean;
  skipped?: 'already_sent' | 'no_email' | 'no_config';
  id?: string;
  error?: string;
}

/** Truncate an invite code for log lines. Never log the full code at INFO. */
export function truncateInviteCode(code: string | null | undefined): string {
  if (!code) return '<empty>';
  return code.length <= 4 ? '****' : code.slice(0, 4) + '****';
}

/**
 * Pick a locale from an Accept-Language header. Only `hi` and `en` are
 * supported — anything else (including `hi-IN`, `en-US`, regional variants)
 * normalises to its primary subtag. Default `en`.
 */
export function pickLocaleFromAcceptLanguage(header: string | null | undefined): EmailLocale {
  if (!header) return 'en';
  const primary = header.split(',')[0]?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (primary.startsWith('hi')) return 'hi';
  return 'en';
}

/**
 * Check whether an email for this template + invite_code has already been
 * dispatched via `ops_events`. Returns true if a prior `email.sent` row exists
 * for the same code.
 */
async function alreadySent(
  template: EmailTemplate,
  inviteCode: string
): Promise<boolean> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('ops_events')
      .select('id')
      .eq('category', 'email')
      .eq('source', `email-delivery/${template}`)
      .eq('subject_type', 'invite_code')
      .eq('subject_id', inviteCode)
      .limit(1);

    if (error) {
      // If the idempotency lookup itself errors, fall through and attempt the
      // send — it's better to risk a duplicate than to silently drop the email.
      logger.warn('email_delivery_idempotency_lookup_failed', {
        template,
        codeTruncated: truncateInviteCode(inviteCode),
        reason: error.message,
      });
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    logger.warn('email_delivery_idempotency_exception', {
      template,
      codeTruncated: truncateInviteCode(inviteCode),
      reason: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Record a send (or attempted send) in `ops_events` so that follow-up retries
 * are short-circuited. Best-effort — failures are logged but never thrown.
 */
async function recordSent(
  template: EmailTemplate,
  inviteCode: string,
  meta: Record<string, unknown>
): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const now = new Date().toISOString();
    await admin.from('ops_events').insert({
      occurred_at: now,
      recorded_at: now,
      category: 'email',
      source: `email-delivery/${template}`,
      severity: 'info',
      subject_type: 'invite_code',
      subject_id: inviteCode,
      message: `transactional email dispatched (${template})`,
      context: meta,
      environment: process.env.NODE_ENV ?? 'production',
    });
  } catch (err) {
    logger.warn('email_delivery_record_sent_failed', {
      template,
      codeTruncated: truncateInviteCode(inviteCode),
      reason: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Fire the transactional email Edge Function. Returns a structured result but
 * NEVER throws — callers should treat this as fire-and-forget.
 */
export async function deliverEmail(input: DeliverEmailInput): Promise<DeliverEmailResult> {
  const { template, to, locale = 'en', params } = input;

  // OTP path: keyed on a per-challenge idempotency key, since each
  // request-otp invocation MUST email a fresh code. School-onboarding path
  // remains keyed on invite_code (1 email per code, ever).
  const isOtp = template === 'parent-link-code-otp';
  const idempotencyKey = isOtp
    ? params?.idempotency_key
    : params?.invite_code;

  if (!to || !idempotencyKey) {
    logger.warn('email_delivery_missing_input', {
      template,
      hasTo: !!to,
      hasKey: !!idempotencyKey,
    });
    return { sent: false, skipped: 'no_email' };
  }

  // Idempotency guard — short-circuit if we've already sent for this key.
  if (await alreadySent(template, idempotencyKey)) {
    logger.info('email_delivery_skipped_duplicate', {
      template,
      codeTruncated: truncateInviteCode(idempotencyKey),
    });
    return { sent: false, skipped: 'already_sent' };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    logger.warn('email_delivery_supabase_env_missing', {
      template,
      codeTruncated: truncateInviteCode(params.invite_code),
    });
    return { sent: false, skipped: 'no_config' };
  }

  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/send-transactional-email`;
  let result: DeliverEmailResult = { sent: false };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ template, to, locale, params }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    let body: { sent?: boolean; id?: string; error?: string } = {};
    try {
      body = await res.json();
    } catch {
      // Some Edge Function failure modes return non-JSON — keep body empty.
    }

    if (res.ok && body.sent) {
      result = { sent: true, id: body.id };
      logger.info('email_delivery_sent', {
        template,
        codeTruncated: truncateInviteCode(idempotencyKey),
        providerId: body.id,
        locale,
      });
    } else {
      result = { sent: false, error: body.error ?? `http_${res.status}` };
      logger.warn('email_delivery_provider_failed', {
        template,
        codeTruncated: truncateInviteCode(idempotencyKey),
        status: res.status,
        providerError: body.error,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { sent: false, error: message };
    logger.warn('email_delivery_fetch_failed', {
      template,
      codeTruncated: truncateInviteCode(idempotencyKey),
      reason: message,
    });
  }

  // Record the attempt regardless of outcome — a failed send still counts for
  // idempotency purposes (we don't want to retry a hard provider rejection on
  // every Vercel request). Future operator action (resend-invites UI) lives
  // outside this path.
  await recordSent(template, idempotencyKey, {
    sent: result.sent,
    providerId: result.id ?? null,
    error: result.error ?? null,
    locale,
  });

  return result;
}
