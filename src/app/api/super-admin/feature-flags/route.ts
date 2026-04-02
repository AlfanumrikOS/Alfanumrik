import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { invalidateFlagCache } from '../../../../lib/feature-flags';
import { featureFlagSchema, validateBody, zUuid } from '../../../../lib/validation';
import { z } from 'zod';

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
    const queryParts = [`select=${fields}`, 'order=created_at.desc', 'limit=100'];
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

    // Validate with Zod schema — structured 400 errors for invalid input
    const createSchema = featureFlagSchema.extend({
      // POST uses 'name' in body, map to flag_name for validation
      name: z.string().min(1).max(100).regex(/^[a-z_]+$/, 'Flag name must be lowercase with underscores only'),
      enabled: z.boolean().optional(),
      description: z.string().max(500).nullable().optional(),
    }).omit({ flag_name: true, is_enabled: true });

    const validation = validateBody(createSchema, body);
    if (!validation.success) return validation.error;

    const { name, enabled, description, target_institutions, target_roles, target_environments } = validation.data;

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
    invalidateFlagCache();
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
    const body = await request.json();

    // Validate patch payload structure
    const patchSchema = z.object({
      id: zUuid,
      updates: z.object({
        enabled: z.boolean().optional(),
        name: z.string().min(1).max(100).regex(/^[a-z_]+$/, 'Flag name must be lowercase with underscores only').optional(),
        description: z.string().max(500).nullable().optional(),
        rollout_percentage: z.number().int().min(0).max(100).nullable().optional(),
        target_grades: z.array(z.string()).nullable().optional(),
        target_institutions: z.array(zUuid).nullable().optional(),
        target_roles: z.array(z.string()).nullable().optional(),
        target_environments: z.array(z.string()).nullable().optional(),
      }).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field must be provided in updates' }),
    });

    const validation = validateBody(patchSchema, body);
    if (!validation.success) return validation.error;

    const { id, updates } = validation.data;

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

    // Fetch previous state for audit trail
    let previousState: Record<string, unknown> | null = null;
    try {
      const prevRes = await fetch(supabaseAdminUrl('feature_flags', `select=flag_name,is_enabled,rollout_percentage,target_roles,target_environments,target_institutions,description&id=eq.${encodeURIComponent(id)}&limit=1`), {
        headers: supabaseAdminHeaders(),
      });
      if (prevRes.ok) {
        const prevData = await prevRes.json();
        if (Array.isArray(prevData) && prevData.length > 0) previousState = prevData[0];
      }
    } catch { /* best-effort: audit still proceeds without previous state */ }

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

    await logAdminAudit(auth, 'feature_flag.updated', 'feature_flags', id, {
      updates,
      previous_state: previousState,
      flag_name: previousState?.flag_name || null,
    });
    invalidateFlagCache();
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
    const body = await request.json();

    const deleteSchema = z.object({ id: zUuid });
    const validation = validateBody(deleteSchema, body);
    if (!validation.success) return validation.error;

    const { id } = validation.data;

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
    invalidateFlagCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
