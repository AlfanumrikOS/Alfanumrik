/**
 * relay-mailer – provider-agnostic transactional email sender (Deno / Edge).
 *
 * Single seam through which the auth + transactional Edge Functions dispatch
 * email. The default transport is resolved from env AT SEND TIME by
 * `resolveDefaultTransport()`:
 *
 *   1. GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY + GMAIL_SENDER present
 *                                               → Gmail API (the email provider)
 *   2. else MAILGUN_API_KEY + MAILGUN_DOMAIN    → Mailgun (legacy fallback)
 *   3. else                                     → no transport (config-absent)
 *
 * ── Product decision 2026-07-16: Google Workspace is the email provider. ─────
 * Mailgun disabled the company account, so all production email moved onto the
 * company's existing Google Workspace via the Gmail API (CEO-approved; no new
 * third-party email platform). Gmail is the PREFERRED default transport; the
 * Mailgun transport is retained as a legacy fallback (selected only when the
 * Gmail secrets are absent — harmless, the account is dead). The Resend
 * transport (`createResendTransport`) remains injectable-only (tests / explicit
 * override) and is NEVER selected by the default path — do not switch back to
 * Mailgun-primary or to Resend without an explicit product decision.
 *
 * Gmail wire (verified 2026-07-16 against
 * https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send
 * and https://developers.google.com/identity/protocols/oauth2/service-account):
 *   1. OAuth2 service-account JWT-bearer flow with domain-wide delegation:
 *      sign a JWT (RS256, header {"alg":"RS256","typ":"JWT"}) with claims
 *      iss=<GOOGLE_SA_CLIENT_EMAIL>, sub=<GMAIL_SENDER> (impersonated mailbox),
 *      scope=https://www.googleapis.com/auth/gmail.send,
 *      aud=https://oauth2.googleapis.com/token, iat/exp (1h max), then
 *      POST https://oauth2.googleapis.com/token
 *        Content-Type: application/x-www-form-urlencoded
 *        grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>
 *      success: { "access_token": "...", "expires_in": 3600, "token_type": "Bearer" }
 *      The token is cached module-globally until ~5min before expiry.
 *   2. POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
 *      Authorization: Bearer <access_token>
 *      Content-Type: application/json
 *      body: { "raw": "<RFC 2822 message, base64url encoded>" }
 *      success: Message resource — { "id": "<gmail-message-id>", ... }
 *
 * Mailgun wire (https://documentation.mailgun.com/docs/mailgun/api-reference/):
 *   POST https://api.mailgun.net/v3/<MAILGUN_DOMAIN>/messages
 *   Authorization: Basic base64("api:" + MAILGUN_API_KEY)
 *   Idempotency-Key: <key>            // set for retry-safety
 *   body (multipart/form-data): from,to,subject,html,text,h:Reply-To,h:<hdr>,o:tag
 *   success: { "id": "<message-id>" }
 *
 * Resend wire (retained for the injectable transport, NOT the default path;
 * https://resend.com/docs/api-reference/emails/send-email):
 *   POST https://api.resend.com/emails
 *   Authorization: Bearer <RESEND_API_KEY>
 *   Idempotency-Key: <key>            // Resend honours this for 24h
 *   Content-Type: application/json
 *   body (snake_case): { from, to, subject, html, text, reply_to, headers, tags }
 *   success: { "id": "<uuid>" }
 *
 * Reliability posture is inherited from `fetchWithTimeout` (_shared/reliability.ts):
 * a 10s timeout and up to 3 attempts. For Mailgun/Resend the POST retry is fully
 * safe because the provider dedupes on `Idempotency-Key`. Gmail has NO
 * provider-side dedup (the idempotency key rides only as an X-Idempotency-Key
 * MIME header for correlation), so a retry after a lost/timed-out response can —
 * rarely — deliver the same email twice. Accepted trade-off: for auth /
 * transactional email a rare duplicate is far better than a lost email (P15).
 *
 * P13 (Data Privacy): every log line is redacted. Keyed/structured payloads go
 * through `redactPII`; free-form provider error bodies go through
 * `redactPIIInText`. Failure/exception return codes are PII-free machine strings
 * (`gmail_http_<status>` / `gmail_auth_failed` / `gmail_exception` /
 * `mailgun_http_<status>` / `mailgun_exception`) — the raw provider detail lives
 * ONLY in a redacted log line, never in the returned code. The Google private
 * key, signed JWTs, and access tokens are NEVER logged.
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
  /** PII-free failure code (e.g. 'gmail_http_400', 'gmail_auth_failed',
   *  'gmail_exception', 'resend_http_400', 'resend_exception',
   *  'mailgun_http_401', 'mailgun_exception', 'no_transport_configured'). */
  code?: string
  /** Which concrete transport handled the send ('gmail' | 'mailgun' | 'resend').
   *  Optional; surfaced for observability. Gmail is the default; Mailgun is the
   *  legacy fallback; Resend is injectable-only. */
  provider?: string
}

