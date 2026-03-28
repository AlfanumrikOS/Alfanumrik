import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

async function supabaseGet(table: string, params: string) {
  const res = await fetch(supabaseAdminUrl(table, params), { headers: supabaseAdminHeaders() });
  return res.ok ? await res.json() : [];
}

// GET — list roles, permissions, user-role assignments
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  const params = new URL(request.url).searchParams;
  const action = params.get('action') || 'roles';

  try {
    if (action === 'roles') {
      const roles = await supabaseGet('roles', 'select=id,name,display_name,hierarchy_level,is_system_role,description&order=hierarchy_level.desc');
      return NextResponse.json({ data: roles });
    }

    if (action === 'permissions') {
      const perms = await supabaseGet('permissions', 'select=id,code,resource,action,description&order=resource.asc,action.asc');
      return NextResponse.json({ data: perms });
    }

    if (action === 'role_permissions') {
      const roleId = params.get('role_id');
      if (!roleId) return NextResponse.json({ error: 'role_id required' }, { status: 400 });
      const rp = await supabaseGet('role_permissions', `select=permission_id,permissions(code,resource,action)&role_id=eq.${roleId}`);
      return NextResponse.json({ data: rp });
    }

    if (action === 'user_roles') {
      const page = Math.max(1, parseInt(params.get('page') || '1'));
      const limit = 25;
      const offset = (page - 1) * limit;
      const search = params.get('search');

      let query = `select=id,auth_user_id,role_id,is_active,created_at,roles(name,display_name)&order=created_at.desc&offset=${offset}&limit=${limit}`;
      if (search) query += `&auth_user_id=eq.${search}`;

      const res = await fetch(supabaseAdminUrl('user_roles', query), { headers: supabaseAdminHeaders('count=exact') });
      const data = await res.json();
      const range = res.headers.get('content-range');
      const total = range ? parseInt(range.split('/')[1]) || 0 : Array.isArray(data) ? data.length : 0;
      return NextResponse.json({ data, total, page });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// POST — assign role to user
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { auth_user_id, role_name } = await request.json();
    if (!auth_user_id || !role_name) {
      return NextResponse.json({ error: 'auth_user_id and role_name required' }, { status: 400 });
    }

    // Get role ID
    const roles = await supabaseGet('roles', `select=id&name=eq.${encodeURIComponent(role_name)}&limit=1`);
    if (!Array.isArray(roles) || roles.length === 0) {
      return NextResponse.json({ error: `Role "${role_name}" not found` }, { status: 404 });
    }
    const roleId = roles[0].id;

    // Insert user_role
    const res = await fetch(supabaseAdminUrl('user_roles'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify({ auth_user_id, role_id: roleId, is_active: true }),
    });

    if (!res.ok) {
      const text = await res.text();
      if (text.includes('duplicate') || text.includes('unique')) {
        return NextResponse.json({ error: 'User already has this role' }, { status: 409 });
      }
      return NextResponse.json({ error: `Assign failed: ${text}` }, { status: res.status });
    }

    const created = await res.json();
    await logAdminAudit(auth, 'role.assigned', 'user_roles', auth_user_id, { role_name, role_id: roleId });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// DELETE — revoke role from user
export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { user_role_id } = await request.json();
    if (!user_role_id) return NextResponse.json({ error: 'user_role_id required' }, { status: 400 });

    const res = await fetch(supabaseAdminUrl('user_roles', `id=eq.${encodeURIComponent(user_role_id)}`), {
      method: 'DELETE',
      headers: supabaseAdminHeaders('return=representation'),
    });

    if (!res.ok) return NextResponse.json({ error: 'Revoke failed' }, { status: 500 });

    const deleted = await res.json();
    const detail = Array.isArray(deleted) && deleted.length > 0 ? deleted[0] : {};
    await logAdminAudit(auth, 'role.revoked', 'user_roles', user_role_id, { auth_user_id: detail.auth_user_id, role_id: detail.role_id });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
