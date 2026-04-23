import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const sp = new URL(request.url).searchParams;
  const role = sp.get('role') || 'student';
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25')));
  const search = sp.get('search') || '';
  const grade = sp.get('grade') || '';
  const status = sp.get('status') || '';
  const plan = sp.get('plan') || '';
  const offset = (page - 1) * limit;

  try {
    const table = role === 'teacher' ? 'identity.teachers' : role === 'guardian' || role === 'parent' ? 'identity.guardians' : 'identity.students';

    let q = supabase
      .from(table)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (search) q = q.ilike('name', `%${search}%`);
    if (table === 'identity.students') {
      if (grade) q = q.eq('grade', grade);
      if (plan) q = q.eq('subscription_plan', plan);
      if (status === 'active') q = q.eq('is_active', true);
      if (status === 'suspended') q = q.eq('is_active', false);
    }

    const { data, count, error } = await q;
    if (error) throw error;

    return NextResponse.json({
      data: (data || []).map((r: Record<string, unknown>) => ({ ...r, role: table === 'identity.guardians' ? 'parent' : role })),
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const { user_id, table, updates } = await request.json();
    if (!user_id || !table || !updates) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const ALLOWED: Record<string, string[]> = {
      'identity.students': ['is_active', 'account_status', 'subscription_plan', 'grade', 'board'],
      'identity.teachers': ['is_active'],
      'identity.guardians': ['is_active'],
    };

    if (!ALLOWED[table]) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });

    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED[table].includes(k)) safe[k] = v;
    }

    if (Object.keys(safe).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

    const { error } = await supabase.from(table).update(safe).eq('id', user_id);
    if (error) throw error;

    await logAdminAction({ action: 'update_user', entity_type: table, entity_id: user_id, details: safe, ip });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