/** A pluggable email transport. Concrete impls: Gmail (default), Mailgun
 *  (legacy fallback), Resend (retained, injectable-only — never the default),
 *  test stubs. */
export interface EmailTransport {
  readonly name: string
  send(message: EmailMessage): Promise<EmailSendResult>
}

const RESEND_API_URL = 'https://api.resend.com/emails'
const EMAIL_TIMEOUT_MS = 10_000
const EMAIL_MAX_ATTEMPTS = 3

// ─── Resend transport (retained, injectable-only — NOT the default) ──────────
//
// Product decision 2026-07-16: Google Workspace (Gmail API) is the email
// provider. This Resend transport is retained for injectability / tests /
// possible future use, but is NEVER selected by resolveDefaultTransport().
// Do not switch to Resend without an explicit product decision.

/**
 * Build a Resend-backed transport. `apiKey` defaults to the RESEND_API_KEY
 * Edge Function secret; `fetcher` defaults to global `fetch` (via
 * fetchWithTimeout). Reading the key here (not at module load) keeps the
 * transport re-creatable per call without caching a stale secret.
 *
 * NOTE: this is not wired into the default send path (see
 * `resolveDefaultTransport`). It is used only via an explicit `opts.transport`
 * override or `setDefaultEmailTransport` (tests).
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

// ─── Mailgun transport (legacy fallback — account disabled) ──────────────────
//
// Product decision 2026-07-16: Google Workspace (Gmail API) is the email
// provider — Mailgun disabled the company account. This transport is retained
// as the LEGACY FALLBACK: resolveDefaultTransport selects it only when the
// Gmail secrets are absent and MAILGUN_API_KEY + MAILGUN_DOMAIN are configured
// (harmless — the account is dead, and removing the path is a separate cleanup).
// It carries the SAME reliability/timeout (10s, 3 attempts), the SAME
// Idempotency-Key posture, and the SAME P13 redaction contract as the other
// transports: the recipient and any free-form provider error body are redacted
// before they reach a log line, and the returned failure `code` is a PII-free
// machine string that carries no provider detail.

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

// ─── Gmail API transport (the default provider) ──────────────────────────────
//
// Product decision 2026-07-16: Google Workspace (Gmail API) is the email
// provider — Mailgun disabled the company account. This transport authenticates
// with a Google service account using DOMAIN-WIDE DELEGATION: it signs an RS256
// JWT whose `sub` claim impersonates the GMAIL_SENDER mailbox, exchanges it for
// an access token at the Google OAuth2 token endpoint, and sends the message as
// that mailbox via `users/me/messages/send`. Wire shapes verified 2026-07-16
// against the live Google docs (see the module header).
//
// It carries the SAME reliability/timeout posture (10s, 3 attempts via
// fetchWithTimeout) and the SAME P13 redaction contract as the other
// transports. Gmail-specific caveats:
//   - Gmail has NO provider-side idempotency: the message idempotency key is
//     embedded as an `X-Idempotency-Key` MIME header for CORRELATION ONLY (it
//     lets a delivered message be traced back to the relay dispatch that
//     produced it). A retry after a lost response can rarely double-send —
//     accepted trade-off vs losing auth email (P15).
//   - The From mailbox (e.g. noreply@ / welcome@ / billing@alfanumrik.com)
//     must be a configured "Send mail as" alias of the GMAIL_SENDER mailbox in
//     Google Workspace, otherwise Gmail rewrites the From header to the
//     impersonated mailbox address (delivery still succeeds).
//   - P13: the private key, signed JWT, and access token are NEVER logged.

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
/** Refresh the cached access token this long BEFORE Google's stated expiry. */
const GMAIL_TOKEN_EARLY_REFRESH_MS = 5 * 60 * 1000

