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
 *     When the caller passes no content_sid, a default is resolved from the
 *     TWILIO_CONTENT_SID_MAP secret by message shape (resolveContentSid) —
 *     this is what lets daily6's dynamically-shaped sends ride generic
 *     pre-provisioned resources.
 *   - template            → ContentSid + ContentVariables (params positional).
 *
 * Positional ContentVariables convention (pre-created resources MUST match;
 * scripts/whatsapp/provision-twilio-content.mjs authors resources to exactly
 * this layout — change BOTH together or substitution silently misfires):
 *   template:            {"1": params[0], "2": params[1], ...}
 *   interactive_buttons: {"1": body, then per button k (1-based):
 *                          "<2k>"=buttons[k-1].id, "<2k+1>"=buttons[k-1].title}
 *                        e.g. 2 buttons → 1=body, 2=id1, 3=title1, 4=id2, 5=title2
 *   interactive_list:    {"1": body, "2": button label, then per item k (1-based):
 *                          "<3k>"=id, "<3k+1>"=title, "<3k+2>"=description-or-''}
 *                        e.g. item 1 → vars 3,4,5; item 2 → vars 6,7,8; ...
 *   Item/button ids MUST be templated (Twilio supports variables in the id
 *   field) — ids carry the private reply-opcode space (d6:a:<q>:<opt>,
 *   subj:<code>, ...) that the webhook intent classifier depends on.
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
      // {1: body, then per button: id, title} — ids are templated so the
      // reply's ButtonPayload carries our opcode space (see module header).
      positional.push(message.body)
      for (const b of message.buttons) positional.push(b.id, b.title)
      break
    case 'interactive_list':
      // {1: body, 2: button label, then per item: id, title, description}.
      // Absent descriptions substitute '' (renders as no description line).
      positional.push(message.body, message.button)
      for (const item of message.items) positional.push(item.id, item.title, item.description ?? '')
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

/**
 * Resolve the Content SID for an interactive send.
 *
 * Root-cause fix for the 2026-07-30 smoke-test failures ("Twilio
 * interactive_* send requires a pre-created content_sid", every outbound row
 * in whatsapp_message_log failed): daily6's callers never pass content_sid,
 * so interactive sends had no Content resource to ride. An explicit
 * caller-supplied content_sid still wins; otherwise the shape-keyed default
 * is read from the TWILIO_CONTENT_SID_MAP secret:
 *
 *   TWILIO_CONTENT_SID_MAP='{"qr2":"HX...","qr3":"HX...","list4":"HX...",...}'
 *
 * Keys: qr<buttonCount> for quick-reply, list<itemCount> for list-picker.
 * Resources are provisioned by scripts/whatsapp/provision-twilio-content.mjs,
 * which authors variable layouts matching buildContentVariables exactly.
 * Returns null when unresolvable — send() surfaces the structured error.
 */
function resolveContentSid(
  message: Extract<TransportSendArgs['message'], { type: 'interactive_buttons' | 'interactive_list' }>,
): string | null {
  if (message.content_sid) return message.content_sid
  const raw = Deno.env.get('TWILIO_CONTENT_SID_MAP')
  if (!raw) return null
  let map: Record<string, unknown>
  try {
    map = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
  const key = message.type === 'interactive_buttons'
    ? `qr${message.buttons.length}`
    : `list${message.items.length}`
  const sid = map[key]
  return typeof sid === 'string' && sid.length > 0 ? sid : null
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
        // Interactive shapes fall back to the TWILIO_CONTENT_SID_MAP default
        // when the caller passed no content_sid; templates must be explicit.
        const contentSid = message.type === 'template'
          ? message.content_sid
          : resolveContentSid(message)
        if (!contentSid) {
          return {
            success: false,
            errorMessage: `Twilio ${message.type} send requires a content_sid — none passed by the caller and no matching key in TWILIO_CONTENT_SID_MAP (provision resources with scripts/whatsapp/provision-twilio-content.mjs, then set the secret)`,
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
