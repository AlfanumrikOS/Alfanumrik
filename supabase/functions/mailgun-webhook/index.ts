/**
 * mailgun-webhook – Mailgun Event Webhook Handler
 *
 * Receives delivery/bounce/complaint events from Mailgun and stores them
 * in email_delivery_log for auth email observability.
 *
 * Setup:
 *   1. Deploy: supabase functions deploy mailgun-webhook --no-verify-jwt
 *   2. In Mailgun Dashboard → Webhooks:
 *      - Add URL: https://{supabase-project}.supabase.co/functions/v1/mailgun-webhook
 *      - Enable events: delivered, permanent_failure, temporary_failure, complained
 *   3. Copy the webhook signing key from Mailgun Dashboard → Settings → API Security
 *   4. Set MAILGUN_WEBHOOK_SIGNING_KEY in Edge Functions → Secrets
 *   5. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Edge Functions → Secrets
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'

const webhookSigningKey = Deno.env.get('MAILGUN_WEBHOOK_SIGNING_KEY') || ''
const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

/**
 * Verify Mailgun webhook signature.
 * Mailgun signs webhooks with HMAC-SHA256(timestamp + token) using the webhook signing key.
 */
async function verifyMailgunSignature(
  timestamp: string,
  token: string,
  signature: string
): Promise<boolean> {
  if (!webhookSigningKey || !timestamp || !token || !signature) return false

  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSigningKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const data = encoder.encode(timestamp + token)
  const sig = await crypto.subtle.sign('HMAC', key, data)
  const computed = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')

  return computed === signature
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: getCorsHeaders(origin),
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...getCorsHeaders(origin), 'Content-Type': 'application/json' },
    })
  }

  try {
    // Parse event data — Mailgun sends JSON (v3 webhooks) or form-encoded (legacy)
    let eventData: Record<string, string> = {}

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('application/json')) {
      const json = await req.json()
      // Mailgun v3 webhook format: { signature: {timestamp, token, signature}, event-data: {...} }
      const sig = json.signature || {}
      const event = json['event-data'] || {}

      // Verify signature FIRST (before any processing)
      const valid = await verifyMailgunSignature(
        String(sig.timestamp || ''),
        String(sig.token || ''),
        String(sig.signature || '')
      )

      if (!valid) {
        console.error('[Mailgun Webhook] Signature verification failed')
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 406,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      eventData = {
        event: event.event || '',
        recipient: event.recipient || '',
        message_id: event.message?.headers?.['message-id'] || '',
        timestamp: String(sig.timestamp || ''),
        severity: event.severity || '',
        reason: event.reason || '',
        delivery_status_code: String(event['delivery-status']?.code || ''),
        delivery_status_message: event['delivery-status']?.message || event['delivery-status']?.description || '',
        tags: JSON.stringify(event.tags || []),
      }
    } else {
      // Legacy form-encoded format
      const formData = await req.formData()

      const timestamp = formData.get('timestamp') as string || ''
      const token = formData.get('token') as string || ''
      const signature = formData.get('signature') as string || ''

      // Verify signature FIRST (before any processing)
      const valid = await verifyMailgunSignature(timestamp, token, signature)
      if (!valid) {
        console.error('[Mailgun Webhook] Signature verification failed')
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 406,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      eventData = {
        event: formData.get('event') as string || '',
        recipient: formData.get('recipient') as string || '',
        message_id: formData.get('Message-Id') as string || '',
        timestamp,
        severity: formData.get('severity') as string || '',
        reason: formData.get('reason') as string || '',
        delivery_status_code: formData.get('code') as string || '',
        delivery_status_message: formData.get('error') as string || formData.get('notification') as string || '',
        tags: JSON.stringify([]),
      }
    }

    // Map Mailgun event types to our status enum
    const eventType = eventData.event.toLowerCase()
    let status: string
    switch (eventType) {
      case 'delivered':
        status = 'delivered'
        break
      case 'failed':
      case 'permanent_failure':
        status = 'failed'
        break
      case 'temporary_failure':
        status = 'deferred'
        break
      case 'bounced':
        status = 'bounced'
        break
      case 'complained':
        status = 'complained'
        break
      case 'rejected':
        status = 'rejected'
        break
      case 'unsubscribed':
        status = 'unsubscribed'
        break
      default:
        // Accept but don't store unknown event types
        console.log(`[Mailgun Webhook] Ignoring event type: ${eventType}`)
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    }

    // Store in email_delivery_log
    if (supabaseUrl && supabaseServiceKey) {
      const supabase = createClient(supabaseUrl, supabaseServiceKey)

      const { error: insertError } = await supabase
        .from('email_delivery_log')
        .insert({
          recipient_email: eventData.recipient,
          message_id: eventData.message_id || null,
          event_type: eventType,
          status,
          severity: eventData.severity || null,
          reason: eventData.reason || null,
          delivery_status_code: eventData.delivery_status_code || null,
          delivery_status_message: eventData.delivery_status_message || null,
          raw_event: eventData,
          mailgun_timestamp: eventData.timestamp
            ? new Date(parseInt(eventData.timestamp) * 1000).toISOString()
            : null,
        })

      if (insertError) {
        console.error('[Mailgun Webhook] Insert error:', insertError.message)
        // Still return 200 to prevent Mailgun retries
      } else {
        console.log(`[Mailgun Webhook] Stored ${status} event for ${eventData.recipient}`)
      }
    } else {
      console.warn('[Mailgun Webhook] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured')
    }

    // Always return 200 to Mailgun
    return new Response(JSON.stringify({ received: true, status }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[Mailgun Webhook] Error:', err)
    // Always return 200 to prevent Mailgun retries
    return new Response(JSON.stringify({ received: true, error: 'Processing failed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
