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
 *   5. Set MAILGUN_API_KEY and MAILGUN_DOMAIN in Edge Functions -> Secrets
 *   6. Verify alfanumrik.com domain in Mailgun (DNS records: DKIM, SPF, DMARC)
 */

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0'

// Supabase stores the secret as "v1,whsec_<base64>" but standardwebhooks expects "whsec_<base64>"
const rawHookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') || ''
const hookSecret = rawHookSecret.startsWith('v1,') ? rawHookSecret.slice(3) : rawHookSecret
const mailgunApiKey = Deno.env.get('MAILGUN_API_KEY') || ''
const mailgunDomain = Deno.env.get('MAILGUN_DOMAIN') || ''
const FROM_EMAIL = 'Alfanumrik <noreply@alfanumrik.com>'
const REPLY_TO = 'support@alfanumrik.com'
const SITE_URL = Deno.env.get('SITE_URL') || 'https://alfanumrik.com'

// ─── Mailgun Email Sender ───────────────────────────────────────────────────
async function sendMailgunEmail(params: {
  to: string; subject: string; html: string; text: string;
  from?: string; replyTo?: string;
  headers?: Record<string, string>;
  tags?: Array<{ name: string; value: string }>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const form = new FormData()
  form.append('from', params.from || FROM_EMAIL)
  form.append('to', params.to)
  form.append('subject', params.subject)
  form.append('html', params.html)
  form.append('text', params.text)
  if (params.replyTo) form.append('h:Reply-To', params.replyTo)
  if (params.headers) {
    for (const [k, v] of Object.entries(params.headers)) form.append(`h:${k}`, v)
  }
  if (params.tags) {
    for (const t of params.tags) form.append('o:tag', `${t.name}:${t.value}`)
  }
  const res = await fetch(`https://api.mailgun.net/v3/${mailgunDomain}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Basic ${btoa(`api:${mailgunApiKey}`)}` },
    body: form,
  })
  if (!res.ok) return { success: false, error: await res.text() }
  const result = await res.json()
  return { success: true, id: result.id }
}

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

function confirmationEmail(url: string): { subject: string; html: string; text: string } {
  const subject = 'Verify your Alfanumrik account'
  const html = baseWrapper(`
          <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Verify your email address</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">Thank you for signing up for Alfanumrik! Click the button below to verify your email and start learning.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0;">
              <a href="${url}" style="display:inline-block;padding:12px 32px;background-color:#6C5CE7;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Verify Email Address</a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.5;">This link expires in 24 hours. If you did not create an account with Alfanumrik, you can safely ignore this email.</p>
          <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">If the button does not work, copy and paste this URL into your browser:<br><a href="${url}" style="color:#6C5CE7;word-break:break-all;">${url}</a></p>
    `, 'Verify your email address for Alfanumrik.')
  const text = `Verify your Alfanumrik account\n\nVerify your email by clicking this link:\n${url}\n\nThis link expires in 24 hours.\nIf you did not create an account, you can ignore this email.\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { subject, html, text }
}

function recoveryEmail(url: string): { subject: string; html: string; text: string } {
  const subject = 'Reset your Alfanumrik password'
  const html = baseWrapper(`
          <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Reset your password</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">We received a request to reset the password for your Alfanumrik account. Click the button below to set a new password.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0;">
              <a href="${url}" style="display:inline-block;padding:12px 32px;background-color:#6C5CE7;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Reset Password</a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.5;">This link expires in 1 hour. If you did not request a password reset, no action is needed - your account is secure.</p>
          <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">If the button does not work, copy and paste this URL into your browser:<br><a href="${url}" style="color:#6C5CE7;word-break:break-all;">${url}</a></p>
    `, 'Reset your Alfanumrik password.')
  const text = `Reset your Alfanumrik password\n\nReset your password by clicking this link:\n${url}\n\nThis link expires in 1 hour.\nIf you did not request this, no action is needed.\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { subject, html, text }
}

