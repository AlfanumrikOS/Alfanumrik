import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, isValidUUID } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * POST /api/super-admin/observability/rules/[id]/test — dry-run rule evaluation
 *
 * Counts matching events using the same logic as the evaluate_alert_rules()
 * SQL function but does NOT create dispatches or deliver notifications.
 */

const SEVERITY_RANK: Record<string, number> = {
  info: 1,
  warning: 2,
  error: 3,
  critical: 4,
};

function severitiesAtOrAbove(minSeverity: string): string[] {
  const minRank = SEVERITY_RANK[minSeverity] ?? 0;
  return Object.entries(SEVERITY_RANK)
    .filter(([, rank]) => rank >= minRank)
    .map(([sev]) => sev);
}

export async function POST(
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
    // Fetch the rule
    const { data: rule, error: ruleErr } = await supabaseAdmin
      .from('alert_rules')
      .select('*')
      .eq('id', id)
      .single();

    if (ruleErr || !rule) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 });
    }

    // Count matching events in the window
    const windowStart = new Date(
      Date.now() - (rule.window_minutes as number) * 60 * 1000,
    ).toISOString();

    const matchingSeverities = severitiesAtOrAbove(rule.min_severity as string);

    let query = supabaseAdmin
      .from('ops_events')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', windowStart)
      .in('severity', matchingSeverities);

    if (rule.category) {
      query = query.eq('category', rule.category as string);
    }
    if (rule.source) {
      query = query.eq('source', rule.source as string);
    }

    const { count, error: countErr } = await query;

    if (countErr) {
      return NextResponse.json({ error: countErr.message }, { status: 500 });
    }

    const matchedCount = count ?? 0;
    const threshold = rule.count_threshold as number;
    const wouldFire = matchedCount >= threshold;

    const message = wouldFire
      ? `Rule "${rule.name}" WOULD FIRE: ${matchedCount} matching event(s) in the last ${rule.window_minutes}m (threshold: ${threshold})`
      : `Rule "${rule.name}" would NOT fire: ${matchedCount} matching event(s) in the last ${rule.window_minutes}m (threshold: ${threshold})`;

    return NextResponse.json({
      dryRun: true,
      wouldFire,
      matchedCount,
      threshold,
      message,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}