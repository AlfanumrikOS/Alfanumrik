/**
 * whatsapp-notify – Alfanumrik Edge Function
 *
 * Sends WhatsApp template messages via Meta's WhatsApp Cloud API.
 * Supports: daily reminders, score notifications, streak warnings, weekly summaries.
 *
 * Auth: requires Authorization header (service-role or user token).
 * Rate limit: 100 messages/day per phone number (WhatsApp Business limits).
 * Fallback: if WhatsApp fails, logs notification for email delivery.
 *
 * P13: Phone numbers are redacted in all log output.
 */

import { createWhatsAppIdempotencyKey, fetchWithTimeout } from '../_shared/reliability.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/cors.ts'
import { edgeLog, getRequestId, writeBusinessAudit, type EdgeLogContext } from '../_shared/edge-audit-log.ts'
import { admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile } from '../_shared/security/ai-admission.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

type TemplateType =
  | 'daily_reminder'
  | 'score_notification'
  | 'streak_warning'
  | 'weekly_summary'
  | 'monthly_synthesis'
  | 'remediation_escalated'
  | 'reengagement_escalated'
  | 'concentration_escalated'
type Language = 'en' | 'hi'

interface NotifyRequest {
  type: TemplateType
  recipient_phone: string
  language: Language
  data: Record<string, string>
  user_id?: string // optional: for logging
}

interface WhatsAppTemplate {
  id: string
  params: readonly string[]
}

// ─── Template definitions (must match Meta-approved templates) ───────────────

const TEMPLATES: Record<TemplateType, Record<Language, WhatsAppTemplate>> = {
  daily_reminder: {
    en: { id: 'daily_study_reminder', params: ['student_name', 'streak_count', 'subject_suggestion'] },
    hi: { id: 'daily_study_reminder_hi', params: ['student_name', 'streak_count', 'subject_suggestion'] },
  },
  score_notification: {
    en: { id: 'quiz_score_parent', params: ['student_name', 'subject', 'score', 'xp_earned'] },
    hi: { id: 'quiz_score_parent_hi', params: ['student_name', 'subject', 'score', 'xp_earned'] },
  },
  streak_warning: {
    en: { id: 'streak_warning', params: ['student_name', 'streak_count'] },
    hi: { id: 'streak_warning_hi', params: ['student_name', 'streak_count'] },
  },
  weekly_summary: {
    en: { id: 'weekly_progress_summary', params: ['student_name', 'quizzes_completed', 'avg_score', 'xp_earned', 'streak_days'] },
    hi: { id: 'weekly_progress_summary_hi', params: ['student_name', 'quizzes_completed', 'avg_score', 'xp_earned', 'streak_days'] },
  },
  // Pedagogy v2 Wave 3 — monthly synthesis parent share. The template body
  // says e.g. "{{student_name}}'s {{synthesis_month}} progress is ready:
  // {{summary_preview}}" and links to the parent portal page where the
  // full ~300-word summary is rendered. Meta-side template approval is
  // async — until the production WhatsApp Cloud API recognises this
  // template id, the call returns a 400 and /api/synthesis/parent-share
  // marks parent_share_status = 'failed'.
  monthly_synthesis: {
    en: { id: 'monthly_synthesis_ready', params: ['student_name', 'synthesis_month', 'summary_preview'] },
    hi: { id: 'monthly_synthesis_ready_hi', params: ['student_name', 'synthesis_month', 'summary_preview'] },
  },
  // Phase A adaptive-loop parent-facing ESCALATION templates (Master Action
  // Plan Phase 3, item 3.5) — the 3 highest-stakes guardian touchpoints from
  // src/lib/notification-triggers.ts: onRemediationEscalated (Loop A),
  // onInactivityEscalated (Loop B), onConcentrationEscalated /
  // onConcentrationReescalated (Loop C, both reuse this one template — same
  // reuse the in-app `notifications.type` column already makes). Deliberately
  // NO student_name param, matching the existing "your child" (never named)
  // convention these same in-app guardian rows already use (P13-adjacent —
  // consistent with the adaptive-loop notification producers, not a new
  // posture invented here).
  //
  // PLACEHOLDER Meta template ids — ops/backend must create + get these
  // approved in Meta Business Manager before ff_adaptive_remediation_v1 /
  // ff_adaptive_loops_bc_v1 are ever turned ON in production. Until approved,
  // the WhatsApp Cloud API call fails (this function returns 400/502) and the
  // caller's fire-and-forget wrapper (sendWhatsAppEscalation) swallows it —
  // the in-app notification row is the unaffected, durable record either way.
  remediation_escalated: {
    en: { id: 'adaptive_remediation_escalated', params: ['subject_code', 'chapter_number'] },
    hi: { id: 'adaptive_remediation_escalated_hi', params: ['subject_code', 'chapter_number'] },
  },
  reengagement_escalated: {
    en: { id: 'adaptive_reengagement_escalated', params: [] },
    hi: { id: 'adaptive_reengagement_escalated_hi', params: [] },
  },
  concentration_escalated: {
    en: { id: 'adaptive_concentration_escalated', params: ['subject_code', 'at_risk_chapter_count'] },
    hi: { id: 'adaptive_concentration_escalated_hi', params: ['subject_code', 'at_risk_chapter_count'] },
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Redact phone for logging (P13) */
function redactPhone(phone: string): string {
  if (!phone || phone.length < 8) return '***'
  return phone.slice(0, 3) + '****' + phone.slice(-4)
}

/** Validate E.164 format */
function isValidE164(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone)
}

// ─── Circuit breaker (copied from foxy-tutor pattern) ───────────────────────

const circuitBreaker = {
  failures: 0,
  lastFailureAt: 0,
  state: 'closed' as 'closed' | 'open' | 'half-open',
  FAILURE_THRESHOLD: 5,
  RESET_TIMEOUT: 60_000,

  canRequest(): boolean {
    if (this.state === 'closed') return true
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt > this.RESET_TIMEOUT) {
        this.state = 'half-open'
        return true
      }
      return false
    }
    return false
  },

  recordSuccess(): void {
    this.failures = 0
    this.state = 'closed'
  },

  recordFailure(): void {
    this.failures++
    this.lastFailureAt = Date.now()
    if (this.failures >= this.FAILURE_THRESHOLD) {
      this.state = 'open'
    }
  },
}

