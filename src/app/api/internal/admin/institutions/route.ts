import { NextRequest, NextResponse } from 'next/server';

function checkAuth(request: NextRequest): boolean {
  const adminKey = request.headers.get('x-admin-secret');
  const secretKey = process.env.SUPER_ADMIN_SECRET;
  return !!(secretKey && adminKey && adminKey === secretKey);
}

function supabaseHeaders(prefer: string = 'count=exact') {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': prefer,
  };
}

function supabaseUrl(table: string, params: string = ''): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${url}/rest/v1/${table}${params ? `?${params}` : ''}`;
}

async function logAudit(action: string, entityId: string, details: Record<string, unknown>) {
  try {
    await fetch(supabaseUrl('admin_audit_log'), {
      method: 'POST',
      headers: supabaseHeaders('return=minimal'),
      body: JSON.stringify({ action, entity_type: 'school', entity_id: entityId, details }),
    });
  } catch { /* fire and forget */ }
}

// GET — list schools with pagination and search
export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25')));
    const offset = (page - 1) * limit;
    const search = params.get('search');

    const queryParts = [
      'select=id,name,code,board,school_type,city,state,principal_name,email,phone,subscription_plan,is_active,max_students,max_teachers,created_at',
      'deleted_at=is.null',
      'order=created_at.desc',
      `offset=${offset}`,
      `limit=${limit}`,
    ];

    if (search) {
      queryParts.push(`name=ilike.*${encodeURIComponent(search)}*`);
    }

    const res = await fetch(supabaseUrl('schools', queryParts.join('&')), {
      method: 'GET',
      headers: supabaseHeaders(),
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch schools' }, { status: res.status });
    }

    const data = await res.json();
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : data.length;

    return NextResponse.json({ data, total, page, limit });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// POST — create a new school
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const ALLOWED = ['name', 'code', 'board', 'school_type', 'address', 'city', 'state', 'pin_code', 'phone', 'email', 'website', 'principal_name', 'subscription_plan', 'max_students', 'max_teachers'];
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (ALLOWED.includes(k) && v !== undefined && v !== '') safe[k] = v;
    }

    if (!safe.name) {
      return NextResponse.json({ error: 'School name is required.' }, { status: 400 });
    }

    const res = await fetch(supabaseUrl('schools'), {
      method: 'POST',
      headers: supabaseHeaders('return=representation'),
      body: JSON.stringify(safe),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Create failed: ${text}` }, { status: res.status });
    }

    const created = await res.json();
    const schoolId = Array.isArray(created) ? created[0]?.id : created?.id;
    await logAudit('school.created', schoolId || '', { data: safe });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH — update a school (including suspend/activate)
export async function PATCH(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, updates } = body;

    if (!id || !updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Missing "id" or "updates".' }, { status: 400 });
    }

    const ALLOWED = ['name', 'board', 'school_type', 'address', 'city', 'state', 'pin_code', 'phone', 'email', 'website', 'principal_name', 'subscription_plan', 'max_students', 'max_teachers', 'is_active'];
    const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED.includes(k)) safe[k] = v;
    }

    const res = await fetch(supabaseUrl('schools', `id=eq.${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: supabaseHeaders('return=representation'),
      body: JSON.stringify(safe),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Update failed: ${text}` }, { status: res.status });
    }

    const updated = await res.json();
    if (Array.isArray(updated) && updated.length === 0) {
      return NextResponse.json({ error: 'School not found.' }, { status: 404 });
    }

    const action = safe.is_active === false ? 'school.suspended' : safe.is_active === true ? 'school.activated' : 'school.updated';
    await logAudit(action, id, { updates: safe });
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
