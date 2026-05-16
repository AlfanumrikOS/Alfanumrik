/**
 * send-transactional-email – Alfanumrik Edge Function
 *
 * Sends transactional emails for school-onboarding flows (trial provisioned,
 * invite codes issued, etc). This is the sibling of `send-auth-email` (which
 * is reserved for Supabase Auth hooks and verified by webhook signature only)
 * and `send-welcome-email` (which is gated on the requester's own auth.users
 * email). This function is callable from server-side API routes using the
 * service role key.
 *
 * Provider: Mailgun (same as send-auth-email / send-welcome-email — no new
 * provider library added).
 *
 * Auth: SUPABASE_SERVICE_ROLE_KEY in Authorization: Bearer header. The function
 * is deployed with `--no-verify-jwt` and validates the bearer manually so that
 * API routes (running under Vercel) can invoke it without minting JWTs.
 *
 * Contract (request body):
 *   {
 *     "template":   "school-trial-provisioned" | "school-invite-code-issued"
 *                   | "parent-link-code-otp",
 *     "to":         "principal@example.com",
 *     "locale":     "en" | "hi",      // optional, default "en"
 *     "params": {
 *       // school-onboarding templates:
 *       "school_name":  "string",
 *       "invite_code":  "string",
 *       "expires_at":   ISO string,
 *       "subdomain_url":"https://slug.alfanumrik.com",  // optional
 *       "recipient_name":"string",    // optional
 *       // parent-link-code-otp template (Phase D.4):
 *       "otp":          "6-digit string",
 *       "idempotency_key":"challenge UUID" // dedup key (not displayed)
 *     }
 *   }
 *
 * Returns: { sent: boolean, id?: string, error?: string }. Always 200 unless
 * the request itself is malformed (caller bug). Email-provider failures are
 * surfaced via the `sent` flag — callers MUST treat the whole call as
 * fire-and-forget.
 *
 * IMPORTANT: do NOT log full invite codes at INFO. Truncated form only.
 */

// ─── Inline CORS (allowed callers are server-side, but keep parity) ──────────
const ALLOWED_ORIGINS = [
  'https://alfanumrik.com',
  'https://www.alfanumrik.com',
  'https://alfanumrik.vercel.app',
  'https://alfanumrik-ten.vercel.app',
  'http://localhost:3000',
]

function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  const origin =
    requestOrigin &&
    ALLOWED_ORIGINS.some((o) => requestOrigin === o || requestOrigin.endsWith('.vercel.app'))
      ? requestOrigin
      : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function jsonResponse(body: unknown, status = 200, origin?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' },
  })
}

// ─── Config ───────────────────────────────────────────────────────────────────
const MAILGUN_API_KEY = Deno.env.get('MAILGUN_API_KEY') ?? ''
const MAILGUN_DOMAIN = Deno.env.get('MAILGUN_DOMAIN') ?? ''
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const FROM_EMAIL = 'Alfanumrik <noreply@alfanumrik.com>'
const REPLY_TO = 'support@alfanumrik.com'
const SITE_URL = Deno.env.get('SITE_URL') || 'https://alfanumrik.com'