// ─── Rate limiter (in-memory, per phone, 100/day) ──────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
const RATE_WINDOW = 24 * 60 * 60 * 1000 // 24 hours
const RATE_MAX = 100
const RATE_MAP_MAX_SIZE = 10_000

function isRateLimited(phone: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(phone)

  if (!entry || now > entry.resetAt) {
    // Evict oldest if map is too large
    if (rateLimitMap.size >= RATE_MAP_MAX_SIZE) {
      const firstKey = rateLimitMap.keys().next().value
      if (firstKey) rateLimitMap.delete(firstKey)
    }
    rateLimitMap.set(phone, { count: 1, resetAt: now + RATE_WINDOW })
    return false
  }

  if (entry.count >= RATE_MAX) return true
  entry.count++
  return false
}

// ─── WhatsApp Cloud API sender ──────────────────────────────────────────────

async function sendWhatsAppMessage(
  template: WhatsAppTemplate,
  recipientPhone: string,
  language: Language,
  data: Record<string, string>,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const token = Deno.env.get('WHATSAPP_TOKEN')
  const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')

  if (!token || !phoneNumberId) {
    return { success: false, error: 'WhatsApp credentials not configured' }
  }

  if (!circuitBreaker.canRequest()) {
    return { success: false, error: 'Circuit breaker open — WhatsApp API unavailable' }
  }

  const parameters = template.params.map((paramName) => ({
    type: 'text',
    text: data[paramName] ?? '',
  }))

  const body = {
    messaging_product: 'whatsapp',
    to: recipientPhone,
    type: 'template',
    template: {
      name: template.id,
      language: { code: language === 'hi' ? 'hi' : 'en' },
      components: [{ type: 'body', parameters }],
    },
  }

  try {
    const res = await fetchWithTimeout(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
        provider: 'whatsapp',
        operation: 'send_template_message',
        timeoutMs: 10_000,
        retry: { maxAttempts: 3 },
        idempotencyKey: createWhatsAppIdempotencyKey({ template: template.id, recipientPhone, language }),
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    )

    if (!res.ok) {
      const errText = await res.text()
      circuitBreaker.recordFailure()
      return { success: false, error: `WhatsApp API ${res.status}: ${errText}` }
    }

    const result = await res.json()
    circuitBreaker.recordSuccess()

    const messageId = result?.messages?.[0]?.id
    return { success: true, messageId }
  } catch (err) {
    circuitBreaker.recordFailure()
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Notification log + email fallback ──────────────────────────────────────

async function logNotification(
  supabase: ReturnType<typeof createClient>,
  userId: string | undefined,
  channel: string,
  templateType: string,
  recipient: string,
  status: string,
  messageId: string | undefined,
  errorMessage: string | undefined,
  context: EdgeLogContext,
): Promise<void> {
  try {
    // RESOLVED 2026-07-22 (Master Action Plan Phase 3, item 3.7): the
    // `notification_log` table now exists — see migration
    // 20260722092000_notification_log_audit_table.sql, whose column shape was
    // derived directly from this insert call (no code change needed here).
    // The insert stays wrapped in try/catch as best-effort: a logging failure
    // must never block WhatsApp delivery or the email fallback below.
    await supabase.from('notification_log').insert({
      user_id: userId ?? null,
      channel,
      template_type: templateType,
      recipient: redactPhone(recipient), // P13: redact in storage too
      status,
      whatsapp_message_id: messageId ?? null,
      error_message: errorMessage ?? null,
    })
  } catch (err) {
    edgeLog('error', context, { action: 'whatsapp.audit_failed', status: 'error', reason: err instanceof Error ? err.message : String(err) })
  }
}

async function queueEmailFallback(
  supabase: ReturnType<typeof createClient>,
  userId: string | undefined,
  templateType: string,
  data: Record<string, string>,
  context: EdgeLogContext,
): Promise<void> {
  try {
    // Schema note: the live `task_queue` table keys the work type on
    // `queue_name` (baseline_from_prod.sql:14324), NOT `type`. Inserting `type`
    // made this insert fail with PGRST204 (column not found); it was swallowed
    // by the catch below, so the WhatsApp→email fallback never actually
    // enqueued. Use the real column name.
    await supabase.from('task_queue').insert({
      queue_name: 'email_fallback',
      payload: {
        original_channel: 'whatsapp',
        template_type: templateType,
        user_id: userId,
        data,
      },
      status: 'pending',
    })
    edgeLog('warn', context, { action: 'whatsapp.email_fallback_queued', status: 'warn', template: templateType })
  } catch (err) {
    edgeLog('error', context, { action: 'whatsapp.email_fallback_failed', status: 'error', reason: err instanceof Error ? err.message : String(err) })
  }
}

// ─── Security route profile ──────────────────────────────────────────────────
const WHATSAPP_NOTIFY_ROUTE_PROFILE = createStaticAiRouteProfile({
  route: 'whatsapp-notify',
  callerTypes: ['internal_service'],
  modelProvider: 'meta',
  modelName: 'whatsapp-cloud-api',
  inputTokenFloor: 1,
  outputTokens: 0,
})

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const context: EdgeLogContext = { requestId: getRequestId(req), route: 'whatsapp-notify', role: 'service_role', actor: null, schoolId: null, startedAt: Date.now() }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  // ── Platform security admission ────────────────────────────────────────────
  // Replaces the legacy constantTimeEqual service-role key check.
  // callerType=internal_service: only signed Next.js routes may call this.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    serviceRoleKey,
    { auth: { persistSession: false } },
  )
  const bodyText = await req.text()
  const admitResult = await admitAiRoute({ req, sb: supabase, profile: WHATSAPP_NOTIFY_ROUTE_PROFILE, bodyText })
  if (!admitResult.ok) {
    return admitResult.response
  }
  const { admission } = admitResult

  try {
    // Parse and validate request body
    let body: NotifyRequest
    try {
      body = JSON.parse(bodyText) as NotifyRequest
    } catch {
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 400, errorCode: 'invalid_json' })
      return errorResponse('Invalid JSON body', 400, origin)
    }

    const { type, recipient_phone, language, data, user_id } = body

    // Validate template type
    if (!type || !TEMPLATES[type]) {
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 400, errorCode: 'invalid_template' })
      return errorResponse(
        `Invalid template type. Must be one of: ${Object.keys(TEMPLATES).join(', ')}`,
        400,
        origin,
      )
    }

    // Validate phone number
    if (!recipient_phone || !isValidE164(recipient_phone)) {
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 400, errorCode: 'invalid_phone' })
      return errorResponse('Invalid phone number. Must be E.164 format (e.g., +919876543210)', 400, origin)
    }

    // Validate language
    if (!language || !['en', 'hi'].includes(language)) {
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 400, errorCode: 'invalid_language' })
      return errorResponse('Invalid language. Must be "en" or "hi"', 400, origin)
    }

    // Validate data
    if (!data || typeof data !== 'object') {
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 400, errorCode: 'invalid_data' })
      return errorResponse('Missing or invalid data object', 400, origin)
    }

    // Check rate limit
    if (isRateLimited(recipient_phone)) {
      edgeLog('warn', context, { action: 'whatsapp.rate_limited', status: 'denied', recipient_phone })
      await logNotification(supabase, user_id, 'whatsapp', type, recipient_phone, 'rate_limited', undefined, undefined, context)
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 429, errorCode: 'rate_limited' })
      return jsonResponse(
        { success: false, error: 'Rate limit exceeded (100 messages/day per number)' },
        429,
        {},
        origin,
      )
    }

    // Look up template
    const template = TEMPLATES[type][language]
    if (!template) {
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 400, errorCode: 'template_not_found' })
      return errorResponse('Template not found for given type and language', 400, origin)
    }

    // Validate required template params
    const missingParams = template.params.filter((p) => !data[p])
    if (missingParams.length > 0) {
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 400, errorCode: 'missing_params' })
      return errorResponse(
        `Missing template parameters: ${missingParams.join(', ')}`,
        400,
        origin,
      )
    }

    // Send WhatsApp message
    edgeLog('info', context, { action: 'whatsapp.send_attempt', status: 'ok', template: type, language, recipient_phone })
    const result = await sendWhatsAppMessage(template, recipient_phone, language, data)

    if (result.success) {
      edgeLog('info', context, { action: 'whatsapp.sent', status: 'ok', template: type, language, message_id: result.messageId ?? null })
      await logNotification(supabase, user_id, 'whatsapp', type, recipient_phone, 'sent', result.messageId, undefined, context)
      await writeBusinessAudit({ supabase, context, action: 'whatsapp.sent', status: 'ok', metadata: { template: type, language, user_id: user_id ?? null } })
      await finalizeAiRoute({ sb: supabase, admission, statusCode: 200 })

      return jsonResponse(
        { success: true, message_id: result.messageId },
        200,
        {},
        origin,
      )
    }

    // WhatsApp failed — log and queue email fallback
    edgeLog('error', context, { action: 'whatsapp.send_failed', status: 'error', template: type, language, reason: result.error ?? 'unknown' })
    await logNotification(supabase, user_id, 'whatsapp', type, recipient_phone, 'failed', undefined, result.error, context)
    await queueEmailFallback(supabase, user_id, type, data, context)
    await finalizeAiRoute({ sb: supabase, admission, statusCode: 502, errorCode: 'whatsapp_send_failed' })

    return jsonResponse(
      { success: false, error: 'WhatsApp delivery failed, queued for email fallback', fallback: 'email' },
      502,
      {},
      origin,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    edgeLog('error', context, { action: 'whatsapp.unhandled', status: 'error', reason: message })
    await finalizeAiRoute({ sb: supabase, admission, statusCode: 500, errorCode: 'unhandled_error' })
    return errorResponse('Internal server error', 500, origin)
  }
})
