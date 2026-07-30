/**
 * ALFANUMRIK — Twilio WhatsApp transport adapter (dev + beta path, ADDENDUM 2).
 *
 * Sends via the Twilio Messages API:
 *   POST https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json
 *   basic auth TWILIO_ACCOUNT_SID:TWILIO_AUTH_TOKEN, URL-encoded form body.
 *
 * Message mapping:
 *   - text                → To=whatsapp:+..., From=whatsapp:+FROM, Body
 *   - interactive_buttons /
 *     interactive_list    → ContentSid + ContentVariables. Twilio interactive
 *     sends require a PRE-CREATED Content resource (quick-reply/list-picker),
 *     authored out-of-band in the Twilio console / Content API — the message
 *     structure lives in the Content resource, NOT in this request. The
 *     resource's numbered placeholders must follow the positional convention
 *     below (buildContentVariables) or substitution silently misfires.
 *   - template            → ContentSid + ContentVariables (params positional).
 *
 * Positional ContentVariables convention (pre-created resources MUST match):
 *   template:            {"1": params[0], "2": params[1], ...}
 *   interactive_buttons: {"1": body, "2": buttons[0].title, "3": buttons[1].title, ...}
 *   interactive_list:    {"1": body, "2": button, "3": items[0].title, ...}
 *
 * StatusCallback: set from WHATSAPP_STATUS_CALLBACK_URL when present —
 * delivery receipts (delivered/read/failed, e.g. 63016 out-of-window) feed
 * whatsapp_message_log and the window ledger via the webhook route.
 *
 * Env: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM
 *      (bare E.164 or already whatsapp:-prefixed), WHATSAPP_STATUS_CALLBACK_URL?
 *
 * P13: `toPhoneE164` is never logged from this module; failures surface as
 * structured TransportResult fields only.
 */

import { fetchWithTimeout } from '../reliability.ts'
import {
  createCircuitBreaker,
  type TransportResult,
  type TransportSendArgs,
  type WhatsAppTransport,
} from './transport-types.ts'

const breaker = createCircuitBreaker()

const TWILIO_TIMEOUT_MS = 10_000

function toWhatsAppAddress(value: string): string {
  return value.startsWith('whatsapp:') ? value : `whatsapp:${value}`
}

function buildContentVariables(message: TransportSendArgs['message']): string | null {
  const positional: string[] = []
  switch (message.type) {
    case 'template':
      positional.push(...message.params)
      break
    case 'interactive_buttons':
      positional.push(message.body, ...message.buttons.map((b) => b.title))
      break
    case 'interactive_list':
      positional.push(message.body, message.button, ...message.items.map((i) => i.title))
      break
    default:
      return null
  }
  const map: Record<string, string> = {}
  positional.forEach((value, index) => {
    map[String(index + 1)] = value
  })
  return JSON.stringify(map)
}

export function createTwilioTransport(): WhatsAppTransport {
  return {
    name: 'twilio',

    async send(args: TransportSendArgs): Promise<TransportResult> {
      const accountSid = Deno.env.get('TWILIO_ACCOUNT_SID')
      const authToken = Deno.env.get('TWILIO_AUTH_TOKEN')
      const from = Deno.env.get('TWILIO_WHATSAPP_FROM')

      if (!accountSid || !authToken || !from) {
        return { success: false, errorMessage: 'Twilio credentials not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM)' }
      }

      if (!breaker.canRequest()) {
        return { success: false, errorMessage: 'Circuit breaker open — Twilio API unavailable' }
      }

      const form = new URLSearchParams()
      form.set('To', toWhatsAppAddress(args.toPhoneE164))
      form.set('From', toWhatsAppAddress(from))

      const statusCallback = Deno.env.get('WHATSAPP_STATUS_CALLBACK_URL')
      if (statusCallback) form.set('StatusCallback', statusCallback)

      const { message } = args
      if (message.type === 'text') {
        form.set('Body', message.body)
      } else {
        // Interactive + template both ride Content resources on Twilio.
        const contentSid = message.content_sid
        if (!contentSid) {
          return {
            success: false,
            errorMessage: `Twilio ${message.type} send requires a pre-created content_sid (Content resources are authored out-of-band in the Twilio console / Content API)`,
          }
        }
        form.set('ContentSid', contentSid)
        const contentVariables = buildContentVariables(message)
        if (contentVariables) form.set('ContentVariables', contentVariables)
      }

      try {
        const res = await fetchWithTimeout(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            provider: 'whatsapp',
            operation: 'twilio_send_message',
            timeoutMs: TWILIO_TIMEOUT_MS,
            retry: { maxAttempts: 3 },
            idempotencyKey: args.idempotencyKey,
            method: 'POST',
            headers: {
              'Authorization': `Basic ${btoa(`${accountSid}:${authToken}`)}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: form.toString(),
          },
        )

        // Twilio errors come back as JSON {code, message, status} on non-2xx.
        if (!res.ok) {
          let errorCode: number | undefined
          let errorMessage = `Twilio API HTTP ${res.status}`
          try {
            const errJson = await res.json()
            if (typeof errJson?.code === 'number') errorCode = errJson.code
            if (typeof errJson?.message === 'string') errorMessage = `Twilio ${errJson.code ?? res.status}: ${errJson.message}`
          } catch {
            // Non-JSON error body — keep the HTTP-status message.
          }
          breaker.recordFailure()
          return { success: false, errorCode, errorMessage }
        }

        const result = await res.json()
        breaker.recordSuccess()
        return {
          success: true,
          providerMessageId: typeof result?.sid === 'string' ? result.sid : undefined,
        }
      } catch (err) {
        breaker.recordFailure()
        return { success: false, errorMessage: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
