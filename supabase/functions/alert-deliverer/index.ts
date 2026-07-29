import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { buildSlackPayload } from './slack.ts';
import { buildEmailPayload } from './email.ts';
import { corsHeaders } from '../_shared/cors.ts';
import {
  auditInternalCronInvocation,
  internalCronUnauthorizedResponse,
  verifyInternalCronRequest,
} from '../_shared/security/internal-cron-auth.ts';

const MAX_BATCH = 50;
const MAX_RETRIES = 3;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // H1 fix (P11-adjacent, 2026-07-29): this previously accepted a bare,
  // client-controlled `x-cron-source: pg_cron` header with NO secret check —
  // anyone who knew that one header value could invoke this function and
  // trigger ops-alert delivery. Replaced with the SAME fail-closed,
  // constant-time internal-cron auth contract daily-cron/queue-consumer use
  // (CRON_SECRET fast path, get_cron_secret() DB fallback, then signed
  // internal-caller verification — never a bare header).
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
  const authStarted = performance.now();
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );
  const auth = await verifyInternalCronRequest({ req, route: 'alert-deliverer', sb, requestId, bodyText: '' });
  if (!auth.ok) {
    await auditInternalCronInvocation({ sb, route: 'alert-deliverer', requestId, started: authStarted, auth, statusCode: auth.status });
    return internalCronUnauthorizedResponse(auth, corsHeaders);
  }
  await auditInternalCronInvocation({ sb, route: 'alert-deliverer', requestId, started: authStarted, auth, statusCode: 200 });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const siteUrl = Deno.env.get('SITE_URL') ?? supabaseUrl;
  const headers = {
    apikey: serviceKey!,
    Authorization: `Bearer ${serviceKey!}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };

  // 1. Fetch pending dispatches
  const pendingRes = await fetch(
    `${supabaseUrl}/rest/v1/alert_dispatches?status=eq.pending&order=fired_at.asc&limit=${MAX_BATCH}`,
    { headers },
  );
  const dispatches = await pendingRes.json();
  if (!Array.isArray(dispatches) || dispatches.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), { status: 200 });
  }

  let sent = 0;
  let failed = 0;

  for (const d of dispatches) {
    // 2. Fetch rule and channel
    const [ruleRes, channelRes] = await Promise.all([
      fetch(`${supabaseUrl}/rest/v1/alert_rules?id=eq.${d.rule_id}&limit=1`, { headers }),
      fetch(`${supabaseUrl}/rest/v1/notification_channels?id=eq.${d.channel_id}&limit=1`, { headers }),
    ]);
    const rules = await ruleRes.json();
    const channels = await channelRes.json();
    const rule = Array.isArray(rules) ? rules[0] : null;
    const channel = Array.isArray(channels) ? channels[0] : null;

    if (!rule || !channel || !channel.enabled) {
      await fetch(`${supabaseUrl}/rest/v1/alert_dispatches?id=eq.${d.id}`, {
        method: 'PATCH',
        headers: { ...headers, Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'failed', delivery_error: 'rule or channel not found or disabled' }),
      });
      failed += 1;
      continue;
    }

    const consoleUrl = `${siteUrl}/super-admin/observability?category=${rule.category ?? ''}&severity=${rule.min_severity}`;
    const commonParams = {
      ruleName: rule.name, severity: rule.min_severity,
      category: rule.category ?? 'any', source: rule.source ?? null,
      matchedCount: d.matched_count, windowMinutes: rule.window_minutes,
      environment: 'production', firedAt: d.fired_at, consoleUrl,
    };

    let deliveryOk = false;
    let deliveryError = '';
    let deliveryResponse: unknown = null;

    try {
      if (channel.type === 'slack_webhook') {
        const payload = buildSlackPayload(commonParams);
        const webhookUrl = channel.config?.webhook_url;
        if (!webhookUrl) throw new Error('slack webhook_url not configured');
        const slackRes = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        deliveryResponse = { status: slackRes.status, statusText: slackRes.statusText };
        deliveryOk = slackRes.ok;
        if (!slackRes.ok) deliveryError = `slack ${slackRes.status}: ${slackRes.statusText}`;
      } else if (channel.type === 'email') {
        const emailPayload = buildEmailPayload({ ...commonParams, to: channel.config?.to ?? '' });
        // For MVP, attempt via the existing send-auth-email function.
        //
        // H2 fix (2026-07-29): send-auth-email is a GoTrue-webhook receiver
        // (P15) that MUST always return HTTP 200 — including when it
        // rejects an unsigned/malformed payload like this ops-alert POST,
        // which is not a signed GoTrue webhook. It signals rejection via
        // `{ success: false }` in the BODY, not the status code. The
        // previous `deliveryOk = emailRes.ok` was always true (200 is
        // always .ok) regardless of whether the email was ever sent, so
        // every email-channel alert was silently marked 'sent' and never
        // retried. We must NOT change send-auth-email's always-200
        // contract (P15) — fix belongs here: parse the body and gate on
        // `success === true`.
        //
        // FOLLOW-UP (not fixed here, out of scope): send-auth-email is
        // purpose-built for GoTrue auth emails specifically and is very
        // unlikely to ever accept an `ops_alert` type payload as
        // `success: true` — this channel probably needs a dedicated
        // transactional/ops-alert email path. Tracked as a follow-up; no
        // general-purpose SMTP helper was found elsewhere in the codebase
        // to swap in today.
        const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-auth-email`, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'ops_alert',
            to: emailPayload.to,
            subject: emailPayload.subject,
            html: emailPayload.htmlBody,
            text: emailPayload.textBody,
          }),
        });
        let emailBody: unknown = null;
        try {
          emailBody = await emailRes.json();
        } catch {
          // Non-JSON body — treat as failure below (deliveryOk stays false).
        }
        const emailBodySuccess =
          typeof emailBody === 'object' && emailBody !== null &&
          (emailBody as Record<string, unknown>).success === true;
        deliveryResponse = { status: emailRes.status, body: emailBody };
        deliveryOk = emailRes.ok && emailBodySuccess;
        if (!deliveryOk) {
          deliveryError = `email ${emailRes.status}: send-auth-email returned success=${String(
            typeof emailBody === 'object' && emailBody !== null ? (emailBody as Record<string, unknown>).success : emailBody,
          )}`;
        }
      } else {
        deliveryError = `unknown channel type: ${channel.type}`;
      }
    } catch (err) {
      deliveryError = String(err);
    }

    // 3. Update dispatch status
    const newRetryCount = (d.retry_count ?? 0) + (deliveryOk ? 0 : 1);
    const shouldBury = !deliveryOk && newRetryCount >= MAX_RETRIES;
    const newStatus = deliveryOk ? 'sent' : shouldBury ? 'failed' : 'pending';

    await fetch(`${supabaseUrl}/rest/v1/alert_dispatches?id=eq.${d.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: newStatus,
        retry_count: newRetryCount,
        delivery_error: deliveryError || null,
        delivery_response: deliveryResponse,
      }),
    });

    if (deliveryOk) sent += 1;
    else failed += 1;
  }

  // CRITICAL: No ops-event logging here — would create a feedback loop
  console.warn(`[alert-deliverer] processed=${dispatches.length} sent=${sent} failed=${failed}`);

  return new Response(JSON.stringify({ processed: dispatches.length, sent, failed }), { status: 200 });
});
