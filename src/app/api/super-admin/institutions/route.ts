import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, isValidUUID, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { logger } from '@/lib/logger';

// GET — list schools with pagination and search
export async function GET(request: NextRequest) {
  // Phase G.1: read of tenant list is OK at support level.
  const auth = await authorizeAdmin(request, 'support');
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
    // paused_at / pause_reason / paused_by_super_admin_id surface the
    // pause-workflow audit context (see migration
    // 20260527000011_school_pause_audit.sql) so the drawer can show why
    // a school is paused without an extra round-trip.
    const queryParts = [
      'select=id,name,code,slug,board,school_type,city,state,principal_name,email,phone,subscription_plan,is_active,max_students,max_teachers,created_at,tenant_type,font_heading,font_body,border_radius_px,custom_domain,domain_verified,paused_at,pause_reason,paused_by_super_admin_id',
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
  // Phase G.1: creating a tenant is a platform-wide change. super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
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
  // Phase G.1: tenant mutation including suspend/restore. super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();
    const { id, updates } = body;

    if (!id || !updates || typeof updates !== 'object') {
      return NextResponse.json({ error: 'Missing "id" or "updates".' }, { status: 400 });
    }

    // ALLOWED expanded with `tenant_type` (#566) and `custom_domain`
    // (white-label routing). Phase B branding fields (font_heading,
    // font_body, border_radius_px) stay OFF this list — those are
    // school-admin owned via /api/school-admin/branding. domain_verified
    // is only ever flipped via the dedicated verify-domain endpoint
    // (server-controlled DNS check), not via this PATCH path.
    const ALLOWED = ['name', 'board', 'school_type', 'address', 'city', 'state', 'pin_code', 'phone', 'email', 'website', 'principal_name', 'subscription_plan', 'max_students', 'max_teachers', 'is_active', 'tenant_type', 'custom_domain'];
    const VALID_TENANT_TYPES = new Set(['school', 'coaching', 'corporate', 'government']);
    // Defense-in-depth domain shape check. Real DNS verification happens in
    // /api/super-admin/institutions/verify-domain. Reject obvious garbage
    // (whitespace, schemes, paths) here so we don't store it.
    const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
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
      // custom_domain validation. Allow null (clear). When setting a new
      // value, ALWAYS reset domain_verified=false — the new domain hasn't
      // been DNS-verified yet, regardless of any previous verification.
      if (k === 'custom_domain') {
        if (v === null) {
          safe.custom_domain = null;
          safe.domain_verified = false;
          continue;
        }
        if (typeof v !== 'string' || !DOMAIN_RE.test(v.trim().toLowerCase())) {
          return NextResponse.json(
            { error: 'custom_domain must be a valid domain (e.g. "learn.dps.com") or null.' },
            { status: 400 }
          );
        }
        safe.custom_domain = v.trim().toLowerCase();
        safe.domain_verified = false;
        continue;
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
    // Order: most-specific first. custom_domain edits get their own label
    // because they have follow-on TLS-provisioning concerns (operator must
    // also configure Vercel routing for the domain to work end-to-end).
    const action =
      'custom_domain' in updates ? 'tenant.custom_domain_changed' :
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

// DELETE — soft-delete a school (default) or hard-delete (force=true).
//
// Soft delete (?id=<uuid>): flips deleted_at + is_active=false. The row stays
// in the table for forensics and downstream join consistency (students /
// subscriptions / audit_logs still resolve). All GET handlers already exclude
// `deleted_at IS NOT NULL` rows (see /institutions GET line 27).
//
// Hard delete (?id=<uuid>&force=true): only allowed when the row is already
// soft-deleted (deleted_at IS NOT NULL). This is the "expunge" path for
// support tickets — empty test schools, GDPR-style scrub requests. Cascades
// via existing FKs (students, school_subscriptions, etc. have
// `ON DELETE CASCADE` referencing schools).
//
// The UI-prompt-style retype-name guard belongs in the super-admin page,
// not here — the API just needs to be callable from a confirmation modal.
export async function DELETE(request: NextRequest) {
  // Cascades to everything under the tenant. super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const id = params.get('id');
    const force = params.get('force') === 'true';

    if (!id || !isValidUUID(id)) {
      return NextResponse.json({ error: 'Valid "id" query param is required.' }, { status: 400 });
    }

    // Load current state so we can validate the soft/hard transition and
    // capture before-state for the audit log.
    const lookupRes = await fetch(
      supabaseAdminUrl('schools', `select=id,name,is_active,deleted_at&id=eq.${encodeURIComponent(id)}&limit=1`),
      { method: 'GET', headers: supabaseAdminHeaders() },
    );
    if (!lookupRes.ok) {
      return NextResponse.json({ error: 'School lookup failed.' }, { status: 502 });
    }
    const rows = await lookupRes.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: 'School not found.' }, { status: 404 });
    }
    const school = rows[0] as { id: string; name: string; is_active: boolean | null; deleted_at: string | null };

    // ── Hard delete branch (?force=true) ──
    if (force) {
      // Only allowed if the row is already soft-deleted. Hard-deleting a
      // live school is the kind of mistake we want a two-step ramp to
      // prevent — operator must soft-delete first, then come back to expunge.
      if (school.deleted_at === null) {
        return NextResponse.json(
          { error: 'School is not soft-deleted yet. Soft-delete first, then re-run with ?force=true to expunge.' },
          { status: 400 },
        );
      }

      const hardRes = await fetch(
        supabaseAdminUrl('schools', `id=eq.${encodeURIComponent(id)}`),
        { method: 'DELETE', headers: supabaseAdminHeaders('return=minimal') },
      );
      if (!hardRes.ok) {
        const text = await hardRes.text();
        logger.error('school_hard_delete_failed', { schoolId: id, status: hardRes.status, body: text });
        return NextResponse.json({ error: `Hard delete failed: ${text}` }, { status: hardRes.status });
      }

      await logAdminAudit(auth, 'hard_delete_school', 'schools', id, {
        school_name: school.name,
        previous_soft_deleted_at: school.deleted_at,
      });

      return NextResponse.json({
        success: true,
        data: { id, deleted_at: school.deleted_at, mode: 'hard' as const },
      });
    }

    // ── Soft delete branch (default) ──
    // Refuse to soft-delete an already soft-deleted row — the operator
    // probably meant to hard-delete via ?force=true, or hit the button twice.
    if (school.deleted_at !== null) {
      return NextResponse.json(
        { error: 'School is already soft-deleted. Re-run with ?force=true to expunge.' },
        { status: 404 },
      );
    }

    const nowIso = new Date().toISOString();
    const softRes = await fetch(
      supabaseAdminUrl('schools', `id=eq.${encodeURIComponent(id)}&deleted_at=is.null`),
      {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify({
          deleted_at: nowIso,
          is_active: false,
          updated_at: nowIso,
        }),
      },
    );
    if (!softRes.ok) {
      const text = await softRes.text();
      logger.error('school_soft_delete_failed', { schoolId: id, status: softRes.status, body: text });
      return NextResponse.json({ error: `Soft delete failed: ${text}` }, { status: softRes.status });
    }

    const updated = await softRes.json();
    if (Array.isArray(updated) && updated.length === 0) {
      // Race: row was soft-deleted between the lookup and the PATCH.
      return NextResponse.json({ error: 'School not found (or already deleted).' }, { status: 404 });
    }

    await logAdminAudit(auth, 'soft_delete_school', 'schools', id, {
      school_name: school.name,
      previously_active: school.is_active !== false,
    });

    return NextResponse.json({
      success: true,
      data: { id, deleted_at: nowIso, mode: 'soft' as const },
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
