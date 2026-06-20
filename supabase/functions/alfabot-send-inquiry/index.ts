/**
 * alfabot-send-inquiry — AlfaBot "Submit your query" mailer.
 *
 * Receives a visitor-submitted inquiry from the Next.js route
 * `/api/alfabot/inquiry` and forwards it to the inquiry inbox via Mailgun.
 *
 * Auth: this function is service-role-only. The Next.js route is the only
 * legitimate caller — it bears the SUPABASE_SERVICE_ROLE_KEY in the
 * `Authorization: Bearer …` header. Any other caller gets 401.
 *
 * Recipient: hardcoded at the top of this file (INQUIRY_RECIPIENT). Future
 * routing changes are intentionally obvious — edit this constant.
 *
 * P13 (Data Privacy):
 *   - We DO log the Mailgun message id, anon id, sessionId, and timestamps.
 *   - We NEVER log the visitor's email, name, or question content to stdout.
 *     (The email payload itself carries them — that's the whole point —
 *     but they do not enter Supabase function logs or Sentry.)
 *
 * Pattern mirrors `supabase/functions/send-welcome-email/index.ts` (Mailgun
 * POST shape, base64 Basic auth, form-encoded body, 10s AbortController).
 *
 * Owner: backend.
 */

import { edgeLog, getRequestId, type EdgeLogContext } from '../_shared/edge-audit-log.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

// ─── Hardcoded recipient ─────────────────────────────────────────────────────
// CHANGE THIS LINE to re-route AlfaBot inquiries. Single source of truth.
const INQUIRY_RECIPIENT = 'alfanumrik10@gmail.com'

// ─── CORS ────────────────────────────────────────────────────────────────────
// CORS logic (ALLOWED_ORIGINS + Vercel-preview detection) lives in
// ../_shared/cors.ts. This thin wrapper preserves the local
// (body, status, origin) call signature while delegating origin validation to
// the shared getCorsHeaders.
function jsonResponse(body: unknown, status = 200, requestOrigin?: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(requestOrigin), 'Content-Type': 'application/json' },
  })
}

// ─── Validation ──────────────────────────────────────────────────────────────

// RFC-5322 lite. Same shape used elsewhere in this repo.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MAX_NAME_LEN = 120
const MAX_EMAIL_LEN = 254
const MIN_QUESTION_LEN = 10
const MAX_QUESTION_LEN = 2000
const MAX_ANON_ID_LEN = 200
const MAILGUN_TIMEOUT_MS = 10_000

interface InquiryRequest {
  name?: string
  email: string
  question: string
  sessionId?: string | null
  anonId?: string
}

interface ValidatedInquiry {
  name: string | null
  email: string
  question: string
  sessionId: string | null
  anonId: string | null
}

function validateBody(body: unknown): ValidatedInquiry | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body_must_be_object' }
  const b = body as Record<string, unknown>

  // email — required.
  if (typeof b.email !== 'string') return { error: 'email_required' }
  const email = b.email.trim()
  if (email.length === 0 || email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return { error: 'email_invalid' }
  }

  // question — required, 10-2000 chars after trim.
  if (typeof b.question !== 'string') return { error: 'question_required' }
  const question = b.question.trim()
  if (question.length < MIN_QUESTION_LEN) return { error: 'question_too_short' }
  if (question.length > MAX_QUESTION_LEN) return { error: 'question_too_long' }

  // name — optional, ≤120 chars after trim.
  let name: string | null = null
  if (b.name !== undefined && b.name !== null) {
    if (typeof b.name !== 'string') return { error: 'name_invalid' }
    const trimmed = b.name.trim()
    if (trimmed.length > MAX_NAME_LEN) return { error: 'name_too_long' }
    name = trimmed.length === 0 ? null : trimmed
  }

  // sessionId — optional UUID.
  let sessionId: string | null = null
  if (b.sessionId !== undefined && b.sessionId !== null) {
    if (typeof b.sessionId !== 'string') return { error: 'sessionId_invalid' }
    if (!UUID_RE.test(b.sessionId)) return { error: 'sessionId_not_uuid' }
    sessionId = b.sessionId
  }

  // anonId — optional ≤200 chars.
  let anonId: string | null = null
  if (b.anonId !== undefined && b.anonId !== null) {
    if (typeof b.anonId !== 'string') return { error: 'anonId_invalid' }
    const trimmed = b.anonId.trim()
    if (trimmed.length === 0) anonId = null
    else if (trimmed.length > MAX_ANON_ID_LEN) return { error: 'anonId_too_long' }
    else anonId = trimmed
  }

  return { name, email, question, sessionId, anonId }
}

