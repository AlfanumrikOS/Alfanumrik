/**
 * send-auth-email – Supabase Auth Send Email Hook
 *
 * Replaces default Supabase auth emails with branded Alfanumrik templates.
 * Uses standardwebhooks for payload verification as required by Supabase.
 *
 * Handles: signup confirmation, password recovery, magic link, email change.
 *
 * IMPORTANT: This function MUST always return HTTP 200.
 * Supabase Auth hooks treat non-200 responses as failures and will BLOCK
 * the entire auth operation (signup, reset, etc.). Even if email sending
 * fails, we return 200 so the user can still sign up.
 *
 * Setup:
 *   1. Deploy: supabase functions deploy send-auth-email --no-verify-jwt
 *   2. Go to Supabase Dashboard -> Authentication -> Hooks
 *   3. Enable "Send Email" hook -> select "HTTPS" -> paste URL:
 *      https://shktyoxqhundlvkiwguu.supabase.co/functions/v1/send-auth-email
 *   4. Copy the generated hook secret and set it as SEND_EMAIL_HOOK_SECRET
 *      in Edge Functions -> Secrets
 *   5. Set RESEND_API_KEY in Edge Functions -> Secrets
 *   6. Verify alfanumrik.com domain in Resend (DNS records: DKIM, SPF, DMARC)
 */

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'
import { createEmailIdempotencyKey } from '../_shared/reliability.ts'
import { redactPIIInText } from '../_shared/redact-pii.ts'
import { authEmailTokenDimension, buildAuthActionUrl } from '../_shared/auth-email-links.ts'
import { sendEmail } from '../_shared/relay-mailer.ts'

// Supabase stores the secret as "v1,whsec_<base64>" but standardwebhooks expects "whsec_<base64>"
const rawHookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') || ''
const hookSecret = rawHookSecret.startsWith('v1,') ? rawHookSecret.slice(3) : rawHookSecret
const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
// TRANSITIONAL Mailgun fallback (remove once Resend is confirmed live in prod).
// Email is attempted when EITHER Resend OR Mailgun is configured; the relay
// (_shared/relay-mailer.ts) prefers Resend and falls back to Mailgun at send
// time. Prod today has only MAILGUN_* set, so this keeps auth email flowing
// through the Resend cutover with zero downtime (P15).
const mailgunApiKey = Deno.env.get('MAILGUN_API_KEY') || ''
const mailgunDomain = Deno.env.get('MAILGUN_DOMAIN') || ''
const hasEmailTransport = Boolean(resendApiKey) || Boolean(mailgunApiKey && mailgunDomain)
const FROM_EMAIL = 'Alfanumrik <noreply@alfanumrik.com>'
const REPLY_TO = 'support@alfanumrik.com'
// R13 fix: SITE_URL configurable via env var for preview/staging deploys.
// Falls back to production URL if not set (safe default).
const SITE_URL = Deno.env.get('SITE_URL') || 'https://alfanumrik.com'

function baseWrapper(content: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <title>Alfanumrik</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border:1px solid #e4e4e7;">
        <tr><td style="padding:32px 32px 0;text-align:center;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#18181b;">Alfanumrik</p>
        </td></tr>
        <tr><td style="padding:24px 32px 32px;">
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e4e4e7;">
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;text-align:center;">
            Alfanumrik EdTech Pvt. Ltd., India<br>
            <a href="${SITE_URL}/privacy" style="color:#71717a;">Privacy</a> |
            <a href="${SITE_URL}/terms" style="color:#71717a;">Terms</a> |
            <a href="mailto:support@alfanumrik.com" style="color:#71717a;">Support</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/** Strip HTML tags and decode entities for plain-text email version */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '  - ')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([^<]*)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#169;/g, '(c)')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Bilingual (EN + HI) auth-email builder ─────────────────────────────────
//
// P7: GoTrue's Send-Email hook payload carries no UI locale, so we cannot know
// the recipient's language. Every auth email therefore stacks English first,
// then Hindi (Devanagari), in a single body. Technical terms (the "Alfanumrik"
// brand, email addresses) are left untranslated. One shared renderer keeps the
// button/URL-fallback markup identical across all four action types.
interface AuthEmailCopy {
  subject: string
  preheader: string
  enHeading: string
  enBody: string
  enCta: string
  enNote: string
  hiHeading: string
  hiBody: string
  hiCta: string
  hiNote: string
}

