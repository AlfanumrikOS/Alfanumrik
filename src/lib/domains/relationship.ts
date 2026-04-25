/**
 * Relationship Domain — parent ↔ student links.
 *
 * Owns guardian_student_links. Provides typed read APIs that the parent
 * portal, support tooling, and child-progress endpoints consume instead of
 * touching the table directly.
 *
 * CONTRACT:
 *   - Server-only. Imports supabase-admin and bypasses RLS deliberately;
 *     callers are expected to have authenticated the request first
 *     (authorizeRequest, requireAdminSecret, or an explicit auth.getUser
 *     check) and to pass through the resulting authUserId / guardianId.
 *   - Reads only. Writes (approve/reject/revoke) stay in the route handlers
 *     until the broader Phase 0c follow-up. Mixing read+write here would
 *     widen the blast radius beyond what this extraction can verify.
 *   - Returns ServiceResult<T>. null is a successful "not found" for
 *     single-row lookups; an empty array is a successful empty result for
 *     list endpoints. Reserve NOT_FOUND for callers that opt into 404 semantics.
 *   - Never `select('*')`. Map raw snake_case rows to the camelCase domain
 *     type once, here, so callers stop depending on database column names.
 *
 * MICROSERVICE EXTRACTION PATH:
 *   This module is the candidate for the second extracted service after
 *   identity. Wrap each helper in an HTTP handler with JWT validation, and
 *   the parent / school-admin / support routes call it via HTTP instead of
 *   import. The ServiceResult<T> shape is already the wire contract.
 *
 * See docs/architecture/MICROSERVICES_EXTRACTION_PLAN.md (Phase 0c).
 */

import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/lib/logger';
import {
  ok,
  fail,
  ACTIVE_GUARDIAN_LINK_STATUSES,
  type ServiceResult,
  type GuardianLinkStatus,
  type GuardianStudentLink,
  type ChildSummary,
  type GuardianSummary,
} from './types';

// ── Row shapes & mappers ──────────────────────────────────────────────────────

