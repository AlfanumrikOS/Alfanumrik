import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest, logAudit } from '@/lib/rbac';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';

/**
 * GET /api/internal/admin/users — List all users with role info
 * Permission: user.manage
 * Query: ?page=1&limit=50&role=student&search=name
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'user.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const url = new URL(request.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
    const role = url.searchParams.get('role');
    const search = url.searchParams.get('search');
    const offset = (page - 1) * limit;

    // Build query based on role filter
    let data: any[] = [];
    let count = 0;

    if (!role || role === 'student') {
      let query = supabaseAdmin
        .from('students')
        .select('id, auth_user_id, name, email, grade, board, xp_total, streak_days, is_active, account_status, subscription_plan, created_at', { count: 'exact' });

      if (search) query = query.ilike('name', `%${search}%`);
      query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

      const result = await query;
      if (!result.error) {
        data = (result.data || []).map(s => ({ ...s, role: 'student' }));
        count = result.count || 0;
      }
    }

    if (role === 'teacher') {
      let query = supabaseAdmin
        .from('teachers')
        .select('id, auth_user_id, name, email, school_name, is_active, created_at', { count: 'exact' });

      if (search) query = query.ilike('name', `%${search}%`);
      query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

      const result = await query;
      if (!result.error) {
        data = (result.data || []).map(t => ({ ...t, role: 'teacher' }));
        count = result.count || 0;
      }
    }

    if (role === 'parent' || role === 'guardian') {
      let query = supabaseAdmin
        .from('guardians')
        .select('id, auth_user_id, name, email, phone, created_at', { count: 'exact' });

      if (search) query = query.ilike('name', `%${search}%`);
      query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

      const result = await query;
      if (!result.error) {
        data = (result.data || []).map(g => ({ ...g, role: 'guardian' }));
        count = result.count || 0;
      }
    }

    logAudit(auth.userId, { action: 'list', resourceType: 'users', details: { role, page, limit, search } });

    return NextResponse.json({ data, total: count, page, limit });
  } catch (err) {
    logger.error('admin_users_list_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/internal/admin/users' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/internal/admin/users — Update user (ban, role change, etc.)
 * Permission: user.manage
 * Body: { user_id, table, updates }
 */
export async function PATCH(request: NextRequest) {
  try {
    const auth = await authorizeRequest(request, 'user.manage');
    if (!auth.authorized) return auth.errorResponse!;

    const { user_id, table, updates } = await request.json();

    if (!user_id || !table || !updates) {
      return NextResponse.json({ error: 'Missing user_id, table, or updates' }, { status: 400 });
    }

    const ALLOWED_TABLES = ['students', 'teachers', 'guardians'];
    if (!ALLOWED_TABLES.includes(table)) {
      return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
    }

    // Whitelist allowed update fields per table
    const ALLOWED_FIELDS: Record<string, string[]> = {
      students: ['is_active', 'account_status', 'subscription_plan', 'grade', 'board'],
      teachers: ['is_active'],
      guardians: ['is_active'],
    };

    const safeUpdates: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (ALLOWED_FIELDS[table]?.includes(key)) {
        safeUpdates[key] = value;
      }
    }

    if (Object.keys(safeUpdates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from(table)
      .update(safeUpdates)
      .eq('id', user_id);

    if (error) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    logAudit(auth.userId, {
      action: 'update',
      resourceType: 'user',
      resourceId: user_id,
      details: { table, updates: safeUpdates },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error('admin_user_update_failed', { error: err instanceof Error ? err : new Error(String(err)), route: '/api/internal/admin/users' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
