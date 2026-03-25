'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { AuthScreen } from '@/components/auth/AuthScreen';
import { LoadingFoxy } from '@/components/ui';

export default function LoginPage() {
  const { isLoggedIn, isLoading, activeRole } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  // Read ?role= query param to pre-select the correct tab
  const roleParam = searchParams.get('role');
  const initialRole: 'student' | 'teacher' | 'parent' =
    roleParam === 'teacher' ? 'teacher'
    : roleParam === 'parent' ? 'parent'
    : 'student';

  useEffect(() => {
    if (!isLoading && isLoggedIn) {
      // Redirect to the correct role dashboard after login/signup
      if (activeRole === 'teacher') router.replace('/teacher');
      else if (activeRole === 'guardian') router.replace('/parent');
      else router.replace('/dashboard');
    }
  }, [isLoggedIn, isLoading, activeRole, router]);

  if (isLoading) return <LoadingFoxy />;
  if (isLoggedIn) return <LoadingFoxy />;

  return (
    <AuthScreen
      initialRole={initialRole}
      onSuccess={() => {
        // After successful auth, refresh to trigger the redirect above
        window.location.href = '/login';
      }}
    />
  );
}
