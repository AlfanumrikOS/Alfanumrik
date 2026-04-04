import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const sp = new URL(request.url).searchParams;
  const page = Math.max(1, parseInt(sp.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') || '25')));
  const source = sp.get('source') || 'all'; // 'all' | 'user' | 'admin'
  const offset = (page - 1) * limit;

  try {
    if (source === 'admin') {
      // Admin audit log
      const { data, count, error } = await supabase
        .from('admin_audit_log')
        .select('id,admin_id,action,entity_type,entity_id,details,ip_address,created_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      return NextResponse.json({ data, total: count ?? 0, page, limit, source });
    }

    // User audit log (default)
    const { data, count, error } = await supabase
      .from('audit_logs')
      .select('id,auth_user_id,action,resource_type,resource_id,details,status,created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return NextResponse.json({ data, total: count ?? 0, page, limit, source });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
