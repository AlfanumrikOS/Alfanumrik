/**
 * whatsapp-send — Alfanumrik Edge Function (Deno)
 *
 * THE single outbound WhatsApp gateway for the study bot (Phase 2 of the
 * approved WhatsApp bot plan). Every bot send flows through here; callers
 * pass `to_identity_id`, NEVER a raw phone — the raw E.164 is resolved
 * internally from `whatsapp_identities` (the only table permitted to hold
 * it, P13) and travels only to the transport adapter.
 *
 * Deliberately separate from the legacy `whatsapp-notify` function (which is
 * template-only, Meta-direct, and carries four callers whose contracts we do
 * not want to inherit). whatsapp-notify stays untouched.
 *
 * ─── Send gate chain (in order; a suppressed send is a NORMAL outcome —
 *     each gate failure returns HTTP 200 with {sent:false, reason}) ─────────
 *   1. ff_whatsapp_bot_v1 DB kill switch          → reason 'kill_switch'
 *   2. identity verified + not revoked            → 'identity_not_found' /
 *                                                    'unverified' / 'revoked'
 *   3. opt_in_status === 'opted_in'               → 'not_opted_in' / 'blocked'
 *      ('blocked' is terminal — never auto-recovers)
 *   4. IST quiet hours — ONLY for kind 'alarm' / 'parent_weekly'; session
 *      replies are always allowed                 → 'quiet_hours'
 *   5. Idempotency — provider-level only for now: createWhatsAppIdempotencyKey
 *      is passed to fetchWithTimeout (Idempotency-Key header + safe-retry
 *      enablement), exactly as whatsapp-notify does. DB-level send-idempotency
 *      needs an additive `client_idempotency_key` column on
 *      whatsapp_message_log in a Phase-3 migration — NOT faked here.
 *   6. Window/caps gate — RPC whatsapp_record_send(p_phone_hash, p_is_template)
 *      RETURNS TABLE(allowed, window_open, sent_today, templates_today).
 *      Free-form allowed → send free (₹0). Window closed + template_fallback
 *      + template caps permit → retry RPC as template, send paid utility
 *      (₹0.115). Otherwise → park in whatsapp_pending_nudges and return
 *      {sent:false, reason:'window_closed', nudge_queued:true} — the plan's
 *      "drop, don't pay" branch. Window open but per-recipient cap hit →
 *      reason 'daily_cap' (no nudge: re-sending later the same IST day would
 *      hit the same cap; the next inbound regenerates fresher content).
 *
 * ─── Response contract ─────────────────────────────────────────────────────
 *   200 {sent:true, provider_message_id}
 *   200 {sent:false, reason, nudge_queued?}   — suppression (normal)
 *   400 invalid body | 401/403 denied by admission | 429/503 quota/breaker
 *   500 gate infrastructure failure (fail closed — never send unchecked)
 *   502 transport failure after retries (with a 'failed' message_log row)
 *
 * ─── Auth ──────────────────────────────────────────────────────────────────
 *   admitAiRoute / finalizeAiRoute with a static profile: route
 *   'whatsapp-send', callerTypes ['internal_service'] — only signed Next.js
 *   routes (registered in security_internal_callers: 'whatsapp-webhook-route',
 *   'whatsapp-drain-cron') may call this. Same posture as whatsapp-notify.
 *
 * ─── Env vars ──────────────────────────────────────────────────────────────
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY        — service client
 *   WHATSAPP_TRANSPORT                             — 'twilio' (default) | 'meta'
 *   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 *   TWILIO_WHATSAPP_FROM                           — twilio adapter
 *   WHATSAPP_STATUS_CALLBACK_URL                   — optional (twilio receipts)
 *   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID       — meta adapter (stub)
 *
 * P13: raw phone is read in exactly ONE place (the identity resolution below),
 * never logged (redactPhone only), never persisted outside whatsapp_identities
 * — every row written here carries phone_hash.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { createWhatsAppIdempotencyKey } from '../_shared/reliability.ts'
import { errorResponse, getCorsHeaders, jsonResponse } from '../_shared/cors.ts'
import { edgeLog, getRequestId, writeBusinessAudit, type EdgeLogContext } from '../_shared/edge-audit-log.ts'
import { admitAiRoute, finalizeAiRoute, createStaticAiRouteProfile } from '../_shared/security/ai-admission.ts'
import { createTwilioTransport } from '../_shared/whatsapp/twilio-transport.ts'
import { createMetaTransport } from '../_shared/whatsapp/meta-transport.ts'
import type { OutboundMessage, WhatsAppTransport } from '../_shared/whatsapp/transport-types.ts'

// ─── Request contract ────────────────────────────────────────────────────────

type SendKind = 'session' | 'alarm' | 'parent_weekly' | 'link_confirm'

interface SendRequest {
  to_identity_id: string // NEVER a raw phone from callers
  kind: SendKind
  message:
    | { type: 'text'; body: string }
    | { type: 'interactive_buttons'; body: string; buttons: Array<{ id: string; title: string }>; content_sid?: string }
    | { type: 'interactive_list'; body: string; button: string; items: Array<{ id: string; title: string; description?: string }>; content_sid?: string }
  template_fallback?: {
    content_sid?: string
    meta_template_name?: string
    language: 'en' | 'hi'
    params: string[]
  }
  idempotency_key: string
}

interface IdentityRow {
  id: string
  phone_e164: string
  phone_hash: string
  student_id: string | null
  guardian_id: string | null
  opt_in_status: 'pending' | 'opted_in' | 'opted_out' | 'blocked'
  verified_at: string | null
  revoked_at: string | null
  quiet_hours_start: number
  quiet_hours_end: number
  locale: 'en' | 'hi'
}

interface RecordSendRow {
  allowed: boolean
  window_open: boolean
  sent_today: number
  templates_today: number
}

// ─── IST helpers ─────────────────────────────────────────────────────────────
// DELIBERATE DUPLICATION of packages/lib/src/whatsapp/ist.ts — packages/lib
// is not importable from the Deno runtime. Keep the two in sync (both are
// pure and tiny; IST is a fixed UTC+05:30 with no DST, so no tz library).

const IST_UTC_OFFSET_MINUTES = 330

function istHhmm(d: Date = new Date()): number {
  const shifted = new Date(d.getTime() + IST_UTC_OFFSET_MINUTES * 60_000)
  return shifted.getUTCHours() * 100 + shifted.getUTCMinutes()
}

/** Wrap-around HHMM window; start inclusive, end exclusive; start===end → no window. */
function isWithinQuietHours(hhmm: number, start: number, end: number): boolean {
  if (start === end) return false
  if (start < end) return hhmm >= start && hhmm < end
  return hhmm >= start || hhmm < end
}

