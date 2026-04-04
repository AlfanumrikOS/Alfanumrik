'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { getRoleDestination } from '@/lib/identity';

export default function LoginPage() {
  const { isLoggedIn, isLoading, activeRole } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const roleParam = searchParams.get('role');
  const redirectTo = searchParams.get('redirect');
  const errorParam = searchParams.get('error');
  const initialRole: 'student' | 'teacher' | 'parent' =
    roleParam === 'teacher' ? 'teacher'
    : roleParam === 'parent' ? 'parent'
    : 'student';

  useEffect(() => {
    // Don't redirect if user explicitly wants to switch accounts
    const params = new URLSearchParams(window.location.search);
    if (params.get('switch') === 'true') return;

    if (!isLoading && isLoggedIn && activeRole !== 'none') {
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
    // After successful auth, trigger a client-side refresh then navigate.
    // AuthContext's onAuthStateChange will detect the new session.
    router.refresh();
    const destination = redirectTo && redirectTo.startsWith('/')
      ? redirectTo
      : getRoleDestination(roleParam || 'student');
    router.replace(destination);
  }, [router, roleParam, redirectTo]);

  // Always show the login form — never block on loading state.
  // If the user is already logged in, the useEffect redirect will fire.
  // This prevents the infinite spinner when session is stale/expired.

  return (
    <div className="flex flex-col items-center min-h-dvh">
      {errorParam && (
        <div className="w-full max-w-sm mt-4 px-4">
          <div className="px-4 py-3 rounded-xl text-sm font-medium" style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)' }}>
            {errorParam === 'auth_callback_failed' ? 'Email verification failed. Please try signing up again.' :
             errorParam === 'verification_failed' ? 'Verification link expired or invalid. Please request a new one.' :
             'Authentication error. Please try again.'}
          </div>
        </div>
      )}
      <AuthScreen
        initialRole={initialRole}
        onSuccess={handleSuccess}
      />
    </div>
  );
}
