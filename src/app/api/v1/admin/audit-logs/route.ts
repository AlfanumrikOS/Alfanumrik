import { NextResponse } from 'next/server';
import { authorizeRequest } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/**
 * GET /api/v1/admin/audit-logs — View audit logs
 * Permission: system.audit
 *
 * Query params:
 *   - page: page number (default 1)
 *   - limit: items per page (default 50, max 100)
 *   - action: filter by action type
 *   - resource: filter by resource type
 *   - user_id: filter by user ID
 *   - from: ISO date, start of date range
 *   - to: ISO date, end of date range
 */
export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, 'system.audit');
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_PAGE_SIZE), 10))
    );
    const action = url.searchParams.get('action');
    const resource = url.searchParams.get('resource');
    const userId = url.searchParams.get('user_id');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let query = supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (action) query = query.eq('action', action);
    if (resource) query = query.eq('resource_type', resource);
    if (userId) query = query.eq('user_id', userId);
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, count, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch audit logs' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: data || [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch (err) {
    logger.error('admin_audit_logs_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/v1/admin/audit-logs' });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