// ─── Validation ──────────────────────────────────────────────────────────────

const KINDS: readonly SendKind[] = ['session', 'alarm', 'parent_weekly', 'link_confirm']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Returns an error string, or null when the body is valid. */
function validateSendRequest(body: SendRequest): string | null {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object'
  if (typeof body.to_identity_id !== 'string' || !UUID_RE.test(body.to_identity_id)) {
    return 'to_identity_id must be a whatsapp_identities UUID (never a raw phone)'
  }
  if (!KINDS.includes(body.kind)) return `kind must be one of: ${KINDS.join(', ')}`
  if (typeof body.idempotency_key !== 'string' || body.idempotency_key.trim().length === 0) {
    return 'idempotency_key is required'
  }

  const m = body.message
  if (!m || typeof m !== 'object') return 'message is required'
  switch (m.type) {
    case 'text':
      if (typeof m.body !== 'string' || m.body.length === 0) return 'text message requires a non-empty body'
      if (m.body.length > 4096) return 'text body exceeds 4096 chars'
      break
    case 'interactive_buttons':
      if (typeof m.body !== 'string' || m.body.length === 0 || m.body.length > 1024) return 'interactive body must be 1..1024 chars'
      if (!Array.isArray(m.buttons) || m.buttons.length === 0 || m.buttons.length > 3) return 'interactive_buttons requires 1..3 buttons'
      for (const b of m.buttons) {
        if (typeof b?.id !== 'string' || b.id.length === 0) return 'every button needs a non-empty id'
        if (typeof b?.title !== 'string' || b.title.length === 0 || b.title.length > 20) return 'button title must be 1..20 chars'
      }
      break
    case 'interactive_list':
      if (typeof m.body !== 'string' || m.body.length === 0 || m.body.length > 1024) return 'interactive body must be 1..1024 chars'
      if (typeof m.button !== 'string' || m.button.length === 0 || m.button.length > 20) return 'list button label must be 1..20 chars'
      if (!Array.isArray(m.items) || m.items.length === 0 || m.items.length > 10) return 'interactive_list requires 1..10 items'
      for (const item of m.items) {
        if (typeof item?.id !== 'string' || item.id.length === 0) return 'every list item needs a non-empty id'
        if (typeof item?.title !== 'string' || item.title.length === 0 || item.title.length > 24) return 'list item title must be 1..24 chars'
        if (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 72)) return 'list item description must be ≤72 chars'
      }
      break
    default:
      return "message.type must be 'text' | 'interactive_buttons' | 'interactive_list'"
  }

  const tf = body.template_fallback
  if (tf !== undefined) {
    if (!tf || typeof tf !== 'object') return 'template_fallback must be an object'
    if (tf.language !== 'en' && tf.language !== 'hi') return "template_fallback.language must be 'en' | 'hi'"
    if (!Array.isArray(tf.params) || tf.params.some((p) => typeof p !== 'string')) return 'template_fallback.params must be string[]'
    if (!tf.content_sid && !tf.meta_template_name) return 'template_fallback needs content_sid (twilio) or meta_template_name (meta)'
  }
  return null
}