// ── Encoding helpers (module-private) ────────────────────────────────────────

/** btoa over raw bytes, chunked so large HTML bodies don't blow the call stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlFromString(s: string): string {
  return base64UrlFromBytes(new TextEncoder().encode(s))
}

/** RFC 2045: base64 body lines must not exceed 76 chars. */
function wrapBase64Lines(b64: string): string {
  return b64.match(/.{1,76}/g)?.join('\r\n') ?? ''
}

/** Strip CR/LF so no caller-supplied value can inject extra MIME headers. */
function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/**
 * RFC 2047 encoded-word for non-ASCII header values (UTF-8 subjects — the
 * bilingual EN|HI templates put Devanagari in the Subject). ASCII-only values
 * pass through unchanged. Long values are split into multiple encoded words
 * (each ≤75 chars incl. the =?UTF-8?B?...?= wrapper) joined with folding
 * whitespace, splitting on code points so a multi-byte char is never cut.
 */
function encodeRfc2047(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value
  const encoder = new TextEncoder()
  const MAX_CHUNK_BYTES = 45 // 45 bytes → 60 base64 chars → 72 chars per encoded word
  const words: string[] = []
  let chunk = ''
  for (const ch of value) {
    if (encoder.encode(chunk + ch).length > MAX_CHUNK_BYTES && chunk.length > 0) {
      words.push(`=?UTF-8?B?${bytesToBase64(encoder.encode(chunk))}?=`)
      chunk = ch
    } else {
      chunk += ch
    }
  }
  if (chunk.length > 0) words.push(`=?UTF-8?B?${bytesToBase64(encoder.encode(chunk))}?=`)
  return words.join('\r\n ')
}

/**
 * Build the RFC 2822 message for Gmail's `raw` field: multipart/alternative
 * with base64-encoded UTF-8 text + html parts (Hindi content survives every
 * legacy mail hop), RFC 2047 subject, Reply-To, custom headers, provider tags
 * folded into one X-Alfanumrik-Tags header, and the idempotency key as
 * X-Idempotency-Key (correlation only — Gmail has no dedup; see transport note).
 */
function buildGmailRawMessage(message: EmailMessage, idempotencyKey: string): string {
  const boundary = `=_alfanumrik_${crypto.randomUUID()}`
  const headerLines: string[] = [
    `From: ${sanitizeHeaderValue(message.from)}`,
    `To: ${sanitizeHeaderValue(message.to)}`,
    `Subject: ${encodeRfc2047(sanitizeHeaderValue(message.subject))}`,
  ]
  if (message.replyTo) headerLines.push(`Reply-To: ${sanitizeHeaderValue(message.replyTo)}`)
  headerLines.push('MIME-Version: 1.0')
  // Correlation only: Gmail has NO provider-side idempotency/dedup (unlike
  // Mailgun/Resend, which honour the Idempotency-Key HTTP header). This MIME
  // header lets a delivered message be traced back to the relay dispatch.
  headerLines.push(`X-Idempotency-Key: ${sanitizeHeaderValue(idempotencyKey)}`)
  if (message.headers) {
    for (const [name, value] of Object.entries(message.headers)) {
      // Defensive: only well-formed header names; values are CR/LF-stripped.
      if (/^[A-Za-z0-9-]+$/.test(name)) headerLines.push(`${name}: ${sanitizeHeaderValue(value)}`)
    }
  }
  if (message.tags && message.tags.length > 0) {
    const tags = message.tags.map((t) => `${sanitizeHeaderValue(t.name)}=${sanitizeHeaderValue(t.value)}`).join('; ')
    headerLines.push(`X-Alfanumrik-Tags: ${tags}`)
  }
  headerLines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)

  const encoder = new TextEncoder()
  const lines = [
    ...headerLines,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64Lines(bytesToBase64(encoder.encode(message.text))),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64Lines(bytesToBase64(encoder.encode(message.html))),
    `--${boundary}--`,
    '',
  ]
  return lines.join('\r\n')
}

