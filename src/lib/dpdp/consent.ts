/**
 * src/lib/dpdp/consent.ts — DPDP parental-consent domain helpers.
 *
 * Phase D.1. India's Digital Personal Data Protection (DPDP) Act
 * requires explicit, verifiable consent from a parent/guardian before
 * we process a child's personal data. This module is the single point
 * where consent is recorded, revoked, and checked.
 *
 * CONTRACT:
 *   - Server-only. Imports supabase-admin and bypasses RLS so the
 *     API route can write authoritatively after it has verified the
 *     caller is the linked guardian. RLS on `parental_consent` exists
 *     as defense-in-depth (see migration 20260527000004); the canonical
 *     write path runs through here.
 *   - Returns ServiceResult<T> — matches src/lib/domains/* convention.
 *     Null is a successful "no active row" for `hasActiveConsent`; an
 *     empty array is a successful empty result for listings.
 *   - Never mutates a revoked row's consent_payload. Revocation is a
 *     soft delete: revoked_at = now(); the historical scopes/payload
 *     stay intact for audit.
 *
 * The current policy version (CURRENT_CONSENT_VERSION) is bumped when
 * the consent text materially changes — the gate code (ParentShell)
 * re-prompts when a guardian's active row is older than this constant.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import { ok, fail, type ServiceResult } from '@/lib/domains/types';

// ── Constants & types ────────────────────────────────────────────────────

/**
 * The active policy version. Bump (e.g. 'v1-2026-05' → 'v2-2026-07')
 * when consent text materially changes; the gate re-prompts every
 * guardian whose active row carries an older version.
 */
export const CURRENT_CONSENT_VERSION = 'v1-2026-05';

/**
 * Scopes a guardian may grant. Each scope is opt-in. The first two are
 * required for the platform to function (no curriculum access = nothing
 * to render); marketing_emails is genuinely optional.
 *
 * Keep this list in sync with the UI in src/app/link/[code]/consent/page.tsx
 * and the runtime guard in `recordConsent`.
 */
export const CONSENT_SCOPES = [
  'curriculum_access',
  'performance_data_sharing_with_teacher',
  'marketing_emails',
] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

export interface ConsentPayload {
  scopes: Partial<Record<ConsentScope, boolean>>;
  locale: 'en' | 'hi';
}

export interface ParentalConsentRow {
  id: string;
  guardianId: string;
  studentId: string;
  consentVersion: string;
  grantedAt: string;
  revokedAt: string | null;
  payload: ConsentPayload;
}

// ── Row shape & mapper ──────────────────────────────────────────────────

type DbRow = {
  id: string;
  guardian_id: string;
  student_id: string;
  consent_version: string;
  granted_at: string;
  revoked_at: string | null;
  consent_payload: ConsentPayload | null;
};

const COLUMNS = 'id, guardian_id, student_id, consent_version, granted_at, revoked_at, consent_payload';

function mapRow(row: DbRow): ParentalConsentRow {
  return {
    id: row.id,
    guardianId: row.guardian_id,
    studentId: row.student_id,
    consentVersion: row.consent_version,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    payload: row.consent_payload ?? { scopes: {}, locale: 'en' },
  };
}

// ── Public API ──────────────────────────────────────────────────────────

