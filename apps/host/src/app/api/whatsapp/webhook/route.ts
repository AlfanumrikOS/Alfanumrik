import { NextRequest, NextResponse, after } from 'next/server';
import { supabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { logger } from '@alfanumrik/lib/logger';
import { isFeatureEnabled } from '@alfanumrik/lib/feature-flags';
import { validateTwilioSignature } from '@alfanumrik/lib/whatsapp/twilio-signature';
import { hashPhone, redactPhone } from '@alfanumrik/lib/whatsapp/phone';
import { istDate } from '@alfanumrik/lib/whatsapp/ist';
import {
  parseInbound,
  classifyIntent,
  classifyControlKeyword,
  type NormalizedInbound,
} from '@alfanumrik/lib/whatsapp/intent';
import {
  processLinkBinding,
  type LinkBindingOutcome,
} from '../_lib/link-binding';
import {
  DAILY6_PROCESSABLE_INTENTS,
  runDaily6EventFromWebhook,
  type Daily6Intent,
} from '../_lib/daily6';

/**
 * Twilio WhatsApp Inbound Webhook — Phase 1 (skeleton).
 *
 * Receives `application/x-www-form-urlencoded` POSTs from Twilio for every
 * inbound WhatsApp message. Verifies `X-Twilio-Signature` (HMAC-SHA1 over the
 * public URL + alphabetically-sorted body params), dedupes on MessageSid,
 * touches the 24h/72h conversation-window ledger, and persists the event for
 * async processing. Replies are sent asynchronously via REST in later phases —
 * the ONLY synchronous (TwiML) replies are the regulatory STOP/START/HELP
 * confirmations, which must work even when everything else is broken.
 *
 * ── RESPONSE POSTURE: ALWAYS 200 AFTER SIGNATURE VERIFICATION ──────────────
 * This route DELIBERATELY DIVERGES from the Razorpay webhook
 * (`api/payments/webhook/route.ts`), which returns 5xx to trigger provider
 * retries. For WhatsApp, sustained non-2xx responses DEGRADE the WABA sender
 * quality rating and can get the number throttled or disabled — provider
 * redelivery is NOT our recovery mechanism. Instead, every verified event is
 * durably persisted to `whatsapp_inbound_events` (status='pending') and a
 * future drain cron re-processes failures. Once the signature verifies, every
 * downstream failure logs and still returns empty TwiML 200. Do not "fix"
 * this to match Razorpay.
 *
 * Pre-verification failures keep the Razorpay posture:
 *   - missing server secrets → 503 (env misconfig; provider may retry)
 *   - missing/invalid signature → 401 (illegitimate request, nothing logged
 *     that could identify the sender — P13)
 *
 * ── ENV VARS ───────────────────────────────────────────────────────────────
 *   TWILIO_AUTH_TOKEN            HMAC key for X-Twilio-Signature validation.
 *   WHATSAPP_WEBHOOK_PUBLIC_URL  Canonical public URL of THIS route exactly as
 *                                configured in the Twilio console (e.g.
 *                                https://alfanumrik.com/api/whatsapp/webhook).
 *                                Behind Vercel, req.url's host is not
 *                                trustworthy for signature reconstruction.
 *   WHATSAPP_PHONE_PEPPER        HMAC pepper for phone_hash (P13 — plaintext
 *                                phones live only in whatsapp_identities).
 *
 * ── FLAGS ──────────────────────────────────────────────────────────────────
 *   ff_whatsapp_inbound_webhook  OFF → drop silently (empty TwiML 200). Lets
 *                                us point Twilio at prod before launch.
 *   ff_whatsapp_bot_v1           Master kill switch. OFF → event is persisted
 *                                as status='ignored', no processing. STOP/
 *                                START/HELP still work (regulatory).
 *   ff_whatsapp_daily6           Daily-6 loop (Phase 3). OFF → d6/menu events
 *                                stay status='pending' (no processing); ON →
 *                                processed via after() with the drain cron as
 *                                the retry mechanism.
 *
 * P13: NEVER log raw phone numbers (use redactPhone) or message bodies (log
 * length only). MediaUrl0 contents are never stored (bearer-token URLs).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

function twimlResponse(xml: string = EMPTY_TWIML): NextResponse {
  return new NextResponse(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      default: return '&quot;';
    }
  });
}

/** Inline synchronous reply — free, works even if everything else is broken. */
function twimlMessage(text: string): NextResponse {
  return twimlResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(text)}</Message></Response>`,
  );
}

// Bilingual one-liners (P7). Technical keywords (STOP, START, MENU, LINK)
// are commands, not translated.
const REPLY_STOP =
  'You will no longer receive messages from Alfanumrik. Reply START to resume. / ' +
  'अब आपको Alfanumrik से संदेश नहीं मिलेंगे। दोबारा शुरू करने के लिए START भेजें।';
const REPLY_START =
  'Welcome back to Alfanumrik! You will receive messages again. Reply STOP anytime to unsubscribe. / ' +
  'Alfanumrik में वापसी पर स्वागत है! आपको फिर से संदेश मिलेंगे। कभी भी रोकने के लिए STOP भेजें।';
const REPLY_HELP =
  'Alfanumrik Study Bot — commands: MENU (main menu), LINK <code> (connect your account), ' +
  'HINDI / ENGLISH (language), STOP (unsubscribe), START (resume). / ' +
  'कमांड: MENU (मुख्य मेनू), LINK <code> (खाता जोड़ें), HINDI / ENGLISH (भाषा), STOP (बंद करें), START (शुरू करें)।';

// LINK-handler replies (P7 bilingual; P13 — success names NOTHING sensitive:
// no student name, no OTP echo, no phone).
const LINK_REPLIES: Record<LinkBindingOutcome, string> = {
  bound:
    '✅ Connected! Send MENU to begin. / ✅ जुड़ गया! शुरू करने के लिए MENU भेजें।',
  invalid:
    'That code is invalid or has expired. Please open the app and get a fresh code. / ' +
    'यह कोड गलत है या इसकी अवधि समाप्त हो गई है। कृपया ऐप से नया कोड लें।',
  ambiguous:
    'Something went wrong. Please try again from the app with a fresh code. / ' +
    'कुछ गड़बड़ हुई। कृपया ऐप से नए कोड के साथ दोबारा प्रयास करें।',
  locked:
    'Too many attempts. Please wait an hour, then get a fresh code from the app. / ' +
    'बहुत अधिक प्रयास हुए। कृपया एक घंटे बाद ऐप से नया कोड लें।',
  limit:
    'This WhatsApp number is already connected to the maximum number of student accounts. / ' +
    'यह WhatsApp नंबर पहले से अधिकतम विद्यार्थी खातों से जुड़ा है।',
  rate_limited:
    'Too many attempts. Please wait an hour, then get a fresh code from the app. / ' +
    'बहुत अधिक प्रयास हुए। कृपया एक घंटे बाद ऐप से नया कोड लें।',
  // Cannot occur on the webhook path (the live inbound carries the phone) —
  // mapped defensively to the generic retry copy.
  phone_unavailable:
    'Something went wrong. Please try again from the app with a fresh code. / ' +
    'कुछ गड़बड़ हुई। कृपया ऐप से नए कोड के साथ दोबारा प्रयास करें।',
  error:
    'Something went wrong. Please try again in a few minutes. / ' +
    'कुछ गड़बड़ हुई। कृपया कुछ मिनट बाद पुनः प्रयास करें।',
};

/**
 * Phase 2: inline LINK <otp> processing (deterministic, fast, and the reply is
 * a free in-window TwiML message). The binding core is shared with the
 * whatsapp-drain cron (`../_lib/link-binding.ts`).
 *
 * The inbound event row is marked 'done' on EVERY outcome — LINK events are
 * terminally handled inline (retrying an invalid/consumed code from the cron
 * is wrong, and the cron cannot reply anyway; the OTP stays valid for its TTL,
 * so on a transient 'error' the user simply resends the same message).
 * All failures degrade to a TwiML error reply — never a 5xx (always-200
 * posture).
 */
async function handleLinkIntent(
  msg: NormalizedInbound,
  phoneHash: string,
  code: string,
  eventRowId: string | null,
): Promise<NextResponse> {
  let outcome: LinkBindingOutcome = 'error';
  try {
    const result = await processLinkBinding({
      code,
      phoneHash,
      phoneE164: msg.phoneE164, // THE one legitimate raw-phone write site (P13)
      source: 'whatsapp/webhook',
    });
    outcome = result.outcome;
  } catch (err) {
    // processLinkBinding never throws by contract — belt and braces.
    logger.error('whatsapp webhook: link binding threw', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  if (eventRowId) {
    try {
      await supabaseAdmin
        .from('whatsapp_inbound_events')
        .update({ status: 'done', processed_at: new Date().toISOString() })
        .eq('id', eventRowId);
    } catch (err) {
      logger.error('whatsapp webhook: link event done-update failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // P13: outcome + redacted phone only — never the OTP code.
  logger.info('whatsapp webhook: link intent processed', {
    outcome,
    phone: redactPhone(msg.phoneE164),
  });
  return twimlMessage(LINK_REPLIES[outcome]);
}

/** Message type for the events table row. */
function deriveMessageType(msg: NormalizedInbound, params: Record<string, string>): string {
  if (msg.buttonPayload || params.MessageType === 'interactive') return 'interactive';
  if (msg.numMedia > 0) return 'media';
  return 'text';
}

/**
 * STOP → opt out all live identities on this phone + append consent events.
 * START → opt back in (never resurrects `blocked` — that state is terminal).
 * HELP → static reply, no writes.
 *
 * All DB work is best-effort try/catch: the TwiML confirmation must go out
 * even if the tables don't exist yet in a dev DB (always-200 posture).
 */
async function handleControlKeyword(
  keyword: 'stop' | 'start' | 'help',
  phoneHash: string,
): Promise<NextResponse> {
  if (keyword === 'help') return twimlMessage(REPLY_HELP);

  const admin = supabaseAdmin;
  const optStatus = keyword === 'stop' ? 'opted_out' : 'opted_in';
  const eventType = keyword === 'stop' ? 'stop_keyword' : 'start_keyword';

  try {
    // All LIVE identities on this phone (a shared family phone can carry up
    // to 4 student bindings + a guardian — opt-out applies to the phone).
    const statusUpdate: Record<string, unknown> = { opt_in_status: optStatus };
    if (keyword === 'stop') {
      statusUpdate.opted_out_at = new Date().toISOString();
    } else {
      statusUpdate.opted_in_at = new Date().toISOString();
    }
    let updateQuery = admin
      .from('whatsapp_identities')
      .update(statusUpdate)
      .eq('phone_hash', phoneHash)
      .is('revoked_at', null);
    if (keyword === 'start') {
      // `blocked` is terminal and never auto-recovers.
      updateQuery = updateQuery.neq('opt_in_status', 'blocked');
    }
    const { error: updErr } = await updateQuery;
    if (updErr) {
      logger.error('whatsapp webhook: opt-in status update failed', {
        keyword, error: updErr.message,
      });
    }

    // Append-only consent trail (DPDP) — one row per live identity.
    const { data: identities, error: idErr } = await admin
      .from('whatsapp_identities')
      .select('id')
      .eq('phone_hash', phoneHash)
      .is('revoked_at', null);
    if (idErr) {
      logger.error('whatsapp webhook: identity lookup for consent trail failed', {
        keyword, error: idErr.message,
      });
    } else if (identities && identities.length > 0) {
      const { error: consentErr } = await admin.from('whatsapp_consent_events').insert(
        identities.map((row: { id: string }) => ({
          identity_id: row.id,
          event: eventType,
          source: 'whatsapp_keyword',
        })),
      );
      if (consentErr) {
        logger.error('whatsapp webhook: consent event insert failed', {
          keyword, error: consentErr.message,
        });
      }
    }
  } catch (err) {
    // Never fail the regulatory reply because of a DB problem.
    logger.error('whatsapp webhook: control keyword handling failed', {
      keyword, error: err instanceof Error ? err.message : String(err),
    });
  }

  return twimlMessage(keyword === 'stop' ? REPLY_STOP : REPLY_START);
}

/**
 * Touch the conversation-window ledger (the single biggest cost decision —
 * a live window means free-form sends are free/unmetered).
 *
 * Inbound with a click-to-WhatsApp referral opens a 72h `free_entry` window;
 * a normal message opens/extends a 24h `service` window. Day counters reset
 * when the IST civil date rolls over.
 */
async function touchConversationWindow(
  msg: NormalizedInbound,
  phoneHash: string,
): Promise<void> {
  const admin = supabaseAdmin;
  const kind = msg.referralSourceId ? 'free_entry' : 'service';
  const hours = kind === 'free_entry' ? 72 : 24;
  const newExpiry = new Date(Date.now() + hours * 3_600_000).toISOString();
  const today = istDate();

  const { data: existing, error: readErr } = await admin
    .from('whatsapp_conversation_windows')
    .select('phone_hash, window_kind, expires_at, day_ist')
    .eq('phone_hash', phoneHash)
    .maybeSingle();
  if (readErr) {
    logger.error('whatsapp webhook: window ledger read failed', { error: readErr.message });
    return;
  }

  if (!existing) {
    const { error: insErr } = await admin.from('whatsapp_conversation_windows').insert({
      phone_hash: phoneHash,
      window_kind: kind,
      opened_at: new Date().toISOString(),
      expires_at: newExpiry,
      last_inbound_at: new Date().toISOString(),
      day_ist: today,
      sent_today: 0,
      templates_today: 0,
      consecutive_failures: 0,
    });
    if (insErr) {
      // PK conflict on concurrent first inbound is benign (read-then-insert race)
      logger.warn('whatsapp webhook: window ledger insert failed', { error: insErr.message });
    }
    return;
  }

  // last_inbound_at advances on EVERY inbound — it is what the send path
  // consults to decide whether a free-form send is legal.
  const updates: Record<string, unknown> = {
    last_inbound_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  // Only ever EXTEND the window — never shorten a live free_entry window
  // because a later plain message computed a nearer service expiry.
  if (!existing.expires_at || new Date(newExpiry) > new Date(existing.expires_at)) {
    updates.expires_at = newExpiry;
    updates.window_kind = kind;
  }
  if (existing.day_ist !== today) {
    updates.day_ist = today;
    updates.sent_today = 0;
    updates.templates_today = 0;
  }

  const { error: updErr } = await admin
    .from('whatsapp_conversation_windows')
    .update(updates)
    .eq('phone_hash', phoneHash);
  if (updErr) {
    logger.error('whatsapp webhook: window ledger update failed', { error: updErr.message });
  }
}

/**
 * GET — healthcheck only. Twilio has no hub.challenge handshake (that is a
 * Meta-direct concept); keep this trivial.
 */
export async function GET(): Promise<NextResponse> {
  return new NextResponse('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const publicUrl = process.env.WHATSAPP_WEBHOOK_PUBLIC_URL;
  const pepper = process.env.WHATSAPP_PHONE_PEPPER;

  // 1. Server misconfig → 503 (mirrors the Razorpay missing-secret posture;
  //    nothing has been verified yet, so a retryable 5xx is correct here).
  if (!authToken || !publicUrl || !pepper) {
    logger.error('whatsapp webhook: server env not configured — returning 503', {
      hasAuthToken: !!authToken,
      hasPublicUrl: !!publicUrl,
      hasPepper: !!pepper,
    });
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 503 });
  }

  // 2. Read the raw body ONCE; parse ALL params (the Twilio param set evolves —
  //    signature validation must consume every received param dynamically).
  const rawBody = await request.text();
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(rawBody)) {
    params[key] = value;
  }

  // 3. Signature over the canonical public URL + any incoming query string.
  //    Behind Vercel the request host header is not trustworthy — reconstruct
  //    from WHATSAPP_WEBHOOK_PUBLIC_URL instead.
  const fullUrl = publicUrl + (request.nextUrl?.search ?? '');
  const signature = request.headers.get('x-twilio-signature');
  if (!validateTwilioSignature({ url: fullUrl, params, signature, authToken })) {
    // P13: log NOTHING identifying — no phone, no body, no params.
    logger.warn('whatsapp webhook: invalid or missing Twilio signature');
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // ── Signature verified. From here on: ALWAYS empty-TwiML 200 (see header). ──
  try {
    // 4. Inbound flag gate — OFF drops silently so Twilio can be pointed at
    //    prod before launch with zero product risk.
    if (!(await isFeatureEnabled('ff_whatsapp_inbound_webhook'))) {
      return twimlResponse();
    }

    // 5. Parse. Unparseable (missing MessageSid / invalid From) → drop.
    const msg = parseInbound(params);
    if (!msg) {
      logger.warn('whatsapp webhook: unparseable inbound dropped', {
        hasMessageSid: !!params.MessageSid,
        bodyLength: (params.Body ?? '').length,
      });
      return twimlResponse();
    }

    const phoneHash = hashPhone(msg.phoneE164, pepper);

    // 6. Regulatory short-circuit — keyword tier ONLY, before session lookup,
    //    before dedupe, before ff_whatsapp_bot_v1. STOP must work even if the
    //    session is corrupt, the identity unbound, or the bot flag off.
    const control = classifyControlKeyword(msg.body);
    if (control) {
      // Documented consequence: control-keyword inbounds are NOT persisted to whatsapp_inbound_events / window ledger — Phase 2 revisits.
      logger.info('whatsapp webhook: control keyword', {
        keyword: control,
        phone: redactPhone(msg.phoneE164),
      });
      return handleControlKeyword(control, phoneHash);
    }

    // 7. Dedupe + durable persistence. Session state is not read in Phase 1 —
    //    classify against 'idle' so the stored intent is still meaningful.
    const classification = classifyIntent(msg, 'idle');
    let eventRowId: string | null = null;
    try {
      // Sanitized payload: body text yes; NEVER MediaUrl (bearer-token URL
      // contents), never the raw phone (phone_hash column carries identity).
      const { data: insertedRows, error: insErr } = await supabaseAdmin
        .from('whatsapp_inbound_events')
        .upsert(
          {
            provider: 'twilio',
            provider_message_id: msg.messageSid,
            phone_hash: phoneHash,
            message_type: deriveMessageType(msg, params),
            intent: classification.intent,
            status: 'pending',
            payload: {
              body: msg.body,
              button_payload: msg.buttonPayload ?? null,
              num_media: msg.numMedia,
              media_content_type0: msg.mediaContentType0 ?? null,
              // P13: profile_name (user display name = PII) is parsed but NEVER persisted; Phase 2 identity flows read it live from the inbound if needed.
              referral_source_id: msg.referralSourceId ?? null,
              intent_args: classification.args,
            },
          },
          { onConflict: 'provider_message_id', ignoreDuplicates: true },
        )
        .select('id');

      if (insErr) {
        logger.error('whatsapp webhook: inbound event insert failed', { error: insErr.message });
      } else if (!insertedRows || insertedRows.length === 0) {
        // Conflict → duplicate delivery (Twilio retry). Already recorded.
        logger.info('whatsapp webhook: dedupe', { phone: redactPhone(msg.phoneE164) });
        return twimlResponse();
      } else {
        eventRowId = insertedRows[0].id as string;
      }

      // Long-retention dedupe key (kept after the event row is swept).
      const { error: seenErr } = await supabaseAdmin
        .from('whatsapp_seen_message_ids')
        .upsert(
          { provider_message_id: msg.messageSid },
          { onConflict: 'provider_message_id', ignoreDuplicates: true },
        );
      if (seenErr) {
        logger.error('whatsapp webhook: seen-message-id insert failed', { error: seenErr.message });
      }
    } catch (err) {
      logger.error('whatsapp webhook: dedupe/persist failed (continuing)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 8. Touch the 24h/72h window ledger (best-effort).
    try {
      await touchConversationWindow(msg, phoneHash);
    } catch (err) {
      logger.error('whatsapp webhook: window ledger touch failed (continuing)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 9. Master kill switch — event stays durably recorded but is never
    //    processed while the bot is off.
    if (!(await isFeatureEnabled('ff_whatsapp_bot_v1'))) {
      if (eventRowId) {
        try {
          await supabaseAdmin
            .from('whatsapp_inbound_events')
            .update({ status: 'ignored' })
            .eq('id', eventRowId);
        } catch (err) {
          logger.error('whatsapp webhook: ignored-status update failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return twimlResponse();
    }

    // 10. Phase 2: LINK <otp> identity binding is processed INLINE — it is
    //     deterministic, fast, and its confirmation is a free in-window TwiML
    //     reply. The event row is marked 'done' by the handler.
    if (classification.intent === 'link') {
      return handleLinkIntent(
        msg,
        phoneHash,
        classification.args.otp ?? '',
        eventRowId,
      );
    }

    // 11. Phase 3: Daily-6 family intents (d6_start / d6_answer /
    //     subject_pick / menu) are processed asynchronously via after() when
    //     ff_whatsapp_daily6 is ON. The processor settles the event row
    //     (done/failed); transient failures leave it 'pending' and the
    //     whatsapp-drain cron is the retry mechanism. Replies go out through
    //     whatsapp-send (caller literal 'whatsapp-webhook-route'), never via
    //     TwiML. Flag OFF → the row stays 'pending' exactly as before.
    if (DAILY6_PROCESSABLE_INTENTS.has(classification.intent) && eventRowId) {
      let daily6On = false;
      try {
        daily6On = await isFeatureEnabled('ff_whatsapp_daily6');
      } catch (err) {
        logger.warn('whatsapp webhook: daily6 flag read failed (leaving pending)', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (daily6On) {
        const evt = {
          id: eventRowId,
          intent: classification.intent as Daily6Intent,
          args: classification.args,
          phoneHash,
          receivedAtMs: Date.now(),
          source: 'webhook' as const,
        };
        try {
          after(async () => {
            await runDaily6EventFromWebhook(evt);
          });
        } catch (err) {
          // after() unavailable (e.g. outside a Next request scope) — the row
          // stays 'pending'; the drain cron picks it up. Always-200 posture.
          logger.warn('whatsapp webhook: after() scheduling failed (drain will retry)', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
        logger.info('whatsapp webhook: daily6 event scheduled', {
          intent: classification.intent,
          phone: redactPhone(msg.phoneE164),
        });
        return twimlResponse();
      }
    }

    // 12. Every OTHER intent stays status='pending' here.
    // TODO(later phases, plan-alfanumrik-whatsapp-bot-mighty-frost.md):
    // UNLINK, doubt ladder, notebook — via after() + the whatsapp-drain cron.
    // Replies go out asynchronously through the whatsapp-send path, never via
    // TwiML.
    logger.info('whatsapp webhook: event accepted', {
      intent: classification.intent,
      messageType: deriveMessageType(msg, params),
      phone: redactPhone(msg.phoneE164),
      bodyLength: msg.body.length,
    });
    return twimlResponse();
  } catch (err) {
    // Always-200 posture: the signature verified, so never surface a 5xx to
    // Twilio (sender-quality risk). Log and ack.
    logger.error('whatsapp webhook: unhandled error after verification (acking 200)', {
      error: err instanceof Error ? err.message : String(err),
    });
    return twimlResponse();
  }
}
