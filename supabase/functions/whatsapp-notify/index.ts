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

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, jsonResponse, errorResponse, getCorsHeaders } from '../_shared/cors.ts'

// ─── Types ──────────────────────────────────────────────────────────────────

type TemplateType = 'daily_reminder' | 'score_notification' | 'streak_warning' | 'weekly_summary'
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
    const res = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      {
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
  messageId?: string,
  errorMessage?: string,
): Promise<void> {
  try {
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
    console.error('[whatsapp-notify] Failed to log notification:', err instanceof Error ? err.message : String(err))
  }
}

async function queueEmailFallback(
  supabase: ReturnType<typeof createClient>,
  userId: string | undefined,
  templateType: string,
  data: Record<string, string>,
): Promise<void> {
  try {
    await supabase.from('task_queue').insert({
      type: 'email_fallback',
      payload: {
        original_channel: 'whatsapp',
        template_type: templateType,
        user_id: userId,
        data,
      },
      status: 'pending',
    })
    console.info(`[whatsapp-notify] Queued email fallback for template=${templateType}`)
  } catch (err) {
    console.error('[whatsapp-notify] Failed to queue email fallback:', err instanceof Error ? err.message : String(err))
  }
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  try {
    // Auth check
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return errorResponse('Missing authorization header', 401, origin)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    )

    // Parse and validate request body
    let body: NotifyRequest
    try {
      body = await req.json()
    } catch {
      return errorResponse('Invalid JSON body', 400, origin)
    }

    const { type, recipient_phone, language, data, user_id } = body

    // Validate template type
    if (!type || !TEMPLATES[type]) {
      return errorResponse(
        `Invalid template type. Must be one of: ${Object.keys(TEMPLATES).join(', ')}`,
        400,
        origin,
      )
    }

    // Validate phone number
    if (!recipient_phone || !isValidE164(recipient_phone)) {
      return errorResponse('Invalid phone number. Must be E.164 format (e.g., +919876543210)', 400, origin)
    }

    // Validate language
    if (!language || !['en', 'hi'].includes(language)) {
      return errorResponse('Invalid language. Must be "en" or "hi"', 400, origin)
    }

    // Validate data
    if (!data || typeof data !== 'object') {
      return errorResponse('Missing or invalid data object', 400, origin)
    }

    // Check rate limit
    if (isRateLimited(recipient_phone)) {
      console.warn(`[whatsapp-notify] Rate limited: ${redactPhone(recipient_phone)}`)
      await logNotification(supabase, user_id, 'whatsapp', type, recipient_phone, 'rate_limited')
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
      return errorResponse('Template not found for given type and language', 400, origin)
    }

    // Validate required template params
    const missingParams = template.params.filter((p) => !data[p])
    if (missingParams.length > 0) {
      return errorResponse(
        `Missing template parameters: ${missingParams.join(', ')}`,
        400,
        origin,
      )
    }

    // Send WhatsApp message
    console.info(`[whatsapp-notify] Sending ${type} (${language}) to ${redactPhone(recipient_phone)}`)
    const result = await sendWhatsAppMessage(template, recipient_phone, language, data)

    if (result.success) {
      console.info(`[whatsapp-notify] Sent successfully, messageId=${result.messageId}`)
      await logNotification(supabase, user_id, 'whatsapp', type, recipient_phone, 'sent', result.messageId)

      return jsonResponse(
        { success: true, message_id: result.messageId },
        200,
        {},
        origin,
      )
    }

    // WhatsApp failed — log and queue email fallback
    console.error(`[whatsapp-notify] Send failed: ${result.error}`)
    await logNotification(supabase, user_id, 'whatsapp', type, recipient_phone, 'failed', undefined, result.error)
    await queueEmailFallback(supabase, user_id, type, data)

    return jsonResponse(
      { success: false, error: 'WhatsApp delivery failed, queued for email fallback', fallback: 'email' },
      502,
      {},
      origin,
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[whatsapp-notify] Fatal error:', message)
    return errorResponse('Internal server error', 500, origin)
  }
})
