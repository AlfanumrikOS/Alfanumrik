import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

// ---------------------------------------------------------------------------
// GET  — list all feature flags (with optional search)
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const search = params.get('search');

    let queryParts = [`select=id,name,enabled,created_at`, `order=created_at.desc`];

    if (search) {
      queryParts.push(`name=ilike.*${encodeURIComponent(search)}*`);
    }

    const res = await fetch(supabaseAdminUrl('feature_flags', queryParts.join('&')), {
      method: 'GET',
      headers: supabaseAdminHeaders('count=exact'),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Supabase error: ${text}` }, { status: res.status });
    }

    const data = await res.json();
    const range = res.headers.get('content-range');
    const total = range ? parseInt(range.split('/')[1]) || 0 : data.length;

    return NextResponse.json({ data, total });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create a new feature flag
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { name, enabled, description } = body;

    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid "name".' }, { status: 400 });
    }

    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'Missing or invalid "enabled" (must be boolean).' }, { status: 400 });
    }

    // Check uniqueness
    const checkRes = await fetch(supabaseAdminUrl('feature_flags', `select=id&name=eq.${encodeURIComponent(name)}&limit=1`), {
      method: 'GET',
      headers: supabaseAdminHeaders('count=exact'),
    });

    if (checkRes.ok) {
      const existing = await checkRes.json();
      if (Array.isArray(existing) && existing.length > 0) {
        return NextResponse.json({ error: `Feature flag "${name}" already exists.` }, { status: 409 });
      }
    }

    const payload: Record<string, unknown> = { name, enabled };
    if (description !== undefined) payload.description = description;

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
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — update an existing feature flag
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id, updates } = body;

    if (!id || !updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Missing "id" or "updates" object.' }, { status: 400 });
    }

    const ALLOWED = ['enabled', 'name'];
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED.includes(k)) safe[k] = v;
    }

    if (Object.keys(safe).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 });
    }

    const res = await fetch(supabaseAdminUrl('feature_flags', `id=eq.${encodeURIComponent(id)}`), {
      method: 'PATCH',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(safe),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Update failed: ${text}` }, { status: res.status });
    }

    const updated = await res.json();
    if (Array.isArray(updated) && updated.length === 0) {
      return NextResponse.json({ error: 'No record found with that id.' }, { status: 404 });
    }

    await logAdminAudit(auth, 'feature_flag.updated', 'feature_flag', id, { updates: safe });
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — hard delete a feature flag
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing "id".' }, { status: 400 });
    }

    const res = await fetch(supabaseAdminUrl('feature_flags', `id=eq.${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: supabaseAdminHeaders('return=representation'),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Delete failed: ${text}` }, { status: res.status });
    }

    const deleted = await res.json();
    if (Array.isArray(deleted) && deleted.length === 0) {
      return NextResponse.json({ error: 'No record found with that id.' }, { status: 404 });
    }

    await logAdminAudit(auth, 'feature_flag.deleted', 'feature_flag', id, { deleted: deleted[0] });
    return NextResponse.json({ success: true, data: deleted });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