type LinkRow = {
  id: string;
  guardian_id: string;
  student_id: string;
  status: string | null;
  permission_level: string | null;
  is_verified: boolean | null;
  linked_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

const LINK_COLUMNS =
  'id, guardian_id, student_id, status, permission_level, is_verified, linked_at, created_at, updated_at';

function coerceStatus(raw: string | null): GuardianLinkStatus {
  // Defensive coercion: the DB column is plain TEXT, so an unexpected value
  // shouldn't blow up the type system. Treat anything we don't recognise as
  // 'pending' (the safest default — it grants no access).
  switch (raw) {
    case 'pending':
    case 'approved':
    case 'active':
    case 'rejected':
    case 'revoked':
      return raw;
    default:
      return 'pending';
  }
}

function mapLink(row: LinkRow): GuardianStudentLink {
  return {
    id: row.id,
    guardianId: row.guardian_id,
    studentId: row.student_id,
    status: coerceStatus(row.status),
    permissionLevel: row.permission_level,
    isVerified: row.is_verified,
    linkedAt: row.linked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Guardian resolution helper (private) ──────────────────────────────────────

/**
 * Resolve a guardian's primary key from their auth_user_id.
 * Returns null when no guardian profile exists for the account — callers
 * choose how to surface that (403 vs 404).
 */
async function resolveGuardianId(
  authUserId: string
): Promise<ServiceResult<string | null>> {
  const { data, error } = await supabaseAdmin
    .from('guardians')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    logger.error('relationship_guardian_lookup_failed', {
      error: new Error(error.message),
      authUserId,
    });
    return fail(`Guardian lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? (data.id as string) : null);
}

// ── Public read APIs ──────────────────────────────────────────────────────────

/**
 * List the children currently linked to a guardian, projected for parent
 * dashboards. Returns rows for any link in an active status (approved or
 * active — see ACTIVE_GUARDIAN_LINK_STATUSES) so legacy demo-flow rows
 * surface alongside the modern approval flow.
 *
 * Empty array is a successful empty result, not an error.
 */
export async function listChildrenForGuardian(
  guardianAuthUserId: string
): Promise<ServiceResult<ChildSummary[]>> {
  if (!guardianAuthUserId) {
    return fail('guardianAuthUserId is required', 'INVALID_INPUT');
  }

  const guardianRes = await resolveGuardianId(guardianAuthUserId);
  if (!guardianRes.ok) return guardianRes;
  if (guardianRes.data == null) return ok([]);
  const guardianId = guardianRes.data;

  const { data, error } = await supabaseAdmin
    .from('guardian_student_links')
    .select(
      'id, status, linked_at, students!inner(id, name, grade, school_id)'
    )
    .eq('guardian_id', guardianId)
    .in('status', ACTIVE_GUARDIAN_LINK_STATUSES as unknown as string[]);

  if (error) {
    logger.error('relationship_list_children_failed', {
      error: new Error(error.message),
      guardianId,
    });
    return fail(`Children lookup failed: ${error.message}`, 'DB_ERROR');
  }

  type Row = {
    id: string;
    status: string | null;
    linked_at: string | null;
    // Supabase returns inner-joined relations as either object or array
    // depending on the FK shape. guardian_student_links.student_id is a
    // single FK, so this should always be a single object — but we accept
    // both shapes defensively to dodge any client-codegen drift.
    students:
      | { id: string; name: string | null; grade: string | number | null; school_id: string | null }
      | { id: string; name: string | null; grade: string | number | null; school_id: string | null }[]
      | null;
  };

  const rows = (data ?? []) as Row[];

  const result: ChildSummary[] = rows
    .map((row): ChildSummary | null => {
      const s = Array.isArray(row.students) ? row.students[0] : row.students;
      if (!s) return null;
      return {
        studentId: s.id,
        name: s.name,
        // Invariant P5: grades are strings.
        grade: s.grade == null ? null : String(s.grade),
        schoolId: s.school_id,
        linkId: row.id,
        linkStatus: coerceStatus(row.status),
        linkedAt: row.linked_at,
      };
    })
    .filter((r): r is ChildSummary => r !== null);

  return ok(result);
}

/**
 * List the guardians currently linked to a student, projected for support
 * tooling and admin profile pages. Includes any link in an active status.
 */
export async function listGuardiansForStudent(
  studentId: string
): Promise<ServiceResult<GuardianSummary[]>> {
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('guardian_student_links')
    .select(
      'id, status, linked_at, guardians!inner(id, name, email, phone)'
    )
    .eq('student_id', studentId)
    .in('status', ACTIVE_GUARDIAN_LINK_STATUSES as unknown as string[]);

  if (error) {
    logger.error('relationship_list_guardians_failed', {
      error: new Error(error.message),
      studentId,
    });
    return fail(`Guardians lookup failed: ${error.message}`, 'DB_ERROR');
  }

  type Row = {
    id: string;
    status: string | null;
    linked_at: string | null;
    guardians:
      | { id: string; name: string | null; email: string | null; phone: string | null }
      | { id: string; name: string | null; email: string | null; phone: string | null }[]
      | null;
  };

  const rows = (data ?? []) as Row[];

  const result: GuardianSummary[] = rows
    .map((row): GuardianSummary | null => {
      const g = Array.isArray(row.guardians) ? row.guardians[0] : row.guardians;
      if (!g) return null;
      return {
        guardianId: g.id,
        name: g.name,
        email: g.email,
        phone: g.phone,
        linkId: row.id,
        linkStatus: coerceStatus(row.status),
        linkedAt: row.linked_at,
      };
    })
    .filter((r): r is GuardianSummary => r !== null);

  return ok(result);
}

/**
 * Find a guardian_student_links row by its link_code (the short code a
 * guardian enters to claim a student). Returns null when no match — the
 * approve flow then surfaces a generic 404 to avoid leaking which codes
 * exist.
 */
export async function findLinkByCode(
  linkCode: string
): Promise<ServiceResult<GuardianStudentLink | null>> {
  if (!linkCode) return fail('linkCode is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('guardian_student_links')
    .select(LINK_COLUMNS)
    .eq('link_code', linkCode)
    .maybeSingle();

  if (error) {
    logger.error('relationship_find_link_by_code_failed', {
      error: new Error(error.message),
    });
    return fail(`Link lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapLink(data as LinkRow) : null);
}

/**
 * Find a single guardian_student_links row by primary key. The companion
 * lookup used by approve-link / reject-link before they apply a write.
 *
 * If `expectedStatus` is provided, the row is only returned when its
 * status matches — useful for "find a pending request" without a separate
 * status check at the call site.
 */
export async function findLinkById(
  linkId: string,
  expectedStatus?: GuardianLinkStatus
): Promise<ServiceResult<GuardianStudentLink | null>> {
  if (!linkId) return fail('linkId is required', 'INVALID_INPUT');

  let query = supabaseAdmin
    .from('guardian_student_links')
    .select(LINK_COLUMNS)
    .eq('id', linkId);

  if (expectedStatus) {
    query = query.eq('status', expectedStatus);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    logger.error('relationship_find_link_by_id_failed', {
      error: new Error(error.message),
      linkId,
    });
    return fail(`Link lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(data ? mapLink(data as LinkRow) : null);
}

/**
 * Check whether a guardian is currently linked to a student in any active
 * status (approved or active). The boolean form is kept narrow on purpose —
 * route handlers that need 403 vs 200 don't care about the link metadata.
 */
export async function isGuardianLinkedToStudent(
  guardianId: string,
  studentId: string
): Promise<ServiceResult<boolean>> {
  if (!guardianId) return fail('guardianId is required', 'INVALID_INPUT');
  if (!studentId) return fail('studentId is required', 'INVALID_INPUT');

  const { data, error } = await supabaseAdmin
    .from('guardian_student_links')
    .select('id')
    .eq('guardian_id', guardianId)
    .eq('student_id', studentId)
    .in('status', ACTIVE_GUARDIAN_LINK_STATUSES as unknown as string[])
    .limit(1)
    .maybeSingle();

  if (error) {
    logger.error('relationship_is_linked_failed', {
      error: new Error(error.message),
      guardianId,
      studentId,
    });
    return fail(`Link check failed: ${error.message}`, 'DB_ERROR');
  }

  return ok(Boolean(data));
}

/**
 * List pending link requests addressed to a guardian's auth user. Powers
 * the parent inbox / "approve these requests" panel.
 */
export async function listPendingLinksForGuardian(
  guardianAuthUserId: string
): Promise<ServiceResult<GuardianStudentLink[]>> {
  if (!guardianAuthUserId) {
    return fail('guardianAuthUserId is required', 'INVALID_INPUT');
  }

  const guardianRes = await resolveGuardianId(guardianAuthUserId);
  if (!guardianRes.ok) return guardianRes;
  if (guardianRes.data == null) return ok([]);
  const guardianId = guardianRes.data;

  const { data, error } = await supabaseAdmin
    .from('guardian_student_links')
    .select(LINK_COLUMNS)
    .eq('guardian_id', guardianId)
    .eq('status', 'pending');

  if (error) {
    logger.error('relationship_list_pending_links_failed', {
      error: new Error(error.message),
      guardianId,
    });
    return fail(`Pending links lookup failed: ${error.message}`, 'DB_ERROR');
  }

  return ok((data ?? []).map((r) => mapLink(r as LinkRow)));
}
