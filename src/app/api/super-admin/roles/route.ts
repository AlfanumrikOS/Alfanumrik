import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

async function query(table: string, params: string) {
  const res = await fetch(supabaseAdminUrl(table, params), { headers: supabaseAdminHeaders() });
  return res.ok ? await res.json() : [];
}

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const params = new URL(request.url).searchParams;
  const action = params.get('action') || 'roles';

  try {
    if (action === 'roles') {
      return NextResponse.json({ data: await query('roles', 'select=id,name,display_name,hierarchy_level,is_system_role,description&order=hierarchy_level.desc') });
    }

    if (action === 'permissions') {
      return NextResponse.json({ data: await query('permissions', 'select=id,code,resource,action,description&order=resource.asc,action.asc') });
    }

    if (action === 'role_permissions') {
      const roleId = params.get('role_id');
      if (!roleId) return NextResponse.json({ error: 'role_id required' }, { status: 400 });
      return NextResponse.json({ data: await query('role_permissions', `select=permission_id,permissions(code,resource,action)&role_id=eq.${roleId}`) });
    }

    if (action === 'user_roles') {
      const page = Math.max(1, parseInt(params.get('page') || '1'));
      const offset = (page - 1) * 25;
      const search = params.get('search');
      let q = `select=id,auth_user_id,role_id,is_active,created_at,roles(name,display_name)&order=created_at.desc&offset=${offset}&limit=25`;
      if (search) q += `&auth_user_id=eq.${search}`;

      const res = await fetch(supabaseAdminUrl('user_roles', q), { headers: supabaseAdminHeaders('count=exact') });
      const data = await res.json();
      const range = res.headers.get('content-range');
      return NextResponse.json({ data, total: range ? parseInt(range.split('/')[1]) || 0 : Array.isArray(data) ? data.length : 0, page });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { auth_user_id, role_name } = await request.json();
    if (!auth_user_id || !role_name) return NextResponse.json({ error: 'auth_user_id and role_name required' }, { status: 400 });

    const roles = await query('roles', `select=id&name=eq.${encodeURIComponent(role_name)}&limit=1`);
    if (!Array.isArray(roles) || roles.length === 0) return NextResponse.json({ error: `Role "${role_name}" not found` }, { status: 404 });

    const res = await fetch(supabaseAdminUrl('user_roles'), {
      method: 'POST', headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({ auth_user_id, role_id: roles[0].id, is_active: true }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (text.includes('duplicate') || text.includes('unique')) return NextResponse.json({ error: 'User already has this role' }, { status: 409 });
      return NextResponse.json({ error: 'Assign failed' }, { status: res.status });
    }

    await logAdminAudit(auth, 'role.assigned', 'user_roles', auth_user_id, { role_name });
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { user_role_id } = await request.json();
    if (!user_role_id) return NextResponse.json({ error: 'user_role_id required' }, { status: 400 });

    const res = await fetch(supabaseAdminUrl('user_roles', `id=eq.${encodeURIComponent(user_role_id)}`), {
      method: 'DELETE', headers: supabaseAdminHeaders('return=representation'),
    });

    if (!res.ok) return NextResponse.json({ error: 'Revoke failed' }, { status: 500 });

    const deleted = await res.json();
    const detail = Array.isArray(deleted) && deleted.length > 0 ? deleted[0] : {};
    await logAdminAudit(auth, 'role.revoked', 'user_roles', user_role_id, { auth_user_id: detail.auth_user_id });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
