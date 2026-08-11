/**
 * Shared authorization + ownership-scoping helpers for the end-user support
 * ticket API (`/api/support/tickets` and `/api/support/tickets/[id]`).
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The list route (`../tickets/route.ts`) and the detail route
 * (`../tickets/[id]/route.ts`) MUST scope reads identically. They did not: the
 * list route narrowed on BOTH `student_id` AND `user_role`, while the detail
 * route filtered on `student_id` alone. Because a guardian's ticket is anchored
 * to the CHILD's `student_id` with `user_role='parent'`, that asymmetry let a
 * student open a ticket their parent had filed about them. Harmless-ish while a
 * ticket was a single frozen message; a P13 disclosure of the whole support
 * conversation (refunds, escalations, behavioural concerns) once
 * `support_ticket_replies` exists.
 *
 * Both routes now derive their scope from `applyTicketOwnershipScope()` here, so
 * the two can no longer drift apart.
 *
 * P8: every caller of these helpers uses the service-role client, which BYPASSES
 * RLS. The RLS policies on `support_tickets` / `support_ticket_replies` are a
 * backstop only — the filters returned by this module ARE the enforcement.
 *
 * P9: authorization is `authorizeRequest()` only. No raw `auth.getUser()`, no
 * new permission codes.
 */

import type { NextRequest } from 'next/server';
import { authorizeRequest, type AuthorizationResult } from '@alfanumrik/lib/rbac';
import { getGuardianByAuthUserId } from '@alfanumrik/lib/domains/identity';
import { listChildrenForGuardian } from '@alfanumrik/lib/domains/relationship';

export interface TicketAuthResult {
  auth: AuthorizationResult;
  /** True when the caller was authorized through the guardian permission path. */
  isGuardianPath: boolean;
}

/**
 * Authorize a support-ticket request. Tries 'foxy.chat' (student), then
 * 'child.view_progress' (parent). Returns the first successful result, or the
 * foxy.chat error response when neither passes (so an unauthenticated caller
 * still gets a clean 401).
 *
 * `foxy.chat` is a STUDENT grant. Verified against
 * `supabase/migrations/20260612123200_rbac_matrix_conformance.sql`: it appears
 * in the `student` grant list (:223) and in no other role's — the `teacher`
 * list (:247-252) does not contain it. So the two rungs here admit exactly
 * students and guardians; a teacher holds neither code and is refused at
 * authorization, before any scope is resolved.
 */
export async function authorizeTicketRequest(
  request: NextRequest,
): Promise<TicketAuthResult> {
  const foxy = await authorizeRequest(request, 'foxy.chat');
  if (foxy.authorized) return { auth: foxy, isGuardianPath: false };

  const parent = await authorizeRequest(request, 'child.view_progress');
  if (parent.authorized) return { auth: parent, isGuardianPath: true };

  // Neither permission held. Prefer the parent error when the caller IS
  // authenticated but unauthorized (403); otherwise the foxy 401.
  return {
    auth: foxy.userId ? parent : foxy,
    isGuardianPath: false,
  };
}

/**
 * Resolve the set of student_ids a guardian is linked to (active links only).
 * Returns [] when the caller is not a guardian or has no active links.
 */
export async function resolveGuardianChildStudentIds(
  authUserId: string,
): Promise<string[]> {
  const guardianRes = await getGuardianByAuthUserId(authUserId);
  if (!guardianRes.ok || !guardianRes.data) return [];
  const childrenRes = await listChildrenForGuardian(authUserId);
  if (!childrenRes.ok) return [];
  return childrenRes.data.map((c) => c.studentId);
}

/**
 * The role anchor a caller's tickets carry in `support_tickets.user_role`.
 * A caller may only ever read/write threads matching their OWN anchor.
 */
export type TicketRoleAnchor = 'student' | 'parent';

export type TicketScope =
  | {
      ok: true;
      /** `user_role` value this caller's tickets are tagged with. */
      roleAnchor: TicketRoleAnchor;
      /** student_id values this caller may reach. Always non-empty. */
      studentIds: string[];
    }
  | {
      /**
       * The caller holds a support permission but has no listable/readable
       * anchor at all (teacher with no student anchor, guardian with no linked
       * child, student with no profile row). Callers return an empty list or a
       * 404 — never a 403, so ticket existence is not leaked.
       */
      ok: false;
      reason: 'no_anchor';
    };

/**
 * Resolve the (role anchor, student_id set) pair a caller is allowed to touch.
 *
 * This is the single cross-role data boundary for the support surface:
 *   - guardian: their linked children's student_ids, `user_role='parent'`
 *   - student : their own student_id,               `user_role='student'`
 *   - teacher / anyone with no student anchor: no_anchor
 *
 * Both halves are mandatory. Filtering on student_id alone is the exact defect
 * this module was created to make unrepresentable.
 */
export async function resolveTicketScope(
  auth: AuthorizationResult,
  isGuardianPath: boolean,
): Promise<TicketScope> {
  if (isGuardianPath) {
    if (!auth.userId) return { ok: false, reason: 'no_anchor' };
    const childIds = await resolveGuardianChildStudentIds(auth.userId);
    if (childIds.length === 0) return { ok: false, reason: 'no_anchor' };
    return { ok: true, roleAnchor: 'parent', studentIds: childIds };
  }

  if (!auth.studentId) return { ok: false, reason: 'no_anchor' };
  return { ok: true, roleAnchor: 'student', studentIds: [auth.studentId] };
}

/**
 * Minimal structural view of a PostgREST filter builder. Declared locally and
 * applied via a cast rather than as a generic CONSTRAINT: constraining `Q` to
 * this shape makes tsc walk Supabase's fully-generic builder types and blow up
 * with TS2589 ("type instantiation is excessively deep") on the list query,
 * which also carries `{ count: 'exact' }`. The cast is safe — both methods
 * exist on every PostgrestFilterBuilder and return the same builder.
 */
interface ScopableQuery {
  in(column: string, values: readonly string[]): ScopableQuery;
  eq(column: string, value: string): ScopableQuery;
}

/**
 * Apply a resolved scope to a PostgREST query builder.
 *
 * `Q` is unconstrained so the caller's builder type (list query with a count
 * option, or the single-row detail query) passes straight through and keeps
 * `.order()` / `.range()` / `.maybeSingle()` available on the result.
 *
 * BOTH filters are applied here and nowhere else. That is the entire point:
 * `student_id` alone was the bug.
 */
export function applyTicketOwnershipScope<Q>(
  query: Q,
  scope: Extract<TicketScope, { ok: true }>,
): Q {
  const scoped = (query as unknown as ScopableQuery)
    .in('student_id', scope.studentIds)
    .eq('user_role', scope.roleAnchor);
  return scoped as unknown as Q;
}