// ─── Mailgun ─────────────────────────────────────────────────────────────────

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildSubject(question: string): string {
  const trimmed = question.slice(0, 60)
  const ellipsis = question.length > 60 ? '…' : ''
  return `AlfaBot inquiry — ${trimmed}${ellipsis}`
}

function buildTextBody(args: {
  name: string | null
  email: string
  question: string
  sessionId: string | null
  anonId: string | null
}): string {
  const lines = [
    'A visitor submitted an inquiry via the AlfaBot widget on /welcome.',
    '',
    `Name:       ${args.name ?? '(no name)'}`,
    `Email:      ${args.email}`,
    '',
    'Question:',
    args.question,
    '',
    '— Metadata —',
    `Session ID: ${args.sessionId ?? '(none)'}`,
    `Anon ID:    ${args.anonId ?? '(none)'}`,
    `Submitted:  ${new Date().toISOString()}`,
  ]
  return lines.join('\n')
}

function buildHtmlBody(args: {
  name: string | null
  email: string
  question: string
  sessionId: string | null
  anonId: string | null
}): string {
  const safeName = args.name ? htmlEscape(args.name) : '<em>(no name)</em>'
  const safeEmail = htmlEscape(args.email)
  const safeQuestion = htmlEscape(args.question).replace(/\n/g, '<br>')
  const safeSession = args.sessionId ? htmlEscape(args.sessionId) : '<em>(none)</em>'
  const safeAnon = args.anonId ? htmlEscape(args.anonId) : '<em>(none)</em>'
  const submitted = new Date().toISOString()
  return [
    `<p>A visitor submitted an inquiry via the AlfaBot widget on <strong>/welcome</strong>.</p>`,
    `<p><strong>Name:</strong> ${safeName}</p>`,
    `<p><strong>Email:</strong> ${safeEmail}</p>`,
    `<p><strong>Question:</strong><br>${safeQuestion}</p>`,
    `<hr>`,
    `<p><strong>Session ID:</strong> ${safeSession}</p>`,
    `<p><strong>Anon ID:</strong> ${safeAnon}</p>`,
    `<p><strong>Submitted:</strong> ${submitted}</p>`,
  ].join('')
}

interface MailgunResult {
  ok: boolean
  messageId?: string
  status?: number
  error?: string
}

async function sendViaMailgun(args: {
  apiKey: string
  domain: string
  to: string
  replyTo: string
  subject: string
  text: string
  html: string
}): Promise<MailgunResult> {
  const form = new FormData()
  form.append('from', `AlfaBot <noreply@${args.domain}>`)
  form.append('to', args.to)
  form.append('h:Reply-To', args.replyTo)
  form.append('subject', args.subject)
  form.append('text', args.text)
  form.append('html', args.html)
  form.append('o:tag', 'category:alfabot-inquiry')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MAILGUN_TIMEOUT_MS)
  try {
    const res = await fetch(`https://api.mailgun.net/v3/${args.domain}/messages`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Authorization': `Basic ${btoa(`api:${args.apiKey}`)}` },
      body: form,
    })
    clearTimeout(timer)
    if (!res.ok) {
      let errText = ''
      try { errText = await res.text() } catch { /* ignore */ }
      return { ok: false, status: res.status, error: `http_${res.status}` + (errText ? `:${errText.slice(0, 200)}` : '') }
    }
    const json = (await res.json()) as { id?: string }
    return { ok: true, messageId: json.id ?? '', status: res.status }
  } catch (err) {
    clearTimeout(timer)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    return { ok: false, error: isAbort ? 'timeout' : (err instanceof Error ? err.message : 'fetch_failed') }
  }
}

