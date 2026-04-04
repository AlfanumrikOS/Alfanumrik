import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// GET /api/internal/admin/feature-flags — list all flags
export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('feature_flags')
    .select('*')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST /api/internal/admin/feature-flags — create flag
export async function POST(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const body = await request.json();
    const { name, description, is_enabled, rollout_percentage, target_grades, target_roles } = body;

    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const { data, error } = await supabase.from('feature_flags').insert({
      name,
      description: description || '',
      is_enabled: is_enabled ?? false,
      rollout_percentage: rollout_percentage ?? 100,
      target_grades: target_grades || null,
      target_roles: target_roles || null,
    }).select().single();

    if (error) throw error;

    await logAdminAction({ action: 'create_feature_flag', entity_type: 'feature_flag', entity_id: data.id, details: { name }, ip });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH /api/internal/admin/feature-flags — update flag
export async function PATCH(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const ALLOWED = ['is_enabled', 'rollout_percentage', 'target_grades', 'target_roles', 'description'];
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED.includes(k)) safe[k] = v;
    }

    const { error } = await supabase.from('feature_flags').update(safe).eq('id', id);
    if (error) throw error;

    await logAdminAction({ action: 'update_feature_flag', entity_type: 'feature_flag', entity_id: id, details: safe, ip });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
