/**
 * relay-mailer – provider-agnostic transactional email sender (Deno / Edge).
 *
 * Single seam through which the auth + transactional Edge Functions dispatch
 * email. The default transport is resolved from env AT SEND TIME by
 * `resolveDefaultTransport()`:
 *
 *   1. RESEND_API_KEY present                     → Resend  (primary)
 *   2. else MAILGUN_API_KEY + MAILGUN_DOMAIN pres → Mailgun (TRANSITIONAL fallback)
 *   3. else                                       → no transport (config-absent)
 *
 * ⚠️ TRANSITIONAL MAILGUN FALLBACK — REMOVE ONCE RESEND IS CONFIRMED LIVE IN
 * PRODUCTION. Production currently has MAILGUN_API_KEY/MAILGUN_DOMAIN set but
 * NOT RESEND_API_KEY. Without the Mailgun fallback, deploying the Resend
 * cutover would silently stop ALL email (a P15 onboarding outage). The fallback
 * makes the cutover ZERO-DOWNTIME: email keeps flowing through the already-live
 * Mailgun until an operator sets RESEND_API_KEY, at which point Resend takes
 * over automatically with no code change. Delete `createMailgunTransport` and
 * its branches in `resolveDefaultTransport()` / `hasEmailTransportConfig()`
 * once Resend is verified in prod.
 *
 * Resend wire (https://resend.com/docs/api-reference/emails/send-email):
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer <RESEND_API_KEY>
 *   Idempotency-Key: <key>            // Resend honours this for 24h
 *   Content-Type: application/json
 *   body (snake_case): { from, to, subject, html, text, reply_to, headers, tags }
 *   success: { "id": "<uuid>" }
 *
 * Mailgun wire (restored verbatim from the pre-Phase-2 senders, git 4fdd35c3~1):
 *   POST https://api.mailgun.net/v3/<MAILGUN_DOMAIN>/messages
 *   Authorization: Basic base64("api:" + MAILGUN_API_KEY)
 *   Idempotency-Key: <key>            // set for retry-safety parity with Resend
 *   body (multipart/form-data): from,to,subject,html,text,h:Reply-To,h:<hdr>,o:tag
 *   success: { "id": "<message-id>" }
 *
 * Reliability posture is inherited from `fetchWithTimeout` (_shared/reliability.ts):
 * a 10s timeout and up to 3 attempts. The POST is only retried because we pass an
 * `Idempotency-Key` (Resend dedupes retries), so a genuine transport retry never
 * double-sends.
 *
 * P13 (Data Privacy): every log line is redacted. Keyed/structured payloads go
 * through `redactPII`; free-form provider error bodies go through
 * `redactPIIInText`. Failure/exception return codes are PII-free machine strings
 * (`resend_http_<status>` / `resend_exception`) — the raw provider detail lives
 * ONLY in a redacted log line, never in the returned code.
 *
 * Testing seam: `setDefaultEmailTransport(transport)` swaps the module-global
 * default transport. This is TEST-ONLY. Production code calls `sendEmail(message)`
 * with no options, so nothing about the transport is request-derived.
 */

import { createEmailIdempotencyKey, fetchWithTimeout } from './reliability.ts'
import { redactPII, redactPIIInText } from './redact-pii.ts'

// ─── Public contract ────────────────────────────────────────────────────────

/** A provider-agnostic email to dispatch. Fields are camelCase; the concrete
 *  transport maps them to its own wire format (Resend uses snake_case). */
export interface EmailMessage {
  /** RFC 5322 From — e.g. "Alfanumrik <noreply@alfanumrik.com>". */
  from: string
  /** Recipient address. */
  to: string
  subject: string
  html: string
  text: string
  /** Optional Reply-To address. */
  replyTo?: string
  /** Optional custom headers (List-Unsubscribe, X-Entity-Ref-ID, …). */
  headers?: Record<string, string>
  /** Optional provider-side categorisation tags. */
  tags?: Array<{ name: string; value: string }>
  /** Precomputed idempotency key. If absent the transport derives a stable one
   *  from template+recipient+subject. Callers that need per-token variation
   *  (e.g. auth confirmations) MUST supply this. */
  idempotencyKey?: string
  /** Metric/operation label for observability (default 'send_email'). */
  operation?: string
}