// ── Service-account JWT + token cache ────────────────────────────────────────

/** PEM (PKCS8) → DER bytes. Normalizes literal "\n" sequences (secrets pasted
 *  into dashboards often carry them) into real newlines first. */
function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const normalized = pem.replace(/\\n/g, '\n')
  const body = normalized
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '')
  const binary = atob(body)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Sign the service-account JWT (RS256 via WebCrypto: PKCS8 import + sign).
 *  `sub` = the impersonated GMAIL_SENDER mailbox (domain-wide delegation). */
async function signGoogleServiceAccountJwt(args: { clientEmail: string; privateKeyPem: string; sub: string }): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(args.privateKeyPem),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const nowSec = Math.floor(Date.now() / 1000)
  const header = base64UrlFromString(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = base64UrlFromString(JSON.stringify({
    iss: args.clientEmail,
    sub: args.sub,
    scope: GMAIL_SEND_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSec,
    exp: nowSec + 3600, // 1h — the documented maximum
  }))
  const signingInput = `${header}.${claims}`
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${base64UrlFromBytes(new Uint8Array(signature))}`
}

interface CachedGmailToken {
  accessToken: string
  /** Epoch ms after which the token must be re-minted (expiry minus 5min). */
  refreshAfterMs: number
}

// Module-global token cache, keyed by clientEmail|sender so distinct
// credentials never share a token. Survives across sends within one Edge
// Function isolate; each isolate re-mints on cold start.
const gmailTokenCache = new Map<string, CachedGmailToken>()

/** TEST-ONLY. Clear the module-global Gmail access-token cache. */
export function clearGmailTokenCacheForTests(): void {
  gmailTokenCache.clear()
}

/**
 * Build a Gmail-API-backed transport. `clientEmail`/`privateKey`/`sender`
 * default to the GOOGLE_SA_CLIENT_EMAIL / GOOGLE_SA_PRIVATE_KEY / GMAIL_SENDER
 * Edge Function secrets; `fetcher` defaults to global `fetch` (via
 * fetchWithTimeout). Reading the secrets here (not at module load) keeps the
 * transport re-creatable per call without caching a stale value.
 */
export function createGmailTransport(opts: { clientEmail?: string; privateKey?: string; sender?: string; fetcher?: typeof fetch } = {}): EmailTransport {
  const clientEmail = opts.clientEmail ?? Deno.env.get('GOOGLE_SA_CLIENT_EMAIL') ?? ''
  const privateKey = opts.privateKey ?? Deno.env.get('GOOGLE_SA_PRIVATE_KEY') ?? ''
  const sender = opts.sender ?? Deno.env.get('GMAIL_SENDER') ?? ''
  const name = 'gmail'
  const cacheKey = `${clientEmail}|${sender}`

  /** Mint (or reuse) an access token. Returns null on failure — the caller
   *  surfaces the PII-free 'gmail_auth_failed' code; the redacted detail is
   *  already logged here. The token/JWT/key are NEVER logged (P13). */
  async function getAccessToken(operation: string): Promise<string | null> {
    const cached = gmailTokenCache.get(cacheKey)
    if (cached && Date.now() < cached.refreshAfterMs) return cached.accessToken

    let assertion: string
    try {
      assertion = await signGoogleServiceAccountJwt({ clientEmail, privateKeyPem: privateKey, sub: sender })
    } catch (err) {
      // Bad/garbled PEM (importKey/atob throws). Never echo key material —
      // only the error class/message, redacted.
      console.error(JSON.stringify(redactPII({
        event: 'relay_email_auth_failed',
        provider: name,
        stage: 'jwt_sign',
        detail: redactPIIInText(err instanceof Error ? err.message : String(err)).text,
      })))
      return null
    }

    try {
      const res = await fetchWithTimeout(GOOGLE_TOKEN_URL, {
        provider: 'gmail',
        operation: `${operation}_token`,
        timeoutMs: EMAIL_TIMEOUT_MS,
        retry: { maxAttempts: EMAIL_MAX_ATTEMPTS },
        // Token minting is safe to retry: re-requesting a token has no side
        // effect beyond issuing another token.
        idempotent: true,
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
        fetcher: opts.fetcher,
      })

      if (!res.ok) {
        const raw = await res.text().catch(() => '')
        console.error(JSON.stringify(redactPII({
          event: 'relay_email_auth_failed',
          provider: name,
          stage: 'token_exchange',
          status: res.status,
          detail: redactPIIInText(raw).text,
        })))
        return null
      }

      const parsed = await res.json().catch(() => ({} as { access_token?: string; expires_in?: number }))
      const accessToken = (parsed as { access_token?: string }).access_token
      const expiresInSec = (parsed as { expires_in?: number }).expires_in ?? 3600
      if (!accessToken) {
        console.error(JSON.stringify(redactPII({
          event: 'relay_email_auth_failed',
          provider: name,
          stage: 'token_parse',
        })))
        return null
      }
      gmailTokenCache.set(cacheKey, {
        accessToken,
        refreshAfterMs: Date.now() + expiresInSec * 1000 - GMAIL_TOKEN_EARLY_REFRESH_MS,
      })
      return accessToken
    } catch (err) {
      console.error(JSON.stringify(redactPII({
        event: 'relay_email_auth_failed',
        provider: name,
        stage: 'token_exchange',
        detail: redactPIIInText(err instanceof Error ? err.message : String(err)).text,
      })))
      return null
    }
  }

  return {
    name,
    async send(message: EmailMessage): Promise<EmailSendResult> {
      const idempotencyKey = message.idempotencyKey ?? createEmailIdempotencyKey({
        template: 'relay_email',
        recipient: message.to,
        subject: message.subject,
      })
      const operation = message.operation ?? 'send_email'

      try {
        const accessToken = await getAccessToken(operation)
        if (!accessToken) return { success: false, provider: name, code: 'gmail_auth_failed' }

        const raw = base64UrlFromString(buildGmailRawMessage(message, idempotencyKey))

        const res = await fetchWithTimeout(GMAIL_SEND_URL, {
          provider: 'gmail',
          operation,
          timeoutMs: EMAIL_TIMEOUT_MS,
          // NOTE: passing idempotencyKey enables fetchWithTimeout's retry path
          // (and sets an Idempotency-Key HTTP header Gmail ignores). Gmail has
          // no dedup, so a retry after a LOST response can rarely double-send —
          // accepted vs dropping auth email (see transport-level comment).
          retry: { maxAttempts: EMAIL_MAX_ATTEMPTS },
          idempotencyKey,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ raw }),
          fetcher: opts.fetcher,
        })

        if (!res.ok) {
          // A 401 means the cached token went stale/revoked early — drop it so
          // the next send re-mints instead of failing for up to 55 more minutes.
          if (res.status === 401) gmailTokenCache.delete(cacheKey)
          // Provider error body is free-form → redactPIIInText. The returned
          // code carries NO provider detail, only the status class.
          const rawBody = await res.text().catch(() => '')
          console.error(JSON.stringify(redactPII({
            event: 'relay_email_failed',
            provider: name,
            status: res.status,
            detail: redactPIIInText(rawBody).text,
          })))
          return { success: false, provider: name, code: `gmail_http_${res.status}` }
        }

        const parsed = await res.json().catch(() => ({} as { id?: string }))
        // Keyed payload → redactPII. `email` is a SENSITIVE_KEY, so the recipient
        // is scrubbed to [REDACTED] before the line is ever written.
        console.log(JSON.stringify(redactPII({
          event: 'relay_email_sent',
          provider: name,
          operation,
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
        return { success: false, provider: name, code: 'gmail_exception' }
      }
    },
  }
}

// ─── Transport resolution (env-driven: Gmail → Mailgun → none) ───────────────

/**
 * True iff SOME default transport is configured: Gmail (GOOGLE_SA_CLIENT_EMAIL
 * + GOOGLE_SA_PRIVATE_KEY + GMAIL_SENDER — the email provider, product decision
 * 2026-07-16) or legacy-fallback Mailgun (MAILGUN_API_KEY + MAILGUN_DOMAIN).
 * The six email Edge Functions gate their "attempt to send" branch on this same
 * predicate — when it is false they emit the config-absent warning / fail-closed
 * and degrade gracefully. Resend is NEVER auto-selected, so RESEND_API_KEY does
 * not make this true.
 */
export function hasEmailTransportConfig(): boolean {
  const gmailClientEmail = Deno.env.get('GOOGLE_SA_CLIENT_EMAIL') ?? ''
  const gmailPrivateKey = Deno.env.get('GOOGLE_SA_PRIVATE_KEY') ?? ''
  const gmailSender = Deno.env.get('GMAIL_SENDER') ?? ''
  if (gmailClientEmail && gmailPrivateKey && gmailSender) return true
  const mailgunKey = Deno.env.get('MAILGUN_API_KEY') ?? ''
  const mailgunDomain = Deno.env.get('MAILGUN_DOMAIN') ?? ''
  return Boolean(mailgunKey && mailgunDomain)
}

/**
 * Pick the default transport at SEND time (never cached):
 *   1. Gmail when GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY + GMAIL_SENDER
 *      are ALL present (the email provider — product decision 2026-07-16),
 *   2. else Mailgun when MAILGUN_API_KEY + MAILGUN_DOMAIN are present (legacy
 *      fallback — the account is disabled, but the path is harmless),
 *   3. else null (config-absent).
 * Resend is NEVER auto-selected. The Resend transport remains reachable only
 * via an explicit `opts.transport` override on `sendEmail` or
 * `setDefaultEmailTransport` (tests); it is never returned from here.
 */
export function resolveDefaultTransport(opts: { fetcher?: typeof fetch } = {}): EmailTransport | null {
  const gmailClientEmail = Deno.env.get('GOOGLE_SA_CLIENT_EMAIL') ?? ''
  const gmailPrivateKey = Deno.env.get('GOOGLE_SA_PRIVATE_KEY') ?? ''
  const gmailSender = Deno.env.get('GMAIL_SENDER') ?? ''
  if (gmailClientEmail && gmailPrivateKey && gmailSender) {
    return createGmailTransport({ clientEmail: gmailClientEmail, privateKey: gmailPrivateKey, sender: gmailSender, fetcher: opts.fetcher })
  }
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
 *   3. the env-resolved default (`resolveDefaultTransport`): Gmail if
 *      GOOGLE_SA_CLIENT_EMAIL + GOOGLE_SA_PRIVATE_KEY + GMAIL_SENDER are set,
 *      else Mailgun if MAILGUN_API_KEY + MAILGUN_DOMAIN are set (legacy
 *      fallback), else none. Resend is never auto-selected (product decision
 *      2026-07-16).
 *
 * Production callers use `sendEmail(message)` — no options — so nothing is
 * request-derived and the transport reads its secret(s) from env. When no
 * transport is configured the resolver returns null; we then return a PII-free
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
