/**
 * send-welcome-email – Alfanumrik Edge Function
 *
 * Sends bilingual (EN + HI, P7) welcome emails to new users based on their role:
 *   - Student: Learning features, pro tips, dashboard CTA
 *   - Teacher: Classroom tools, quick setup guide, dashboard CTA
 *   - Parent:  Tracking features, child linking guide, parent portal CTA
 *
 * Templates live in ./templates.ts and render on the SHARED bilingual
 * primitives (`_shared/bilingual-email.ts`, extracted from send-auth-email
 * v49) — same stacked EN→HI structure, one html + one text body per send.
 *
 * Sends via the shared Mailgun relay (`_shared/relay-mailer.ts`); when the relay
 * is not configured it falls back to inserting a `notifications` row.
 */

import { createEmailIdempotencyKey } from '../_shared/reliability.ts'
import { hasEmailTransportConfig, sendEmail } from '../_shared/relay-mailer.ts'
import { redactPIIInText } from '../_shared/redact-pii.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { edgeLog, getRequestId, writeBusinessAudit, type EdgeLogContext } from '../_shared/edge-audit-log.ts'
import { getCorsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { parentEmail, studentEmail, teacherEmail, welcomeEmailHeaders } from './templates.ts'

// ─── Config ───────────────────────────────────────────────────────────────────
// Product decision 2026-07-16: Google Workspace (Gmail API) is the email
// provider (Mailgun disabled the company account). The relay is configured iff
// the shared seam (_shared/relay-mailer.ts) resolves ANY transport — Gmail
// (GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY + GMAIL_SENDER) preferred,
// legacy Mailgun (MAILGUN_API_KEY + MAILGUN_DOMAIN) as fallback; Resend is
// never auto-selected. When nothing is configured we degrade to the
// notifications-table fallback (below).
const HAS_EMAIL_TRANSPORT = hasEmailTransportConfig()
const FROM_EMAIL = 'Alfanumrik <welcome@alfanumrik.com>'
const REPLY_TO = 'support@alfanumrik.com'
// SITE_URL must come from env per P15 #6. See audit 2026-04-27 F4.
const SITE_URL = Deno.env.get('SITE_URL') || 'https://alfanumrik.com'

interface WelcomeRequest {
  role: 'student' | 'teacher' | 'parent'
  name: string
  email: string
  grade?: string
  board?: string
  school_name?: string
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const context: EdgeLogContext = { requestId: getRequestId(req), route: 'send-welcome-email', role: 'authenticated', actor: null, schoolId: null, startedAt: Date.now() }
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return errorResponse('Missing authorization header', 401, origin)

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) {
      edgeLog('error', context, { action: 'welcome_email.auth_denied', status: 'denied', reason: userError?.message ?? 'missing_user' })
      return errorResponse('Unauthorized', 401, origin)
    }
    context.actor = user.id

    const body: WelcomeRequest = await req.json()
    const { role, name, grade, board, school_name } = body

    // P13: send only to the JWT user's own verified email — never trust
    // body.email. Pre-fix any logged-in user could send a branded
    // "welcome" email to an arbitrary address (clear phishing-amplification
    // primitive against an Alfanumrik-trusted From: header).
    const email = user.email
    if (!email) return errorResponse('Authenticated user has no email', 400, origin)
    if (!role || !name) return errorResponse('Missing required fields: role, name', 400, origin)

    // Bilingual (EN + HI) templates on the shared v49 primitives — every send
    // carries BOTH an html and a text body mirroring the same stacked content.
    let emailContent: { subject: string; html: string; text: string }
    switch (role) {
      case 'student': emailContent = studentEmail(SITE_URL, name, grade, board); break
      case 'teacher': emailContent = teacherEmail(SITE_URL, name, school_name); break
      case 'parent': emailContent = parentEmail(SITE_URL, name); break
      default: return errorResponse('Invalid role', 400, origin)
    }

    // Send via the shared relay if configured (Gmail primary, legacy Mailgun
    // fallback — product decision 2026-07-16). sendEmail resolves the transport
    // internally, retries with an idempotency key, and returns a PII-free
    // failure `code` (+ which provider handled it) on error.
    if (HAS_EMAIL_TRANSPORT) {
      try {
        const result = await sendEmail({
          from: FROM_EMAIL,
          to: email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          replyTo: REPLY_TO,
          // Deliverability hygiene: mailto-only List-Unsubscribe (address
          // documented in EMAIL_DELIVERABILITY.md). No List-Unsubscribe-Post —
          // RFC 8058 one-click needs a real HTTPS endpoint, which we don't have.
          headers: welcomeEmailHeaders(role),
          tags: [
            { name: 'category', value: 'welcome' },
            { name: 'role', value: role },
          ],
          idempotencyKey: createEmailIdempotencyKey({ template: 'welcome_email', recipient: email, subject: emailContent.subject }),
          operation: 'send_welcome_email',
        })

        if (result.success) {
          const provider = result.provider ?? 'relay'
          edgeLog('info', context, { action: 'welcome_email.sent', status: 'ok', provider, role, relay_message_id: result.id ?? null })
          await writeBusinessAudit({ supabase: supabaseClient, context, action: 'welcome_email.sent', status: 'ok', metadata: { provider, role } })
          return jsonResponse({ sent: true, provider, id: result.id }, 200, {}, origin)
        }
        // result.code is a PII-free machine code (resend_http_<status> / mailgun_http_<status> / *_exception).
        edgeLog('error', context, { action: 'welcome_email.relay_failed', status: 'error', provider: result.provider ?? 'relay', reason: result.code ?? 'unknown' })
      } catch (fetchErr) {
        edgeLog('error', context, { action: 'welcome_email.fetch_failed', status: 'error', reason: redactPIIInText(fetchErr instanceof Error ? fetchErr.message : String(fetchErr)).text })
      }
    }

    // Fallback: store as notification (relay not configured, or relay send failed)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )
    await supabaseAdmin.from('notifications').insert({
      recipient_id: user.id,
      recipient_type: role === 'parent' ? 'guardian' : role,
      type: 'welcome_email',
      title: emailContent.subject,
      body: `Welcome to Alfanumrik, ${name.split(' ')[0]}! Your ${role} account is ready.`,
      is_read: false,
    })

    edgeLog('warn', context, { action: 'welcome_email.notification_fallback', status: 'warn', provider: 'notification_fallback', role })
    await writeBusinessAudit({ supabase: supabaseAdmin, context, action: 'welcome_email.notification_fallback', status: 'warn', metadata: { role } })
    return jsonResponse({ sent: true, provider: 'notification_fallback' }, 200, {}, origin)
  } catch (err) {
    edgeLog('error', context, { action: 'welcome_email.unhandled', status: 'error', reason: err instanceof Error ? err.message : String(err) })
    return errorResponse('Internal server error', 500, origin)
  }
})