/** Result of a send attempt. On failure `code` is a PII-free machine string. */
export interface EmailSendResult {
  success: boolean
  /** Provider message id on success. */
  id?: string
  /** PII-free failure code (e.g. 'resend_http_400', 'resend_exception',
   *  'mailgun_http_401', 'mailgun_exception', 'no_transport_configured'). */
  code?: string
  /** Which concrete transport handled the send ('resend' | 'mailgun'). Optional;
   *  surfaced for observability during the transitional Resend/Mailgun cutover. */
  provider?: string
}

/** A pluggable email transport. Concrete impls: Resend (default), test stubs. */
export interface EmailTransport {
  readonly name: string
  send(message: EmailMessage): Promise<EmailSendResult>
}

const RESEND_API_URL = 'https://api.resend.com/emails'
const EMAIL_TIMEOUT_MS = 10_000
const EMAIL_MAX_ATTEMPTS = 3

// ─── Resend transport (concrete default) ────────────────────────────────────

/**
 * Build a Resend-backed transport. `apiKey` defaults to the RESEND_API_KEY
 * Edge Function secret; `fetcher` defaults to global `fetch` (via
 * fetchWithTimeout). Reading the key here (not at module load) keeps the
 * transport re-creatable per call without caching a stale secret.
 */
export function createResendTransport(opts: { apiKey?: string; fetcher?: typeof fetch } = {}): EmailTransport {
  const apiKey = opts.apiKey ?? Deno.env.get('RESEND_API_KEY') ?? ''
  const name = 'resend'

  return {
    name,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const idempotencyKey = message.idempotencyKey ?? createEmailIdempotencyKey({
        template: 'relay_email',
        recipient: message.to,
        subject: message.subject,
      })

      // Resend wire body — snake_case. Only include optional fields when present.
      const body: Record<string, unknown> = {
        from: message.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      }
      if (message.replyTo) body.reply_to = message.replyTo
      if (message.headers) body.headers = message.headers
      if (message.tags) body.tags = message.tags

      try {
        const res = await fetchWithTimeout(RESEND_API_URL, {
          // Explicit so provider metrics are tagged 'resend' rather than being
          // inferred (inferProvider also maps api.resend.com → 'resend', but
          // pinning it here keeps the metric attribution stable if the URL moves).
          provider: 'resend',
          operation: message.operation ?? 'send_email',
          timeoutMs: EMAIL_TIMEOUT_MS,
          retry: { maxAttempts: EMAIL_MAX_ATTEMPTS },
          idempotencyKey,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          fetcher: opts.fetcher,
        })

        if (!res.ok) {
          // Provider error body is free-form → redactPIIInText. The returned
          // code carries NO provider detail, only the status class.
          const raw = await res.text().catch(() => '')
          console.error(JSON.stringify(redactPII({
            event: 'relay_email_failed',
            provider: name,
            status: res.status,
            detail: redactPIIInText(raw).text,
          })))
          return { success: false, provider: name, code: `resend_http_${res.status}` }
        }

        const parsed = await res.json().catch(() => ({} as { id?: string }))
        // Keyed payload → redactPII. `email` is a SENSITIVE_KEY, so the recipient
        // is scrubbed to [REDACTED] before the line is ever written.
        console.log(JSON.stringify(redactPII({
          event: 'relay_email_sent',
          provider: name,
          operation: message.operation ?? 'send_email',
          email: message.to,
          id: (parsed as { id?: string }).id,
        })))
        return { success: true, provider: name, id: (parsed as { id?: string }).id }
      } catch (err) {
        // Never surface err.message in the return value (may embed PII). Redacted
        // detail goes to the log; the caller sees only a stable machine code.
        console.error(JSON.stringify(redactPII({
          event: 'relay_email_exception',
          provider: name,
          detail: redactPIIInText(err instanceof Error ? err.message : String(err)).text,
        })))
        return { success: false, provider: name, code: 'resend_exception' }
      }
    },
  }
}

