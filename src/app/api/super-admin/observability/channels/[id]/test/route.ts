import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/super-admin/observability/channels/[id]/test — live test delivery
 *
 * For slack_webhook: sends a real test message to the webhook URL.
 * For email: returns a stub response (not yet implemented).
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Invalid channel id' }, { status: 400 });
  }

  try {
    // Fetch the full channel (we need the unmasked config for delivery)
    const { data: channel, error: chErr } = await supabaseAdmin
      .from('notification_channels')
      .select('*')
      .eq('id', id)
      .single();

    if (chErr || !channel) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    const channelType = channel.type as string;
    const config = (channel.config ?? {}) as Record<string, unknown>;

    // Audit the test attempt
    await logAdminAudit(auth, 'test_notification_channel', 'notification_channels', id, {
      name: channel.name,
      type: channelType,
    });

    if (channelType === 'slack_webhook') {
      const webhookUrl = config.webhook_url;
      if (!webhookUrl || typeof webhookUrl !== 'string') {
        return NextResponse.json(
          { ok: false, detail: 'Channel has no webhook_url configured' },
          { status: 400 },
        );
      }

      const testPayload = {
        text: `[TEST] Alfanumrik alerting test from super-admin console`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:white_check_mark: *Alfanumrik Alert Test*\nChannel "${channel.name}" is working correctly.\nTriggered by admin: ${auth.name || auth.email}`,
            },
          },
        ],
      };

      const slackRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testPayload),
      });

      if (slackRes.ok) {
        return NextResponse.json({
          ok: true,
          detail: `Slack test message sent successfully to "${channel.name}"`,
        });
      } else {
        const body = await slackRes.text().catch(() => '');
        return NextResponse.json({
          ok: false,
          detail: `Slack delivery failed: ${slackRes.status} ${slackRes.statusText}. ${body}`.trim(),
        });
      }
    }

    if (channelType === 'email') {
      return NextResponse.json({
        ok: true,
        detail: 'Email test not yet implemented',
      });
    }

    return NextResponse.json({
      ok: false,
      detail: `Unknown channel type: ${channelType}`,
    }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}