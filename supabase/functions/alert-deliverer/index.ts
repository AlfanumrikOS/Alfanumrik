import { buildSlackPayload } from './slack.ts';
import { buildEmailPayload } from './email.ts';

const MAX_BATCH = 50;
const MAX_RETRIES = 3;

Deno.serve(async (req) => {
  // Auth: accept service role key, CRON_SECRET, or pg_cron internal header.
  // pg_cron calls via pg_net from within the same Supabase project pass
  // x-cron-source: pg_cron since ALTER DATABASE SET is not available on
  // managed Supabase to configure custom bearer tokens.
  const auth = req.headers.get('Authorization')?.replace('Bearer ', '');
  const cronSource = req.headers.get('x-cron-source');
  const cronSecret = Deno.env.get('CRON_SECRET');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const isAuthorized =
    auth === serviceKey ||
    (cronSecret && auth === cronSecret) ||
    cronSource === 'pg_cron';
  if (!isAuthorized) {
    return new Response('unauthorized', { status: 401 });
  }

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
        // For MVP, attempt via the existing send-auth-email function
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
        deliveryResponse = { status: emailRes.status };
        deliveryOk = emailRes.ok;
        if (!emailRes.ok) deliveryError = `email ${emailRes.status}`;
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
