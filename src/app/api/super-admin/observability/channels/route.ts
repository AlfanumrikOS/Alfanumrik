import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET  /api/super-admin/observability/channels — list all notification channels
 * POST /api/super-admin/observability/channels — create a new channel
 */

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config };
  if (typeof masked.webhook_url === 'string') {
    masked.webhook_url = masked.webhook_url.slice(0, 20) + '\u2026';
  }
  return masked;
}

const VALID_TYPES = ['slack_webhook', 'email'];

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { data, error } = await supabaseAdmin
      .from('notification_channels')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Mask webhook URLs before returning
    const masked = (data ?? []).map((ch: Record<string, unknown>) => ({
      ...ch,
      config: maskConfig((ch.config as Record<string, unknown>) ?? {}),
    }));

    return NextResponse.json({ data: masked });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();

    const { name, type, config, enabled } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }
    if (!config || typeof config !== 'object') {
      return NextResponse.json({ error: 'config object is required' }, { status: 400 });
    }

    // Type-specific validation
    if (type === 'slack_webhook') {
      if (!config.webhook_url || typeof config.webhook_url !== 'string') {
        return NextResponse.json({ error: 'config.webhook_url is required for slack_webhook channels' }, { status: 400 });
      }
    }
    if (type === 'email') {
      if (!config.to || typeof config.to !== 'string') {
        return NextResponse.json({ error: 'config.to (email address) is required for email channels' }, { status: 400 });
      }
    }

    const insertData = {
      name: name.trim(),
      type,
      config,
      enabled: typeof enabled === 'boolean' ? enabled : true,
      created_by: auth.userId,
    };

    const { data, error } = await supabaseAdmin
      .from('notification_channels')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAudit(auth, 'create_notification_channel', 'notification_channels', data.id, {
      name: insertData.name,
      type: insertData.type,
    });

    // Mask config in response
    return NextResponse.json({
      data: { ...data, config: maskConfig(data.config ?? {}) },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}