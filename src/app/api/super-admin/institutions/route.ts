import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';

// GET — list schools with pagination and search
export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const page = Math.max(1, parseInt(params.get('page') || '1'));
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') || '25')));
    const offset = (page - 1) * limit;
    const search = params.get('search');

    // Phase B fields (tenant_type + typography) added so the super-admin
    // institutions UI can display them and feed an upcoming edit flow.
    // Slug + custom_domain included for parity with /api/school-config so
    // ops can spot which schools have white-label routing wired up.
    const queryParts = [
      'select=id,name,code,slug,board,school_type,city,state,principal_name,email,phone,subscription_plan,is_active,max_students,max_teachers,created_at,tenant_type,font_heading,font_body,border_radius_px,custom_domain,domain_verified',
      'deleted_at=is.null',
      'order=created_at.desc',
      `offset=${offset}`,
      `limit=${limit}`,
    ];

    if (search) {
      queryParts.push(`name=ilike.*${encodeURIComponent(search)}*`);
    }

    const res = await fetch(supabaseAdminUrl('schools', queryParts.join('&')), {
      method: 'GET',
      headers: supabaseAdminHeaders(),
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
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

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

    const res = await fetch(supabaseAdminUrl('schools'), {
      method: 'POST',
      headers: supabaseAdminHeaders('return=representation'),
      body: JSON.stringify(safe),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `Create failed: ${text}` }, { status: res.status });
    }

    const created = await res.json();
    const schoolId = Array.isArray(created) ? created[0]?.id : created?.id;
    await logAdminAudit(auth, 'school.created', 'school', schoolId || '', { data: safe });
    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH — update a school (including suspend/activate)
export async function PATCH(request: NextRequest) {
  const auth = await authorizeAdmin(request);
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id, updates } = body;

    if (!id || !updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Missing "id" or "updates".' }, { status: 400 });
    }

    // ALLOWED expanded with `tenant_type` so super-admin can change a
    // tenant's category (school → coaching, etc.). All other Phase B fields
    // (font_heading, font_body, border_radius_px) are intentionally NOT
    // listed here — those are owned by the school admin via
    // /api/school-admin/branding (#563), keeping responsibilities separated.
    const ALLOWED = ['name', 'board', 'school_type', 'address', 'city', 'state', 'pin_code', 'phone', 'email', 'website', 'principal_name', 'subscription_plan', 'max_students', 'max_teachers', 'is_active', 'tenant_type'];
    const VALID_TENANT_TYPES = new Set(['school', 'coaching', 'corporate', 'government']);
    const safe: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(updates)) {
      if (!ALLOWED.includes(k)) continue;
      // tenant_type is constrained at the DB layer (CHECK constraint added
      // by migration 20260507000004), but reject early at the API for a
      // clearer error message + to avoid emitting a vague Postgres failure.
      if (k === 'tenant_type' && !(typeof v === 'string' && VALID_TENANT_TYPES.has(v))) {
        return NextResponse.json(
          { error: "tenant_type must be one of 'school', 'coaching', 'corporate', 'government'." },
          { status: 400 }
        );
      }
      safe[k] = v;
    }

    const res = await fetch(supabaseAdminUrl('schools', `id=eq.${encodeURIComponent(id)}`), {
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
      return NextResponse.json({ error: 'School not found.' }, { status: 404 });
    }

    // Pick the most-specific action label so audit-log triage is easy.
    // tenant_type changes get their own action because they're load-bearing
    // for default modules + copy + billing assumptions; ops should be able
    // to filter on them without inspecting each row's `updates` blob.
    const action =
      'tenant_type' in updates ? 'tenant.type_changed' :
      safe.is_active === false ? 'school.suspended' :
      safe.is_active === true ? 'school.activated' :
      'school.updated';
    await logAdminAudit(auth, action, 'school', id, { updates: safe });
    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
