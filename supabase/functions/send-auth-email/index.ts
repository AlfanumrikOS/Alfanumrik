/**
 * send-auth-email – Custom Auth Email Hook for Alfanumrik
 *
 * Supabase Auth Hook that replaces default email templates with
 * beautifully branded Alfanumrik emails for:
 *   - Email confirmation (signup)
 *   - Password reset (recovery)
 *   - Magic link login
 *
 * Configure in Supabase Dashboard -> Auth -> Email Templates -> Hook URL
 * JWT verification is disabled because this is called by Supabase Auth internally.
 */

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = 'Alfanumrik <noreply@alfanumrik.com>'
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
            &copy; 2026 Alfanumrik EdTech. Made with &#10084;&#65039; in India.<br>
            <a href="${SITE_URL}/privacy" style="color:#6C5CE7;text-decoration:none;">Privacy</a> &nbsp;|&nbsp;
            <a href="${SITE_URL}/terms" style="color:#6C5CE7;text-decoration:none;">Terms</a> &nbsp;|&nbsp;
            <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;text-decoration:none;">Support</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function confirmationEmail(confirmUrl: string): { subject: string; html: string } {
  return {
    subject: 'Confirm your Alfanumrik account',
    html: baseWrapper(`
      <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#9993;&#65039;</div></div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Verify Your Email</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">You're almost there! Click the button below to confirm your email address and start your learning journey.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${confirmUrl}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Confirm Email &#8594;</a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">This link expires in 24 hours. If you didn't create an Alfanumrik account, you can safely ignore this email.</p>
      <div style="margin:20px 0 0;padding:12px;background:#F5F3FF;border-radius:8px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#6B7280;word-break:break-all;">If the button doesn't work, copy and paste this link:<br><a href="${confirmUrl}" style="color:#6C5CE7;">${confirmUrl}</a></p>
      </div>
    `, 'Confirm your email to start learning on Alfanumrik.')
  }
}

function recoveryEmail(resetUrl: string): { subject: string; html: string } {
  return {
    subject: 'Reset your Alfanumrik password',
    html: baseWrapper(`
      <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#128274;</div></div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Reset Your Password</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">We received a request to reset your password. Click the button below to choose a new one.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${resetUrl}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#EF4444,#DC2626);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Reset Password &#8594;</a>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
        <tr><td style="padding:14px;background:#FEF2F2;border-radius:10px;border-left:4px solid #EF4444;">
          <p style="margin:0;font-size:13px;color:#991B1B;line-height:1.5;">&#9888;&#65039; <strong>Security notice:</strong> This link expires in 1 hour. If you didn't request a password reset, please ignore this email. Your password will remain unchanged.</p>
        </td></tr>
      </table>
      <div style="margin:20px 0 0;padding:12px;background:#FEF2F2;border-radius:8px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#6B7280;word-break:break-all;">If the button doesn't work, copy this link:<br><a href="${resetUrl}" style="color:#EF4444;">${resetUrl}</a></p>
      </div>
    `, 'Reset your Alfanumrik password. This link expires in 1 hour.')
  }
}

function magicLinkEmail(loginUrl: string): { subject: string; html: string } {
  return {
    subject: 'Your Alfanumrik login link',
    html: baseWrapper(`
      <div style="text-align:center;margin-bottom:20px;"><div style="font-size:48px;line-height:1;">&#10024;</div></div>
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:800;color:#1F2937;text-align:center;">Magic Login Link</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#6B7280;text-align:center;line-height:1.6;">Click the button below to log in to your Alfanumrik account. No password needed!</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${loginUrl}" style="display:inline-block;padding:14px 48px;background:linear-gradient(135deg,#10B981,#059669);color:#FFFFFF;font-size:15px;font-weight:700;text-decoration:none;border-radius:12px;">Log In &#8594;</a>
        </td></tr>
      </table>
      <p style="margin:20px 0 0;font-size:12px;color:#9CA3AF;text-align:center;line-height:1.6;">This link expires in 24 hours and can only be used once.</p>
    `, 'Log in to Alfanumrik with one click.')
  }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' },
    })
  }

  try {
    const body = await req.json()

    // Supabase Auth Hook format
    const { user, email_data } = body
    if (!user || !email_data) {
      return new Response(JSON.stringify({ error: 'Invalid hook payload' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const { email } = user
    const { token, token_hash, redirect_to, email_action_type } = email_data

    // Build the confirmation/reset URL
    let actionUrl = ''
    if (token_hash) {
      actionUrl = `${SITE_URL}/auth/confirm?token_hash=${token_hash}&type=${email_action_type}`
    } else if (token) {
      actionUrl = `${redirect_to || SITE_URL + '/auth/callback'}?token=${token}&type=${email_action_type}`
    } else {
      actionUrl = redirect_to || `${SITE_URL}/dashboard`
    }

    let emailContent: { subject: string; html: string }
    switch (email_action_type) {
      case 'signup':
      case 'email_change':
        emailContent = confirmationEmail(actionUrl)
        break
      case 'recovery':
        emailContent = recoveryEmail(actionUrl)
        break
      case 'magic_link':
        emailContent = magicLinkEmail(actionUrl)
        break
      default:
        emailContent = confirmationEmail(actionUrl)
    }

    // Send via Resend if configured
    if (RESEND_API_KEY) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
        body: JSON.stringify({ from: FROM_EMAIL, to: [email], subject: emailContent.subject, html: emailContent.html }),
      })

      if (res.ok) {
        return new Response(JSON.stringify({ success: true }), {
          status: 200, headers: { 'Content-Type': 'application/json' },
        })
      }

      console.error('[Auth Email] Resend error:', await res.text())
    }

    // If Resend not configured or failed, let Supabase use default template
    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('[Auth Email] Error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
