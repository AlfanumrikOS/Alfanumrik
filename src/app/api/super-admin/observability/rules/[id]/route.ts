import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET    /api/super-admin/observability/rules/[id] — single rule
 * PATCH  /api/super-admin/observability/rules/[id] — update rule
 * DELETE /api/super-admin/observability/rules/[id] — delete rule
 */

const VALID_SEVERITIES = ['info', 'warning', 'error', 'critical'];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const { id } = await params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('alert_rules')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    return NextResponse.json({ data });
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
    return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
  }

  try {
    const body = await request.json();

    // Fetch existing rule to check channel_ids constraint
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('alert_rules')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Determine effective channel_ids after the update
    const effectiveChannelIds = Array.isArray(body.channel_ids)
      ? body.channel_ids
      : (existing.channel_ids as string[]);

    // Determine effective enabled state after the update
    const effectiveEnabled = typeof body.enabled === 'boolean'
      ? body.enabled
      : (existing.enabled as boolean);

    // Cannot enable with empty channel_ids
    if (effectiveEnabled && effectiveChannelIds.length === 0) {
      return NextResponse.json(
        { error: 'Cannot enable a rule with no channels. Add channel_ids first.' },
        { status: 400 },
      );
    }

    // Build update object with only provided fields
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.name === 'string') update.name = body.name.trim();
    if (typeof body.description === 'string' || body.description === null) update.description = body.description;
    if (typeof body.enabled === 'boolean') update.enabled = body.enabled;
    if (typeof body.category === 'string' || body.category === null) update.category = body.category;
    if (typeof body.source === 'string' || body.source === null) update.source = body.source;
    if (typeof body.min_severity === 'string') {
      if (!VALID_SEVERITIES.includes(body.min_severity)) {
        return NextResponse.json({ error: `min_severity must be one of: ${VALID_SEVERITIES.join(', ')}` }, { status: 400 });
      }
      update.min_severity = body.min_severity;
    }
    if (typeof body.count_threshold === 'number') {
      if (body.count_threshold < 1) {
        return NextResponse.json({ error: 'count_threshold must be >= 1' }, { status: 400 });
      }
      update.count_threshold = body.count_threshold;
    }
    if (typeof body.window_minutes === 'number') {
      if (body.window_minutes < 1 || body.window_minutes > 1440) {
        return NextResponse.json({ error: 'window_minutes must be between 1 and 1440' }, { status: 400 });
      }
      update.window_minutes = body.window_minutes;
    }
    if (Array.isArray(body.channel_ids)) update.channel_ids = body.channel_ids;
    if (typeof body.cooldown_minutes === 'number') update.cooldown_minutes = body.cooldown_minutes;

    const { data, error } = await supabaseAdmin
      .from('alert_rules')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAudit(auth, 'update_alert_rule', 'alert_rules', id, {
      fields_updated: Object.keys(update).filter(k => k !== 'updated_at'),
    });

    return NextResponse.json({ data });
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
    return NextResponse.json({ error: 'Invalid rule id' }, { status: 400 });
  }

  try {
    // Fetch rule name for audit log
    const { data: existing } = await supabaseAdmin
      .from('alert_rules')
      .select('name')
      .eq('id', id)
      .single();

    const { error } = await supabaseAdmin
      .from('alert_rules')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAudit(auth, 'delete_alert_rule', 'alert_rules', id, {
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