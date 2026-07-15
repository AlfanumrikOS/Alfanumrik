import { createEmailIdempotencyKey } from '../_shared/reliability.ts'
import { sendEmail } from '../_shared/relay-mailer.ts'
/**
 * send-pre-debit-notice — Alfanumrik Edge Function
 *
 * Wave 2 D7.3 — RBI e-mandate compliance.
 *
 * Sends a regulated pre-debit notification to a customer ≥24h before their
 * Razorpay subscription auto-charge fires. Triggered by the Vercel cron at
 * /api/cron/pre-debit-notice every 6 hours.
 *
 * Compliance contract (RBI circular RBI/2020-21/74 DPSS.CO.PD No. 754/02.14.003/2020-21
 * dated 4-Dec-2020, tightened by RBI/2021-22/82 dated 25-Aug-2021, plus 30-Sep-2022
 * deadline circular):
 *   - Customer MUST be notified ≥24h before each recurring auto-debit.
 *   - Notice MUST contain: amount, charge date+window, plan name, merchant,
 *     cancellation instructions, support contact.
 *   - If notice cannot be delivered (3 retries fail), the auto-charge MUST be
 *     skipped — emitting `pre_debit_notice_failed` is the signal for ops /
 *     payment-ops to either retry-then-skip via Razorpay's pause-mandate API
 *     or accept the regulatory miss and reconcile manually.
 *
 * POST contract:
 *   {
 *     subscription_id: string,        // student_subscriptions.id (UUID)
 *     student_id: string,             // students.id (UUID)
 *     amount_inr: number,             // amount in INR (whole rupees)
 *     charge_date_iso: string,        // ISO-8601 of the upcoming charge
 *     plan_name: string,              // e.g. "Pro Monthly"
 *     plan_code: string,              // e.g. "pro"
 *     billing_cycle: 'monthly'|'yearly',
 *     customer_email: string,         // mandatory channel
 *     customer_phone?: string,        // optional WhatsApp
 *     razorpay_subscription_id?: string,
 *   }
 *
 * Returns:
 *   200 { success: true, idempotency_key, channels: ['email', ...], event_id }
 *   200 { success: true, already_sent: true, idempotency_key }    — dedup short-circuit
 *   422 { error: 'validation', detail }                            — bad input
 *   401 { error: 'unauthorized' }                                  — wrong cron secret
 *   5xx { error: 'send_failed' | 'audit_failed', detail }          — retry from cron
 *
 * Bilingual readiness (P7): both English AND Hindi bodies are now sent in
 * every notice (launch-readiness, 2026-05-05 — D7.3.h closed). The cron
 * driver (src/app/api/cron/pre-debit-notice/route.ts) does not currently
 * pass a preferred-language hint, so the safest RBI-compliant default is
 * "send both", English first then Hindi, separated by a divider. This
 * preserves the regulated information for both English-speaking and
 * Hindi-speaking customers without forcing a schema change to the cron
 * payload. If a future request body adds `preferred_language: 'en'|'hi'`
 * the buildEmail() helper can be tightened to render only that variant.
 *
 * The Hindi text below intentionally keeps the technical tokens — INR/
 * Razorpay/Alfanumrik/Settings → Subscription — in English/Latin script
 * because that is what the customer sees in the app UI (P7 carve-out for
 * brand and navigation strings). Currency symbol ₹ + numeric amount and
 * IST date strings are language-neutral.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'

// ─── Config ──────────────────────────────────────────────────────────────────
// Regulated notice is delivered via the shared Resend relay. RESEND_API_KEY
// gates configured-ness; when absent the notice is treated as undeliverable
// (fails closed → audit 'pre_debit_notice_failed' → 500 → cron retries/skips).
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = 'Alfanumrik Billing <billing@alfanumrik.com>'
const REPLY_TO = 'support@alfanumrik.com'
const SITE_URL = Deno.env.get('SITE_URL') || 'https://alfanumrik.com'
const MERCHANT_NAME = 'Alfanumrik EdTech (via Razorpay)'
const SUPPORT_EMAIL = 'support@alfanumrik.com'

// ─── Types ───────────────────────────────────────────────────────────────────
interface PreDebitRequest {
  subscription_id: string
  student_id: string
  amount_inr: number
  charge_date_iso: string
  plan_name: string
  plan_code: string
  billing_cycle: 'monthly' | 'yearly'
  customer_email: string
  customer_phone?: string
  razorpay_subscription_id?: string
}

// ─── Validation ──────────────────────────────────────────────────────────────
function validate(body: unknown): { ok: true; value: PreDebitRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be a JSON object' }
  const b = body as Record<string, unknown>
  const required = ['subscription_id', 'student_id', 'amount_inr', 'charge_date_iso', 'plan_name', 'plan_code', 'billing_cycle', 'customer_email']
  for (const k of required) {
    if (b[k] === undefined || b[k] === null || b[k] === '') return { ok: false, error: `missing ${k}` }
  }
  if (typeof b.amount_inr !== 'number' || b.amount_inr <= 0) return { ok: false, error: 'amount_inr must be positive number' }
  if (typeof b.charge_date_iso !== 'string' || isNaN(Date.parse(b.charge_date_iso as string))) {
    return { ok: false, error: 'charge_date_iso must be ISO-8601' }
  }
  if (b.billing_cycle !== 'monthly' && b.billing_cycle !== 'yearly') return { ok: false, error: 'billing_cycle must be monthly|yearly' }
  if (typeof b.customer_email !== 'string' || !b.customer_email.includes('@')) return { ok: false, error: 'invalid customer_email' }
  return { ok: true, value: b as unknown as PreDebitRequest }
}

// ─── Idempotency key ─────────────────────────────────────────────────────────
function buildIdempotencyKey(subscriptionId: string, chargeDateIso: string): string {
  // YYYY-MM-DD slice — same charge_date in UTC always produces the same key,
  // so re-runs of the cron in the 24-48h window cannot duplicate the notice.
  const day = chargeDateIso.slice(0, 10)
  return `pre_debit_${subscriptionId}_${day}`
}

// ─── Email template (P7: bilingual — English + Hindi in every notice) ───────
function buildEmail(req: PreDebitRequest): { subject: string; html: string; text: string } {
  const chargeDate = new Date(req.charge_date_iso)
  const dateStr = chargeDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  // Hindi-locale rendering of the same date for the Hindi block. Modern
  // Deno + V8 ships full ICU so 'hi-IN' produces Devanagari month/weekday
  // names ("सोमवार", "जनवरी" etc). This is graceful — if the runtime
  // ever ships a stripped ICU we still get a valid date string back.
  const dateStrHi = chargeDate.toLocaleDateString('hi-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const windowStr = '00:00 — 23:59 IST (Razorpay processing window)'
  const windowStrHi = '00:00 — 23:59 IST (Razorpay प्रोसेसिंग विंडो)'
  const cycle = req.billing_cycle === 'yearly' ? 'yearly' : 'monthly'
  const cycleHi = req.billing_cycle === 'yearly' ? 'वार्षिक' : 'मासिक'
  const cancelByDate = new Date(chargeDate.getTime() - 86_400_000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })
  const cancelByDateHi = new Date(chargeDate.getTime() - 86_400_000).toLocaleDateString('hi-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })

  // Subject line is intentionally bilingual to satisfy P7 entry-point parity.
  const subject = `Reminder: ₹${req.amount_inr} auto-debit on ${dateStr} | आपके Alfanumrik subscription का auto-debit ${dateStr} को`

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Pre-Debit Notification</title></head>
<body style="margin:0;padding:0;background:#F0F2F5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F0F2F5;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <tr><td style="background:linear-gradient(135deg,#6C5CE7 0%,#A855F7 100%);padding:24px 32px;text-align:center;">
    <h1 style="margin:0;font-size:22px;font-weight:700;color:#FFFFFF;">Upcoming Auto-Debit Reminder</h1>
    <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.9);">Required notification under RBI e-mandate rules</p>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <p style="margin:0 0 16px;font-size:15px;color:#111827;">Hello,</p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.6;">
      This is your mandatory advance notice that an auto-debit will be attempted on your registered payment method for your Alfanumrik <strong>${req.plan_name}</strong> subscription.
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FA;border-radius:8px;padding:18px;margin:16px 0;">
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">Amount</td><td style="font-size:15px;color:#111827;font-weight:700;text-align:right;padding:4px 0;">₹${req.amount_inr.toLocaleString('en-IN')}</td></tr>
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">Charge date</td><td style="font-size:15px;color:#111827;font-weight:600;text-align:right;padding:4px 0;">${dateStr}</td></tr>
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">Charge window</td><td style="font-size:13px;color:#111827;text-align:right;padding:4px 0;">${windowStr}</td></tr>
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">Plan</td><td style="font-size:15px;color:#111827;text-align:right;padding:4px 0;">${req.plan_name} (${cycle})</td></tr>
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">Merchant</td><td style="font-size:13px;color:#111827;text-align:right;padding:4px 0;">${MERCHANT_NAME}</td></tr>
    </table>

    <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:6px;padding:14px 16px;margin:16px 0;">
      <p style="margin:0;font-size:13px;color:#92400E;line-height:1.5;">
        <strong>Want to cancel?</strong> Cancel anytime before <strong>${cancelByDate}</strong> from
        <a href="${SITE_URL}/billing" style="color:#92400E;text-decoration:underline;">Settings → Subscription</a>.
        Cancellations after this date will only stop the next billing cycle, not this one.
      </p>
    </div>

    <p style="margin:16px 0 0;font-size:13px;color:#6B7280;line-height:1.6;">
      Questions? Reply to this email or write to
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#6C5CE7;">${SUPPORT_EMAIL}</a>.
      A receipt will be emailed to you after the charge succeeds.
    </p>

    <!-- ── Hindi parity block (P7 launch-readiness) ────────────────────── -->
    <hr style="border:none;border-top:1px dashed #E5E7EB;margin:28px 0;">

    <p style="margin:0 0 16px;font-size:15px;color:#111827;" lang="hi">नमस्ते,</p>
    <p style="margin:0 0 16px;font-size:15px;color:#111827;line-height:1.7;" lang="hi">
      यह आपकी अनिवार्य अग्रिम सूचना है: आपके Alfanumrik <strong>${req.plan_name}</strong> सब्सक्रिप्शन के लिए, आपके पंजीकृत भुगतान विधि से auto-debit किया जाएगा।
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F9FA;border-radius:8px;padding:18px;margin:16px 0;" lang="hi">
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">राशि</td><td style="font-size:15px;color:#111827;font-weight:700;text-align:right;padding:4px 0;">₹${req.amount_inr.toLocaleString('en-IN')}</td></tr>
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">कटौती की तिथि</td><td style="font-size:15px;color:#111827;font-weight:600;text-align:right;padding:4px 0;">${dateStrHi}</td></tr>
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">समय अवधि</td><td style="font-size:13px;color:#111827;text-align:right;padding:4px 0;">${windowStrHi}</td></tr>
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">योजना</td><td style="font-size:15px;color:#111827;text-align:right;padding:4px 0;">${req.plan_name} (${cycleHi})</td></tr>
      <tr><td style="font-size:13px;color:#6B7280;padding:4px 0;">व्यापारी</td><td style="font-size:13px;color:#111827;text-align:right;padding:4px 0;">${MERCHANT_NAME}</td></tr>
    </table>

    <div style="background:#FEF3C7;border-left:4px solid #F59E0B;border-radius:6px;padding:14px 16px;margin:16px 0;" lang="hi">
      <p style="margin:0;font-size:13px;color:#92400E;line-height:1.6;">
        <strong>रद्द करना चाहते हैं?</strong> <strong>${cancelByDateHi}</strong> से पहले कभी भी
        <a href="${SITE_URL}/billing" style="color:#92400E;text-decoration:underline;">Settings → Subscription</a> से रद्द करें।
        इस तिथि के बाद रद्द करने पर केवल अगला बिलिंग चक्र रुकेगा, यह कटौती नहीं रुकेगी।
      </p>
    </div>

    <p style="margin:16px 0 0;font-size:13px;color:#6B7280;line-height:1.7;" lang="hi">
      प्रश्नों के लिए, इस ईमेल का उत्तर दें या
      <a href="mailto:${SUPPORT_EMAIL}" style="color:#6C5CE7;">${SUPPORT_EMAIL}</a>
      पर लिखें। कटौती सफल होने के बाद आपको रसीद ईमेल की जाएगी।
    </p>
    <!-- ── /Hindi parity block ──────────────────────────────────────────── -->
  </td></tr>
  <tr><td style="padding:18px 32px;background:#F8F9FA;border-top:1px solid #E5E7EB;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9CA3AF;line-height:1.6;">
      This notice is sent in compliance with the Reserve Bank of India's e-mandate framework.<br>
      &copy; 2026 Alfanumrik EdTech &nbsp;|&nbsp;
      <a href="${SITE_URL}/billing" style="color:#6C5CE7;text-decoration:none;">Manage subscription</a> &nbsp;|&nbsp;
      <a href="${SITE_URL}/privacy" style="color:#6C5CE7;text-decoration:none;">Privacy</a>
    </p>
  </td></tr>
</table></td></tr></table></body></html>`

  const text = [
    `Upcoming Auto-Debit Reminder (RBI-mandated notice)`,
    ``,
    `An auto-debit of Rs. ${req.amount_inr} will be attempted on ${dateStr} for your Alfanumrik ${req.plan_name} (${cycle}) subscription.`,
    ``,
    `Charge window: ${windowStr}`,
    `Merchant: ${MERCHANT_NAME}`,
    ``,
    `Cancel before ${cancelByDate} from ${SITE_URL}/billing.`,
    ``,
    `Support: ${SUPPORT_EMAIL}`,
    ``,
    `---`,
    ``,
    // ── Hindi parity block (P7 launch-readiness, 2026-05-05) ──
    `आगामी Auto-Debit सूचना (RBI द्वारा अनिवार्य)`,
    ``,
    `${dateStrHi} को आपके Alfanumrik ${req.plan_name} (${cycleHi}) सब्सक्रिप्शन के लिए ₹${req.amount_inr.toLocaleString('en-IN')} का auto-debit किया जाएगा।`,
    ``,
    `समय अवधि: ${windowStrHi}`,
    `व्यापारी: ${MERCHANT_NAME}`,
    ``,
    `रद्द करने के लिए: ${cancelByDateHi} से पहले ${SITE_URL}/billing पर जाएं (Settings → Subscription)।`,
    ``,
    `सहायता: ${SUPPORT_EMAIL}`,
  ].join('\n')

  return { subject, html, text }
}

// ─── Relay delivery ──────────────────────────────────────────────────────────
// The shared relay (sendEmail) owns timeout + retry (10s / 3 attempts) with an
// Idempotency-Key, so the per-notice manual retry loop is gone — a single
// dispatch covers the regulated "≥3 attempts before giving up" posture, and
// Resend collapses any transport double-fire on the idempotency key. The
// correlationId folds the day-scoped idempotencyKey in so the SAME upcoming
// charge always derives the SAME Resend key across cron re-runs in the window.
async function sendEmailWithRetry(to: string, subject: string, html: string, text: string, idempotencyKey: string): Promise<{ ok: boolean; provider_id?: string; error?: string; attempts: number }> {
  if (!RESEND_API_KEY) {
    return { ok: false, error: 'relay_not_configured', attempts: 0 }
  }
  const result = await sendEmail({
    from: FROM_EMAIL,
    to,
    subject,
    html,
    text,
    replyTo: REPLY_TO,
    tags: [
      { name: 'kind', value: 'pre_debit_notice' },
      { name: 'compliance', value: 'rbi_compliance' },
    ],
    idempotencyKey: createEmailIdempotencyKey({ template: 'pre_debit_notice', recipient: to, subject, correlationId: idempotencyKey }),
    operation: 'send_pre_debit_notice',
  })
  // `attempts` is now "relay dispatches" (1); the relay retried internally.
  return result.success
    ? { ok: true, provider_id: result.id, attempts: 1 }
    : { ok: false, error: result.code ?? 'relay_send_failed', attempts: 1 }
}

// ─── WhatsApp queue (fire-and-forget; failure does NOT block compliance) ─────
async function queueWhatsApp(supabase: ReturnType<typeof createClient>, phone: string, body: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Best-effort enqueue into task_queue for the whatsapp-notify Edge Function
    // to consume. Email is the regulated channel; WhatsApp is convenience.
    // Schema note: the live `task_queue` table keys work on `queue_name`
    // (baseline_from_prod.sql:14324), NOT `task_type`. The old `task_type`
    // insert failed and was swallowed below, so the WhatsApp convenience
    // notice never queued (the regulated email path was unaffected).
    const { error } = await supabase.from('task_queue').insert({
      queue_name: 'whatsapp_pre_debit_notice',
      payload: { to: phone, body, kind: 'pre_debit_notice' },
      status: 'pending',
    })
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Auth ────────────────────────────────────────────────────────────────────
function checkCronSecret(req: Request): boolean {
  const expected = Deno.env.get('CRON_SECRET') ?? ''
  if (!expected) return false
  const got = req.headers.get('x-cron-secret') ?? ''
  if (got.length !== expected.length) return false
  let m = 0
  for (let i = 0; i < got.length; i++) m |= got.charCodeAt(i) ^ expected.charCodeAt(i)
  return m === 0
}

// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return errorResponse('method_not_allowed', 405, origin)

  if (!checkCronSecret(req)) return errorResponse('unauthorized', 401, origin)

  let body: unknown
  try { body = await req.json() } catch { return jsonResponse({ error: 'invalid_json' }, 422, {}, origin) }

  const v = validate(body)
  if (!v.ok) return jsonResponse({ error: 'validation', detail: v.error }, 422, {}, origin)
  const input = v.value

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  const idempotencyKey = buildIdempotencyKey(input.subscription_id, input.charge_date_iso)

  // Pre-flight idempotency check: if a 'sent' row already exists, short-circuit.
  // The DB unique index is the authoritative defense against worker races; this
  // pre-flight just saves us a relay call when the row is already there.
  const { data: existing } = await supabase
    .from('subscription_events')
    .select('id, event_type')
    .eq('subscription_id', input.subscription_id)
    .eq('event_type', 'pre_debit_notice_sent')
    .filter('metadata->>idempotency_key', 'eq', idempotencyKey)
    .limit(1)
    .maybeSingle()

  if (existing) {
    return jsonResponse({ success: true, already_sent: true, idempotency_key: idempotencyKey, event_id: existing.id }, 200, {}, origin)
  }

  // Build + send email (regulated channel)
  const email = buildEmail(input)
  const sendResult = await sendEmailWithRetry(input.customer_email, email.subject, email.html, email.text, idempotencyKey)

  // Optional WhatsApp (convenience; failures do NOT mark notice as failed)
  let whatsappResult: { ok: boolean; error?: string } | null = null
  if (sendResult.ok && input.customer_phone) {
    const waBody = `Alfanumrik: An auto-debit of Rs.${input.amount_inr} will be attempted on ${input.charge_date_iso.slice(0, 10)} for your ${input.plan_name} subscription. Cancel anytime at ${SITE_URL}/billing.`
    whatsappResult = await queueWhatsApp(supabase, input.customer_phone, waBody)
  }

  const eventType = sendResult.ok ? 'pre_debit_notice_sent' : 'pre_debit_notice_failed'

  // Audit row (atomic with idempotency_key — DB unique index dedups races)
  const { data: insertedEvent, error: auditError } = await supabase
    .from('subscription_events')
    .insert({
      student_id: input.student_id,
      subscription_id: input.subscription_id,
      event_type: eventType,
      razorpay_subscription_id: input.razorpay_subscription_id ?? null,
      plan_code: input.plan_code,
      amount_inr: input.amount_inr,
      metadata: {
        idempotency_key: idempotencyKey,
        charge_date_iso: input.charge_date_iso,
        billing_cycle: input.billing_cycle,
        plan_name: input.plan_name,
        channels: { email: sendResult.ok, whatsapp: whatsappResult?.ok ?? null },
        // provider_message_id pins THIS audit row to a specific Resend delivery.
        // Under Mailgun the business idempotency key rode a *searchable* provider
        // field (X-Mailgun-Variables), so a Razorpay/RBI dispute could correlate
        // an audit row to a delivery. Under Resend the key rides only the
        // non-searchable Idempotency-Key header, so we MUST persist the returned
        // message id here to keep that correlation. A Resend message id is not
        // PII (P13) — safe to store/log.
        provider_message_id: sendResult.provider_id ?? null,
        // relay_dispatches = how many times WE handed the notice to the shared
        // relay (always 1). The relay itself retries the HTTP POST up to 3×
        // internally (fetchWithTimeout, Idempotency-Key-guarded), so this is NOT
        // the provider-attempt count. provider_status is the authoritative relay
        // outcome (the Resend message id on success / a PII-free failure code).
        relay_dispatches: sendResult.attempts,
        provider_status: sendResult.ok ? (sendResult.provider_id ?? 'delivered') : (sendResult.error ?? 'relay_send_failed'),
        error: sendResult.error ?? null,
        rbi_compliance_version: 'v1',
      },
    })
    .select('id')
    .single()

  // Unique-violation (23505) means another worker beat us to the audit row.
  // That's a successful idempotency outcome from the caller's perspective.
  if (auditError) {
    const code = (auditError as { code?: string }).code
    if (code === '23505') {
      return jsonResponse({ success: true, already_sent: true, idempotency_key: idempotencyKey }, 200, {}, origin)
    }
    // Audit write failed for an unexpected reason. We've already sent the email;
    // surface 5xx so the cron retries (idempotent — relay Idempotency-Key matches).
    return jsonResponse({ error: 'audit_failed', detail: auditError.message, idempotency_key: idempotencyKey }, 500, {}, origin)
  }

  if (!sendResult.ok) {
    // Email send failed after 3 retries. We logged the failure as an audit row;
    // surface 500 to the cron so ops alerting (Sentry on cron 500s) fires AND
    // the cron will retry on next 6-hour tick.
    return jsonResponse({
      error: 'send_failed',
      detail: sendResult.error,
      idempotency_key: idempotencyKey,
      event_id: insertedEvent?.id,
    }, 500, {}, origin)
  }

  return jsonResponse({
    success: true,
    idempotency_key: idempotencyKey,
    event_id: insertedEvent?.id,
    channels: ['email', ...(whatsappResult?.ok ? ['whatsapp'] : [])],
    attempts: sendResult.attempts,
  }, 200, {}, origin)
})
