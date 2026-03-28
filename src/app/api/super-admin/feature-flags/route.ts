import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

/**
 * Feature Flags API — supports global, per-institution, per-role, per-environment scoping.
 *
 * DB columns: id, flag_name, is_enabled, rollout_percentage, target_grades,
 *             target_institutions, target_roles, target_environments,
 *             description, updated_by, created_at, updated_at
 */

// GET — list all flags
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const search = params.get('search');

    const fields = 'id,flag_name,is_enabled,rollout_percentage,target_grades,target_institutions,target_roles,target_environments,description,created_at,updated_at';
    const queryParts = [`select=${fields}`, 'order=created_at.desc'];
    if (search) queryParts.push(`flag_name=ilike.*${encodeURIComponent(search)}*`);

    const res = await fetch(supabaseAdminUrl('feature_flags', queryParts.join('&')), {
      headers: supabaseAdminHeaders('count=exact'),
    });

    if (!res.ok) return NextResponse.json({ error: 'Fetch failed' }, { status: res.status });

    const data = await res.json();
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : Array.isArray(data) ? data.length : 0;

    // Normalize for UI (map DB columns to friendly names)
    const normalized = Array.isArray(data) ? data.map((f: Record<string, unknown>) => ({
      id: f.id,
      name: f.flag_name,
      enabled: f.is_enabled,
      rollout_percentage: f.rollout_percentage,
      target_grades: f.target_grades,
      target_institutions: f.target_institutions,
      target_roles: f.target_roles,
      target_environments: f.target_environments,
      description: f.description,
      created_at: f.created_at,
      updated_at: f.updated_at,
    })) : [];

    return NextResponse.json({ data: normalized, total });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// POST — create a new flag
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { name, enabled, description, target_institutions, target_roles, target_environments } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "name".' }, { status: 400 });
    }

    // Check uniqueness
    const checkRes = await fetch(supabaseAdminUrl('feature_flags', `select=id&flag_name=eq.${encodeURIComponent(name)}&limit=1`), {
      headers: supabaseAdminHeaders(),
    });
    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        return NextResponse.json({ error: `Flag "${name}" already exists.` }, { status: 409 });
      }
    }

    const payload: Record<string, unknown> = {
      flag_name: name,
      is_enabled: enabled === true,
      description: description || null,
      updated_by: auth.userId,
    };
    if (Array.isArray(target_institutions)) payload.target_institutions = target_institutions;
    if (Array.isArray(target_roles)) payload.target_roles = target_roles;
    if (Array.isArray(target_environments)) payload.target_environments = target_environments;

    const res = await fetch(supabaseAdminUrl('feature_flags'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Create failed: ${text}` }, { status: res.status });
    }

    const created = await res.json();
    const flagId = Array.isArray(created) ? created[0]?.id : created?.id;
    await logAdminAudit(auth, 'feature_flag.created', 'feature_flags', flagId || '', { name, enabled });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH — update a flag (toggle, scoping, description)
export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { id, updates } = await request.json();
    if (!id || !updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Missing "id" or "updates".' }, { status: 400 });
    }

    // Map friendly names to DB columns
    const FIELD_MAP: Record<string, string> = {
      enabled: 'is_enabled',
      name: 'flag_name',
      description: 'description',
      rollout_percentage: 'rollout_percentage',
      target_grades: 'target_grades',
      target_institutions: 'target_institutions',
      target_roles: 'target_roles',
      target_environments: 'target_environments',
    };

    const safe: Record<string, unknown> = { updated_by: auth.userId, updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(updates)) {
      const dbCol = FIELD_MAP[k];
      if (dbCol) safe[dbCol] = v;
    }

    if (Object.keys(safe).length <= 2) { // only updated_by and updated_at
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
    }

    const res = await fetch(supabaseAdminUrl('feature_flags', `id=eq.${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(safe),
    });

    if (!res.ok) return NextResponse.json({ error: 'Update failed' }, { status: res.status });

    const updated = await res.json();
    if (Array.isArray(updated) && updated.length === 0) {
      return NextResponse.json({ error: 'Flag not found.' }, { status: 404 });
    }

    await logAdminAudit(auth, 'feature_flag.updated', 'feature_flags', id, { updates });
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// DELETE — hard delete a flag
export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const { id } = await request.json();
    if (!id) return NextResponse.json({ error: 'Missing "id".' }, { status: 400 });

    const res = await fetch(supabaseAdminUrl('feature_flags', `id=eq.${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: supabaseAdminHeaders('return=representation'),
    });

    if (!res.ok) return NextResponse.json({ error: 'Delete failed' }, { status: res.status });

    const deleted = await res.json();
    if (Array.isArray(deleted) && deleted.length === 0) {
      return NextResponse.json({ error: 'Flag not found.' }, { status: 404 });
    }

    await logAdminAudit(auth, 'feature_flag.deleted', 'feature_flags', id, { deleted: deleted[0] });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
