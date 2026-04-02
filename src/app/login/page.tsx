'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AuthScreen } from '@/components/auth/AuthScreen';

/**
 * Returns the correct post-login destination based on user role.
 */
function getRoleDestination(role: string): string {
  switch (role) {
    case 'teacher': return '/teacher';
    case 'guardian': return '/parent';
    default: return '/dashboard';
  }
}

export default function LoginPage() {
  const { isLoggedIn, isLoading, activeRole } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const roleParam = searchParams.get('role');
  const redirectTo = searchParams.get('redirect');
  const initialRole: 'student' | 'teacher' | 'parent' =
    roleParam === 'teacher' ? 'teacher'
    : roleParam === 'parent' ? 'parent'
    : 'student';

  useEffect(() => {
    // Don't redirect if user explicitly wants to switch accounts
    const params = new URLSearchParams(window.location.search);
    if (params.get('switch') === 'true') return;

    if (!isLoading && isLoggedIn) {
      // If there's a redirect param, use it (for deep-link returns)
      if (redirectTo && redirectTo.startsWith('/')) {
        router.replace(redirectTo);
      } else {
        router.replace(getRoleDestination(activeRole));
      }
    }
  }, [isLoggedIn, isLoading, activeRole, router, redirectTo]);

  // Role-aware onSuccess handler: after login, navigate to the correct portal.
  // We use the roleParam hint from the URL since activeRole may not be updated yet.
  const handleSuccess = useCallback(() => {
    router.refresh();
    // Use redirect param if available, otherwise role-based destination.
    // The roleParam from URL is a hint for the initial redirect;
    // the useEffect above will correct if activeRole differs after auth loads.
    if (redirectTo && redirectTo.startsWith('/')) {
      router.replace(redirectTo);
    } else {
      const destination = roleParam === 'teacher' ? '/teacher'
        : roleParam === 'parent' ? '/parent'
        : '/dashboard';
      router.replace(destination);
    }
  }, [router, roleParam, redirectTo]);

  // Always show the login form — never block on loading state.
  // If the user is already logged in, the useEffect redirect will fire.
  // This prevents the infinite spinner when session is stale/expired.

  return (
    <AuthScreen
      initialRole={initialRole}
      onSuccess={handleSuccess}
    />
  );
}