// ─── Structured logging (no PII) ─────────────────────────────────────────────

function logEvent(context: EdgeLogContext, action: string, status: 'ok' | 'error' | 'warn' | 'denied', fields: Record<string, unknown> = {}): void {
  edgeLog(status === 'error' || status === 'denied' ? 'error' : status === 'warn' ? 'warn' : 'info', context, {
    action,
    status,
    ...fields,
  })
}

// ─── Main handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const context: EdgeLogContext = {
    requestId: getRequestId(req),
    route: 'alfabot-send-inquiry',
    role: 'unknown',
    actor: null,
    schoolId: null,
    startedAt: Date.now(),
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405, origin)
  }

  // ── Auth: require a Supabase service-role JWT ──
  // Strict-equality against env-SRK was brittle (key rotations / multi-env
  // mismatches caused 401s). We now decode the bearer JWT and check the
  // `role` claim — same security model as the rest of the AI Edge Functions
  // in this repo. The Supabase platform also validates the JWT signature
  // upstream before our code runs, so unsigned bearers can never reach here.
  const authHeader = req.headers.get('Authorization') ?? ''
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!bearer) {
    logEvent(context, 'alfabot_inquiry.unauthorized', 'denied', { reason: 'no_bearer' })
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401, origin)
  }
  const parts = bearer.split('.')
  if (parts.length !== 3) {
    logEvent(context, 'alfabot_inquiry.unauthorized', 'denied', { reason: 'bad_jwt_shape' })
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401, origin)
  }
  let role = ''
  try {
    // base64url decode the JWT payload (middle segment)
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((parts[1].length + 3) % 4)
    const decoded = JSON.parse(atob(padded)) as { role?: string }
    role = String(decoded.role ?? '')
  } catch {
    logEvent(context, 'alfabot_inquiry.unauthorized', 'denied', { reason: 'jwt_decode_failed' })
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401, origin)
  }
  context.role = role || 'unknown'
  if (role !== 'service_role') {
    logEvent(context, 'alfabot_inquiry.unauthorized', 'denied', { reason: 'role_not_service', role })
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401, origin)
  }

  // ── Parse + validate body ──
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return jsonResponse({ ok: false, error: 'invalid_body' }, 400, origin)
  }
  const validated = validateBody(raw)
  if ('error' in validated) {
    return jsonResponse({ ok: false, error: validated.error }, 400, origin)
  }

  // ── Mailgun config ──
  const apiKey = Deno.env.get('MAILGUN_API_KEY') ?? ''
  const domain = Deno.env.get('MAILGUN_DOMAIN') ?? ''
  if (!apiKey || !domain) {
    logEvent(context, 'alfabot_inquiry.mailgun_config_missing', 'error', {
      has_api_key: Boolean(apiKey),
      has_domain: Boolean(domain),
    })
    return jsonResponse({ ok: false, error: 'mailgun_config_missing' }, 503, origin)
  }

  // ── Build email ──
  const subject = buildSubject(validated.question)
  const text = buildTextBody(validated)
  const html = buildHtmlBody(validated)

  // ── Send ──
  const result = await sendViaMailgun({
    apiKey,
    domain,
    to: INQUIRY_RECIPIENT,
    replyTo: validated.email, // so the team can reply directly to the visitor
    subject,
    text,
    html,
  })

  if (!result.ok) {
    logEvent(context, 'alfabot_inquiry.mailgun_failed', 'error', {
      anon_id: validated.anonId,
      session_id: validated.sessionId,
      mailgun_status: result.status ?? null,
      reason: result.error ?? 'unknown',
    })
    return jsonResponse(
      { ok: false, error: `mailgun_${result.status ?? 'error'}` },
      502,
      origin,
    )
  }

  logEvent(context, 'alfabot_inquiry.sent', 'ok', {
    anon_id: validated.anonId,
    session_id: validated.sessionId,
    mailgun_message_id: result.messageId ?? null,
    mailgun_status: result.status ?? null,
  })

  return jsonResponse(
    { ok: true, messageId: result.messageId ?? '' },
    200,
    origin,
  )
})
