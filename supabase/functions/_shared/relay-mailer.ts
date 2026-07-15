/**
 * relay-mailer – provider-agnostic transactional email sender (Deno / Edge).
 *
 * Single seam through which the auth + transactional Edge Functions dispatch
 * email. The concrete default transport is Resend
 * (https://resend.com/docs/api-reference/emails/send-email):
 *
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer <RESEND_API_KEY>
 *   Idempotency-Key: <key>            // Resend honours this for 24h
 *   Content-Type: application/json
 *   body (snake_case): { from, to, subject, html, text, reply_to, headers, tags }
 *   success: { "id": "<uuid>" }
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
  /** PII-free failure code (e.g. 'resend_http_400', 'resend_exception'). */
  code?: string
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
          return { success: false, code: `resend_http_${res.status}` }
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
        return { success: true, id: (parsed as { id?: string }).id }
      } catch (err) {
        // Never surface err.message in the return value (may embed PII). Redacted
        // detail goes to the log; the caller sees only a stable machine code.
        console.error(JSON.stringify(redactPII({
          event: 'relay_email_exception',
          provider: name,
          detail: redactPIIInText(err instanceof Error ? err.message : String(err)).text,
        })))
        return { success: false, code: 'resend_exception' }
      }
    },
  }
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
 *   3. a fresh Resend transport (production default).
 *
 * Production callers use `sendEmail(message)` — no options — so nothing is
 * request-derived and the Resend transport reads RESEND_API_KEY from env.
 */
export async function sendEmail(
  message: EmailMessage,
  opts: { transport?: EmailTransport; fetcher?: typeof fetch } = {},
): Promise<EmailSendResult> {
  const transport = opts.transport ?? defaultTransport ?? createResendTransport({ fetcher: opts.fetcher })
  return await transport.send(message)
}
