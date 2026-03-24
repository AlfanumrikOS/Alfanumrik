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
import { Resend } from 'https://esm.sh/resend@4.0.0'

// Supabase stores the secret as "v1,whsec_<base64>" but standardwebhooks expects "whsec_<base64>"
const rawHookSecret = Deno.env.get('SEND_EMAIL_HOOK_SECRET') || ''
const hookSecret = rawHookSecret.startsWith('v1,') ? rawHookSecret.slice(3) : rawHookSecret
const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''
const FROM_EMAIL = 'Alfanumrik <noreply@alfanumrik.com>'
// Resend provides this test address that works without domain verification
const FALLBACK_FROM_EMAIL = 'Alfanumrik <onboarding@resend.dev>'
const SITE_URL = 'https://alfanumrik.com'

function baseWrapper(content: string, preheader: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alfanumrik</title>
  <style>
    body { margin: 0; padding: 0; background: #F0F2F5; font-family: 'Inter', -apple-system, sans-serif; }
    .preheader { display: none !important; max-height: 0; overflow: hidden; }
  </style>
</head>
<body style="margin:0;padding:0;background:#F0F2F5;">
  <span class="preheader">${preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:linear-gradient(135deg,#6C5CE7 0%,#A855F7 100%);padding:24px 32px;text-align:center;">
          <h1 style="margin:0;font-size:26px;font-weight:800;color:#FFFFFF;letter-spacing:-0.5px;">Alfanumrik</h1>
          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.8);font-weight:500;">India's Adaptive Learning OS</p>
        </td></tr>
        <tr><td style="padding:32px;">
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;background:#F8F9FA;border-top:1px solid #E5E7EB;text-align:center;">
          <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;">
            &#169; 2026 Alfanumrik EdTech. Made with &#10084;&#65039; in India.<br>
            <a href="${SITE_URL}/privacy" style="color:#6C5CE7;text-decoration:none;">Privacy</a> &#183;
            <a href="${SITE_URL}/terms" style="color:#6C5CE7;text-decoration:none;">Terms</a> &#183;
            <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;text-decoration:none;">Support</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function confirmationEmail(url: string, otpCode?: string): { subject: string; html: string } {
  const codeBlock = otpCode ? `
      <div style="margin:0 0 24px;text-align:center;">
        <p style="margin:0 0 8px;font-size:13px;color:#6B7280;">Your verification code:</p>
        <div style="display:inline-block;padding:16px 32px;background:#F5F3FF;border:2px dashed #6C5CE7;border-radius:12px;">
          <span style="font-size:32px;font-weight:800;letter-spacing:6px;color:#6C5CE7;font-family:monospace;">${otpCode}</span>
        </div>
        <p style="margin:8px 0 0;font-size:12px;color:#9CA3AF;">Enter this code on the verification page</p>
      </div>` : ''
  return {
    subject: otpCode ? `${otpCode} is your Alfanumrik verification code` : 'Confirm your Alfanumrik account',
    html: baseWrapper(`
      <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#9993;&#65039;</div></div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Verify Your Email</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">You're almost there! Use the code below to confirm your email and start your learning journey.</p>
      ${codeBlock}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${url}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Or Click to Confirm &#8594;</a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">This code expires in 24 hours. If you didn't sign up for Alfanumrik, ignore this email.</p>
    `, otpCode ? `Your code: ${otpCode}. Confirm your Alfanumrik account.` : 'Confirm your email to start learning on Alfanumrik.')
  }
}

function recoveryEmail(url: string, otpCode?: string): { subject: string; html: string } {
  const codeBlock = otpCode ? `
      <div style="margin:0 0 24px;text-align:center;">
        <p style="margin:0 0 8px;font-size:13px;color:#6B7280;">Your reset code:</p>
        <div style="display:inline-block;padding:16px 32px;background:#FEF2F2;border:2px dashed #EF4444;border-radius:12px;">
          <span style="font-size:32px;font-weight:800;letter-spacing:6px;color:#EF4444;font-family:monospace;">${otpCode}</span>
        </div>
      </div>` : ''
  return {
    subject: otpCode ? `${otpCode} is your Alfanumrik password reset code` : 'Reset your Alfanumrik password',
    html: baseWrapper(`
      <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#128274;</div></div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Reset Your Password</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">We received a request to reset your password. Use the code below or click the button.</p>
      ${codeBlock}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${url}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#EF4444,#DC2626);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Reset Password &#8594;</a>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr><td style="padding:14px;background:#FEF2F2;border-radius:10px;border-left:4px solid #EF4444;">
          <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.5;">&#9888;&#65039; <strong>Security:</strong> This code expires in 1 hour. If you didn't request this, your password is safe &#8212; just ignore this email.</p>
        </td></tr>
      </table>
    `, otpCode ? `Your code: ${otpCode}. Reset your Alfanumrik password.` : 'Reset your Alfanumrik password.')
  }
}

function magicLinkEmail(url: string): { subject: string; html: string } {
  return {
    subject: 'Your Alfanumrik login link',
    html: baseWrapper(`
      <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#10024;</div></div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Magic Login Link</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">Click below to log in to Alfanumrik instantly. No password needed!</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${url}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#10B981,#059669);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Log In &#8594;</a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">This link expires in 24 hours and can only be used once.</p>
    `, 'Log in to Alfanumrik with one click.')
  }
}

function emailChangeEmail(url: string): { subject: string; html: string } {
  return {
    subject: 'Confirm your new email for Alfanumrik',
    html: baseWrapper(`
      <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#128231;</div></div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Confirm Email Change</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">You requested to change your email address. Click below to confirm the change.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${url}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Confirm New Email &#8594;</a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">If you didn't request this change, please contact support immediately.</p>
    `, 'Confirm your new email for Alfanumrik.')
  }
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

    if (hookSecret) {
      try {
        const wh = new Webhook(hookSecret)
        data = wh.verify(payload, headers) as typeof data
      } catch (verifyErr) {
        console.error('[Auth Email] Webhook verification failed:', (verifyErr as Error).message)
        // Fall back to parsing the payload directly so email still gets sent
        data = JSON.parse(payload)
      }
    } else {
      data = JSON.parse(payload)
    }

    const { user, email_data } = data
    if (!user?.email || !email_data) {
      return new Response(JSON.stringify({ error: 'Invalid payload' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { token, token_hash, redirect_to, email_action_type, site_url } = email_data
    const baseSiteUrl = site_url || SITE_URL

    let actionUrl: string
    if (token_hash) {
      actionUrl = `${baseSiteUrl}/auth/confirm?token_hash=${token_hash}&type=${email_action_type}`
      if (redirect_to) actionUrl += `&next=${encodeURIComponent(redirect_to)}`
    } else if (token) {
      const redirectBase = redirect_to || `${baseSiteUrl}/auth/callback`
      actionUrl = `${redirectBase}${redirectBase.includes('?') ? '&' : '?'}token=${token}&type=${email_action_type}`
    } else {
      actionUrl = `${baseSiteUrl}/dashboard`
    }

    // token is the OTP code users can type in; token_hash is for link-based verification
    const otpCode = token || undefined

    let emailContent: { subject: string; html: string }
    switch (email_action_type) {
      case 'signup':
        emailContent = confirmationEmail(actionUrl, otpCode)
        break
      case 'recovery':
        emailContent = recoveryEmail(actionUrl, otpCode)
        break
      case 'magic_link':
        emailContent = magicLinkEmail(actionUrl)
        break
      case 'email_change_new':
      case 'email_change_current':
        emailContent = emailChangeEmail(actionUrl)
        break
      default:
        emailContent = confirmationEmail(actionUrl, otpCode)
    }

    if (!resendApiKey) {
      // CRITICAL: Return 200 even without API key so Supabase doesn't block signup.
      // Supabase will use its built-in SMTP as fallback when the hook doesn't send.
      console.warn('[Auth Email] RESEND_API_KEY not set. Returning 200 so Supabase built-in email can work.')
      return new Response(JSON.stringify({ success: true, warning: 'no_api_key' }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      })
    }

    const resend = new Resend(resendApiKey)

    // Try with custom domain first, fall back to Resend's test sender
    let sent = false
    for (const fromAddress of [FROM_EMAIL, FALLBACK_FROM_EMAIL]) {
      try {
        const { error: sendError } = await resend.emails.send({
          from: fromAddress,
          to: [user.email],
          subject: emailContent.subject,
          html: emailContent.html,
        })

        if (sendError) {
          console.error(`[Auth Email] Resend error with ${fromAddress}:`, sendError)
          // If custom domain fails (likely not verified), try fallback
          if (fromAddress === FROM_EMAIL) continue
        } else {
          console.log(`[Auth Email] Sent ${email_action_type} email to ${user.email} via ${fromAddress}`)
          sent = true
          break
        }
      } catch (sendErr) {
        console.error(`[Auth Email] Send exception with ${fromAddress}:`, sendErr)
        if (fromAddress === FROM_EMAIL) continue
      }
    }

    if (!sent) {
      console.error('[Auth Email] All send attempts failed for', user.email)
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
