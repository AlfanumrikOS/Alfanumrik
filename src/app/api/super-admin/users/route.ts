import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const role = params.get('role') || 'student';
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, parseInt(params.get('limit') || '25'));
    const search = params.get('search');
    const offset = (page - 1) * limit;

    const table = role === 'teacher' ? 'teachers' : role === 'guardian' || role === 'parent' ? 'guardians' : 'students';
    let query = `select=*&order=created_at.desc&offset=${offset}&limit=${limit}`;
    if (search) query += `&name=ilike.*${encodeURIComponent(search)}*`;

    const res = await fetch(supabaseAdminUrl(table, query), { headers: supabaseAdminHeaders() });
    const data = await res.json();
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : Array.isArray(data) ? data.length : 0;

    return NextResponse.json({
      data: (data || []).map((r: Record<string, unknown>) => ({ ...r, role: table === 'guardians' ? 'parent' : role })),
      total, page, limit,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { user_id, table, updates } = await request.json();
    if (!user_id || !table || !updates) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }

    const allowedFields: Record<string, string[]> = {
      students: ['is_active', 'account_status', 'subscription_plan', 'grade', 'board'],
      teachers: ['is_active'],
      guardians: ['is_active'],
    };

    if (!allowedFields[table]) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });

    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (allowedFields[table].includes(k)) safe[k] = v;
    }
    if (Object.keys(safe).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

    const res = await fetch(supabaseAdminUrl(table, `id=eq.${user_id}`), {
      method: 'PATCH', headers: supabaseAdminHeaders('return=minimal'), body: JSON.stringify(safe),
    });

    if (!res.ok) return NextResponse.json({ error: 'Update failed' }, { status: 500 });

    const action = safe.is_active === false ? 'user.suspended' : safe.is_active === true ? 'user.activated' : 'user.updated';
    await logAdminAudit(auth, action, table, user_id, { updates: safe });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
