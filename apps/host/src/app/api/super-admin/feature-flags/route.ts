import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { invalidateFlagCache } from '../../../../lib/feature-flags';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { getProtection, type FlagProtection } from '@alfanumrik/lib/flags/protected-flags';
import { featureFlagSchema, validateBody, zUuid } from '../../../../lib/validation';
import { z } from 'zod';

/**
 * Feature Flags API — supports global, per-institution, per-role, per-environment scoping.
 *
 * DB columns: id, flag_name, is_enabled, rollout_percentage, target_grades,
 *             target_institutions, target_roles, target_environments,
 *             description, updated_by, created_at, updated_at
 *
 * Protected-flag guardrail (2026-07-20 console bulk-enable incident):
 * flags listed in @alfanumrik/lib/flags/protected-flags require an explicit
 * typed confirmation (body.confirm === the exact flag_name) before any
 * mutation that makes them MORE enabled (PATCH), before deletion (DELETE),
 * and before re-creation under a protected name (POST — prevents the
 * delete-recreate bypass). Missing/mismatched confirm → 409 FLAG_PROTECTED
 * BEFORE any DB write or audit row. Disabling stays confirm-free (kill
 * switches must stay fast) EXCEPT the special_do_not_touch / p11_payment
 * tiers (e.g. ff_atomic_subscription_activation is a payment safety device —
 * disabling it also requires confirm).
 */

/** 409 body for a protected-flag mutation attempted without typed confirmation. */
function protectedFlagResponse(flagName: string, protection: FlagProtection): NextResponse {
  return NextResponse.json(
    {
      error: `"${flagName}" is a protected flag (${protection.tier}). To proceed, resend the request with body field "confirm" set to the exact flag name.`,
      code: 'FLAG_PROTECTED',
      tier: protection.tier,
      reason: protection.reason,
      confirm_required: flagName,
    },
    { status: 409 },
  );
}

