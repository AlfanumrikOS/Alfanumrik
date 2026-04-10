'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, type UserRole } from './AuthContext';

/**
 * Hook to protect pages by authentication and optionally by role.
 * Redirects to '/' if not authenticated or wrong role.
 *
 * @param requiredRole - Optional role required to access the page
 * @returns { isReady, student, teacher, guardian, activeRole } - Auth state once resolved
 */
export function useRequireAuth(requiredRole?: UserRole) {
  const auth = useAuth();
  const router = useRouter();

  const { isLoading, isLoggedIn, activeRole, roles } = auth;

  useEffect(() => {
    if (isLoading) return;

    if (!isLoggedIn) {
      router.replace('/login');
      return;
    }

    if (requiredRole && requiredRole !== 'none' && !roles.includes(requiredRole)) {
      // User is logged in but doesn't have the required role
      router.replace('/dashboard');
    }
  }, [isLoading, isLoggedIn, activeRole, roles, requiredRole, router]);

  const isReady = !isLoading && isLoggedIn && (!requiredRole || requiredRole === 'none' || roles.includes(requiredRole));

  return {
    isReady,
    ...auth,
  };
}
