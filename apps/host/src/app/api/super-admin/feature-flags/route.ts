import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@alfanumrik/lib/logger';
import { authorizeAdmin, logAdminAudit, supabaseAdminHeaders, supabaseAdminUrl } from '../../../../lib/admin-auth';
import { invalidateFlagCache } from '../../../../lib/feature-flags';
import { logOpsEvent } from '@alfanumrik/lib/ops-events';
import { getProtection, type FlagProtection } from '@alfanumrik/lib/flags/protected-flags';
import { featureFlagSchema, validateBody, zUuid } from '../../../../lib/validation';
import { z } from 'zod';
import type { AdminAuth } from '../../../../lib/admin-auth';

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
 *
 * Phase 0 flag-governance hardening (2026-07-22, master action plan items
 * 0.4/0.5/0.10/0.11) — two additive layers on top of the above:
 *
 * 1. DB-routed writes for GATED protected mutations. A PATCH that requires
 *    (and receives) the typed confirmation now writes via the
 *    `admin_flip_feature_flag` SECURITY DEFINER RPC (migration
 *    20260722090200) instead of a raw PostgREST PATCH. The RPC re-validates
 *    the confirm, arms the `app.protected_flag_ack` session GUC for the
 *    transaction, performs the UPDATE, and writes an admin_audit_log row —
 *    all atomically. This is what makes the DB-layer BEFORE UPDATE trigger
 *    (`trg_protect_feature_flags`, migration 20260722090100) actually
 *    permit the write: a raw PATCH to a gated transition would now be
 *    REJECTED by that trigger, since only this RPC sets the ack GUC.
 *    UNGATED protected-flag mutations (description-only edits, or disabling
 *    a non-payment-safety tier) are UNCHANGED — they keep using the fast
 *    raw-PATCH path, because the trigger permits those transitions
 *    unconditionally and routing them through the RPC would needlessly force
 *    a typed confirmation the existing contract does not require (see
 *    feature-flags-protected-guardrail.test.ts: "description-only update on
 *    a PROTECTED flag needs no confirm"). Non-protected flags are entirely
 *    unaffected in every direction.
 *
 * 2. Velocity / burst guard. If the SAME admin has made more than
 *    `BURST_THRESHOLD` (3) CONFIRMED protected-flag mutations in the
 *    trailing `BURST_WINDOW_MS` (10 minutes) — counted from admin_audit_log,
 *    the same durable trail every protected mutation already writes to — the
 *    4th and later mutation in that window additionally requires the body
 *    field `bulk_confirm` to equal the exact token `BULK-<ordinal>-<flag_name>`
 *    (`ordinal` = this mutation's 1-indexed position in the burst, e.g. the
 *    4th mutation needs `bulk_confirm: "BULK-4-ff_school_pulse_v1"`). Missing
 *    or wrong token → 409 FLAG_BULK_CONFIRM_REQUIRED, ZERO DB writes, and a
 *    distinct `feature_flag.bulk_mutation_burst` audit action (so the burst
 *    ATTEMPT itself is durably logged even when it is refused). This is the
 *    guardrail the 2026-07-20 incident (49 flags flipped in one bulk action)
 *    would have tripped after the 3rd flag. Applies uniformly to PATCH,
 *    DELETE, and POST-under-a-protected-name, since all three are viable
 *    bulk-flip vectors.
 *
 * 3. Every protected-flag audit payload now carries a `tier` field
 *    (previously only `previous_state`/`updates` were logged) so the audit
 *    trail is self-describing without a join back to protected-flags.ts.
 */

// ── Phase 0 burst guard (2026-07-22) ─────────────────────────────────────────

const BURST_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const BURST_THRESHOLD = 3; // 1st–3rd confirmed protected mutation in the window: no extra gate

/** Actions counted as a "confirmed protected-flag mutation" for burst purposes. */
const PROTECTED_MUTATION_ACTIONS = [
  'feature_flag.created',
  'feature_flag.updated',
  'feature_flag.deleted',
  'feature_flag.protected_flip_rpc',
] as const;

/**
 * Count this admin's CONFIRMED protected-flag mutations in the trailing
 * burst window, read from admin_audit_log (the same durable trail every
 * protected mutation already writes to — see logAdminAudit). Fail-OPEN on a
 * read error (returns 0): a transient audit-log read failure must never
 * block a legitimate single-flag emergency action; the nightly
 * flag-posture-canary remains the drift backstop either way.
 */
async function countRecentProtectedMutations(adminUserId: string): Promise<number> {
  const since = new Date(Date.now() - BURST_WINDOW_MS).toISOString();
  try {
    const actionFilter = `in.(${PROTECTED_MUTATION_ACTIONS.join(',')})`;
    const res = await fetch(
      supabaseAdminUrl(
        'admin_audit_log',
        `select=id&admin_id=eq.${encodeURIComponent(adminUserId)}` +
          `&action=${actionFilter}` +
          `&created_at=gte.${encodeURIComponent(since)}` +
          `&details->>protected_confirmed=eq.true`,
      ),
      { headers: supabaseAdminHeaders('count=exact'), method: 'HEAD' },
    );
    if (!res.ok) return 0;
    const range = res.headers.get('content-range');
    if (!range) return 0;
    const total = parseInt(range.split('/')[1] || '0', 10);
    return Number.isFinite(total) ? total : 0;
  } catch {
    return 0;
  }
}

function bulkConfirmToken(ordinal: number, flagName: string): string {
  return `BULK-${ordinal}-${flagName}`;
}

interface BurstGuardResult {
  /** Set when the burst guard blocks the request — return this response as-is. */
  blocked: NextResponse | null;
  /** This mutation's 1-indexed ordinal within the trailing window (for audit). */
  ordinal: number;
}

/**
 * Enforces the velocity/burst guard for a CONFIRMED protected-flag mutation.
 * Call this ONLY after the normal typed-confirmation check has already
 * passed (this guard is a SECOND gate on top of, not instead of, the
 * per-flag confirm).
 */
async function enforceBurstGuard(
  auth: AdminAuth,
  flagName: string,
  bulkConfirm: string | undefined,
): Promise<BurstGuardResult> {
  const priorCount = await countRecentProtectedMutations(auth.userId);
  const ordinal = priorCount + 1;
  if (ordinal <= BURST_THRESHOLD) return { blocked: null, ordinal };

  const expected = bulkConfirmToken(ordinal, flagName);
  if (bulkConfirm === expected) return { blocked: null, ordinal };

  // Log the burst ATTEMPT itself — distinct action, so a refused burst is
  // still durably visible in the audit trail (not just the eventual success).
  await logAdminAudit(auth, 'feature_flag.bulk_mutation_burst', 'feature_flags', flagName, {
    flag_name: flagName,
    attempted_ordinal: ordinal,
    recent_mutation_count: priorCount,
    window_minutes: BURST_WINDOW_MS / 60000,
    bulk_confirm_required: expected,
  });

  return {
    ordinal,
    blocked: NextResponse.json(
      {
        error:
          `You have made ${priorCount} confirmed protected-flag mutation(s) in the last ` +
          `${BURST_WINDOW_MS / 60000} minutes. To proceed with mutation #${ordinal}, resend the ` +
          `request with body field "bulk_confirm" set to "${expected}".`,
        code: 'FLAG_BULK_CONFIRM_REQUIRED',
        bulk_confirm_required: expected,
        recent_mutation_count: priorCount,
      },
      { status: 409 },
    ),
  };
}

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

/**
 * Best-effort mapping of an admin_flip_feature_flag RPC failure to an HTTP
 * status, without leaking internal error text to the caller. The RPC's own
 * confirm check is defense-in-depth (the route already validated
 * confirm === flagName before calling it), so FLAG_CONFIRM_MISMATCH here
 * would indicate a logic bug rather than a normal caller error.
 */
function rpcErrorStatus(errorText: string): number {
  if (errorText.includes('FLAG_NOT_FOUND')) return 404;
  if (errorText.includes('FLAG_CONFIRM_MISMATCH')) return 409;
  return 500;
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
      // Phase 0 burst guard: only relevant once the per-admin burst threshold
      // is exceeded (see enforceBurstGuard).
      bulk_confirm: z.string().optional(),
    }).omit({ flag_name: true, is_enabled: true });

    const validation = validateBody(createSchema, body);
    if (!validation.success) return validation.error;

    const { name, enabled, description, rollout_percentage, target_institutions, target_roles, target_environments, confirm, bulk_confirm } = validation.data;

    // Protected-flag guardrail: creating a flag under a protected NAME requires
    // the typed confirmation (prevents the delete-recreate bypass). Checked
    // BEFORE any DB I/O or audit.
    const createProtection = getProtection(name);
    if (createProtection && confirm !== name) {
      return protectedFlagResponse(name, createProtection);
    }

    // Phase 0 burst guard: only reached once the per-flag confirm has already
    // passed, so this is a SECOND gate on a genuinely confirmed protected
    // creation.
    let createBurstOrdinal: number | null = null;
    if (createProtection) {
      const burst = await enforceBurstGuard(auth, name, bulk_confirm);
      if (burst.blocked) return burst.blocked;
      createBurstOrdinal = burst.ordinal;
    }
    void createBurstOrdinal; // recorded via logAdminAudit below, not otherwise used

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
      ...(createProtection ? { protected_confirmed: true, tier: createProtection.tier } : {}),
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
      // Phase 0 burst guard: only relevant once the per-admin burst threshold
      // is exceeded (see enforceBurstGuard).
      bulk_confirm: z.string().optional(),
    });

    const validation = validateBody(patchSchema, body);
    if (!validation.success) return validation.error;

    const { id, updates, confirm, bulk_confirm } = validation.data;

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
    let protectionTier: string | null = null;
    const patchFlagName = typeof previousState?.flag_name === 'string' ? previousState.flag_name : null;
    if (patchFlagName) {
      const protection = getProtection(patchFlagName);
      if (protection) {
        // Rename-bypass guard (backend review, Phase 0 follow-up 2026-07-22):
        // renaming a protected flag is a BYPASS vector, not merely a gated
        // transition. protected_feature_flags and the DB trigger
        // (trg_protect_feature_flags) both key protection strictly off
        // flag_name, so a rename to an unregistered name would let a SECOND,
        // unconfirmed PATCH freely enable the (now-unprotected-by-name) row —
        // defeating both this app-layer gate and the DB-layer trigger. The
        // admin_flip_feature_flag RPC (migration 20260722090200) also has no
        // CASE for flag_name in its UPDATE, so even routing a "confirmed"
        // rename through the RPC would silently drop the name change while
        // reporting success. Block outright rather than gate-and-silently-drop.
        //
        // FINAL (architect decision, 2026-07-22 — this is not a placeholder;
        // do not reopen without a new architect review): permanent-block is
        // the correct, permanent posture. Rename support for a protected flag
        // was considered and REJECTED, because:
        //   1. Flag identity is load-bearing in application CODE, not just
        //      this table — dozens of call sites reference a flag_name as a
        //      hardcoded string constant (e.g. ADAPTIVE_REMEDIATION_FLAGS.V1,
        //      ADAPTIVE_LOOPS_BC_FLAGS.V1, DIGITAL_TWIN_FLAGS.V1 in
        //      packages/lib/src/feature-flags.ts). A runtime admin rename
        //      cannot atomically update those call sites; every reader still
        //      using the old string would evaluate against a name that no
        //      longer exists, and per this app's convention that fails safe
        //      to "disabled" — an availability regression with no code
        //      deploy to explain it.
        //   2. protected_feature_flags.flag_name is deliberately NOT
        //      FK'd to feature_flags.flag_name (a name can be pre-registered
        //      before the flag row exists). A rename RPC would therefore need
        //      to rename BOTH rows in the same transaction and would still
        //      leave every historical admin_audit_log / audit_logs row that
        //      recorded the OLD name orphaned for reporting — a forensic-
        //      trail cost with no offsetting product benefit.
        //   3. There is no legitimate product need for a protected flag to be
        //      renamed at runtime. Every protected tier (p0_outage,
        //      p11_payment, ai_provider, constitution_pinned,
        //      special_do_not_touch, staged_rollout) exists precisely because
        //      the flag is high-blast-radius; a genuine rename (e.g.
        //      correcting a pre-launch typo) should go through the SAME
        //      review rigor as the original protection — a migration
        //      updating both tables plus a code PR updating every reference
        //      — not a self-service console action.
        // Conclusion: this 409 stays permanent. If a rename is ever genuinely
        // needed, do it via a hand-authored migration (rename in
        // feature_flags AND protected_feature_flags in one transaction) paired
        // with a code PR updating every flag_name reference — never via this
        // route or the admin_flip_feature_flag RPC.
        if (typeof updates.name === 'string' && updates.name !== patchFlagName) {
          return NextResponse.json(
            {
              error: `"${patchFlagName}" is a protected flag (${protection.tier}) and cannot be renamed. Renaming would let the row escape protected-flag tracking (protection is keyed by flag_name).`,
              code: 'FLAG_RENAME_BLOCKED',
              tier: protection.tier,
            },
            { status: 409 },
          );
        }

        protectionTier = protection.tier;
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

    // Phase 0 burst guard (2026-07-22): a SECOND gate, only reached once the
    // per-flag confirm above has already passed. Not applied to ungated
    // protected mutations (description-only edits, safe disables) — those
    // never set protectedConfirmed and are not the incident's bulk-flip
    // vector.
    if (protectedConfirmed && patchFlagName) {
      const burst = await enforceBurstGuard(auth, patchFlagName, bulk_confirm);
      if (burst.blocked) return burst.blocked;
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

    // C1 (ops review): `updates` is what the caller SENT; `effective_updates`
    // is what was actually WRITTEN (the mapped payload minus the updated_by/
    // updated_at bookkeeping columns) — the two differ when the 0→100 rollout
    // auto-promotion fires. Additive keys only; existing keys unchanged.
    // Computed BEFORE the write so both the RPC path (which needs it as the
    // p_updates argument) and the raw-PATCH path (which needs it for the
    // audit row) share the identical value.
    const effectiveUpdates = Object.fromEntries(
      Object.entries(safe).filter(([k]) => k !== 'updated_by' && k !== 'updated_at'),
    );

    // ── Phase 0 write routing (2026-07-22) ───────────────────────────────────
    // A GATED-and-CONFIRMED protected mutation writes via the
    // admin_flip_feature_flag RPC (arms app.protected_flag_ack so
    // trg_protect_feature_flags permits the write). Everything else
    // (unprotected flags, or protected-but-ungated updates) keeps the
    // existing raw-PATCH fast path — see the file-header note for why.
    let updated: unknown;
    if (protectedConfirmed && patchFlagName) {
      const rpcRes = await fetch(supabaseAdminUrl('rpc/admin_flip_feature_flag'), {
        method: 'POST',
        headers: supabaseAdminHeaders(),
        body: JSON.stringify({
          p_flag_name: patchFlagName,
          p_updates: effectiveUpdates,
          p_confirm: confirm,
          // p_actor_id must be admin_users.id (the PK), not the Supabase Auth
          // user id (auth.userId / admin_users.auth_user_id). The RPC writes
          // p_actor_id verbatim into admin_audit_log.admin_id, which has an FK
          // to admin_users.id -- passing auth.userId caused a class-23 FK
          // violation (Postgres -> PostgREST 409), aborting the whole RPC
          // transaction (including the flag UPDATE) and surfacing as a
          // generic 500 because the error text didn't match either substring
          // rpcErrorStatus() recognizes. Fixed 2026-07-22.
          p_actor_id: auth.adminId,
        }),
      });
      if (!rpcRes.ok) {
        const text = await rpcRes.text();
        const mappedStatus = rpcErrorStatus(text);
        // Observability (2026-07-22): rpcErrorStatus() only recognizes two
        // substrings (FLAG_NOT_FOUND, FLAG_CONFIRM_MISMATCH) and defaults
        // everything else to 500 -- previously that default was silent, so a
        // genuine, unrecognized Supabase/PostgREST error (e.g. a real
        // constraint violation distinct from our own FLAG_CONFIRM_MISMATCH
        // 409) was indistinguishable from an unknown failure in the logs.
        // Always log the upstream status + response text so an unmapped
        // error is diagnosable from the first occurrence, not just after a
        // human happens to check the Vercel Function Invocation log by hand.
        logger.error('feature_flags_rpc_write_failed', {
          route: 'super-admin/feature-flags',
          flag_name: patchFlagName,
          upstream_status: rpcRes.status,
          mapped_status: mappedStatus,
          recognized: mappedStatus !== 500,
          rpc_error_text: text.slice(0, 2000),
        });
        return NextResponse.json({ error: 'Update failed' }, { status: mappedStatus });
      }
      const rpcRow = await rpcRes.json(); // admin_flip_feature_flag RETURNS jsonb (a single object)
      updated = [rpcRow]; // normalize to the same array shape the raw-PATCH path returns
    } else {
      const res = await fetch(supabaseAdminUrl('feature_flags', `id=eq.${encodeURIComponent(id)}`), {
        method: 'PATCH',
        headers: supabaseAdminHeaders('return=representation'),
        body: JSON.stringify(safe),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        logger.error('feature_flags_patch_write_failed', {
          route: 'super-admin/feature-flags',
          flag_id: id,
          upstream_status: res.status,
          error_text: text.slice(0, 2000),
        });
        return NextResponse.json({ error: 'Update failed' }, { status: res.status });
      }

      updated = await res.json();
      if (Array.isArray(updated) && updated.length === 0) {
        return NextResponse.json({ error: 'Flag not found.' }, { status: 404 });
      }
    }

    await logAdminAudit(auth, 'feature_flag.updated', 'feature_flags', id, {
      updates,
      effective_updates: effectiveUpdates,
      rollout_promoted: rolloutPromoted,
      previous_state: previousState,
      flag_name: previousState?.flag_name || null,
      ...(protectedConfirmed ? { protected_confirmed: true } : {}),
      ...(protectionTier ? { tier: protectionTier } : {}),
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
      // Phase 0 burst guard: only relevant once the per-admin burst threshold
      // is exceeded (see enforceBurstGuard).
      bulk_confirm: z.string().optional(),
    });
    const validation = validateBody(deleteSchema, body);
    if (!validation.success) return validation.error;

    const { id, confirm, bulk_confirm } = validation.data;

    // ── Protected-flag guardrail (2026-07-20 incident) ──────────────────────
    // Deleting a protected flag requires the same typed confirmation as
    // enabling it (a deleted row could otherwise be re-created unprotected, or
    // its absence could change evaluator behavior). Read-only name lookup
    // first; 409 BEFORE the DELETE write or audit row.
    let deleteProtectedConfirmed = false;
    let deleteTier: string | null = null;
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
            deleteTier = protection.tier;
            if (confirm !== flagName) {
              return protectedFlagResponse(flagName, protection);
            }
            deleteProtectedConfirmed = true;

            // Phase 0 burst guard: a SECOND gate, only reached once the
            // per-flag confirm has already passed.
            const burst = await enforceBurstGuard(auth, flagName, bulk_confirm);
            if (burst.blocked) return burst.blocked;
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
      ...(deleteTier ? { tier: deleteTier } : {}),
    });
    invalidateFlagCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal error' }, { status: 500 });
  }
}
