'use client';

import { useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { getRoleDestination } from '@/lib/identity';

export default function LoginPage() {
  const { isLoggedIn, isLoading, activeRole, isHi } = useAuth();
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
  //
  // Historical bug (2026-05-20): this used to call
  //   router.replace(getRoleDestination(roleParam || 'student'))
  // which sent every visitor to /dashboard whenever ?role= was absent — even
  // school_admins, who then saw the student-dashboard skeleton forever
  // because they had no `students` row.
  //
  // Fix: do NOT route from here. The useEffect above already handles the
  // redirect once AuthContext picks up the new session and resolves
  // activeRole via get_user_role (and its school_admin fallback). All we
  // need to do here is force a client-side refresh so that effect re-runs.
  //
  // Trade-off: if AuthContext takes >~2s to populate activeRole, the user
  // briefly sees the AuthScreen still rendered after submitting. That's a
  // degraded UX worth solving separately (e.g. a "Signing you in…" overlay),
  // but it is strictly better than mis-routing non-student roles.
  const handleSuccess = useCallback(() => {
    router.refresh();
  }, [router]);

  // Always show the login form — never block on loading state.
  // If the user is already logged in, the useEffect redirect will fire.
  // This prevents the infinite spinner when session is stale/expired.

  return (
    <div className="flex flex-col items-center min-h-dvh">
      {errorParam && (
        <div className="w-full max-w-sm mt-4 px-4">
          <div className="px-4 py-3 rounded-xl text-sm font-medium" style={{ background: '#FEE2E2', color: '#DC2626', border: '1px solid #FECACA' }}>
            {errorParam === 'auth_callback_failed'
              ? (isHi
                  ? 'ईमेल सत्यापन विफल। कृपया दोबारा साइन-अप करें।'
                  : 'Email verification failed. Please try signing up again.')
              : errorParam === 'verification_failed'
              ? (isHi
                  ? 'सत्यापन लिंक की अवधि समाप्त हो गई या यह अमान्य है। कृपया नया अनुरोध करें।'
                  : 'Verification link expired or invalid. Please request a new one.')
              : (isHi
                  ? 'प्रमाणीकरण त्रुटि। कृपया पुनः प्रयास करें।'
                  : 'Authentication error. Please try again.')}
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
