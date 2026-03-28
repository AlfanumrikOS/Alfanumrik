import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../../lib/admin-auth';

async function supabaseQuery(table: string, params: string) {
  const res = await fetch(supabaseAdminUrl(table, params), {
    headers: supabaseAdminHeaders('count=exact'),
  });
  const data = await res.json();
  const range = res.headers.get('content-range');
  const total = range ? parseInt(range.split('/')[1]) || 0 : data.length;
  return { data, total };
}

async function supabaseUpdate(table: string, id: string, updates: Record<string, unknown>) {
  const res = await fetch(supabaseAdminUrl(table, `id=eq.${id}`), {
    method: 'PATCH',
    headers: supabaseAdminHeaders('return=minimal'),
    body: JSON.stringify(updates),
  });
  return res.ok;
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const role = params.get('role') || 'student';
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25')));
    const search = params.get('search');
    const offset = (page - 1) * limit;

    const table = role === 'teacher' ? 'teachers' : role === 'guardian' || role === 'parent' ? 'guardians' : 'students';

    let queryParams = `select=*&order=created_at.desc&offset=${offset}&limit=${limit}`;
    if (search) queryParams += `&name=ilike.*${encodeURIComponent(search)}*`;

    const { data, total } = await supabaseQuery(table, queryParams);

    return NextResponse.json({
      data: (data || []).map((r: Record<string, unknown>) => ({ ...r, role: table === 'guardians' ? 'parent' : role })),
      total,
      page,
      limit,
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

    const ALLOWED: Record<string, string[]> = {
      students: ['is_active', 'account_status', 'subscription_plan', 'grade', 'board'],
      teachers: ['is_active'],
      guardians: ['is_active'],
    };

    if (!ALLOWED[table]) return NextResponse.json({ error: 'Invalid table' }, { status: 400 });

    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED[table].includes(k)) safe[k] = v;
    }

    if (Object.keys(safe).length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 });

    const ok = await supabaseUpdate(table, user_id, safe);
    return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Update failed' }, { status: 500 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
