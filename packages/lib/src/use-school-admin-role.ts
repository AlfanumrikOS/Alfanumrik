/**
 * useSchoolAdminRole — resolves the CALLER'S own `school_admins.role` for the
 * active school, for Phase 3B Wave C role-aware nav/capability gating.
 *
 * Source: a client-side, RLS-respecting read of the caller's OWN school_admins
 * row (baseline policy "School admins can view own record":
 *   SELECT … USING (auth_user_id = auth.uid())
 * ). This is the SAME self-read the school-admin pages already perform to
 * resolve their school_id (see invite-codes/page.tsx bootstrap), now extended to
 * read `role`. It works for ALL FOUR roles (each reads only their own row) and
 * needs NO new backend endpoint.
 *
 * This is a UI-convenience source ONLY (P9): server-side authorizeSchoolAdmin
 * already enforces the role→permission matrix when `ff_school_admin_rbac` is ON,
 * so nav hiding is UX polish, not a security boundary. The hook resolves to
 * `null` while loading / on failure / when the caller is not a school admin, and
 * callers MUST fail-open (show everything) on `null` to avoid hiding legitimate
 * nav for a transient read failure.
 *
 * The fetch is deliberately unconditional on any flag: it is cheap, additive,
 * and the consumers only USE the result when `ff_school_admin_rbac` is ON. (The
 * staff page itself is rendered only when the flag is on; the nav gating is a
 * no-op while the flag is off — see ConsolidatedSchoolNav.)
 */

import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { SchoolAdminRole } from './school-admin-auth';

export type { SchoolAdminRole };

export interface SchoolAdminRoleState {
  /** The caller's school_admins.role, or null (loading / failure / not an admin). */
  role: SchoolAdminRole | null;
  /**
   * The caller's own school_admins.id, or null. Lets the staff list mark the
   * caller's own row "(you)" with a precise id match (no PII / email needed).
   */
  selfAdminId: string | null;
  loading: boolean;
}

const VALID_ROLES: ReadonlySet<string> = new Set<string>([
  'principal',
  'vice_principal',
  'academic_coordinator',
  'institution_admin',
]);

/**
 * React hook: returns the caller's own `school_admins.role` (or null).
 *
 * @param authUserId The authenticated user id (from useAuth). When null/undefined
 *   the hook stays in its initial null/loading state and issues no query.
 */
export function useSchoolAdminRole(authUserId: string | null | undefined): SchoolAdminRoleState {
  const [role, setRole] = useState<SchoolAdminRole | null>(null);
  const [selfAdminId, setSelfAdminId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!authUserId) {
      setRole(null);
      setSelfAdminId(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await supabase
          .from('school_admins')
          .select('id, role')
          .eq('auth_user_id', authUserId)
          .eq('is_active', true)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data || typeof data.role !== 'string' || !VALID_ROLES.has(data.role)) {
          // Fail-open: leave role null so consumers show everything.
          setRole(null);
          setSelfAdminId(null);
        } else {
          setRole(data.role as SchoolAdminRole);
          setSelfAdminId(typeof data.id === 'string' ? data.id : null);
        }
      } catch {
        if (!cancelled) {
          setRole(null);
          setSelfAdminId(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authUserId]);

  return { role, selfAdminId, loading };
}