function ctaButton(url: string, label: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0;">
              <a href="${url}" style="display:inline-block;padding:12px 32px;background-color:#6C5CE7;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">${label}</a>
            </td></tr>
          </table>`
}

function urlFallback(url: string, label: string): string {
  return `<p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">${label}<br><a href="${url}" style="color:#6C5CE7;word-break:break-all;">${url}</a></p>`
}

function renderBilingualAuthEmail(url: string, copy: AuthEmailCopy): { subject: string; html: string; text: string } {
  const content = `
          <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">${copy.enHeading}</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">${copy.enBody}</p>
          ${ctaButton(url, copy.enCta)}
          <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.5;">${copy.enNote}</p>
          ${urlFallback(url, 'If the button does not work, copy and paste this URL into your browser:')}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;">
            <tr><td style="border-top:1px solid #e4e4e7;font-size:0;line-height:0;height:1px;">&nbsp;</td></tr>
          </table>
          <h2 lang="hi" style="margin:28px 0 16px;font-size:18px;font-weight:600;color:#18181b;">${copy.hiHeading}</h2>
          <p lang="hi" style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.7;">${copy.hiBody}</p>
          ${ctaButton(url, copy.hiCta)}
          <p lang="hi" style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.7;">${copy.hiNote}</p>
          ${urlFallback(url, 'यदि बटन काम नहीं करता, तो इस URL को अपने ब्राउज़र में कॉपी करके पेस्ट करें:')}
    `
  const html = baseWrapper(content, copy.preheader)
  const text = htmlToPlainText(content) + `\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { subject: copy.subject, html, text }
}

function confirmationEmail(url: string): { subject: string; html: string; text: string } {
  return renderBilingualAuthEmail(url, {
    subject: 'Verify your Alfanumrik account | अपना Alfanumrik खाता सत्यापित करें',
    preheader: 'Verify your email address for Alfanumrik. | अपना Alfanumrik ईमेल सत्यापित करें।',
    enHeading: 'Verify your email address',
    enBody: 'Thank you for signing up for Alfanumrik! Click the button below to verify your email and start learning.',
    enCta: 'Verify Email Address',
    enNote: 'This link expires in 24 hours. If you did not create an account with Alfanumrik, you can safely ignore this email.',
    hiHeading: 'अपना ईमेल पता सत्यापित करें',
    hiBody: 'Alfanumrik के लिए साइन अप करने के लिए धन्यवाद! अपना ईमेल सत्यापित करने और सीखना शुरू करने के लिए नीचे दिए गए बटन पर क्लिक करें।',
    hiCta: 'ईमेल पता सत्यापित करें',
    hiNote: 'यह लिंक 24 घंटे में समाप्त हो जाएगा। यदि आपने Alfanumrik पर खाता नहीं बनाया है, तो आप इस ईमेल को सुरक्षित रूप से अनदेखा कर सकते हैं।',
  })
}

function recoveryEmail(url: string): { subject: string; html: string; text: string } {
  return renderBilingualAuthEmail(url, {
    subject: 'Reset your Alfanumrik password | अपना Alfanumrik पासवर्ड रीसेट करें',
    preheader: 'Reset your Alfanumrik password. | अपना Alfanumrik पासवर्ड रीसेट करें।',
    enHeading: 'Reset your password',
    enBody: 'We received a request to reset the password for your Alfanumrik account. Click the button below to set a new password.',
    enCta: 'Reset Password',
    enNote: 'This link expires in 1 hour. If you did not request a password reset, no action is needed - your account is secure.',
    hiHeading: 'अपना पासवर्ड रीसेट करें',
    hiBody: 'हमें आपके Alfanumrik खाते का पासवर्ड रीसेट करने का अनुरोध प्राप्त हुआ है। नया पासवर्ड सेट करने के लिए नीचे दिए गए बटन पर क्लिक करें।',
    hiCta: 'पासवर्ड रीसेट करें',
    hiNote: 'यह लिंक 1 घंटे में समाप्त हो जाएगा। यदि आपने पासवर्ड रीसेट का अनुरोध नहीं किया है, तो कोई कार्रवाई आवश्यक नहीं है — आपका खाता सुरक्षित है।',
  })
}

function magicLinkEmail(url: string): { subject: string; html: string; text: string } {
  return renderBilingualAuthEmail(url, {
    subject: 'Log in to Alfanumrik | Alfanumrik में लॉग इन करें',
    preheader: 'Log in to your Alfanumrik account. | अपने Alfanumrik खाते में लॉग इन करें।',
    enHeading: 'Log in to Alfanumrik',
    enBody: 'Click the button below to log in to your Alfanumrik account. No password is required.',
    enCta: 'Log In to Alfanumrik',
    enNote: 'This link expires in 24 hours and can only be used once. If you did not request this, you can ignore this email.',
    hiHeading: 'Alfanumrik में लॉग इन करें',
    hiBody: 'अपने Alfanumrik खाते में लॉग इन करने के लिए नीचे दिए गए बटन पर क्लिक करें। किसी पासवर्ड की आवश्यकता नहीं है।',
    hiCta: 'Alfanumrik में लॉग इन करें',
    hiNote: 'यह लिंक 24 घंटे में समाप्त हो जाएगा और केवल एक बार उपयोग किया जा सकता है। यदि आपने इसका अनुरोध नहीं किया है, तो आप इस ईमेल को अनदेखा कर सकते हैं।',
  })
}

function emailChangeEmail(url: string): { subject: string; html: string; text: string } {
  return renderBilingualAuthEmail(url, {
    subject: 'Confirm your new email for Alfanumrik | अपना नया Alfanumrik ईमेल पुष्टि करें',
    preheader: 'Confirm your new email for Alfanumrik. | अपना नया Alfanumrik ईमेल पुष्टि करें।',
    enHeading: 'Confirm your new email address',
    enBody: 'You requested to change the email address on your Alfanumrik account. Click the button below to confirm this change.',
    enCta: 'Confirm New Email',
    enNote: 'If you did not request this change, please contact us at support@alfanumrik.com immediately.',
    hiHeading: 'अपना नया ईमेल पता पुष्टि करें',
    hiBody: 'आपने अपने Alfanumrik खाते का ईमेल पता बदलने का अनुरोध किया है। इस बदलाव की पुष्टि करने के लिए नीचे दिए गए बटन पर क्लिक करें।',
    hiCta: 'नया ईमेल पुष्टि करें',
    hiNote: 'यदि आपने यह बदलाव नहीं किया है, तो कृपया तुरंत support@alfanumrik.com पर हमसे संपर्क करें।',
  })
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const payload = await req.text()
    const headers = Object.fromEntries(req.headers)

    let data: {
      user: { email: string }
      email_data: {
        token: string
        token_hash: string
        redirect_to: string
        email_action_type: string
        site_url: string
        token_new: string
        token_hash_new: string
      }
    }

    // ── Webhook signature verification (MANDATORY) ──
    // Without this, anyone can trigger email sends to arbitrary addresses.
    // Fail closed: if the secret is not configured, reject all requests.
    if (!hookSecret) {
      console.error('[Auth Email] SEND_EMAIL_HOOK_SECRET is not set. Allowing auth to proceed but email hook is unconfigured. Configure the secret in Edge Functions → Secrets.')
      return new Response(JSON.stringify({ success: false, warning: 'Webhook secret not configured' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const wh = new Webhook(hookSecret)
      data = wh.verify(payload, headers) as typeof data
    } catch (verifyErr) {
      console.error('[Auth Email] Webhook verification FAILED — allowing auth to proceed but email will not be sent:', (verifyErr as Error).message)
      return new Response(JSON.stringify({ success: false, warning: 'Webhook verification failed' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { user, email_data } = data
    if (!user?.email || !email_data) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { token, token_hash, redirect_to, email_action_type, token_new, token_hash_new } = email_data

    // Always use our app URL — never trust site_url from Supabase payload
    // (Supabase may send its own project URL which causes "No API key" errors)
    const baseSiteUrl = SITE_URL

    // Route both token shapes through the same server-side verification path.
    // The app's /auth/callback handler is PKCE-only; token-based auth links
    // must go through /auth/confirm so the server can call verifyOtp.
    const actionUrl = buildAuthActionUrl({
      baseSiteUrl,
      emailActionType: email_action_type,
      token,
      tokenHash: token_hash,
      redirectTo: redirect_to,
      email: user.email,
    })

    let emailContent: { subject: string; html: string; text: string }
    switch (email_action_type) {
      case 'signup':
        emailContent = confirmationEmail(actionUrl)
        break
      case 'recovery':
        emailContent = recoveryEmail(actionUrl)
        break
      case 'magic_link':
        emailContent = magicLinkEmail(actionUrl)
        break
      case 'email_change_new':
      case 'email_change_current':
        emailContent = emailChangeEmail(actionUrl)
        break
      default:
        emailContent = confirmationEmail(actionUrl)
    }

    // Relay guard: if NO relay provider is configured (neither Resend nor the
    // transitional Mailgun fallback), return 200 so the auth operation still
    // succeeds (Supabase built-in email can take over). Never block signup/reset
    // on a missing email secret. The `no_relay_config` warning string is stable
    // (pinned by the always-200 Deno test).
    if (!hasEmailTransport) {
      console.warn('[Auth Email] No email relay configured (RESEND_API_KEY / MAILGUN_*). Returning 200 so Supabase built-in email can work.')
      return new Response(JSON.stringify({ success: true, warning: 'no_relay_config' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    // P15/idempotency: fold the per-auth token into the idempotency key so a
    // genuine retry of the SAME token dedupes (Resend honours Idempotency-Key
    // for 24h) while a re-requested confirmation/reset (a DISTINCT token) sends.
    const idempotencyKey = createEmailIdempotencyKey({
      template: 'auth_email',
      recipient: user.email,
      subject: emailContent.subject,
      correlationId: authEmailTokenDimension({
        token,
        tokenHash: token_hash,
        tokenNew: token_new,
        tokenHashNew: token_hash_new,
      }),
    })

    let sent = false
    try {
      const result = await sendEmail({
        from: FROM_EMAIL,
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        replyTo: REPLY_TO,
        headers: {
          'X-Entity-Ref-ID': `auth-${email_action_type}-${Date.now()}`,
          'List-Unsubscribe': '<mailto:unsubscribe@alfanumrik.com?subject=unsubscribe>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
        tags: [
          { name: 'category', value: 'auth' },
          { name: 'type', value: email_action_type },
        ],
        idempotencyKey,
        operation: 'send_auth_email',
      })

      // P13: user.email is PII; log a truncated form only. Audit 2026-04-27 F5.
      const redactedEmail = user.email.slice(0, 3) + '***@' + (user.email.split('@')[1] ?? 'unknown')

      if (result.success) {
        console.log(`[Auth Email] Sent ${email_action_type} email to ${redactedEmail}, id: ${result.id}`)
        sent = true
      } else {
        // result.code is a PII-free machine code (resend_http_<status> / resend_exception).
        console.error(`[Auth Email] Relay send failed for ${email_action_type} (${result.code ?? 'unknown'})`)
      }
    } catch (sendErr) {
      console.error('[Auth Email] Send exception:', redactPIIInText(sendErr instanceof Error ? sendErr.message : String(sendErr)).text)
    }

    if (!sent) {
      // P13: user.email is PII; log a truncated form only. Audit 2026-04-27 F5.
      const redactedEmailFail = user.email.slice(0, 3) + '***@' + (user.email.split('@')[1] ?? 'unknown')
      console.error('[Auth Email] Send failed for', redactedEmailFail, '- check RESEND_API_KEY and domain verification in Resend dashboard')
    }

    // ALWAYS return 200 — never block the auth flow
    return new Response(JSON.stringify({ success: sent }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    // P13: never surface raw err.message (may embed PII). Redact for the log,
    // return a stable PII-free code to the caller.
    console.error('[Auth Email] Error:', redactPIIInText(err instanceof Error ? err.message : String(err)).text)
    // ALWAYS return 200 — a broken email must never block signup/login
    return new Response(JSON.stringify({ success: false, error: 'internal_error' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
})