export interface RecordConsentInput {
  guardianId: string;
  studentId: string;
  consentVersion: string;
  scopes: Partial<Record<ConsentScope, boolean>>;
  locale?: 'en' | 'hi';
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Record a parental consent grant. Inserts a row with revoked_at = NULL
 * (active). Returns the new row's id.
 *
 * Callers (the API route) MUST verify the guardian is actually linked
 * to the student before invoking — this function does not re-check
 * ownership.
 *
 * If an active row already exists for (guardian, student), the unique
 * constraint `parental_consent_unique_active` rejects the insert. The
 * caller should either revoke first (consent_version bump) or detect
 * the existing row via `hasActiveConsent` and skip.
 */
export async function recordConsent(
  input: RecordConsentInput
): Promise<ServiceResult<string>> {
  if (!input.guardianId) return fail('guardianId is required', 'INVALID_INPUT');
  if (!input.studentId) return fail('studentId is required', 'INVALID_INPUT');
  if (!input.consentVersion) return fail('consentVersion is required', 'INVALID_INPUT');

  // Defense-in-depth: reject unknown scopes at the boundary so a
  // forged payload can't slip into the audit trail.
  for (const k of Object.keys(input.scopes)) {
    if (!(CONSENT_SCOPES as readonly string[]).includes(k)) {
      return fail(`Unknown consent scope: ${k}`, 'INVALID_INPUT');
    }
  }

  const payload: ConsentPayload = {
    scopes: input.scopes,
    locale: input.locale ?? 'en',
  };

  const { data, error } = await supabaseAdmin
    .from('parental_consent')
    .insert({
      guardian_id: input.guardianId,
      student_id: input.studentId,
      consent_version: input.consentVersion,
      consent_payload: payload,
      ip_address: input.ipAddress ?? null,
      user_agent: input.userAgent ?? null,
    })
    .select('id')
    .single();

  if (error) {
    // 23505 = unique_violation on (guardian_id, student_id, revoked_at).
    // Surface as CONFLICT so the route can return 409 if it wants.
    if ((error as { code?: string }).code === '23505') {
      return fail('Active consent already exists for this guardian/student pair', 'CONFLICT');
    }
    logger.error('parental_consent_insert_failed', {
      error: new Error(error.message),
      guardianId: input.guardianId,
      studentId: input.studentId,
    });
    return fail(`Consent insert failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data.id as string);
}

export interface RevokeConsentInput {
  guardianId: string;
  studentId: string;
}

/**
 * Revoke the active consent row for a (guardian, student) pair. Sets
 * revoked_at = now() on the existing row. Returns the revoked row's id
 * (or NOT_FOUND if there is no active row).
 *
 * Soft delete: the historical row stays intact for audit.
 */
export async function revokeConsent(
  input: RevokeConsentInput
): Promise<ServiceResult<string>> {
  if (!input.guardianId) return fail('guardianId is required', 'INVALID_INPUT');
  if (!input.studentId) return fail('studentId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('parental_consent')
    .update({ revoked_at: new Date().toISOString() })
    .eq('guardian_id', input.guardianId)
    .eq('student_id', input.studentId)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  if (error) {
    logger.error('parental_consent_revoke_failed', {
      error: new Error(error.message),
      guardianId: input.guardianId,
      studentId: input.studentId,
    });
    return fail(`Consent revoke failed: ${error.message}`, 'DB_ERROR');
  }

  if (!data) {
    return fail('No active consent found to revoke', 'NOT_FOUND');
  }

  return ok(data.id as string);
}

export interface HasActiveConsentInput {
  guardianId: string;
  studentId: string;
  /**
   * If set, only consider the consent "active" when the stored
   * consent_version matches. Pass CURRENT_CONSENT_VERSION to force
   * re-prompt on policy bumps.
   */
  requiredVersion?: string;
}

/**
 * Returns true when a non-revoked consent row exists for the
 * (guardian, student) pair. When requiredVersion is supplied, the
 * stored consent_version must match exactly.
 *
 * Used by the ParentShell gate to decide whether to redirect to the
 * consent capture screen.
 */
export async function hasActiveConsent(
  input: HasActiveConsentInput
): Promise<ServiceResult<boolean>> {
  if (!input.guardianId) return fail('guardianId is required', 'INVALID_INPUT');
  if (!input.studentId) return fail('studentId is required', 'INVALID_INPUT');

  let query = supabaseAdmin
    .from('parental_consent')
    .select('id, consent_version')
    .eq('guardian_id', input.guardianId)
    .eq('student_id', input.studentId)
    .is('revoked_at', null);

  if (input.requiredVersion) {
    query = query.eq('consent_version', input.requiredVersion);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.error('parental_consent_active_lookup_failed', {
      error: new Error(error.message),
      guardianId: input.guardianId,
      studentId: input.studentId,
    });
    return fail(`Consent lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(!!data);
}

/**
 * List the caller's active consent rows. Used by the parent profile
 * surface and the gate to figure out which children still need a prompt.
 */
export async function listActiveConsentForGuardian(
  guardianId: string
): Promise<ServiceResult<ParentalConsentRow[]>> {
  if (!guardianId) return fail('guardianId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('parental_consent')
    .select(COLUMNS)
    .eq('guardian_id', guardianId)
    .is('revoked_at', null);

  if (error) {
    logger.error('parental_consent_list_failed', {
      error: new Error(error.message),
      guardianId,
    });
    return fail(`Consent list failed: ${error.message}`, 'DB_ERROR');
  }

  const rows = (data ?? []) as DbRow[];
  return ok(rows.map(mapRow));
}
