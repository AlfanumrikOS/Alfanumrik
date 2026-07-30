/**
 * ALFANUMRIK — Meta WhatsApp Cloud API transport adapter.
 *
 * // PRODUCTION-VOLUME PATH (ADDENDUM 2) — activate via WHATSAPP_TRANSPORT=meta;
 * // verify against live Meta docs before first use.
 *
 * Stub for the hybrid-transport switch: Twilio carries dev + the 50-student
 * beta (accepting its ~$0.005/msg platform fee at that volume); this adapter
 * is the zero-platform-fee path that preserves the ~₹9–12/student/month
 * economics at production volume. The template branch is lifted from
 * whatsapp-notify's sendWhatsAppMessage (graph.facebook.com Cloud API call);
 * free-form text is implemented minimally per the /messages `type: 'text'`
 * shape; interactive (buttons/list) is NOT implemented yet and throws a
 * structured error — TODO Phase 3.
 *
 * Env: WHATSAPP_TOKEN (System User token, non-expiring),
 *      WHATSAPP_PHONE_NUMBER_ID.
 *
 * P13: `toPhoneE164` is never logged from this module.
 */

import { fetchWithTimeout } from '../reliability.ts'
import {
  createCircuitBreaker,
  type TransportResult,
  type TransportSendArgs,
  type WhatsAppTransport,
} from './transport-types.ts'

const breaker = createCircuitBreaker()

const META_TIMEOUT_MS = 10_000
const GRAPH_API_VERSION = 'v18.0' // matches whatsapp-notify; re-verify before activation

/** Structured not-implemented error so callers can distinguish it from a provider failure. */
export class MetaTransportNotImplementedError extends Error {
  readonly code = 'meta_interactive_not_implemented'
  constructor(messageType: string) {
    super(
      `meta-transport: '${messageType}' is not implemented — interactive sends via the Meta Cloud API are TODO Phase 3. ` +
        'Use WHATSAPP_TRANSPORT=twilio (Content-resource sends) until then.',
    )
    this.name = 'MetaTransportNotImplementedError'
  }
}

export function createMetaTransport(): WhatsAppTransport {
  return {
    name: 'meta',

    async send(args: TransportSendArgs): Promise<TransportResult> {
      const token = Deno.env.get('WHATSAPP_TOKEN')
      const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID')

      if (!token || !phoneNumberId) {
        return { success: false, errorMessage: 'Meta WhatsApp credentials not configured (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID)' }
      }

      if (!breaker.canRequest()) {
        return { success: false, errorMessage: 'Circuit breaker open — Meta WhatsApp Cloud API unavailable' }
      }

      const { message } = args
      let body: Record<string, unknown>

      if (message.type === 'text') {
        body = {
          messaging_product: 'whatsapp',
          to: args.toPhoneE164,
          type: 'text',
          text: { body: message.body },
        }
      } else if (message.type === 'template') {
        if (!message.meta_template_name) {
          return { success: false, errorMessage: 'Meta template send requires meta_template_name (content_sid is Twilio-only)' }
        }
        // Same shape as whatsapp-notify's sendWhatsAppMessage.
        body = {
          messaging_product: 'whatsapp',
          to: args.toPhoneE164,
          type: 'template',
          template: {
            name: message.meta_template_name,
            language: { code: message.language === 'hi' ? 'hi' : 'en' },
            components: [
              {
                type: 'body',
                parameters: message.params.map((text) => ({ type: 'text', text })),
              },
            ],
          },
        }
      } else {
        // TODO Phase 3: /messages with type 'interactive' (button / list) per
        // the Meta Cloud API interactive-message schema.
        throw new MetaTransportNotImplementedError(message.type)
      }

      try {
        const res = await fetchWithTimeout(
          `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`,
          {
            provider: 'whatsapp',
            operation: 'meta_send_message',
            timeoutMs: META_TIMEOUT_MS,
            retry: { maxAttempts: 3 },
            idempotencyKey: args.idempotencyKey,
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
          breaker.recordFailure()
          return { success: false, errorMessage: `Meta WhatsApp API ${res.status}: ${errText}` }
        }

        const result = await res.json()
        breaker.recordSuccess()
        const providerMessageId = result?.messages?.[0]?.id
        return { success: true, providerMessageId: typeof providerMessageId === 'string' ? providerMessageId : undefined }
      } catch (err) {
        if (err instanceof MetaTransportNotImplementedError) throw err
        breaker.recordFailure()
        return { success: false, errorMessage: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
