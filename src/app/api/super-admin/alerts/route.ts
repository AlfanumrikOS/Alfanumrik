import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

// ── helpers ──────────────────────────────────────────────────────────

async function safeJson<T>(res: Response): Promise<T[]> {
  try { const d = await res.json(); return Array.isArray(d) ? d : []; }
  catch { return []; }
}

const VALID_RULE_TYPES = ['error_rate', 'engagement_drop', 'payment_failure', 'ai_budget', 'seat_limit'] as const;
type RuleType = typeof VALID_RULE_TYPES[number];

function isValidRuleType(v: unknown): v is RuleType {
  return typeof v === 'string' && VALID_RULE_TYPES.includes(v as RuleType);
}

function isValidUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

// ── GET /api/super-admin/alerts — list all rules ──

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const ruleType = params.get('rule_type');
    const schoolId = params.get('school_id');

    const queryParts = [
      'select=id,school_id,rule_type,threshold,is_active,last_triggered_at,created_at,updated_at',
      'order=created_at.desc',
      'limit=500',
    ];

    if (ruleType && isValidRuleType(ruleType)) {
      queryParts.push(`rule_type=eq.${ruleType}`);
    }
    if (schoolId === 'global') {
      queryParts.push('school_id=is.null');
    } else if (schoolId && isValidUUID(schoolId)) {
      queryParts.push(`school_id=eq.${schoolId}`);
    }

    const res = await fetch(supabaseAdminUrl('school_alert_rules', queryParts.join('&')), {
      headers: supabaseAdminHeaders('count=exact'),
    });

    if (!res.ok) {
      const text = await res.text();
      // Table may not exist yet — return empty gracefully
      if (text.includes('relation') && text.includes('does not exist')) {
        return NextResponse.json({ success: true, data: [], total: 0 });
      }
      return NextResponse.json({ success: false, error: `Fetch failed: ${text}` }, { status: res.status });
    }

    const data = await safeJson<Record<string, unknown>>(res);
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : data.length;

    // Enrich with school names if any have school_id
    const schoolIds = [...new Set(
      data.filter(r => r.school_id).map(r => r.school_id as string)
    )];

    let schoolNames: Record<string, string> = {};
    if (schoolIds.length > 0) {
      const schoolRes = await fetch(
        supabaseAdminUrl('schools', `select=id,name&id=in.(${schoolIds.join(',')})&limit=100`),
        { headers: supabaseAdminHeaders() },
      );
      if (schoolRes.ok) {
        const schools = await safeJson<{ id: string; name: string }>(schoolRes);
        schoolNames = Object.fromEntries(schools.map(s => [s.id, s.name]));
      }
    }

    const enriched = data.map(r => ({
      ...r,
      school_name: r.school_id ? (schoolNames[r.school_id as string] || 'Unknown') : null,
      scope: r.school_id ? 'School' : 'Global',
    }));

    return NextResponse.json({ success: true, data: enriched, total });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ── POST /api/super-admin/alerts — create rule ──

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { rule_type, threshold, school_id } = body;

    if (!isValidRuleType(rule_type)) {
      return NextResponse.json(
        { success: false, error: `Invalid rule_type. Must be one of: ${VALID_RULE_TYPES.join(', ')}` },
        { status: 400 },
      );
    }

    if (typeof threshold !== 'number' || threshold < 0 || threshold > 100) {
      return NextResponse.json(
        { success: false, error: 'Threshold must be a number between 0 and 100.' },
        { status: 400 },
      );
    }

    if (school_id !== undefined && school_id !== null && !isValidUUID(school_id)) {
      return NextResponse.json(
        { success: false, error: 'Invalid school_id format.' },
        { status: 400 },
      );
    }

    const insertBody: Record<string, unknown> = {
      rule_type,
      threshold,
      school_id: school_id || null,
      is_active: true,
    };

    const res = await fetch(supabaseAdminUrl('school_alert_rules'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(insertBody),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, error: `Create failed: ${text}` }, { status: res.status });
    }

    const created = await res.json();
    const ruleId = Array.isArray(created) ? created[0]?.id : created?.id;
    await logAdminAudit(auth, 'alert_rule.created', 'school_alert_rules', ruleId || '', { rule_type, threshold, school_id });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ── PATCH /api/super-admin/alerts — update rule ──

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id, threshold, is_active } = body;

    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Valid rule ID is required.' }, { status: 400 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof threshold === 'number' && threshold >= 0 && threshold <= 100) {
      updates.threshold = threshold;
    }
    if (typeof is_active === 'boolean') {
      updates.is_active = is_active;
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ success: false, error: 'No valid updates provided.' }, { status: 400 });
    }

    const res = await fetch(supabaseAdminUrl('school_alert_rules', `id=eq.${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(updates),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, error: `Update failed: ${text}` }, { status: res.status });
    }

    const updated = await res.json();
    if (Array.isArray(updated) && updated.length === 0) {
      return NextResponse.json({ success: false, error: 'Rule not found.' }, { status: 404 });
    }

    await logAdminAudit(auth, 'alert_rule.updated', 'school_alert_rules', id, { updates });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

// ── DELETE /api/super-admin/alerts — delete rule ──

export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ success: false, error: 'Valid rule ID is required.' }, { status: 400 });
    }

    const res = await fetch(supabaseAdminUrl('school_alert_rules', `id=eq.${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: supabaseAdminHeaders('return=representation'),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ success: false, error: `Delete failed: ${text}` }, { status: res.status });
    }

    const deleted = await res.json();
    if (Array.isArray(deleted) && deleted.length === 0) {
      return NextResponse.json({ success: false, error: 'Rule not found.' }, { status: 404 });
    }

    await logAdminAudit(auth, 'alert_rule.deleted', 'school_alert_rules', id, {});

    return NextResponse.json({ success: true, data: { deleted: true, id } });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