// ─── Mailgun transport (TRANSITIONAL fallback) ──────────────────────────────
//
// ⚠️ TRANSITIONAL — REMOVE ONCE RESEND IS CONFIRMED LIVE IN PRODUCTION.
// Restored verbatim (wire shape) from the pre-Phase-2 senders (git 4fdd35c3~1)
// so the Resend cutover can merge with ZERO downtime while prod still has only
// MAILGUN_API_KEY/MAILGUN_DOMAIN configured. It preserves the SAME
// reliability/timeout (10s, 3 attempts), the SAME Idempotency-Key posture, and
// the SAME P13 redaction contract as the Resend transport: the recipient and
// any free-form provider error body are redacted before they reach a log line,
// and the returned failure `code` is a PII-free machine string that carries no
// provider detail. Delete this transport (and its branch in
// resolveDefaultTransport/hasEmailTransportConfig) once Resend is verified.

const MAILGUN_API_BASE = 'https://api.mailgun.net/v3'

/**
 * Build a Mailgun-backed transport. `apiKey`/`domain` default to the
 * MAILGUN_API_KEY / MAILGUN_DOMAIN Edge Function secrets; `fetcher` defaults to
 * global `fetch` (via fetchWithTimeout). Reading the secrets here (not at module
 * load) keeps the transport re-creatable per call without caching a stale value.
 */
export function createMailgunTransport(opts: { apiKey?: string; domain?: string; fetcher?: typeof fetch } = {}): EmailTransport {
  const apiKey = opts.apiKey ?? Deno.env.get('MAILGUN_API_KEY') ?? ''
  const domain = opts.domain ?? Deno.env.get('MAILGUN_DOMAIN') ?? ''
  const name = 'mailgun'

  return {
    name,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const idempotencyKey = message.idempotencyKey ?? createEmailIdempotencyKey({
        template: 'relay_email',
        recipient: message.to,
        subject: message.subject,
      })

      // Mailgun wire body — multipart/form-data. Custom headers ride as h:<name>,
      // provider tags as repeated o:tag. Restored from the pre-Phase-2 sender.
      const form = new FormData()
      form.append('from', message.from)
      form.append('to', message.to)
      form.append('subject', message.subject)
      form.append('html', message.html)
      form.append('text', message.text)
      if (message.replyTo) form.append('h:Reply-To', message.replyTo)
      if (message.headers) {
        for (const [k, v] of Object.entries(message.headers)) form.append(`h:${k}`, v)
      }
      if (message.tags) {
        for (const t of message.tags) form.append('o:tag', `${t.name}:${t.value}`)
      }

      try {
        const res = await fetchWithTimeout(`${MAILGUN_API_BASE}/${domain}/messages`, {
          provider: 'mailgun',
          operation: message.operation ?? 'send_email',
          timeoutMs: EMAIL_TIMEOUT_MS,
          retry: { maxAttempts: EMAIL_MAX_ATTEMPTS },
          idempotencyKey,
          method: 'POST',
          headers: {
            'Authorization': `Basic ${btoa(`api:${apiKey}`)}`,
          },
          body: form,
          fetcher: opts.fetcher,
        })

        if (!res.ok) {
          // Provider error body is free-form → redactPIIInText. The returned
          // code carries NO provider detail, only the status class.
          const raw = await res.text().catch(() => '')
          console.error(JSON.stringify(redactPII({
            event: 'relay_email_failed',
            provider: name,
            status: res.status,
            detail: redactPIIInText(raw).text,
          })))
          return { success: false, provider: name, code: `mailgun_http_${res.status}` }
        }

        const parsed = await res.json().catch(() => ({} as { id?: string }))
        // Keyed payload → redactPII. `email` is a SENSITIVE_KEY, so the recipient
        // is scrubbed to [REDACTED] before the line is ever written.
        console.log(JSON.stringify(redactPII({
          event: 'relay_email_sent',
          provider: name,
          operation: message.operation ?? 'send_email',
          email: message.to,
          id: (parsed as { id?: string }).id,
        })))
        return { success: true, provider: name, id: (parsed as { id?: string }).id }
      } catch (err) {
        // Never surface err.message in the return value (may embed PII). Redacted
        // detail goes to the log; the caller sees only a stable machine code.
        console.error(JSON.stringify(redactPII({
          event: 'relay_email_exception',
          provider: name,
          detail: redactPIIInText(err instanceof Error ? err.message : String(err)).text,
        })))
        return { success: false, provider: name, code: 'mailgun_exception' }
      }
    },
  }
}

