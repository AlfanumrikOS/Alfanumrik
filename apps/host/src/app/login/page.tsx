'use client';

import { useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@alfanumrik/lib/AuthContext';
import { AuthScreen } from '@alfanumrik/ui/auth/AuthScreen';
import { getRoleDestination, validateRedirectTarget } from '@alfanumrik/lib/identity';
import { setPendingInvite } from '@alfanumrik/lib/school/pending-invite';
import { Alert } from '@alfanumrik/ui/ui/primitives';

function LoginPageContent() {
  const { isLoggedIn, isLoading, activeRole, isHi } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const roleParam = searchParams.get('role');
  const redirectTo = searchParams.get('redirect');
  const errorParam = searchParams.get('error');
  // School invite-code redemption (B2B day-1 path). `/join` forwards
  // unauthenticated joiners here as `/login?school=<slug>&code=<code>`. We
  // persist the code so it survives the email-verification round-trip; once a
  // session AND profile exist, AuthContext redeems it via /api/schools/join.
  const codeParam = searchParams.get('code');
  // institution_admin is included so a school admin opening an invite link
  // lands on the right tab; the redeemed link itself is role-driven server-side.
  const initialRole: 'student' | 'teacher' | 'parent' | 'institution_admin' =
    roleParam === 'teacher' ? 'teacher'
    : roleParam === 'parent' ? 'parent'
    : roleParam === 'institution_admin' || roleParam === 'school' ? 'institution_admin'
    : 'student';

  // Persist a pending invite code as early as possible (before any signup /
  // verification redirect). Idempotent and bilingual-agnostic.
  useEffect(() => {
    if (codeParam) setPendingInvite(codeParam);
  }, [codeParam]);

  useEffect(() => {
    // Don't redirect if user explicitly wants to switch accounts
    const params = new URLSearchParams(window.location.search);
    if (params.get('switch') === 'true') return;

    if (!isLoading && isLoggedIn && activeRole !== 'none') {
      // If there's a redirect param, use it (for deep-link returns).
      // M1: validateRedirectTarget blocks open redirects (`//evil.com`,
      // backslashes, encoded slashes) — invalid targets fall back to the
      // role-based destination.
      const roleDestination = getRoleDestination(activeRole);
      router.replace(
        redirectTo ? validateRedirectTarget(redirectTo, roleDestination) : roleDestination
      );
    }
  }, [isLoggedIn, isLoading, activeRole, router, redirectTo]);

  // Role-aware onSuccess handler: after login, navigate to the correct portal.
  // We use the roleParam hint from the URL since activeRole may not be updated yet.
  const handleSuccess = useCallback(() => {
    // After successful auth, trigger a client-side refresh then navigate.
    // AuthContext's onAuthStateChange will detect the new session.
    router.refresh();
    // M1: same open-redirect guard as the already-logged-in effect above.
    const roleDestination = getRoleDestination(roleParam || 'student');
    const destination = redirectTo
      ? validateRedirectTarget(redirectTo, roleDestination)
      : roleDestination;
    router.replace(destination);
  }, [router, roleParam, redirectTo]);

  // Always show the login form — never block on loading state.
  // If the user is already logged in, the useEffect redirect will fire.
  // This prevents the infinite spinner when session is stale/expired.

  return (
    <div className="flex flex-col items-center min-h-dvh">
      {errorParam && (
        <div className="w-full max-w-sm mt-4 px-4">
          <Alert tone="danger">
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
          </Alert>
        </div>
      )}
      <AuthScreen
        initialRole={initialRole}
        onSuccess={handleSuccess}
      />
    </div>
  );
}

/**
 * Suspense boundary required by Next.js App Router when using useSearchParams().
 *
 * Without this, Next.js renders the page on the server with null searchParams
 * and hydrates on the client with the actual URL values — any JSX that renders
 * a different text node (e.g. the ?error= message) causes React #418 hydration
 * mismatch. The Suspense boundary tells React to defer SSR of this content;
 * the fallback is null since the auth form is instant-loading on the client.
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginPageContent />
    </Suspense>
  );
}
