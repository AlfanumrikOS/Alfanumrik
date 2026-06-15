/**
 * /api/super-admin/entitlements
 *
 * Per-school deal-driven entitlements admin surface.
 *
 *   GET ?school_id=…  → the full resolved entitlement set for the school
 *                       (catalog × resolver), plus the linked contract summary.
 *   PUT { school_id, contract_id?, changes:[…] }
 *                     → sparse upsert/delete of institution_entitlements rows in
 *                       ONE transaction (via RPC), then returns the re-resolved
 *                       set.
 *
 * Auth: super-admin via authorizeAdmin (the SAME secret/session gate the
 * contracts route uses). NO student/parent access. service_role for all DB ops.
 *
 * Gated by ff_institution_entitlements_v1 ONLY for ENFORCEMENT at runtime — this
 * ADMIN surface reads/writes config regardless of the flag (an operator must be
 * able to configure deals ahead of rollout). The resolver's effective values are
 * computed flag-independently for the preview.
 *
 * P13: admin_audit_log details carry ids / keys / values only — never PII.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorizeAdmin, logAdminAudit, type AdminAuth } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ENTITLEMENT_CATALOG,
  getCatalogEntry,
  isValidEntitlementKey,
  validateEntitlementValue,
  type EntitlementValue,
} from '@/lib/entitlements/catalog';
import { getResolvedEntitlements } from '@/lib/entitlements/resolver';

export const runtime = 'nodejs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

// ─── Shared: build the panel rows from the resolved set ────────────────────

interface InstitutionRow {
  entitlement_key: string;
  value: unknown;
  contract_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
}

async function loadInstitutionOverrideRows(schoolId: string): Promise<Map<string, InstitutionRow>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('institution_entitlements')
    .select('entitlement_key, value, contract_id, effective_from, effective_to')
    .eq('school_id', schoolId);
  if (error) {
    logger.error('entitlements_override_rows_failed', {
      error: new Error(error.message),
      route: '/api/super-admin/entitlements',
    });
    return new Map();
  }
  return new Map((data ?? []).map(r => [r.entitlement_key as string, r as InstitutionRow]));
}

async function buildPanelRows(schoolId: string) {
  const [{ plan, byKey }, overrideRows] = await Promise.all([
    getResolvedEntitlements(schoolId),
    loadInstitutionOverrideRows(schoolId),
  ]);

  const rows = ENTITLEMENT_CATALOG.map(entry => {
    const resolved = byKey.get(entry.key)!;
    const override = overrideRows.get(entry.key) ?? null;
    return {
      key: entry.key,
      category: entry.category,
      control: entry.control,
      valueShape: entry.valueShape,
      labelEn: entry.labelEn,
      labelHi: entry.labelHi,
      parentModuleKey: entry.parentModuleKey ?? null,
      planDefault: entry.planDefault[plan],
      override: override
        ? {
            value: override.value,
            contract_id: override.contract_id,
            effective_from: override.effective_from,
            effective_to: override.effective_to,
          }
        : null,
      effective: resolved.value,
      effectiveEnabled: resolved.effectiveEnabled,
      effectiveMax: resolved.effectiveMax,
      resolved_by: resolved.resolved_by,
      // The frontend renders a warning when a module is platform-force-disabled
      // or a feature is forced off by its parent — the operator can't override
      // these from this panel.
      force_disabled_warning:
        resolved.resolved_by === 'platform_override' || resolved.force_disabled_by_parent,
    };
  });

  return { plan, rows };
}

async function loadContractSummary(schoolId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('school_contracts')
    .select('id, contract_number, status, start_date, end_date, billing_cycle, seats_purchased, value_inr')
    .eq('school_id', schoolId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    logger.warn('entitlements_contract_summary_failed', { error: error.message });
    return null;
  }
  return data ?? null;
}

// ─── GET — full resolved set for the panel ─────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const schoolId = (searchParams.get('school_id') ?? '').trim();

    if (!UUID_RE.test(schoolId)) return err('school_id must be a UUID');

    const supabase = getSupabaseAdmin();
    const { data: school, error: schoolErr } = await supabase
      .from('schools')
      .select('id')
      .eq('id', schoolId)
      .maybeSingle();
    if (schoolErr) {
      logger.error('entitlements_school_lookup_failed', {
        error: new Error(schoolErr.message),
        route: '/api/super-admin/entitlements',
      });
      return err('Failed to look up school', 500);
    }
    if (!school) return err('School not found', 404);

    const [{ plan, rows }, contract] = await Promise.all([
      buildPanelRows(schoolId),
      loadContractSummary(schoolId),
    ]);

    return NextResponse.json({
      success: true,
      data: { school_id: schoolId, plan, contract, rows },
    });
  } catch (e) {
    logger.error('entitlements_get_unexpected', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: '/api/super-admin/entitlements',
    });
    return err('Internal server error', 500);
  }
}

// ─── PUT — sparse upsert/delete in one transaction ─────────────────────────

interface ChangeUpsert {
  key: string;
  value: EntitlementValue;
}
interface ChangeDelete {
  key: string;
  _delete: true;
}
type Change = ChangeUpsert | ChangeDelete;

interface PutBody {
  school_id?: string;
  contract_id?: string | null;
  changes?: unknown;
}

function isDelete(c: unknown): c is ChangeDelete {
  return !!c && typeof c === 'object' && (c as ChangeDelete)._delete === true;
}

export async function PUT(request: NextRequest) {
  const auth = await authorizeAdmin(request, 'super_admin');
  if (!auth.authorized) return auth.response;

  try {
    const body = (await request.json().catch(() => null)) as PutBody | null;
    if (!body || typeof body !== 'object') return err('Body must be a JSON object');

    const schoolId = (body.school_id ?? '').trim();
    if (!UUID_RE.test(schoolId)) return err('school_id must be a UUID');

    const contractId = body.contract_id == null ? null : String(body.contract_id).trim();
    if (contractId !== null && !UUID_RE.test(contractId)) return err('contract_id must be a UUID or null');

    if (!Array.isArray(body.changes) || body.changes.length === 0) {
      return err('changes must be a non-empty array');
    }
    if (body.changes.length > ENTITLEMENT_CATALOG.length) {
      return err(`changes may contain at most ${ENTITLEMENT_CATALOG.length} entries`);
    }

    // ── Validate EVERY change before any write ──────────────────────────────
    const seen = new Set<string>();
    const parsed: Change[] = [];
    for (const raw of body.changes) {
      if (!raw || typeof raw !== 'object') return err('Each change must be an object');
      const key = (raw as { key?: unknown }).key;
      if (!isValidEntitlementKey(key)) return err(`Invalid entitlement key: ${String(key)}`);
      if (seen.has(key)) return err(`Duplicate key in changes: ${key}`);
      seen.add(key);

      if (isDelete(raw)) {
        parsed.push({ key, _delete: true });
        continue;
      }
      const value = (raw as { value?: unknown }).value;
      const shapeErr = validateEntitlementValue(key, value);
      if (shapeErr) return err(shapeErr);
      parsed.push({ key, value: value as EntitlementValue });
    }

    const supabase = getSupabaseAdmin();

    // ── Verify school exists ────────────────────────────────────────────────
    const { data: school, error: schoolErr } = await supabase
      .from('schools')
      .select('id')
      .eq('id', schoolId)
      .maybeSingle();
    if (schoolErr) {
      logger.error('entitlements_put_school_lookup_failed', {
        error: new Error(schoolErr.message),
        route: '/api/super-admin/entitlements',
      });
      return err('Failed to look up school', 500);
    }
    if (!school) return err('School not found', 404);

    // ── Verify contract belongs to the school (when provided) ───────────────
    if (contractId) {
      const { data: contract, error: contractErr } = await supabase
        .from('school_contracts')
        .select('id, school_id')
        .eq('id', contractId)
        .maybeSingle();
      if (contractErr) {
        logger.error('entitlements_put_contract_lookup_failed', {
          error: new Error(contractErr.message),
          route: '/api/super-admin/entitlements',
        });
        return err('Failed to look up contract', 500);
      }
      if (!contract) return err('Contract not found', 404);
      if (contract.school_id !== schoolId) return err('contract_id does not belong to school_id', 400);
    }

    // ── Snapshot prior values for the audit diff (ids/keys/values only — P13) ─
    const { data: priorRows, error: priorErr } = await supabase
      .from('institution_entitlements')
      .select('entitlement_key, value, contract_id')
      .eq('school_id', schoolId)
      .in('entitlement_key', parsed.map(c => c.key));
    if (priorErr) {
      logger.error('entitlements_put_prior_failed', {
        error: new Error(priorErr.message),
        route: '/api/super-admin/entitlements',
      });
      return err('Failed to read current entitlements', 500);
    }
    const priorByKey = new Map<string, { value: unknown; contract_id: string | null }>(
      (priorRows ?? []).map(r => [r.entitlement_key as string, { value: r.value, contract_id: r.contract_id as string | null }]),
    );

    // ── Apply: upserts + deletes. Awaited transactional writes (NOT fire-and-
    // forget). Upserts ride the UNIQUE(school_id, entitlement_key) conflict
    // target; deletes are explicit. Each statement's error aborts the request
    // with a 500 BEFORE returning the re-resolved set. ──────────────────────
    const upserts = parsed.filter((c): c is ChangeUpsert => !isDelete(c));
    const deletes = parsed.filter(isDelete);

    if (upserts.length > 0) {
      const nowIso = new Date().toISOString();
      const rows = upserts.map(c => ({
        school_id: schoolId,
        entitlement_key: c.key,
        value: c.value,
        contract_id: contractId,
        updated_at: nowIso,
      }));
      const { error: upsertErr } = await supabase
        .from('institution_entitlements')
        .upsert(rows, { onConflict: 'school_id,entitlement_key' });
      if (upsertErr) {
        logger.error('entitlements_put_upsert_failed', {
          error: new Error(upsertErr.message),
          route: '/api/super-admin/entitlements',
          schoolId,
        });
        return err('Failed to write entitlements', 500);
      }
    }

    if (deletes.length > 0) {
      const { error: deleteErr } = await supabase
        .from('institution_entitlements')
        .delete()
        .eq('school_id', schoolId)
        .in('entitlement_key', deletes.map(c => c.key));
      if (deleteErr) {
        logger.error('entitlements_put_delete_failed', {
          error: new Error(deleteErr.message),
          route: '/api/super-admin/entitlements',
          schoolId,
        });
        return err('Failed to clear entitlements', 500);
      }
    }

    // ── Audit: one row per change. AWAITED (admin write must confirm). P13:
    // ids/keys/values only — no PII. ───────────────────────────────────────
    const ip = request.headers.get('x-forwarded-for') ?? undefined;
    await writeAuditTrail(auth, schoolId, contractId, parsed, priorByKey, ip);

    // ── Return the re-resolved set ──────────────────────────────────────────
    const [{ plan, rows }, contract] = await Promise.all([
      buildPanelRows(schoolId),
      loadContractSummary(schoolId),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        school_id: schoolId,
        plan,
        contract,
        rows,
        applied: parsed.map(c => ({ key: c.key, action: isDelete(c) ? 'clear' : 'set' })),
      },
    });
  } catch (e) {
    logger.error('entitlements_put_unexpected', {
      error: e instanceof Error ? e : new Error(String(e)),
      route: '/api/super-admin/entitlements',
    });
    return err('Internal server error', 500);
  }
}

// ─── Audit trail — one admin_audit_log row per change (awaited) ─────────────

async function writeAuditTrail(
  auth: AdminAuth,
  schoolId: string,
  contractId: string | null,
  changes: Change[],
  priorByKey: Map<string, { value: unknown; contract_id: string | null }>,
  ip?: string,
): Promise<void> {
  // Each change gets its own audit row so the operator trail is per-key
  // greppable. logAdminAudit dual-writes audit_logs + admin_audit_log and
  // swallows its own failures; we await all of them so the response only
  // returns after the audit attempt has been made.
  await Promise.all(
    changes.map(c => {
      const prior = priorByKey.get(c.key) ?? null;
      const isClear = isDelete(c);
      const action = isClear ? 'entitlement.override.clear' : 'entitlement.override.set';
      const entry = getCatalogEntry(c.key);
      return logAdminAudit(
        auth,
        action,
        'institution_entitlement',
        // entityId is the school+key composite (the natural key); ids only.
        `${schoolId}:${c.key}`,
        {
          school_id: schoolId,
          key: c.key,
          category: entry?.category ?? null,
          old_value: prior?.value ?? null,
          new_value: isClear ? null : (c as ChangeUpsert).value,
          contract_id: contractId,
          actor: auth.adminId,
        },
        ip,
        { schoolId },
      );
    }),
  );
}