// ─── Transport factory (ADDENDUM 2 hybrid seam) ─────────────────────────────

function resolveTransport(): WhatsAppTransport {
  return (Deno.env.get('WHATSAPP_TRANSPORT') ?? 'twilio') === 'meta'
    ? createMetaTransport()
    : createTwilioTransport()
}

// ─── Utility template cost (₹, Meta India utility rate; the Twilio ~$0.005
//     platform fee is tracked separately at invoice level, not per row) ──────

const UTILITY_TEMPLATE_COST_INR = 0.115

// ─── Security route profile (posture copied from whatsapp-notify) ────────────

const WHATSAPP_SEND_ROUTE_PROFILE = createStaticAiRouteProfile({
  route: 'whatsapp-send',
  callerTypes: ['internal_service'],
  // Analogous to whatsapp-notify's meta/whatsapp-cloud-api: not an LLM —
  // provider/model name the default (Phase-2) transport for cost attribution.
  modelProvider: 'twilio',
  modelName: 'whatsapp-messages-api',
  inputTokenFloor: 1,
  outputTokens: 0,
})

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin')
  const context: EdgeLogContext = {
    requestId: getRequestId(req),
    route: 'whatsapp-send',
    role: 'service_role',
    actor: null,
    schoolId: null,
    startedAt: Date.now(),
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: getCorsHeaders(origin) })
  }
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405, origin)
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  )

  // The admission helper types its client structurally with rpc() returning a
  // Promise; supabase-js's rpc() returns a thenable PostgrestFilterBuilder,
  // which is await-compatible but not assignable. Cast once at this seam
  // (whatsapp-notify has the same latent mismatch; this file keeps
  // `deno check` clean).
  const admissionClient = supabase as unknown as Parameters<typeof admitAiRoute>[0]['sb']

  // ── Platform security admission (internal_service only) ──────────────────
  const bodyText = await req.text()
  const admitResult = await admitAiRoute({ req, sb: admissionClient, profile: WHATSAPP_SEND_ROUTE_PROFILE, bodyText })
  if (!admitResult.ok) {
    return admitResult.response
  }
  const { admission } = admitResult

  /** Suppressed send: NORMAL outcome — 200 with {sent:false, reason}. */
  const suppress = async (reason: string, extra: Record<string, unknown> = {}): Promise<Response> => {
    edgeLog('info', context, { action: 'whatsapp_send.suppressed', status: 'ok', reason, ...extra })
    await finalizeAiRoute({ sb: admissionClient, admission, statusCode: 200 })
    return jsonResponse({ sent: false, reason, ...extra }, 200, {}, origin)
  }

  /** Gate infrastructure failure: fail CLOSED — never send unchecked. */
  const gateFailure = async (gate: string, detail: string): Promise<Response> => {
    edgeLog('error', context, { action: 'whatsapp_send.gate_unavailable', status: 'error', gate, reason: detail })
    await finalizeAiRoute({ sb: admissionClient, admission, statusCode: 500, errorCode: 'gate_unavailable' })
    return errorResponse('Send gate unavailable', 500, origin)
  }

  try {
    // ── Parse + validate ─────────────────────────────────────────────────
    let body: SendRequest
    try {
      body = JSON.parse(bodyText) as SendRequest
    } catch {
      await finalizeAiRoute({ sb: admissionClient, admission, statusCode: 400, errorCode: 'invalid_json' })
      return errorResponse('Invalid JSON body', 400, origin)
    }

    const validationError = validateSendRequest(body)
    if (validationError) {
      await finalizeAiRoute({ sb: admissionClient, admission, statusCode: 400, errorCode: 'invalid_body' })
      return errorResponse(validationError, 400, origin)
    }

    // ── Gate 1: master kill switch (DB flag, double gate mirroring
    //    isFeatureEnabled: is_enabled AND rollout_percentage > 0; a missing
    //    row is OFF) ─────────────────────────────────────────────────────
    const { data: flag, error: flagError } = await supabase
      .from('feature_flags')
      .select('is_enabled, rollout_percentage')
      .eq('flag_name', 'ff_whatsapp_bot_v1')
      .maybeSingle()
    if (flagError) return await gateFailure('kill_switch', flagError.message)
    if (!flag || flag.is_enabled !== true || (flag.rollout_percentage ?? 0) <= 0) {
      return await suppress('kill_switch')
    }

    // ── Gate 2: identity resolution — the ONLY place phone_e164 is read ──
    const { data: identity, error: identityError } = await supabase
      .from('whatsapp_identities')
      .select('id, phone_e164, phone_hash, student_id, guardian_id, opt_in_status, verified_at, revoked_at, quiet_hours_start, quiet_hours_end, locale')
      .eq('id', body.to_identity_id)
      .maybeSingle<IdentityRow>()
    if (identityError) return await gateFailure('identity', identityError.message)
    if (!identity) return await suppress('identity_not_found')
    if (identity.revoked_at !== null) return await suppress('revoked')
    if (identity.verified_at === null) return await suppress('unverified')

    // ── Gate 3: opt-in (whatsapp_identities.opt_in_status is the SOLE
    //    consent authority for this channel; 'blocked' is terminal) ───────
    if (identity.opt_in_status !== 'opted_in') {
      return await suppress(identity.opt_in_status === 'blocked' ? 'blocked' : 'not_opted_in')
    }

    // ── Gate 4: IST quiet hours — alarms/parent notes ONLY; session
    //    replies inside an open window are always allowed ─────────────────
    if (body.kind === 'alarm' || body.kind === 'parent_weekly') {
      const nowHhmm = istHhmm()
      if (isWithinQuietHours(nowHhmm, identity.quiet_hours_start, identity.quiet_hours_end)) {
        return await suppress('quiet_hours')
      }
    }

    // ── Gate 5: idempotency — provider-level (Idempotency-Key header via
    //    fetchWithTimeout, which also makes the POST safe to retry). See
    //    header: DB-level dedupe is a Phase-3 additive column, not faked. ──
    const idempotencyKey = createWhatsAppIdempotencyKey({
      template: body.kind,
      recipientPhone: identity.phone_e164,
      language: identity.locale,
      correlationId: body.idempotency_key,
    })

    // ── Gate 6: window/caps ledger (whatsapp_record_send RPC). The RPC
    //    atomically checks AND records the send when allowed, so a
    //    subsequent transport failure over-counts by one — the cost-safe
    //    direction (counters only ever err toward sending LESS). ──────────
    const rpc1 = await supabase.rpc('whatsapp_record_send', {
      p_phone_hash: identity.phone_hash,
      p_is_template: false,
    })
    if (rpc1.error) return await gateFailure('record_send', rpc1.error.message)
    const freeForm = (Array.isArray(rpc1.data) ? rpc1.data[0] : rpc1.data) as RecordSendRow | undefined
    if (!freeForm) return await gateFailure('record_send', 'whatsapp_record_send returned no row')

    let messageToSend: OutboundMessage = body.message
    let isTemplateSend = false

    if (!freeForm.allowed) {
      if (freeForm.window_open) {
        // Window open but per-recipient daily cap (sent_today) exhausted.
        return await suppress('daily_cap', { sent_today: freeForm.sent_today })
      }

      // Window closed. Template-worthy AND caps permit → pay for ONE utility
      // template. Otherwise: drop, don't pay — park a nudge for the next
      // inbound (free) delivery.
      if (body.template_fallback) {
        const rpc2 = await supabase.rpc('whatsapp_record_send', {
          p_phone_hash: identity.phone_hash,
          p_is_template: true,
        })
        if (rpc2.error) return await gateFailure('record_send_template', rpc2.error.message)
        const asTemplate = (Array.isArray(rpc2.data) ? rpc2.data[0] : rpc2.data) as RecordSendRow | undefined
        if (asTemplate?.allowed) {
          messageToSend = {
            type: 'template',
            content_sid: body.template_fallback.content_sid,
            meta_template_name: body.template_fallback.meta_template_name,
            language: body.template_fallback.language,
            params: body.template_fallback.params,
          }
          isTemplateSend = true
        }
      }

      if (!isTemplateSend) {
        const { error: nudgeError } = await supabase.from('whatsapp_pending_nudges').insert({
          identity_id: identity.id,
          kind: body.kind,
          payload: { message: body.message, idempotency_key: body.idempotency_key },
        })
        if (nudgeError) {
          edgeLog('error', context, { action: 'whatsapp_send.nudge_insert_failed', status: 'error', reason: nudgeError.message })
        }
        return await suppress('window_closed', { nudge_queued: !nudgeError })
      }
    }

    // ── Billing category: template = paid utility; free-form = ₹0, split
    //    'free' (free_entry 72h window) vs 'service' (normal 24h window) ───
    let billingCategory: 'utility' | 'service' | 'free' = 'utility'
    if (!isTemplateSend) {
      const { data: windowRow, error: windowErr } = await supabase
        .from('whatsapp_conversation_windows')
        .select('window_kind')
        .eq('phone_hash', identity.phone_hash)
        .maybeSingle()
      // A failed read silently reclassifies a FREE (free_entry 72h) send as a
      // billable 'service' send, so the cost ledger drifts with no signal.
      // The conservative default is kept (never under-report a charge), but the
      // misclassification is now visible. P13: never log the phone hash.
      if (windowErr) {
        edgeLog('error', context, { action: 'whatsapp_send.window_kind_read_failed', status: 'error', reason: windowErr.message })
      }
      billingCategory = windowRow?.window_kind === 'free_entry' ? 'free' : 'service'
    }

    // ── Send via the configured transport ────────────────────────────────
    const transport = resolveTransport()
    edgeLog('info', context, {
      action: 'whatsapp_send.attempt',
      status: 'ok',
      transport: transport.name,
      kind: body.kind,
      message_type: messageToSend.type,
      template: isTemplateSend,
      identity_id: identity.id,
      // P13: phone never logged — phone_hash prefix is enough to correlate.
      phone_hash_prefix: identity.phone_hash.slice(0, 8),
    })

    const result = await transport.send({
      toPhoneE164: identity.phone_e164,
      message: messageToSend,
      idempotencyKey,
    })

    const messageType = messageToSend.type === 'text' ? 'text' : messageToSend.type === 'template' ? 'template' : 'interactive'
    const templateName = messageToSend.type === 'template'
      ? (messageToSend.content_sid ?? messageToSend.meta_template_name ?? null)
      : ('content_sid' in messageToSend ? messageToSend.content_sid ?? null : null)

    // ── Message log (P13: phone_hash only, never the raw phone) ──────────
    const { error: logError } = await supabase.from('whatsapp_message_log').insert({
      phone_hash: identity.phone_hash,
      identity_id: identity.id,
      student_id: identity.student_id,
      direction: 'out',
      provider_message_id: result.providerMessageId ?? null,
      kind: body.kind,
      message_type: messageType,
      template_name: templateName,
      // billable=true ONLY for out-of-window template sends (the cost thesis:
      // every session message must log billable=false — verified empirically
      // from this table in week one).
      billable: isTemplateSend,
      billing_category: billingCategory,
      est_cost_inr: isTemplateSend ? UTILITY_TEMPLATE_COST_INR : 0,
      status: result.success ? 'sent' : 'failed',
      error_code: result.errorCode ?? null,
      error_message: result.errorMessage ?? null,
    })
    if (logError) {
      // Best-effort: a logging failure must never turn a delivered message
      // into a caller-visible error.
      edgeLog('error', context, { action: 'whatsapp_send.message_log_failed', status: 'error', reason: logError.message })
    }

    if (result.success) {
      edgeLog('info', context, {
        action: 'whatsapp_send.sent',
        status: 'ok',
        transport: transport.name,
        kind: body.kind,
        message_type: messageType,
        billable: isTemplateSend,
        provider_message_id: result.providerMessageId ?? null,
      })
      await writeBusinessAudit({
        // Same thenable-vs-Promise structural cast as admissionClient above.
        supabase: supabase as unknown as Parameters<typeof writeBusinessAudit>[0]['supabase'],
        context,
        action: 'whatsapp_send.sent',
        status: 'ok',
        metadata: { kind: body.kind, message_type: messageType, transport: transport.name, billable: isTemplateSend, identity_id: identity.id },
      })
      await finalizeAiRoute({ sb: admissionClient, admission, statusCode: 200 })
      return jsonResponse({ sent: true, provider_message_id: result.providerMessageId }, 200, {}, origin)
    }

    // Transport failure after retries → 502 (message_log 'failed' row above).
    edgeLog('error', context, {
      action: 'whatsapp_send.transport_failed',
      status: 'error',
      transport: transport.name,
      kind: body.kind,
      error_code: result.errorCode ?? null,
      reason: result.errorMessage ?? 'unknown',
    })
    await finalizeAiRoute({ sb: admissionClient, admission, statusCode: 502, errorCode: 'transport_failed' })
    return jsonResponse({ sent: false, reason: 'transport_failed' }, 502, {}, origin)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    edgeLog('error', context, { action: 'whatsapp_send.unhandled', status: 'error', reason: message })
    await finalizeAiRoute({ sb: admissionClient, admission, statusCode: 500, errorCode: 'unhandled_error' })
    return errorResponse('Internal server error', 500, origin)
  }
})