function magicLinkEmail(url: string): { subject: string; html: string; text: string } {
  const subject = 'Log in to Alfanumrik'
  const html = baseWrapper(`
          <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Log in to Alfanumrik</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">Click the button below to log in to your Alfanumrik account. No password is required.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0;">
              <a href="${url}" style="display:inline-block;padding:12px 32px;background-color:#6C5CE7;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Log In to Alfanumrik</a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.5;">This link expires in 24 hours and can only be used once. If you did not request this, you can ignore this email.</p>
          <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">If the button does not work, copy and paste this URL into your browser:<br><a href="${url}" style="color:#6C5CE7;word-break:break-all;">${url}</a></p>
    `, 'Log in to your Alfanumrik account.')
  const text = `Log in to Alfanumrik\n\nClick this link to log in:\n${url}\n\nThis link expires in 24 hours and can only be used once.\nIf you did not request this, you can ignore this email.\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { subject, html, text }
}

function emailChangeEmail(url: string): { subject: string; html: string; text: string } {
  const subject = 'Confirm your new email for Alfanumrik'
  const html = baseWrapper(`
          <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">Confirm your new email address</h2>
          <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">You requested to change the email address on your Alfanumrik account. Click the button below to confirm this change.</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding:8px 0;">
              <a href="${url}" style="display:inline-block;padding:12px 32px;background-color:#6C5CE7;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Confirm New Email</a>
            </td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.5;">If you did not request this change, please contact us at support@alfanumrik.com immediately.</p>
          <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;line-height:1.5;">If the button does not work, copy and paste this URL into your browser:<br><a href="${url}" style="color:#6C5CE7;word-break:break-all;">${url}</a></p>
    `, 'Confirm your new email for Alfanumrik.')
  const text = `Confirm your new email for Alfanumrik\n\nConfirm by visiting:\n${url}\n\nIf you did not request this change, please contact support@alfanumrik.com immediately.\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { subject, html, text }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
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
      console.error('[Auth Email] SEND_EMAIL_HOOK_SECRET is not set. Rejecting request. Configure the secret in Edge Functions → Secrets.')
      return new Response(JSON.stringify({ error: 'Webhook secret not configured' }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      })
    }

    try {
      const wh = new Webhook(hookSecret)
      data = wh.verify(payload, headers) as typeof data
    } catch (verifyErr) {
      console.error('[Auth Email] Webhook verification FAILED — rejecting:', (verifyErr as Error).message)
      return new Response(JSON.stringify({ error: 'Webhook verification failed' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { user, email_data } = data
    if (!user?.email || !email_data) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { token, token_hash, redirect_to, email_action_type } = email_data

    // Always use our app URL — never trust site_url from Supabase payload
    // (Supabase may send its own project URL which causes "No API key" errors)
    const baseSiteUrl = SITE_URL

    // Build link-based verification URL only (no OTP codes)
    let actionUrl: string
    if (token_hash) {
      actionUrl = `${baseSiteUrl}/auth/confirm?token_hash=${token_hash}&type=${email_action_type}`
      if (redirect_to) {
        // redirect_to may be a full URL (e.g. https://alfanumrik.com/auth/callback?type=signup)
        // The confirm route prepends its own origin, so we must pass only the path portion
        let nextPath = redirect_to
        try {
          const parsed = new URL(redirect_to)
          nextPath = parsed.pathname + parsed.search
        } catch {
          // Already a relative path — use as-is
        }
        actionUrl += `&next=${encodeURIComponent(nextPath)}`
      }
    } else if (token) {
      actionUrl = `${baseSiteUrl}/auth/callback?token=${token}&type=${email_action_type}`
    } else {
      actionUrl = `${baseSiteUrl}/dashboard`
    }

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

    if (!mailgunApiKey || !mailgunDomain) {
      console.warn('[Auth Email] MAILGUN_API_KEY or MAILGUN_DOMAIN not set. Returning 200 so Supabase built-in email can work.')
      return new Response(JSON.stringify({ success: true, warning: 'no_mailgun_config' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    let sent = false
    try {
      const result = await sendMailgunEmail({
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        from: FROM_EMAIL,
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
      })

      if (result.error) {
        console.error('[Auth Email] Mailgun error:', result.error)
      } else {
        console.log(`[Auth Email] Sent ${email_action_type} email to ${user.email}, id: ${result.id}`)
        sent = true
      }
    } catch (sendErr) {
      console.error('[Auth Email] Send exception:', sendErr)
    }

    if (!sent) {
      console.error('[Auth Email] Send failed for', user.email, '- check domain verification in Mailgun dashboard')
    }

    // ALWAYS return 200 — never block the auth flow
    return new Response(JSON.stringify({ success: sent }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[Auth Email] Error:', err)
    // ALWAYS return 200 — a broken email must never block signup/login
    return new Response(JSON.stringify({ success: false, error: (err as Error).message || 'Internal error' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
})
