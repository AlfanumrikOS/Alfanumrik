import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * GET /api/internal/admin/logs — Paginated audit logs
 * Auth: ADMIN_SECRET_KEY only
 */
export async function GET(request: NextRequest) {
  try {
    const adminKey = request.headers.get('x-admin-key');
    const secretKey = process.env.ADMIN_SECRET_KEY;
    if (!secretKey || !adminKey || adminKey !== secretKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

    const params = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25')));
    const offset = (page - 1) * limit;

    const { data, count, error } = await db
      .from('audit_logs')
      .select('id, user_id:auth_user_id, action, resource_type, resource_id, details, status, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data: data || [], total: count || 0, page, limit });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
