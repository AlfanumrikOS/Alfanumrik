import { NextRequest, NextResponse } from 'next/server';
import { requireAdminSecret, logAdminAction } from '@alfanumrik/lib/admin-auth';
import { getSupabaseAdmin } from '@alfanumrik/lib/supabase-admin';
import { invalidateFlagCache } from '@alfanumrik/lib/feature-flags';
import { getProtection } from '@alfanumrik/lib/flags/protected-flags';

// Protected-flag guardrail parity fix (backend review, Phase 0 follow-up
// 2026-07-22): this route mutates feature_flags directly via the x-admin-secret
// shared-secret gate (requireAdminSecret), which is a WEAKER, non-admin-tier
// credential than the super_admin session check on
// apps/host/src/app/api/super-admin/feature-flags/route.ts. Before this fix it
// had NO awareness of the protected-flags registry at all:
//   - POST (INSERT) is not covered by the DB-layer trg_protect_feature_flags
//     trigger (BEFORE UPDATE only), so it could create a brand-new row under a
//     protected/reserved name pre-enabled, bypassing every guardrail
//     (the "delete-recreate"-class bypass the console POST handler already
//     defends against, but this route never did).
//   - PATCH on an EXISTING protected row is still blocked from becoming MORE
//     enabled by the DB trigger (it fires regardless of caller), so that half
//     was never exploitable — but this route had no typed-confirmation or
//     burst-guard parity and would return a raw, unhandled Postgres trigger
//     error to the caller.
// Rather than duplicating the confirm/burst-guard machinery here, this route
// now simply REFUSES to touch a protected flag at all: use the hardened
// super-admin console route for any protected-flag mutation.

export const runtime = 'nodejs';

// GET /api/internal/admin/feature-flags — list all flags
export async function GET(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  // NB: the column is flag_name — ordering by the nonexistent `name` column
  // made this query error for every caller.
  const { data, error } = await supabase
    .from('feature_flags')
    .select('*')
    .order('flag_name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data });
}

// POST /api/internal/admin/feature-flags — create flag
export async function POST(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const body = await request.json();
    const { name, description, is_enabled, rollout_percentage, target_grades, target_roles } = body;

    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    // Protected-flag guardrail parity (2026-07-22): refuse to create a row
    // under a protected/reserved name from this weaker-authed path. INSERT is
    // not covered by trg_protect_feature_flags (BEFORE UPDATE only), so
    // without this check a caller could pre-enable a protected flag here.
    const createProtection = getProtection(name);
    if (createProtection) {
      return NextResponse.json(
        {
          error: `"${name}" is a protected flag (${createProtection.tier}). Protected flags must be created/enabled via the super-admin console (/api/super-admin/feature-flags), which enforces typed confirmation and burst-rate limiting.`,
          code: 'FLAG_PROTECTED',
          tier: createProtection.tier,
        },
        { status: 403 },
      );
    }

    // Column is flag_name, not `name` — inserting `name` failed on the live
    // schema. rollout_percentage is set explicitly (defaulting to 100) because
    // the DB default is 0 and the evaluator treats 0% as OFF even when enabled.
    const { data, error } = await supabase.from('feature_flags').insert({
      flag_name: name,
      description: description || '',
      is_enabled: is_enabled ?? false,
      rollout_percentage: rollout_percentage ?? 100,
      target_grades: target_grades || null,
      target_roles: target_roles || null,
    }).select().single();

    if (error) throw error;

    invalidateFlagCache();
    await logAdminAction({ action: 'create_feature_flag', entity_type: 'feature_flag', entity_id: data.id, details: { name }, ip });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}

// PATCH /api/internal/admin/feature-flags — update flag
export async function PATCH(request: NextRequest) {
  const denied = requireAdminSecret(request);
  if (denied) return denied;

  const supabase = getSupabaseAdmin();
  const ip = request.headers.get('x-forwarded-for') || '';

  try {
    const { id, ...updates } = await request.json();
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const ALLOWED = ['is_enabled', 'rollout_percentage', 'target_grades', 'target_roles', 'description'];
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (ALLOWED.includes(k)) safe[k] = v;
    }

    // Protected-flag guardrail parity (2026-07-22): if this row is a
    // registered protected flag, refuse is_enabled/rollout_percentage changes
    // from this weaker-authed path — even though trg_protect_feature_flags
    // would also block a make-more-enabled transition at the DB layer, that
    // would surface as a raw, unhandled Postgres trigger error here rather
    // than a clean 403, and this route has no typed-confirmation/burst-guard
    // parity with the console route. Non-protected flags and description/
    // target_* edits on protected flags are unaffected.
    if ('is_enabled' in safe || 'rollout_percentage' in safe) {
      const { data: existing } = await supabase
        .from('feature_flags')
        .select('flag_name')
        .eq('id', id)
        .maybeSingle();
      const currentName = existing?.flag_name;
      if (typeof currentName === 'string') {
        const protection = getProtection(currentName);
        if (protection) {
          return NextResponse.json(
            {
              error: `"${currentName}" is a protected flag (${protection.tier}). Enable/rollout changes must go through the super-admin console (/api/super-admin/feature-flags), which enforces typed confirmation and burst-rate limiting.`,
              code: 'FLAG_PROTECTED',
              tier: protection.tier,
            },
            { status: 403 },
          );
        }
      }
    }

    const { error } = await supabase.from('feature_flags').update(safe).eq('id', id);
    if (error) throw error;

    invalidateFlagCache();
    await logAdminAction({ action: 'update_feature_flag', entity_type: 'feature_flag', entity_id: id, details: safe, ip });
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
