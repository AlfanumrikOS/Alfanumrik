'use client';

/**
 * useSchoolAdminAuth — consolidates the `school_admins` lookup + login-redirect
 * guard that was previously copy-pasted (with minor drift) across 15+
 * `/school-admin/**` pages (RCA finding, 2026-07-20). Every migrated page used
 * the same three-step shape:
 *   1. redirect to /login once AuthContext resolves with no authUserId
 *   2. query `school_admins` for the caller's own active row
 *   3. redirect to /login again if the row is missing/erroring, else expose
 *      `school_id` (+ occasionally `name`/`email`/`role`) to the page body
 *
 * This hook is that pattern, factored once. It mirrors the DOMINANT
 * redirect-on-missing-row behavior used by the majority of school-admin pages
 * (classes, students, teachers, exams, content, enroll, invite-codes, parents,
 * reports, setup, announcements, api-keys, audit-log, billing).
 *
 * NOT migrated: `school-admin/rbac/page.tsx` intentionally keeps its own inline
 * guard — it shows an in-page error banner instead of redirecting when the
 * caller isn't a school admin, a deliberate UX difference this hook does not
 * reproduce (folding it in would silently change that page's behavior).
 *
 * Sibling to `@alfanumrik/lib/school-admin/school-admin-context.tsx`, which
 * resolves schoolId ONCE at the shell level for nav branding. This hook is
 * independent of that context (pages call it directly) so it keeps working for
 * any school-admin page regardless of shell wiring, and returns the richer
 * `admin` record (name/email/role) some pages need beyond schoolId alone.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { supabase } from '@alfanumrik/lib/supabase';

export interface SchoolAdminAuthRecord {
  school_id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
}

export interface UseSchoolAdminAuthResult {
  /** Resolved school_id UUID. null while loading or on redirect-to-login. */
  schoolId: string | null;
  /** The caller's own school_admins row (school_id, name, email, role). */
  admin: SchoolAdminAuthRecord | null;
  /** true while AuthContext OR the school_admins lookup is still resolving. */
  isLoading: boolean;
  /** Non-null only when the lookup failed with a DB error (redirect still fires). */
  error: string | null;
}

export function useSchoolAdminAuth(): UseSchoolAdminAuthResult {
  const router = useRouter();
  const { authUserId, isLoading: authLoading } = useAuth();

  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [admin, setAdmin] = useState<SchoolAdminAuthRecord | null>(null);
  const [loadingAdmin, setLoadingAdmin] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAdminRecord = useCallback(async () => {
    if (!authUserId) return;
    setLoadingAdmin(true);
    setError(null);

    const { data, error: dbErr } = await supabase
      .from('school_admins')
      .select('school_id, name, email, role')
      .eq('auth_user_id', authUserId)
      .eq('is_active', true)
      .maybeSingle();

    if (dbErr || !data) {
      setError(dbErr?.message ?? null);
      router.replace('/login');
      return;
    }

    setSchoolId(data.school_id as string);
    setAdmin(data as SchoolAdminAuthRecord);
    setLoadingAdmin(false);
  }, [authUserId, router]);

  /* Step 1 — unauthenticated guard (mirrors the prior per-page effect). */
  useEffect(() => {
    if (!authLoading && !authUserId) {
      router.replace('/login');
    }
  }, [authLoading, authUserId, router]);

  /* Step 2 — fetch the school_admins record once auth resolves with a user. */
  useEffect(() => {
    if (!authLoading && authUserId) {
      void fetchAdminRecord();
    }
  }, [authLoading, authUserId, fetchAdminRecord]);

  return {
    schoolId,
    admin,
    isLoading: authLoading || loadingAdmin,
    error,
  };
}

export default useSchoolAdminAuth;
