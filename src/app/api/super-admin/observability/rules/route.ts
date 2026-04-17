import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET  /api/super-admin/observability/rules — list all alert rules
 * POST /api/super-admin/observability/rules — create a new rule
 */

const VALID_SEVERITIES = ['info', 'warning', 'error', 'critical'];

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    // Fetch all rules
    const { data: rules, error } = await supabaseAdmin
      .from('alert_rules')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Fetch the most recent 'sent' dispatch per rule for last_fired
    const ruleIds = (rules ?? []).map((r: Record<string, unknown>) => r.id as string);
    let lastFiredMap: Record<string, string> = {};

    if (ruleIds.length > 0) {
      const { data: dispatches } = await supabaseAdmin
        .from('alert_dispatches')
        .select('rule_id, fired_at')
        .in('rule_id', ruleIds)
        .eq('status', 'sent')
        .order('fired_at', { ascending: false });

      if (dispatches && dispatches.length > 0) {
        // Keep only the first (most recent) per rule_id
        for (const d of dispatches) {
          const rid = d.rule_id as string;
          if (!lastFiredMap[rid]) {
            lastFiredMap[rid] = d.fired_at as string;
          }
        }
      }
    }

    const enriched = (rules ?? []).map((r: Record<string, unknown>) => ({
      ...r,
      last_fired: lastFiredMap[r.id as string] ?? null,
    }));

    return NextResponse.json({ data: enriched });
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

    // Validate required fields
    const { name, description, enabled, category, source, min_severity,
            count_threshold, window_minutes, channel_ids, cooldown_minutes } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!min_severity || !VALID_SEVERITIES.includes(min_severity)) {
      return NextResponse.json({ error: `min_severity must be one of: ${VALID_SEVERITIES.join(', ')}` }, { status: 400 });
    }
    if (typeof count_threshold !== 'number' || count_threshold < 1) {
      return NextResponse.json({ error: 'count_threshold must be >= 1' }, { status: 400 });
    }
    if (typeof window_minutes !== 'number' || window_minutes < 1 || window_minutes > 1440) {
      return NextResponse.json({ error: 'window_minutes must be between 1 and 1440' }, { status: 400 });
    }

    const resolvedChannelIds = Array.isArray(channel_ids) ? channel_ids : [];

    // Cannot enable with empty channel_ids
    if (enabled === true && resolvedChannelIds.length === 0) {
      return NextResponse.json(
        { error: 'Cannot enable a rule with no channels. Add channel_ids first.' },
        { status: 400 },
      );
    }

    const insertData = {
      name: name.trim(),
      description: description || null,
      enabled: enabled ?? false,
      category: category || null,
      source: source || null,
      min_severity,
      count_threshold,
      window_minutes,
      channel_ids: resolvedChannelIds,
      cooldown_minutes: typeof cooldown_minutes === 'number' ? cooldown_minutes : 15,
      created_by: auth.userId,
    };

    const { data, error } = await supabaseAdmin
      .from('alert_rules')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await logAdminAudit(auth, 'create_alert_rule', 'alert_rules', data.id, {
      name: insertData.name,
      enabled: insertData.enabled,
    });

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}