// ─── Transport resolution (env-driven, Resend-primary / Mailgun-fallback) ────

/**
 * True if EITHER email transport is configured: Resend (RESEND_API_KEY) OR the
 * TRANSITIONAL Mailgun fallback (MAILGUN_API_KEY + MAILGUN_DOMAIN). The six email
 * Edge Functions gate their "attempt to send" branch on this same predicate —
 * when it is false (BOTH providers unconfigured) they emit the config-absent
 * warning and degrade gracefully. Remove the Mailgun clause once Resend is live.
 */
export function hasEmailTransportConfig(): boolean {
  const resend = Deno.env.get('RESEND_API_KEY') ?? ''
  const mailgunKey = Deno.env.get('MAILGUN_API_KEY') ?? ''
  const mailgunDomain = Deno.env.get('MAILGUN_DOMAIN') ?? ''
  return Boolean(resend) || Boolean(mailgunKey && mailgunDomain)
}

/**
 * Pick the default transport at SEND time (never cached): Resend when
 * RESEND_API_KEY is present (primary), else the TRANSITIONAL Mailgun fallback
 * when MAILGUN_API_KEY + MAILGUN_DOMAIN are present, else null (config-absent).
 * The moment an operator sets RESEND_API_KEY in prod, Resend wins automatically
 * with no code change — that is the zero-downtime cutover.
 */
export function resolveDefaultTransport(opts: { fetcher?: typeof fetch } = {}): EmailTransport | null {
  const resend = Deno.env.get('RESEND_API_KEY') ?? ''
  if (resend) return createResendTransport({ apiKey: resend, fetcher: opts.fetcher })
  const mailgunKey = Deno.env.get('MAILGUN_API_KEY') ?? ''
  const mailgunDomain = Deno.env.get('MAILGUN_DOMAIN') ?? ''
  if (mailgunKey && mailgunDomain) return createMailgunTransport({ apiKey: mailgunKey, domain: mailgunDomain, fetcher: opts.fetcher })
  return null
}

// ─── Default-transport DI seam (TEST-ONLY) ──────────────────────────────────

let defaultTransport: EmailTransport | null = null

/**
 * TEST-ONLY. Override (or clear, with `null`) the module-global default
 * transport used by `sendEmail`. Production never calls this — `sendEmail`
 * is invoked with no options, so the transport is not request-derived.
 */
export function setDefaultEmailTransport(transport: EmailTransport | null): void {
  defaultTransport = transport
}

/**
 * Dispatch an email. Transport resolution order:
 *   1. an explicit `opts.transport` (per-call override),
 *   2. the module-global default set via `setDefaultEmailTransport` (tests),
 *   3. the env-resolved default (`resolveDefaultTransport`): Resend if
 *      RESEND_API_KEY is set, else the TRANSITIONAL Mailgun fallback if
 *      MAILGUN_API_KEY + MAILGUN_DOMAIN are set.
 *
 * Production callers use `sendEmail(message)` — no options — so nothing is
 * request-derived and the transport reads its secret(s) from env. When NEITHER
 * provider is configured the resolver returns null; we then return a PII-free
 * `no_transport_configured` failure (callers already gate on
 * `hasEmailTransportConfig()`, so this is a defensive belt-and-braces path).
 */
export async function sendEmail(
  message: EmailMessage,
  opts: { transport?: EmailTransport; fetcher?: typeof fetch } = {},
): Promise<EmailSendResult> {
  const transport = opts.transport ?? defaultTransport ?? resolveDefaultTransport({ fetcher: opts.fetcher })
  if (!transport) {
    console.error(JSON.stringify(redactPII({ event: 'relay_email_no_transport' })))
    return { success: false, code: 'no_transport_configured' }
  }
  return await transport.send(message)
}
