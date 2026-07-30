/**
 * ALFANUMRIK — WhatsApp outbound transport seam (ADDENDUM 2, hybrid LOCKED).
 *
 * `whatsapp-send` is built with a transport-adapter seam from day one:
 *   - twilio-transport.ts — dev + 50-student beta (Twilio WhatsApp API)
 *   - meta-transport.ts   — production-volume path (Meta Cloud API direct),
 *                           stubbed for now; activated via WHATSAPP_TRANSPORT=meta
 * The switch is config + credentials, not a migration: schema is already
 * provider-agnostic (`provider`, `provider_message_id` columns).
 *
 * P13: adapters receive the raw E.164 destination — the ONLY place outside
 * `whatsapp_identities` it may travel. It must never be logged (use
 * redactPhone) or persisted (message_log stores phone_hash only).
 */

export type OutboundLanguage = 'en' | 'hi'

/**
 * Provider-agnostic outbound message union.
 *
 * The three free-form shapes mirror the whatsapp-send request contract; the
 * 'template' shape is what the gateway constructs from `template_fallback`
 * when the 24h window is closed and a paid utility send is justified.
 *
 * `content_sid` on interactive shapes: Twilio interactive sends require a
 * PRE-CREATED Content resource (quick-reply / list-picker), authored
 * out-of-band in the Twilio console / Content API. See twilio-transport.ts
 * for the positional ContentVariables convention those resources must follow.
 */
export type OutboundMessage =
  | { type: 'text'; body: string }
  | {
      type: 'interactive_buttons'
      body: string
      buttons: Array<{ id: string; title: string }> // ≤3, title ≤20 chars
      content_sid?: string
    }
  | {
      type: 'interactive_list'
      body: string
      button: string
      items: Array<{ id: string; title: string; description?: string }> // ≤10, title ≤24, desc ≤72
      content_sid?: string
    }
  | {
      type: 'template'
      content_sid?: string // Twilio Content SID (transport=twilio)
      meta_template_name?: string // Meta-approved template name (transport=meta)
      language: OutboundLanguage
      params: string[]
    }

export interface TransportSendArgs {
  /** Raw E.164 destination (P13: never log, never persist). */
  toPhoneE164: string
  message: OutboundMessage
  /** Provider-level idempotency key (createWhatsAppIdempotencyKey). */
  idempotencyKey: string
}

export interface TransportResult {
  success: boolean
  /** Twilio MessageSid / Meta wamid — goes to whatsapp_message_log.provider_message_id. */
  providerMessageId?: string
  errorCode?: number
  errorMessage?: string
}

export interface WhatsAppTransport {
  readonly name: 'twilio' | 'meta'
  send(args: TransportSendArgs): Promise<TransportResult>
}

// ─── Circuit breaker (copied from whatsapp-notify / foxy-tutor pattern) ──────
// One instance per transport module — provider failures must not open the
// other provider's breaker.

export interface CircuitBreaker {
  canRequest(): boolean
  recordSuccess(): void
  recordFailure(): void
}

export function createCircuitBreaker(
  failureThreshold = 5,
  resetTimeoutMs = 60_000,
): CircuitBreaker {
  let failures = 0
  let lastFailureAt = 0
  let state: 'closed' | 'open' | 'half-open' = 'closed'

  return {
    canRequest(): boolean {
      if (state === 'closed') return true
      if (state === 'open') {
        if (Date.now() - lastFailureAt > resetTimeoutMs) {
          state = 'half-open'
          return true
        }
        return false
      }
      return false // half-open: single probe already in flight this tick
    },
    recordSuccess(): void {
      failures = 0
      state = 'closed'
    },
    recordFailure(): void {
      failures++
      lastFailureAt = Date.now()
      if (failures >= failureThreshold) state = 'open'
    },
  }
}
