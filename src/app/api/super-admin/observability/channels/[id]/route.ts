import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET    /api/super-admin/observability/channels/[id] — single channel
 * PATCH  /api/super-admin/observability/channels/[id] — update channel
 * DELETE /api/super-admin/observability/channels/[id] — delete channel
 */

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked = { ...config };
  if (typeof masked.webhook_url === 'string') {
    masked.webhook_url = masked.webhook_url.slice(0, 20) + '\u2026';
  }
  return masked;
}

const VALID_TYPES = ['slack_webhook', 'email'];

export async function GET(
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
    const { data, error } = await supabaseAdmin
      .from('notification_channels')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: { ...data, config: maskConfig(data.config ?? {}) },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function PATCH(
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
    const body = await request.json();

    // Verify channel exists
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('notification_channels')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Channel not found' }, { status: 404 });
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string') update.name = body.name.trim();
    if (typeof body.type === 'string') {
      if (!VALID_TYPES.includes(body.type)) {
        return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` }, { status: 400 });
      }
      update.type = body.type;
    }
    if (body.config && typeof body.config === 'object') update.config = body.config;
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled;

    const { data, error } = await supabaseAdmin
      .from('notification_channels')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAudit(auth, 'update_notification_channel', 'notification_channels', id, {
      fields_updated: Object.keys(update).filter(k => k !== 'updated_at'),
    });

    return NextResponse.json({
      data: { ...data, config: maskConfig(data.config ?? {}) },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function DELETE(
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
    const { data: existing } = await supabaseAdmin
      .from('notification_channels')
      .select('name')
      .eq('id', id)
      .single();

    const { error } = await supabaseAdmin
      .from('notification_channels')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAudit(auth, 'delete_notification_channel', 'notification_channels', id, {
      name: existing?.name ?? 'unknown',
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}