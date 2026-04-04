import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

// GET /api/internal/admin/support?status=open|pending|resolved|all&page=&limit=
export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const sp = new URL(request.url).searchParams;
  const status = sp.get('status') || 'open';
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const limit = Math.min(100, parseInt(sp.get('limit') || '25'));
  const offset = (page - 1) * limit;

  let q = supabase
    .from('support_tickets')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status !== 'all') q = q.eq('status', status);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data, total: count ?? 0, page, limit });
}

// PATCH /api/internal/admin/support — update ticket status / add note
export async function PATCH(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const { id, status, admin_note } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (admin_note !== undefined) updates.admin_notes = admin_note; // column is admin_notes
    if (status === 'resolved') updates.resolved_at = new Date().toISOString();

    const { error } = await supabase.from('support_tickets').update(updates).eq('id', id);
    if (error) throw error;

    await logAdminAction({ action: 'update_support_ticket', entity_type: 'support_ticket', entity_id: id, details: { status, admin_note }, ip });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
