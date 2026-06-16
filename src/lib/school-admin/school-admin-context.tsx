/**
 * SchoolAdminContext — single source of truth for the resolved school identity
 * shared across all school-admin pages.
 *
 * SchoolAdminShell resolves schoolId once (from tenant context or DB) and
 * injects it here. Child pages consume useSchoolAdminCtx() instead of making
 * their own school_admins queries — eliminates the duplicate DB round-trip (RCA-04).
 *
 * Fail-safe: schoolId is null while resolving. Pages that guard on
 * `if (!schoolId) return <Skeleton />` continue to work correctly.
 */
'use client';

import { createContext, useContext } from 'react';

export interface SchoolAdminContextValue {
  /** Resolved school_id UUID. null while the shell is still loading identity. */
  schoolId: string | null;
  /** Resolved school display name (for page-level display). */
  schoolName: string | null;
  /** true while the school identity is still being fetched from DB. */
  isLoading: boolean;
}

export const SchoolAdminContext = createContext<SchoolAdminContextValue>({
  schoolId: null,
  schoolName: null,
  isLoading: true,
});

/**
 * Hook for child pages to consume the resolved school identity without
 * issuing their own school_admins queries.
 */
export function useSchoolAdminCtx(): SchoolAdminContextValue {
  return useContext(SchoolAdminContext);
}