// ─── Mailgun client ──────────────────────────────────────────────────────────
async function sendMailgunEmail(params: {
  to: string
  subject: string
  html: string
  text: string
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const form = new FormData()
  form.append('from', FROM_EMAIL)
  form.append('to', params.to)
  form.append('subject', params.subject)
  form.append('html', params.html)
  form.append('text', params.text)
  form.append('h:Reply-To', REPLY_TO)
  if (params.headers) {
    for (const [k, v] of Object.entries(params.headers)) form.append(`h:${k}`, v)
  }
  if (params.tags) {
    for (const t of params.tags) form.append('o:tag', `${t.name}:${t.value}`)
  }
  const res = await fetch(`https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`, {
    method: 'POST',
    headers: { Authorization: `Basic ${btoa(`api:${MAILGUN_API_KEY}`)}` },
    body: form,
  })
  if (!res.ok) return { success: false, error: await res.text() }
  const result = await res.json()
  return { success: true, id: result.id }
}

// ─── Constant-time string compare (avoid timing attacks on bearer check) ─────
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// ─── Shared HTML wrapper ──────────────────────────────────────────────────────
function baseWrapper(content: string, preheader: string, lang: 'en' | 'hi'): string {
  return `<!DOCTYPE html>
<html lang="${lang}" xmlns="http://www.w3.org/1999/xhtml">
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
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
        <tr><td style="background:linear-gradient(135deg,#6C5CE7 0%,#A855F7 100%);padding:24px 32px;text-align:center;">
          <p style="margin:0;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Alfanumrik</p>
          <p style="margin:4px 0 0;font-size:12px;color:rgba(255,255,255,0.85);font-weight:500;">${lang === 'hi' ? 'भारत का अनुकूली शिक्षण मंच' : "India's Adaptive Learning Platform"}</p>
        </td></tr>
        <tr><td style="padding:32px;">
          ${content}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #e4e4e7;background-color:#fafafa;">
          <p style="margin:0;font-size:12px;color:#71717a;line-height:1.6;text-align:center;">
            Alfanumrik EdTech Pvt. Ltd., India<br>
            <a href="${SITE_URL}/privacy" style="color:#71717a;">${lang === 'hi' ? 'गोपनीयता' : 'Privacy'}</a> |
            <a href="${SITE_URL}/terms" style="color:#71717a;">${lang === 'hi' ? 'शर्तें' : 'Terms'}</a> |
            <a href="mailto:support@alfanumrik.com" style="color:#71717a;">${lang === 'hi' ? 'सहायता' : 'Support'}</a>
          </p>
          <p style="margin:8px 0 0;font-size:11px;color:#a1a1aa;text-align:center;">
            ${lang === 'hi'
              ? 'यदि आपने यह ईमेल अपेक्षित नहीं किया था, तो आप इसे सुरक्षित रूप से अनदेखा कर सकते हैं।'
              : "If you didn't expect this email, you can safely ignore it."}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

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

function formatExpiry(iso: string, locale: 'en' | 'hi'): string {
  try {
    const d = new Date(iso)
    return d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─── Templates ────────────────────────────────────────────────────────────────
interface TemplateParams {
  // school-onboarding fields
  school_name?: string
  invite_code?: string
  expires_at?: string
  subdomain_url?: string
  recipient_name?: string
  // parent-link-code-otp fields
  otp?: string
  idempotency_key?: string
}

function trialProvisionedEmail(p: TemplateParams, locale: 'en' | 'hi'): { subject: string; html: string; text: string } {
  const schoolName = escapeHtml(p.school_name ?? '')
  const code = escapeHtml(p.invite_code ?? '')
  const expiry = formatExpiry(p.expires_at ?? '', locale)
  const signInUrl = p.subdomain_url || `${SITE_URL}/auth/login`
  const safeSignIn = escapeHtml(signInUrl)

  if (locale === 'hi') {
    const subject = `${p.school_name ?? ''} में आपका स्वागत है — Alfanumrik ट्रायल सक्रिय`
    const content = `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#18181b;">${schoolName} में स्वागत है!</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
        आपका 30-दिन का Alfanumrik ट्रायल अब सक्रिय है। नीचे दिया गया इनवाइट कोड शिक्षकों और छात्रों को आपके स्कूल खाते से जोड़ने के लिए उपयोग करें।
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:24px;background:#F5F3FF;border:2px dashed #6C5CE7;border-radius:12px;text-align:center;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#6C5CE7;text-transform:uppercase;letter-spacing:1px;">आपका इनवाइट कोड</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#18181b;font-family:'Courier New',monospace;letter-spacing:4px;">${code}</p>
          <p style="margin:12px 0 0;font-size:12px;color:#6B7280;">${escapeHtml(expiry)} तक मान्य</p>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${safeSignIn}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;">अपने डैशबोर्ड में साइन इन करें</a>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
        प्रश्न हैं? <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;">support@alfanumrik.com</a> पर लिखें।
      </p>
    `
    const html = baseWrapper(content, `${p.school_name ?? ''} के लिए आपका Alfanumrik ट्रायल सक्रिय है।`, 'hi')
    const text = htmlToPlainText(content) + `\n\nAlfanumrik EdTech Pvt. Ltd., भारत`
    return { subject, html, text }
  }

  const subject = `Welcome to Alfanumrik — your ${p.school_name ?? ''} trial is active`
  const content = `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#18181b;">Welcome to ${schoolName}!</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
        Your 30-day Alfanumrik trial is now active. Share the invite code below with your teachers and students to link them to your school account.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:24px;background:#F5F3FF;border:2px dashed #6C5CE7;border-radius:12px;text-align:center;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#6C5CE7;text-transform:uppercase;letter-spacing:1px;">Your invite code</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#18181b;font-family:'Courier New',monospace;letter-spacing:4px;">${code}</p>
          <p style="margin:12px 0 0;font-size:12px;color:#6B7280;">Valid until ${escapeHtml(expiry)}</p>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${safeSignIn}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;">Sign in to your dashboard</a>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
        Questions? Email <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;">support@alfanumrik.com</a> and our team will help you get set up.
      </p>
    `
  const html = baseWrapper(content, `Your Alfanumrik trial for ${p.school_name ?? ''} is active.`, 'en')
  const text = htmlToPlainText(content) + `\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { subject, html, text }
}

function inviteCodeIssuedEmail(p: TemplateParams, locale: 'en' | 'hi'): { subject: string; html: string; text: string } {
  const schoolName = escapeHtml(p.school_name ?? '')
  const code = escapeHtml(p.invite_code ?? '')
  const expiry = formatExpiry(p.expires_at ?? '', locale)
  const signInUrl = p.subdomain_url || `${SITE_URL}/auth/signup`
  const safeSignIn = escapeHtml(signInUrl)
  const greeting = p.recipient_name ? `, ${escapeHtml(p.recipient_name)}` : ''

  if (locale === 'hi') {
    const subject = `${p.school_name ?? ''} ने आपको Alfanumrik पर आमंत्रित किया है`
    const content = `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#18181b;">नमस्ते${greeting}!</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
        <strong>${schoolName}</strong> ने आपको Alfanumrik पर शामिल होने के लिए आमंत्रित किया है। साइन अप के दौरान नीचे दिए गए कोड का उपयोग करें।
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:24px;background:#F5F3FF;border:2px dashed #6C5CE7;border-radius:12px;text-align:center;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#6C5CE7;text-transform:uppercase;letter-spacing:1px;">आपका इनवाइट कोड</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#18181b;font-family:'Courier New',monospace;letter-spacing:4px;">${code}</p>
          <p style="margin:12px 0 0;font-size:12px;color:#6B7280;">${escapeHtml(expiry)} तक मान्य</p>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${safeSignIn}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;">अब शामिल हों</a>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
        सहायता चाहिए? <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;">support@alfanumrik.com</a> पर लिखें।
      </p>
    `
    const html = baseWrapper(content, `${p.school_name ?? ''} से Alfanumrik इनवाइट।`, 'hi')
    const text = htmlToPlainText(content) + `\n\nAlfanumrik EdTech Pvt. Ltd., भारत`
    return { subject, html, text }
  }

  const subject = `${p.school_name ?? ''} has invited you to Alfanumrik`
  const content = `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#18181b;">Hello${greeting}!</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
        <strong>${schoolName}</strong> has invited you to join Alfanumrik. Use the invite code below when you sign up to link your account to your school.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:24px;background:#F5F3FF;border:2px dashed #6C5CE7;border-radius:12px;text-align:center;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#6C5CE7;text-transform:uppercase;letter-spacing:1px;">Your invite code</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#18181b;font-family:'Courier New',monospace;letter-spacing:4px;">${code}</p>
          <p style="margin:12px 0 0;font-size:12px;color:#6B7280;">Valid until ${escapeHtml(expiry)}</p>
        </td></tr>
      </table>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;">
        <tr><td align="center" style="padding:8px 0;">
          <a href="${safeSignIn}" style="display:inline-block;padding:14px 36px;background:linear-gradient(135deg,#6C5CE7,#A855F7);color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;">Join now</a>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
        Need help? Email <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;">support@alfanumrik.com</a>.
      </p>
    `
  const html = baseWrapper(content, `Invite code from ${p.school_name ?? ''} on Alfanumrik.`, 'en')
  const text = htmlToPlainText(content) + `\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { subject, html, text }
}

function parentLinkCodeOtpEmail(p: TemplateParams, locale: 'en' | 'hi'): { subject: string; html: string; text: string } {
  const otp = escapeHtml(p.otp ?? '')
  const name = p.recipient_name ? escapeHtml(p.recipient_name) : ''
  const greeting = name ? `, ${name}` : ''

  if (locale === 'hi') {
    const subject = `Alfanumrik सत्यापन कोड: ${p.otp ?? ''}`
    const content = `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#18181b;">नमस्ते${greeting}!</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
        अपने बच्चे के खाते से जुड़ने के लिए नीचे दिए गए एक बार के सत्यापन कोड का उपयोग करें। यह कोड 10 मिनट में समाप्त हो जाएगा।
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:24px;background:#F5F3FF;border:2px dashed #6C5CE7;border-radius:12px;text-align:center;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#6C5CE7;text-transform:uppercase;letter-spacing:1px;">सत्यापन कोड</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#18181b;font-family:'Courier New',monospace;letter-spacing:8px;">${otp}</p>
          <p style="margin:12px 0 0;font-size:12px;color:#6B7280;">10 मिनट तक मान्य</p>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
        यदि आपने इस कोड का अनुरोध नहीं किया है, तो कृपया इस ईमेल को अनदेखा करें — आपका खाता सुरक्षित है।
      </p>
      <p style="margin:12px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
        सहायता चाहिए? <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;">support@alfanumrik.com</a>
      </p>
    `
    const html = baseWrapper(content, `Alfanumrik सत्यापन कोड — 10 मिनट तक मान्य।`, 'hi')
    const text = htmlToPlainText(content) + `\n\nAlfanumrik EdTech Pvt. Ltd., भारत`
    return { subject, html, text }
  }

  const subject = `Alfanumrik verification code: ${p.otp ?? ''}`
  const content = `
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#18181b;">Hi${greeting},</h2>
      <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
        Use the one-time code below to finish linking your child's account on Alfanumrik. The code expires in 10 minutes.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
        <tr><td style="padding:24px;background:#F5F3FF;border:2px dashed #6C5CE7;border-radius:12px;text-align:center;">
          <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#6C5CE7;text-transform:uppercase;letter-spacing:1px;">Verification code</p>
          <p style="margin:0;font-size:32px;font-weight:800;color:#18181b;font-family:'Courier New',monospace;letter-spacing:8px;">${otp}</p>
          <p style="margin:12px 0 0;font-size:12px;color:#6B7280;">Valid for 10 minutes</p>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
        If you didn't request this code, you can safely ignore this email — your account is still secure.
      </p>
      <p style="margin:12px 0 0;font-size:13px;color:#71717a;line-height:1.6;">
        Need help? Email <a href="mailto:support@alfanumrik.com" style="color:#6C5CE7;">support@alfanumrik.com</a>.
      </p>
    `
  const html = baseWrapper(content, `Your Alfanumrik verification code (valid 10 minutes).`, 'en')
  const text = htmlToPlainText(content) + `\n\nAlfanumrik EdTech Pvt. Ltd., India`
  return { subject, html, text }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
type TemplateName = 'school-trial-provisioned' | 'school-invite-code-issued' | 'parent-link-code-otp'

interface RequestBody {
  template: TemplateName
  to: string
  locale?: 'en' | 'hi'
  params: TemplateParams
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)
}

function truncateCode(code: string): string {
  return code.length <= 4 ? '****' : code.slice(0, 4) + '****'
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ sent: false, error: 'Method not allowed' }, 405, origin)
  }

  // ── Bearer-token auth (service role only) ──
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  if (!SERVICE_ROLE_KEY || !constantTimeEqual(auth, SERVICE_ROLE_KEY)) {
    return jsonResponse({ sent: false, error: 'Unauthorized' }, 401, origin)
  }

  let body: RequestBody
  try {
    body = (await req.json()) as RequestBody
  } catch {
    return jsonResponse({ sent: false, error: 'Invalid JSON body' }, 400, origin)
  }

  const { template, to, locale = 'en', params } = body || ({} as RequestBody)
  if (!template || !to || !params) {
    return jsonResponse({ sent: false, error: 'Missing template, to, or params' }, 400, origin)
  }
  if (!isValidEmail(to)) {
    return jsonResponse({ sent: false, error: 'Invalid recipient email' }, 400, origin)
  }
  // Per-template required-field validation. The OTP template is keyed by
  // its idempotency_key (the challenge id), NOT by invite_code, because we
  // re-issue codes per request — see email-delivery.ts.
  if (template === 'parent-link-code-otp') {
    if (!params.otp || !/^\d{6}$/.test(params.otp)) {
      return jsonResponse({ sent: false, error: 'Missing or invalid 6-digit otp in params' }, 400, origin)
    }
    if (!params.idempotency_key) {
      return jsonResponse({ sent: false, error: 'Missing idempotency_key in params' }, 400, origin)
    }
  } else {
    if (!params.school_name || !params.invite_code || !params.expires_at) {
      return jsonResponse({ sent: false, error: 'Missing school_name, invite_code, or expires_at in params' }, 400, origin)
    }
  }
  const effectiveLocale: 'en' | 'hi' = locale === 'hi' ? 'hi' : 'en'

  let content: { subject: string; html: string; text: string }
  switch (template) {
    case 'school-trial-provisioned':
      content = trialProvisionedEmail(params, effectiveLocale)
      break
    case 'school-invite-code-issued':
      content = inviteCodeIssuedEmail(params, effectiveLocale)
      break
    case 'parent-link-code-otp':
      content = parentLinkCodeOtpEmail(params, effectiveLocale)
      break
    default:
      return jsonResponse({ sent: false, error: `Unknown template: ${template}` }, 400, origin)
  }

  // Log key derivation: school templates use invite_code, OTP uses
  // idempotency_key. Either way we redact via truncateCode().
  const logKey = template === 'parent-link-code-otp'
    ? (params.idempotency_key ?? '')
    : (params.invite_code ?? '')

  // Graceful degradation: if Mailgun isn't configured, return 200 with sent:false
  // so callers (which are fire-and-forget) don't retry.
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN) {
    console.warn(`[Transactional Email] Mailgun not configured. Skipping send for template=${template} code=${truncateCode(logKey)}`)
    return jsonResponse({ sent: false, error: 'mailgun_not_configured' }, 200, origin)
  }

  try {
    const result = await sendMailgunEmail({
      to,
      subject: content.subject,
      html: content.html,
      text: content.text,
      headers: {
        'X-Entity-Ref-ID': `txn-${template}-${Date.now()}`,
        'List-Unsubscribe': '<mailto:unsubscribe@alfanumrik.com?subject=unsubscribe>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
      tags: [
        { name: 'category', value: 'transactional' },
        { name: 'template', value: template },
        { name: 'locale', value: effectiveLocale },
      ],
    })

    const redactedEmail = to.slice(0, 3) + '***@' + (to.split('@')[1] ?? 'unknown')
    if (result.success) {
      console.log(`[Transactional Email] Sent template=${template} code=${truncateCode(logKey)} to=${redactedEmail} id=${result.id}`)
      return jsonResponse({ sent: true, id: result.id }, 200, origin)
    }
    console.error(`[Transactional Email] Mailgun error template=${template} code=${truncateCode(logKey)}: ${result.error}`)
    return jsonResponse({ sent: false, error: result.error ?? 'mailgun_error' }, 200, origin)
  } catch (err) {
    console.error('[Transactional Email] Send exception:', err)
    return jsonResponse({ sent: false, error: (err as Error).message ?? 'send_failed' }, 200, origin)
  }
})