// GET — list all flags
export async function GET(request: NextRequest) {
  // Phase G.1: reading the flag list is OK at support level.
  const auth = await authorizeAdmin(request, 'support');
  if (!auth.authorized) return auth.response;

  try {
    const params = new URL(request.url).searchParams;
    const search = params.get('search');

    // Query-param pagination. Default limit 500 (the table currently holds ~180
    // rows, so the default returns everything); hard cap 1000. The previous
    // hard-coded limit=100 silently truncated the flag list in the UI.
    const rawLimit = parseInt(params.get('limit') || '', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 1000) : 500;
    const rawOffset = parseInt(params.get('offset') || '', 10);
    const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

    const fields = 'id,flag_name,is_enabled,rollout_percentage,target_grades,target_institutions,target_roles,target_environments,description,created_at,updated_at';
    const queryParts = [`select=${fields}`, 'order=created_at.desc', `limit=${limit}`, `offset=${offset}`];
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
  // Phase G.1: creating a flag (and any subsequent rollout it gates) is a
  // platform-wide change. super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();

    // Validate with Zod schema — structured 400 errors for invalid input
    const createSchema = featureFlagSchema.extend({
      // POST uses 'name' in body, map to flag_name for validation.
      // Real flags look like ff_school_pulse_v1 — digits are legal, but the
      // name must start with a letter.
      name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'Flag name must start with a lowercase letter and contain only lowercase letters, digits, and underscores'),
      enabled: z.boolean().optional(),
      description: z.string().max(500).nullable().optional(),
      // Protected-flag guardrail: typed confirmation (must equal the flag name).
      confirm: z.string().optional(),
    }).omit({ flag_name: true, is_enabled: true });

    const validation = validateBody(createSchema, body);
    if (!validation.success) return validation.error;

    const { name, enabled, description, rollout_percentage, target_institutions, target_roles, target_environments, confirm } = validation.data;

    // Protected-flag guardrail: creating a flag under a protected NAME requires
    // the typed confirmation (prevents the delete-recreate bypass). Checked
    // BEFORE any DB I/O or audit.
    const createProtection = getProtection(name);
    if (createProtection && confirm !== name) {
      return protectedFlagResponse(name, createProtection);
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
      // 0-rollout landmine: the DB column defaults rollout_percentage to 0, and
      // the web evaluator (packages/lib/src/feature-flags.ts) returns FALSE for
      // rollout_percentage=0 even when is_enabled=true. Always set it explicitly
      // (100 unless the caller provided a validated 0-100 value) so a newly
      // created flag can actually turn on when enabled.
      rollout_percentage: typeof rollout_percentage === 'number' ? rollout_percentage : 100,
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
    await logAdminAudit(auth, 'feature_flag.created', 'feature_flags', flagId || '', {
      name,
      enabled,
      ...(createProtection ? { protected_confirmed: true } : {}),
    });
    invalidateFlagCache();

    logOpsEvent({
      category: 'deploy',
      source: 'feature-flags/route.ts',
      severity: 'info',
      message: `Feature flag created: ${name}`,
      context: { flag_name: name, enabled: enabled === true, admin_user_id: auth.userId },
    });

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH — update a flag (toggle, scoping, description)
export async function PATCH(request: NextRequest) {
  // Phase G.1: flipping target_grades/target_institutions/target_roles/
  // target_environments/rollout_percentage is a platform-wide change.
  // super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();

    // Validate patch payload structure
    const patchSchema = z.object({
      id: zUuid,
      updates: z.object({
        enabled: z.boolean().optional(),
        name: z.string().min(1).max(100).regex(/^[a-z][a-z0-9_]*$/, 'Flag name must start with a lowercase letter and contain only lowercase letters, digits, and underscores').optional(),
        description: z.string().max(500).nullable().optional(),
        rollout_percentage: z.number().int().min(0).max(100).nullable().optional(),
        target_grades: z.array(z.string()).nullable().optional(),
        target_institutions: z.array(zUuid).nullable().optional(),
        target_roles: z.array(z.string()).nullable().optional(),
        target_environments: z.array(z.string()).nullable().optional(),
      }).refine(obj => Object.keys(obj).length > 0, { message: 'At least one field must be provided in updates' }),
      // Protected-flag guardrail: typed confirmation (must equal the flag name).
      confirm: z.string().optional(),
    });

    const validation = validateBody(patchSchema, body);
    if (!validation.success) return validation.error;

    const { id, updates, confirm } = validation.data;

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

    // ── Protected-flag guardrail (2026-07-20 incident) ──────────────────────
    // If the target flag is protected and this update would make it MORE
    // enabled (enabled=true, or a rollout_percentage > 0), require the typed
    // confirmation body.confirm === the exact flag_name. Disabling stays
    // confirm-free (kill switches must stay fast) EXCEPT the
    // special_do_not_touch / p11_payment tiers, where disabling is ALSO gated
    // (ff_atomic_subscription_activation is a payment safety device).
    // 409 is returned BEFORE any DB write or audit row.
    // Known seam: if the previous-state read above failed, the flag name is
    // unknown and this gate cannot fire — the nightly flag-posture-canary cron
    // is the drift backstop for that path.
    let protectedConfirmed = false;
    const patchFlagName = typeof previousState?.flag_name === 'string' ? previousState.flag_name : null;
    if (patchFlagName) {
      const protection = getProtection(patchFlagName);
      if (protection) {
        const makingMoreEnabled =
          updates.enabled === true ||
          (typeof updates.rollout_percentage === 'number' && updates.rollout_percentage > 0);
        const disableGated =
          updates.enabled === false &&
          (protection.tier === 'special_do_not_touch' || protection.tier === 'p11_payment');
        if (makingMoreEnabled || disableGated) {
          if (confirm !== patchFlagName) {
            return protectedFlagResponse(patchFlagName, protection);
          }
          protectedConfirmed = true;
        }
      }
    }

    // 0-rollout landmine: rollout_percentage has a DB DEFAULT of 0, and the web
    // evaluator (packages/lib/src/feature-flags.ts) returns FALSE whenever
    // rollout_percentage is 0 — even with is_enabled=true. So toggling a flag
    // "on" while it still sits at 0% would silently keep it OFF for everyone.
    // When the caller enables a flag WITHOUT explicitly sending a
    // rollout_percentage and the current value is 0, promote it to 100.
    // A non-zero rollout (e.g. an intentional 10% ramp) is NEVER touched.
    // C1 (ops review): track whether the promotion fired so the audit trail
    // reflects what was ACTUALLY written, not just what the caller sent.
    let rolloutPromoted = false;
    if (
      updates.enabled === true &&
      updates.rollout_percentage === undefined &&
      previousState?.rollout_percentage === 0
    ) {
      safe.rollout_percentage = 100;
      rolloutPromoted = true;
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

    // C1 (ops review): `updates` is what the caller SENT; `effective_updates`
    // is what was actually WRITTEN (the mapped payload minus the updated_by/
    // updated_at bookkeeping columns) — the two differ when the 0→100 rollout
    // auto-promotion fires. Additive keys only; existing keys unchanged.
    const effectiveUpdates = Object.fromEntries(
      Object.entries(safe).filter(([k]) => k !== 'updated_by' && k !== 'updated_at'),
    );

    await logAdminAudit(auth, 'feature_flag.updated', 'feature_flags', id, {
      updates,
      effective_updates: effectiveUpdates,
      rollout_promoted: rolloutPromoted,
      previous_state: previousState,
      flag_name: previousState?.flag_name || null,
      ...(protectedConfirmed ? { protected_confirmed: true } : {}),
    });
    invalidateFlagCache();

    logOpsEvent({
      category: 'deploy',
      source: 'feature-flags/route.ts',
      severity: 'info',
      message: `Feature flag updated: ${previousState?.flag_name || id}`,
      context: {
        flag_id: id,
        updates,
        effective_updates: effectiveUpdates,
        rollout_promoted: rolloutPromoted,
        admin_user_id: auth.userId,
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// DELETE — hard delete a flag
export async function DELETE(request: NextRequest) {
  // Phase G.1: hard-deleting a flag — super_admin only.
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = await request.json();

    const deleteSchema = z.object({
      id: zUuid,
      // Protected-flag guardrail: typed confirmation (must equal the flag name).
      confirm: z.string().optional(),
    });
    const validation = validateBody(deleteSchema, body);
    if (!validation.success) return validation.error;

    const { id, confirm } = validation.data;

    // ── Protected-flag guardrail (2026-07-20 incident) ──────────────────────
    // Deleting a protected flag requires the same typed confirmation as
    // enabling it (a deleted row could otherwise be re-created unprotected, or
    // its absence could change evaluator behavior). Read-only name lookup
    // first; 409 BEFORE the DELETE write or audit row.
    let deleteProtectedConfirmed = false;
    try {
      const nameRes = await fetch(supabaseAdminUrl('feature_flags', `select=flag_name&id=eq.${encodeURIComponent(id)}&limit=1`), {
        headers: supabaseAdminHeaders(),
      });
      if (nameRes.ok) {
        const rows = await nameRes.json();
        const flagName = Array.isArray(rows) && rows.length > 0 ? rows[0]?.flag_name : null;
        if (typeof flagName === 'string') {
          const protection = getProtection(flagName);
          if (protection) {
            if (confirm !== flagName) {
              return protectedFlagResponse(flagName, protection);
            }
            deleteProtectedConfirmed = true;
          }
        }
      }
    } catch { /* name lookup best-effort; the posture canary is the drift backstop */ }

    const res = await fetch(supabaseAdminUrl('feature_flags', `id=eq.${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: supabaseAdminHeaders('return=representation'),
    });

    if (!res.ok) return NextResponse.json({ error: 'Delete failed' }, { status: res.status });

    const deleted = await res.json();
    if (Array.isArray(deleted) && deleted.length === 0) {
      return NextResponse.json({ error: 'Flag not found.' }, { status: 404 });
    }

    await logAdminAudit(auth, 'feature_flag.deleted', 'feature_flags', id, {
      deleted: deleted[0],
      ...(deleteProtectedConfirmed ? { protected_confirmed: true } : {}),
    });
    invalidateFlagCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
