import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getDb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function checkAdminKey(request: NextRequest): boolean {
  const adminKey = request.headers.get('x-admin-key');
  const secretKey = process.env.SUPER_ADMIN_SECRET;
  return !!(secretKey && adminKey && adminKey === secretKey);
}

/**
 * GET /api/internal/admin/users — List users by role
 */
export async function GET(request: NextRequest) {
  try {
    if (!checkAdminKey(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDb();
    const url = new URL(request.url);
    const role = url.searchParams.get('role') || 'student';
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '25')));
    const search = url.searchParams.get('search');
    const offset = (page - 1) * limit;

    const table = role === 'teacher' ? 'teachers' : role === 'guardian' || role === 'parent' ? 'guardians' : 'students';

    // Use raw SQL via RPC to avoid Supabase parser type issues
    let query = db.from(table).select('*', { count: 'exact' });
    if (search) query = query.ilike('name', `%${search}%`);
    query = query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data, count, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const rows = (data || []).map((r: Record<string, unknown>) => {
      const row = r as Record<string, unknown>;
      return { ...row, role: table === 'guardians' ? 'parent' : role };
    });

    return NextResponse.json({
      data: rows,
      total: count || 0,
      page,
      limit,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

/**
 * PATCH /api/internal/admin/users — Update user fields
 */
export async function PATCH(request: NextRequest) {
  try {
    if (!checkAdminKey(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const db = getDb();
    const { user_id, table, updates } = await request.json();

    if (!user_id || !table || !updates) {
      return NextResponse.json({ error: 'Missing user_id, table, or updates' }, { status: 400 });
    }

    const ALLOWED: Record<string, string[]> = {
      students: ['is_active', 'account_status', 'subscription_plan', 'grade', 'board'],
      teachers: ['is_active'],
      guardians: ['is_active'],
    };

    if (!ALLOWED[table]) {
      return NextResponse.json({ error: 'Invalid table' }, { status: 400 });
    }

    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED[table].includes(k)) safe[k] = v;
    }

    if (Object.keys(safe).length === 0) {
      return NextResponse.json({ error: 'No valid fields' }, { status: 400 });
    }

    const { error } = await db.from(table).update(safe).eq('id', user_id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
