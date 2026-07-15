/**
 * send-renewal-reminder — Alfanumrik Edge Function
 *
 * Sends a bilingual (English + Hindi) renewal-reminder email to a school's
 * billing contact for an expiring school_contracts row. Phase 3-C follow-up
 * to the daily-cron renewal-notifier (PR #585) — closes the "actual email
 * send" gap that #585 deliberately deferred so the email-template change
 * could be reviewed independently of the date-math.
 *
 * Auth: service-role bearer only. This function is server-to-server, called
 *       from daily-cron's processContractReminders step (in PR #585).
 *
 * POST body:
 * {
 *   contract_id: string  // uuid of school_contracts row
 *   t_minus:     number  // 60 | 30 | 15 | 7 | 1 — days until end_date
 * }
 *
 * Response:
 *   200 { ok: true, delivered: true,  message_id }
 *   200 { ok: true, delivered: false, reason } — soft-fail (no billing email,
 *                                                relay outage, etc.). Caller
 *                                                still got a 200 so the cron
 *                                                doesn't retry-storm.
 *   400 invalid input
 *   403 invalid auth
 *   404 contract or school not found
 *
 * Idempotency: the daily-cron updates reminders_sent[] BEFORE calling us, so
 * we don't need our own dedup. The relay's Idempotency-Key (Resend honours it
 * for 24h) collapses accidental double-sends.
 *
 * P13 (PII): we send to the school's billing_email (or schools.email
 * fallback). We log only message_id + status, never the email body or
 * recipient address.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createEmailIdempotencyKey } from '../_shared/reliability.ts'
import { sendEmail } from '../_shared/relay-mailer.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { checkBearerToken } from '../_shared/auth.ts'

// ── Config ────────────────────────────────────────────────────────────────

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// Transport is the shared Resend relay; RESEND_API_KEY gates configured-ness.
const RESEND_API_KEY            = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL                = Deno.env.get('RENEWAL_FROM_EMAIL') ?? 'Alfanumrik <billing@alfanumrik.com>'
const REPLY_TO                  = 'support@alfanumrik.com'
const SITE_URL                  = Deno.env.get('SITE_URL') ?? 'https://alfanumrik.com'

interface RequestBody {
  contract_id?: string
  t_minus?:     number
}

interface ContractRow {
  id:               string
  school_id:        string
  contract_number:  string
  start_date:       string
  end_date:         string
  billing_cycle:    string
  seats_purchased:  number
  value_inr:        number
  status:           string
}

interface SchoolRow {
  id:             string
  name:           string
  email:          string | null
  billing_email:  string | null
  state:          string | null
  principal_name: string | null
}

const VALID_T_MINUS = new Set([60, 30, 15, 7, 1])

// ── Helpers ──────────────────────────────────────────────────────────────

function json(data: unknown, status = 200, cors: HeadersInit = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function formatINR(n: number): string {
  const fixed = Math.abs(n).toFixed(2)
  const [intPart, decPart] = fixed.split('.')
  if (intPart.length <= 3) return `₹${intPart}.${decPart}`
  const last3 = intPart.slice(-3)
  const rest  = intPart.slice(0, -3)
  return `₹${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}.${decPart}`
}

function urgencyTone(tMinus: number): { en: string; hi: string } {
  if (tMinus <= 1)  return { en: 'expires tomorrow', hi: 'कल समाप्त हो रहा है' }
  if (tMinus <= 7)  return { en: `expires in ${tMinus} days`, hi: `${tMinus} दिनों में समाप्त हो रहा है` }
  if (tMinus <= 15) return { en: `expires in ${tMinus} days`, hi: `${tMinus} दिनों में समाप्त हो रहा है` }
  if (tMinus <= 30) return { en: `expires in ${tMinus} days`, hi: `${tMinus} दिनों में समाप्त हो रहा है` }
  return { en: `expires in ${tMinus} days`, hi: `${tMinus} दिनों में समाप्त हो रहा है` }
}

// ── Email rendering (bilingual) ──────────────────────────────────────────

function renderEmail(c: ContractRow, s: SchoolRow, tMinus: number): { subject: string; html: string; text: string } {
  const tone     = urgencyTone(tMinus)
  const value    = formatINR(Number(c.value_inr))
  const greeting = s.principal_name ? `Dear ${s.principal_name}` : `Dear ${s.name} team`
  const greetHi  = s.principal_name ? `आदरणीय ${s.principal_name}` : `${s.name} टीम के लिए`

  const subject = `Action needed: contract ${c.contract_number} ${tone.en} | ${tone.hi} | अनुबंध ${c.contract_number}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Renewal reminder · नवीनीकरण सूचना</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
    <tr><td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e4e4e7;">
        <tr><td style="padding:32px 32px 0;text-align:center;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#18181b;">Alfanumrik</p>
          <p style="margin:4px 0 0;font-size:12px;color:#71717a;">Billing &middot; बिलिंग</p>
        </td></tr>

        <!-- English block -->
        <tr><td style="padding:24px 32px 8px;">
          <h2 style="margin:0 0 12px;font-size:18px;font-weight:600;color:#18181b;">${greeting},</h2>
          <p style="margin:0 0 12px;font-size:14px;color:#3f3f46;line-height:1.6;">
            Your subscription contract <strong>${c.contract_number}</strong> ${tone.en}
            (end date <strong>${c.end_date}</strong>).
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:8px 0 16px;border:1px solid #e4e4e7;background-color:#fafafa;">
            <tr><td style="padding:12px 16px;">
              <p style="margin:0;font-size:13px;color:#3f3f46;line-height:1.7;">
                <strong>School:</strong> ${s.name}<br>
                <strong>Contract:</strong> ${c.contract_number}<br>
                <strong>Term:</strong> ${c.start_date} → ${c.end_date}<br>
                <strong>Seats:</strong> ${c.seats_purchased}<br>
                <strong>Value:</strong> ${value}<br>
                <strong>Billing cycle:</strong> ${c.billing_cycle}
              </p>
            </td></tr>
          </table>
          <p style="margin:0 0 16px;font-size:14px;color:#3f3f46;line-height:1.6;">
            To renew or discuss next year's terms, reply to this email or write to
            <a href="mailto:${REPLY_TO}" style="color:#6C5CE7;">${REPLY_TO}</a>.
          </p>
        </td></tr>

        <!-- Divider -->
        <tr><td style="padding:8px 32px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
        </td></tr>

        <!-- Hindi block -->
        <tr><td style="padding:8px 32px 24px;">
          <h2 style="margin:0 0 12px;font-size:18px;font-weight:600;color:#18181b;">${greetHi},</h2>
          <p style="margin:0 0 12px;font-size:14px;color:#3f3f46;line-height:1.7;">
            आपका सदस्यता अनुबंध <strong>${c.contract_number}</strong> ${tone.hi}
            (समाप्ति तिथि <strong>${c.end_date}</strong>)।
          </p>
          <p style="margin:0 0 8px;font-size:14px;color:#3f3f46;line-height:1.7;">
            नवीनीकरण के लिए कृपया इस ईमेल का उत्तर दें या
            <a href="mailto:${REPLY_TO}" style="color:#6C5CE7;">${REPLY_TO}</a> पर लिखें।
          </p>
        </td></tr>

        <tr><td style="padding:16px 32px;border-top:1px solid #e4e4e7;background-color:#fafafa;">
          <p style="margin:0;font-size:11px;color:#71717a;line-height:1.6;text-align:center;">
            Cusiosense Learning India Private Limited<br>
            <a href="${SITE_URL}/privacy" style="color:#71717a;">Privacy</a> ·
            <a href="${SITE_URL}/terms" style="color:#71717a;">Terms</a> ·
            <a href="mailto:${REPLY_TO}" style="color:#71717a;">Support</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text =
`${greeting},

Your subscription contract ${c.contract_number} ${tone.en} (end date ${c.end_date}).

  School:    ${s.name}
  Contract:  ${c.contract_number}
  Term:      ${c.start_date} → ${c.end_date}
  Seats:     ${c.seats_purchased}
  Value:     ${value}
  Billing:   ${c.billing_cycle}

To renew or discuss next year's terms, reply to this email or write to ${REPLY_TO}.

────

${greetHi},

आपका सदस्यता अनुबंध ${c.contract_number} ${tone.hi} (समाप्ति तिथि ${c.end_date})।

नवीनीकरण के लिए कृपया इस ईमेल का उत्तर दें या ${REPLY_TO} पर लिखें।

—
Cusiosense Learning India Private Limited
${SITE_URL}`

  return { subject, html, text }
}

// ── Relay send ───────────────────────────────────────────────────────────
// Thin wrapper over the shared sendEmail seam. Preserves the RENEWAL_FROM_EMAIL
// From override and the { success, id?, error? } shape the handler consumes;
// `error` carries the relay's PII-free failure code.

async function sendRenewalEmail(params: {
  to: string; subject: string; html: string; text: string;
  tags?: Array<{ name: string; value: string }>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    return { success: false, error: 'relay_not_configured' }
  }
  const result = await sendEmail({
    from: FROM_EMAIL,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    replyTo: REPLY_TO,
    tags: params.tags,
    idempotencyKey: createEmailIdempotencyKey({ template: 'renewal_reminder', recipient: params.to, subject: params.subject }),
    operation: 'send_renewal_reminder',
  })
  return { success: result.success, id: result.id, error: result.code }
}

// ── Main ─────────────────────────────────────────────────────────────────

serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('origin'))
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405, cors)

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'misconfigured', detail: 'missing supabase env' }, 500, cors)
  }

  // Service-role bearer required. Constant-time check — comparing a high-
  // value secret with `!==` short-circuits at the first differing byte and
  // leaks the secret through response timing.
  if (!checkBearerToken(req.headers.get('Authorization'), SUPABASE_SERVICE_ROLE_KEY)) {
    return json({ error: 'forbidden' }, 403, cors)
  }

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400, cors)
  }
  const contractId = (body.contract_id ?? '').trim()
  const tMinus     = Number(body.t_minus)
  if (!/^[0-9a-f-]{36}$/i.test(contractId)) return json({ error: 'invalid_contract_id' }, 400, cors)
  if (!Number.isInteger(tMinus) || !VALID_T_MINUS.has(tMinus)) {
    return json({ error: 'invalid_t_minus', detail: 'must be 60|30|15|7|1' }, 400, cors)
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Load contract
  const { data: contract, error: cErr } = await admin
    .from('school_contracts')
    .select('id, school_id, contract_number, start_date, end_date, billing_cycle, seats_purchased, value_inr, status')
    .eq('id', contractId)
    .maybeSingle()
  if (cErr || !contract) {
    return json({ error: 'contract_not_found', detail: cErr?.message }, 404, cors)
  }
  const c = contract as ContractRow

  // Load school
  const { data: school, error: sErr } = await admin
    .from('schools')
    .select('id, name, email, billing_email, state, principal_name')
    .eq('id', c.school_id)
    .maybeSingle()
  if (sErr || !school) {
    return json({ error: 'school_not_found', detail: sErr?.message }, 404, cors)
  }
  const s = school as SchoolRow

  // Pick recipient (billing_email > email; soft-fail if neither)
  const recipient = (s.billing_email ?? s.email ?? '').trim()
  if (!recipient) {
    // Soft-fail: caller still gets 200 so cron doesn't retry-storm.
    return json({ ok: true, delivered: false, reason: 'no_billing_email' }, 200, cors)
  }

  const { subject, html, text } = renderEmail(c, s, tMinus)
  const send = await sendRenewalEmail({
    to: recipient,
    subject,
    html,
    text,
    tags: [
      { name: 'kind', value: 'renewal_reminder' },
      { name: 't_minus', value: String(tMinus) },
    ],
  })

  if (!send.success) {
    // Soft-fail: log via PII-free console.warn (no recipient or body), return 200.
    console.warn(`send-renewal-reminder: contract=${c.id} t_minus=${tMinus} reason=${send.error}`)
    return json({ ok: true, delivered: false, reason: send.error ?? 'send_failed' }, 200, cors)
  }

  return json({ ok: true, delivered: true, message_id: send.id }, 200, cors)
})
